import express from 'express';
import Redis from 'ioredis';
import crypto from 'crypto';
import Stripe from 'stripe';
import { initPgCache, isPgAvailable, isVectorAvailable, pgSet, pgGet, pgDel, pgClear, pgStats, pgCleanup, pgSemanticSearch, pgFindSimilar, pgClearByModel, pgGetKeys, pgStatsByModel, pgPrefixSearch, pgRefreshTTL, CacheEntry, pool } from './services/pgCache';
import {
  estimateTokens,
  estimateContextUtilization,
  shouldCompact,
  compactContext,
  orderForKVCaching,
  maskObservation,
  autoMaskToolOutputs,
  partitionContext,
  shouldPartition,
  generateOptimizationReport,
  type OptimizationReport,
  type KVCachePrompt,
} from './middleware/contextOptimization';
import { apiKeyAuth, optionalApiKeyAuth } from './middleware/apiKeyAuth';
import { rateLimiter } from './middleware/rateLimit';
import { recordRequest, getUsageStats, TIERS } from './services/usageLimits';
import { analytics } from './services/analytics';
import { extractPromptDNA, explainDNA, calculateSimilarity, findSimilarPrompts } from './services/promptDNA';
import { TEMPLATES, applyTemplate, transformResponse } from './services/templates';
import { webhookNotifier } from './services/webhooks';
import { healthMonitor } from './services/healthMonitor';
import { createAnalyticsRouter, recordAnalytics } from './services/analyticsRouter';
import { getAPIKeyTier } from './services/apiKeys';

// Stripe setup
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2026-02-25.clover' as any,
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize PostgreSQL cache
initPgCache().then(() => {});

// Redis client (optional - falls back to memory)
let redis: Redis | null = null;
let useRedis = false;

try {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  redis.on('error', () => {
    console.log('⚠️ Redis unavailable, using in-memory cache');
    redis = null;
  });
  redis.on('connect', () => {
    console.log('🔗 Connected to Redis');
    useRedis = true;
  });
} catch {
  console.log('⚠️ Redis not available, using in-memory cache');
}

// In-memory fallback
interface MemCacheEntry {
  prompt: string;
  response: string;
  model: string;
  createdAt: number;
  ttl: number;
  hits: number;
}
const memoryCache = new Map<string, MemCacheEntry>();

// ===== Request Deduplication (prevents duplicate LLM calls) =====
const inFlightRequests = new Map<string, { promise: Promise<any>; resolve: Function; reject: Function; createdAt: number }>();
const IN_FLIGHT_TTL = 30000; // 30 seconds timeout for pending requests

// Clean up stale in-flight requests periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, req] of inFlightRequests.entries()) {
    if (now - req.createdAt > IN_FLIGHT_TTL) {
      req.reject(new Error('Request timeout'));
      inFlightRequests.delete(key);
    }
  }
}, 10000);

// Register an in-flight request - returns existing promise if already in progress
function registerInFlightRequest(key: string): { isDuplicate: boolean; promise?: Promise<any> } {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return { isDuplicate: true, promise: existing.promise };
  }
  
  let resolveFn: Function;
  let rejectFn: Function;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  
  inFlightRequests.set(key, { 
    promise, 
    resolve: resolveFn!, 
    reject: rejectFn!, 
    createdAt: Date.now() 
  });
  
  return { isDuplicate: false };
}

// Complete an in-flight request (called when LLM responds)
function completeInFlightRequest(key: string, response: any, isError = false) {
  const req = inFlightRequests.get(key);
  if (req) {
    if (isError) {
      req.reject(response);
    } else {
      req.resolve(response);
    }
    inFlightRequests.delete(key);
  }
}

function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

function isExpired(entry: { createdAt: number; ttl: number }): boolean {
  return Date.now() > entry.createdAt + entry.ttl;
}

// Get best available backend
function getBackend(): 'pg' | 'redis' | 'memory' {
  if (isPgAvailable()) return 'pg';
  if (useRedis) return 'redis';
  return 'memory';
}

// Health with cache status
app.get('/health', async (req, res) => {
  const memSize = memoryCache.size;
  let redisSize = 0;
  let pgSize = 0;

  if (useRedis && redis) {
    try {
      redisSize = await redis.dbsize();
    } catch {}
  }
  
  if (isPgAvailable()) {
    try {
      const pg = await pgStats();
      pgSize = pg.entries;
    } catch {}
  }

  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    cache: {
      backend: getBackend(),
      pgEntries: pgSize,
      redisEntries: redisSize,
      memoryEntries: memSize
    }
  });
});

// Cache a prompt with TTL (rate limited: 100 req/min)
app.post('/cache', rateLimiter({ windowMs: 60000, maxRequests: 100 }), async (req, res) => {
  const apiKey = req.headers['x-api-key'] as string;
  const usage = apiKey ? recordRequest(apiKey, false) : { allowed: true, remaining: -1, tier: 'free' };
  
  if (!usage.allowed) {
    return res.status(429).json({ error: 'Daily limit exceeded', tier: usage.tier, remaining: 0 });
  }
  
  const { prompt, response, model, ttl: rawTtl } = req.body;
  const modelKey = model || 'default';
  const modelCfg = cacheConfig.defaults[modelKey] || cacheConfig.defaults['default'];
  const ttl = rawTtl !== undefined ? effectiveTtl(modelKey, rawTtl) : modelCfg.ttl;
  
  if (!prompt || !response) {
    return res.status(400).json({ error: 'prompt and response required' });
  }

  const key = hashPrompt(prompt);
  const entry: CacheEntry = { 
    prompt, 
    response, 
    model: model || 'gpt-4', 
    createdAt: Date.now(), 
    ttl, 
    hits: 0 
  };

  // Try PostgreSQL first
  if (isPgAvailable()) {
    const ok = await pgSet(key, entry);
    if (ok) {
      return res.json({ success: true, key, backend: 'pg' });
    }
  }

  // Try Redis
  if (useRedis && redis) {
    try {
      await redis.setex(`prompt:${key}`, Math.floor(ttl / 1000), JSON.stringify(entry));
      return res.json({ success: true, key, backend: 'redis' });
    } catch (e) {
      console.error('Redis write failed, falling back to memory');
    }
  }

  // Fall back to memory
  memoryCache.set(key, entry);
  res.json({ success: true, key, backend: 'memory' });
});

// Stream cached response or proxy+cache LLM streaming response via SSE
app.post('/cache/stream', async (req, res) => {
  const apiKey = req.headers['x-api-key'] as string;
  const usage = apiKey ? recordRequest(apiKey, false) : { allowed: true, remaining: -1, tier: 'free' };

  if (!usage.allowed) {
    return res.status(429).json({ error: 'Daily limit exceeded', tier: usage.tier, remaining: 0 });
  }

  const { prompt, model = 'gpt-4', llmEndpoint, llmKey, ttl: rawTtl, template, uppercase, lowercase, trim = true, escape } = req.body;
  const modelCfg = cacheConfig.defaults[model] || cacheConfig.defaults['default'];
  const ttl = rawTtl !== undefined ? effectiveTtl(model, rawTtl) : modelCfg.ttl;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt required' });
  }

  const key = hashPrompt(prompt);
  const startTime = Date.now();

  // 1. Check cache first
  let entry: CacheEntry | null = null;

  if (isPgAvailable()) {
    entry = await pgGet(key);
  }

  if (!entry && useRedis && redis) {
    try {
      const data = await redis.get(`prompt:${key}`);
      if (data) entry = JSON.parse(data);
    } catch {}
  }

  if (!entry) {
    entry = memoryCache.get(key) || null;
  }

  if (entry && !isExpired(entry)) {
    // Cache HIT — stream cached response via SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Cache-Status', 'HIT');
    res.setHeader('X-Cache-Backend', getBackend());

    const streamId = `cache-${Date.now()}`;
    const age = Date.now() - entry.createdAt;

    res.write(`event: meta\n`);
    res.write(`data: ${JSON.stringify({ cached: true, key, model: entry.model, age, hits: entry.hits + 1, backend: getBackend() })}\n\n`);

    // Stream the response word-by-word with slight delays for realism
    let streamedResponse = entry.response;
    if (template || uppercase || lowercase || escape) {
      streamedResponse = transformResponse(streamedResponse, { template, uppercase, lowercase, trim, escape });
    }
    const words = streamedResponse.split(' ');
    for (let i = 0; i < words.length; i++) {
      res.write(`event: chunk\n`);
      res.write(`data: ${JSON.stringify({ text: words[i] + (i < words.length - 1 ? ' ' : ''), done: false })}\n\n`);
      await new Promise(r => setImmediate(r));
    }

    // Update hits (fire-and-forget)
    if (isPgAvailable()) {
      entry.hits++;
      pgSet(key, entry).catch(() => {});
    } else if (useRedis && redis) {
      entry.hits++;
      redis.set(`prompt:${key}`, JSON.stringify(entry), 'EX', Math.floor((entry.createdAt + entry.ttl - Date.now()) / 1000)).catch(() => {});
    } else {
      entry.hits++;
      memoryCache.set(key, entry);
    }

    const latency = Date.now() - startTime;
    analytics.recordRequest(true, latency, entry.model, false, apiKey);
    recordAnalytics(apiKey, true, latency, entry.model);

    res.write(`event: done\n`);
    res.write(`data: ${JSON.stringify({ latency, cached: true })}\n\n`);
    res.end();
    return;
  }

  // 2. Cache MISS — stream from LLM and cache while streaming
  if (!llmEndpoint || !llmKey) {
    return res.status(400).json({ error: 'llmEndpoint and llmKey required on cache miss (or pre-cache with POST /cache)' });
  }

  // Stream the LLM response
  let fullResponse = '';

  try {
    const llmRes = await fetch(llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      return res.status(502).json({ error: 'LLM request failed', details: errText });
    }

    if (!llmRes.body) {
      return res.status(502).json({ error: 'LLM returned no stream body' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Cache-Status', 'MISS');
    res.setHeader('X-Cache-Backend', getBackend());
    res.setHeader('X-Cache-Key', key);

    const streamId = `llm-${Date.now()}`;

    res.write(`event: meta\n`);
    res.write(`data: ${JSON.stringify({ cached: false, key, model, streamId })}\n\n`);

    const reader = llmRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const text = parsed.choices?.[0]?.delta?.content || parsed.delta?.content || '';
          if (text) {
            fullResponse += text;
            res.write(`event: chunk\n`);
            res.write(`data: ${JSON.stringify({ text, done: false })}\n\n`);
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Cache the complete response
    if (fullResponse) {
      const cacheEntry: CacheEntry = {
        prompt,
        response: fullResponse,
        model,
        createdAt: Date.now(),
        ttl,
        hits: 1,
      };

      if (isPgAvailable()) {
        pgSet(key, cacheEntry).catch(() => {});
      } else if (useRedis && redis) {
        redis.setex(`prompt:${key}`, Math.floor(ttl / 1000), JSON.stringify(cacheEntry)).catch(() => {});
      } else {
        memoryCache.set(key, cacheEntry);
      }
    }

    const latency = Date.now() - startTime;
    analytics.recordRequest(false, latency, model, false, apiKey);
    recordAnalytics(apiKey, false, latency, model);

    res.write(`event: done\n`);
    res.write(`data: ${JSON.stringify({ latency, cached: false, key, fullResponse: fullResponse.length })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('Stream error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Stream failed', details: err.message });
    }
    res.end();
  }
});

// Batch cache multiple prompts at once
app.post('/cache/batch', optionalApiKeyAuth, async (req, res) => {
  const { entries } = req.body;
  
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries array required' });
  }
  
  if (entries.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 entries per batch' });
  }
  
  const ttl = req.body.ttl || 3600000;
  const results: Array<{ success: boolean; key: string; error?: string }> = [];
  
  for (const item of entries) {
    const { prompt, response, model } = item;
    
    if (!prompt || !response) {
      results.push({ success: false, key: '', error: 'prompt and response required' });
      continue;
    }
    
    const key = hashPrompt(prompt);
    const entry: CacheEntry = {
      prompt,
      response,
      model: model || 'gpt-4',
      createdAt: Date.now(),
      ttl,
      hits: 0
    };
    
    let ok = false;
    
    // Try PostgreSQL first
    if (isPgAvailable()) {
      ok = await pgSet(key, entry);
    }
    
    // Try Redis
    if (!ok && useRedis && redis) {
      try {
        await redis.setex(`prompt:${key}`, Math.floor(ttl / 1000), JSON.stringify(entry));
        ok = true;
      } catch {}
    }
    
    // Fall back to memory
    if (!ok) {
      memoryCache.set(key, entry);
      ok = true;
    }
    
    results.push({ success: ok, key });
  }
  
  const successCount = results.filter(r => r.success).length;
  
  res.json({
    success: true,
    total: entries.length,
    cached: successCount,
    failed: entries.length - successCount,
    results,
    backend: getBackend()
  });
});

// Batch get multiple cached prompts
app.get('/cache/batch', optionalApiKeyAuth, async (req, res) => {
  const prompts = (req.query.prompts as string)?.split(',').map(p => p.trim()).filter(Boolean) || [];
  
  if (prompts.length === 0) {
    return res.status(400).json({ error: 'prompts query parameter required (comma-separated)' });
  }
  
  if (prompts.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 prompts per batch' });
  }
  
  const results = [];
  
  for (const prompt of prompts) {
    const key = hashPrompt(prompt);
    let entry: CacheEntry | null = null;
    let backend = 'memory';
    
    // Try PostgreSQL first
    if (isPgAvailable()) {
      entry = await pgGet(key);
      if (entry) backend = 'pg';
    }
    
    // Try Redis
    if (!entry && useRedis && redis) {
      try {
        const data = await redis.get(`prompt:${key}`);
        if (data) {
          entry = JSON.parse(data);
          backend = 'redis';
        }
      } catch {}
    }
    
    // Try memory
    if (!entry) {
      entry = memoryCache.get(key) || null;
      backend = 'memory';
    }
    
    if (!entry) {
      // Try semantic search
      if (isPgAvailable() && isVectorAvailable()) {
        const semanticEntry = await pgSemanticSearch(prompt);
        if (semanticEntry) {
          results.push({
            prompt,
            cached: true,
            semantic: true,
            response: semanticEntry.response,
            model: semanticEntry.model,
            backend: 'pg-semantic'
          });
          continue;
        }
      }
      results.push({ prompt, cached: false });
      continue;
    }
    
    // Check TTL
    if (isExpired(entry)) {
      if (isPgAvailable()) await pgDel(key);
      else if (useRedis && redis) await redis.del(`prompt:${key}`);
      else memoryCache.delete(key);
      
      results.push({ prompt, cached: false, expired: true });
      continue;
    }
    
    entry.hits++;
    
    // Update hits
    if (isPgAvailable()) {
      await pgSet(key, entry);
    } else if (useRedis && redis) {
      await redis.set(`prompt:${key}`, JSON.stringify(entry), 'EX', Math.floor((entry.createdAt + entry.ttl - Date.now()) / 1000));
    } else {
      memoryCache.set(key, entry);
    }
    
    results.push({
      prompt,
      cached: true,
      response: entry.response,
      model: entry.model,
      hits: entry.hits,
      age: Date.now() - entry.createdAt,
      backend
    });
  }
  
  const hitCount = results.filter(r => r.cached).length;
  
  // Add rate limit headers
  res.set('RateLimit-Limit', '200');
  res.set('RateLimit-Remaining', String(Math.max(0, 200 - prompts.length)));
  res.set('Cache-Hits', String(hitCount));
  res.set('Cache-Misses', String(prompts.length - hitCount));
  
  res.json({
    total: prompts.length,
    hits: hitCount,
    misses: prompts.length - hitCount,
    results,
    backend: getBackend()
  });
});

// Cache Warmer - pre-populate cache with prompts using an LLM function
// This endpoint accepts a list of prompts and a function to generate responses
app.post('/cache/warm', optionalApiKeyAuth, async (req, res) => {
  const { prompts, model, ttl, generateResponse } = req.body;
  
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: 'prompts array required' });
  }
  
  if (prompts.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 prompts per warm request' });
  }
  
  const warmTtl = ttl || 3600000; // default 1 hour
  const warmModel = model || 'gpt-4';
  
  // If generateResponse is provided as a function reference, use it
  // Otherwise, expect responses to be passed directly
  const results: Array<{ prompt: string; success: boolean; error?: string }> = [];
  let warmed = 0;
  
  if (typeof generateResponse === 'function') {
    // Server-side warming (limited use - function won't serialize)
    return res.status(400).json({ error: 'generateResponse must be an API endpoint, not a function' });
  }
  
  // Accept pre-generated responses or call external LLM endpoint
  for (const item of prompts) {
    const prompt = typeof item === 'string' ? item : item.prompt;
    const response = typeof item === 'string' ? null : item.response;
    
    if (!prompt) {
      results.push({ prompt: '', success: false, error: 'prompt required' });
      continue;
    }
    
    let cachedResponse = response;
    
    // If no response provided, try to call external LLM (placeholder - user configures)
    if (!cachedResponse) {
      // Call external LLM if endpoint configured
      const llmEndpoint = process.env.LLM_WARM_ENDPOINT;
      const llmKey = process.env.LLM_WARM_KEY;
      
      if (llmEndpoint && llmKey) {
        try {
          const llmRes = await fetch(llmEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${llmKey}`
            },
            body: JSON.stringify({ prompt, model: warmModel })
          });
          const llmData = await llmRes.json() as { response?: string; content?: string; text?: string };
          cachedResponse = llmData.response || llmData.content || llmData.text;
        } catch (e: any) {
          results.push({ prompt, success: false, error: e.message });
          continue;
        }
      } else {
        results.push({ prompt, success: false, error: 'No response provided and LLM endpoint not configured' });
        continue;
      }
    }
    
    if (!cachedResponse) {
      results.push({ prompt, success: false, error: 'No response generated' });
      continue;
    }
    
    const key = hashPrompt(prompt);
    const entry: CacheEntry = {
      prompt,
      response: cachedResponse,
      model: warmModel,
      createdAt: Date.now(),
      ttl: warmTtl,
      hits: 0
    };
    
    let ok = false;
    
    if (isPgAvailable()) {
      ok = await pgSet(key, entry);
    }
    
    if (!ok && useRedis && redis) {
      try {
        await redis.setex(`prompt:${key}`, Math.floor(warmTtl / 1000), JSON.stringify(entry));
        ok = true;
      } catch {}
    }
    
    if (!ok) {
      memoryCache.set(key, entry);
      ok = true;
    }
    
    if (ok) warmed++;
    results.push({ prompt, success: ok, error: ok ? undefined : 'Failed to cache' });
  }
  
  res.json({
    success: true,
    total: prompts.length,
    warmed,
    failed: prompts.length - warmed,
    results,
    backend: getBackend()
  });
});

// Trigger manual cache cleanup
app.post('/cache/cleanup', async (req, res) => {
  let cleaned = 0;
  
  if (isPgAvailable()) {
    cleaned = await pgCleanup();
  }
  
  // Also clean memory cache
  for (const [key, entry] of memoryCache.entries()) {
    if (isExpired(entry)) {
      memoryCache.delete(key);
      cleaned++;
    }
  }
  
  res.json({
    success: true,
    cleaned,
    backend: getBackend(),
    timestamp: new Date().toISOString()
  });
});

// Clear cache by model
app.delete('/cache/model/:model', async (req, res) => {
  const { model } = req.params;
  
  if (!model) {
    return res.status(400).json({ error: 'model parameter required' });
  }
  
  let cleared = 0;
  
  if (isPgAvailable()) {
    cleared = await pgClearByModel(model);
  } else if (useRedis && redis) {
    try {
      const keys = await redis.keys(`prompt:*`);
      let deleted = 0;
      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const entry = JSON.parse(data);
          if (entry.model === model) {
            await redis.del(key);
            deleted++;
          }
        }
      }
      cleared = deleted;
    } catch {}
  } else {
    for (const [key, entry] of memoryCache.entries()) {
      if (entry.model === model) {
        memoryCache.delete(key);
        cleared++;
      }
    }
  }
  
  res.json({ success: true, model, cleared });
});

// List all cache keys
app.get('/cache/keys', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
  const offset = parseInt(req.query.offset as string) || 0;
  
  let keys: Array<{key: string; model: string; hits: number; createdAt: number; ttl: number}> = [];
  let backend = 'memory';
  
  if (isPgAvailable()) {
    keys = await pgGetKeys(limit, offset);
    backend = 'pg';
  } else if (useRedis && redis) {
    try {
      const allKeys = await redis.keys('prompt:*');
      const paginatedKeys = allKeys.slice(offset, offset + limit);
      for (const k of paginatedKeys) {
        const data = await redis.get(k);
        if (data) {
          const entry = JSON.parse(data);
          keys.push({
            key: k.replace('prompt:', ''),
            model: entry.model,
            hits: entry.hits,
            createdAt: entry.createdAt,
            ttl: entry.ttl
          });
        }
      }
      backend = 'redis';
    } catch {}
  } else {
    let i = 0;
    for (const [key, entry] of memoryCache) {
      if (i >= offset && i < offset + limit) {
        keys.push({ key, model: entry.model, hits: entry.hits, createdAt: entry.createdAt, ttl: entry.ttl });
      }
      i++;
    }
    backend = 'memory';
  }
  
  res.json({ keys, backend, limit, offset, count: keys.length });
});

// Get cache stats by model
app.get('/cache/stats/by-model', async (req, res) => {
  let stats: Record<string, { count: number; hits: number }> = {};
  let backend = getBackend();
  
  if (backend === 'pg') {
    stats = await pgStatsByModel();
  } else if (backend === 'redis' && redis) {
    try {
      const keys = await redis.keys('prompt:*');
      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const entry = JSON.parse(data);
          const model = entry.model || 'unknown';
          if (!stats[model]) {
            stats[model] = { count: 0, hits: 0 };
          }
          stats[model].count++;
          stats[model].hits += entry.hits || 0;
        }
      }
    } catch {}
  } else {
    for (const entry of memoryCache.values()) {
      const model = entry.model || 'unknown';
      if (!stats[model]) {
        stats[model] = { count: 0, hits: 0 };
      }
      stats[model].count++;
      stats[model].hits += entry.hits || 0;
    }
  }
  
  res.json({ stats, backend });
});

// Prefix search - find cached prompts by prefix (for autocomplete)
app.get('/cache/search', optionalApiKeyAuth, async (req, res) => {
  const prefix = req.query.prefix as string;
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
  
  if (!prefix || prefix.length < 2) {
    return res.status(400).json({ error: 'Prefix must be at least 2 characters' });
  }
  
  const backend = getBackend();
  let results: CacheEntry[] = [];
  
  if (backend === 'pg') {
    results = await pgPrefixSearch(prefix, limit);
  } else if (backend === 'redis' && redis) {
    try {
      const keys = await redis.keys('prompt:*');
      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const entry = JSON.parse(data);
          if (entry.prompt.toLowerCase().startsWith(prefix.toLowerCase())) {
            results.push(entry);
            if (results.length >= limit) break;
          }
        }
      }
    } catch {}
  } else {
    for (const entry of memoryCache.values()) {
      if (entry.prompt.toLowerCase().startsWith(prefix.toLowerCase())) {
        results.push(entry);
        if (results.length >= limit) break;
      }
    }
  }
  
  res.json({ 
    prefix, 
    results: results.map(e => ({ prompt: e.prompt, model: e.model, hits: e.hits, age: Date.now() - e.createdAt })),
    count: results.length,
    backend 
  });
});

// Find semantically similar cached prompts
app.get('/cache/similar/:prompt(*)', optionalApiKeyAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);
  const prompt = req.params.prompt;
  
  if (!prompt || prompt.trim().length < 3) {
    return res.status(400).json({ error: 'prompt must be at least 3 characters' });
  }
  
  const backend = getBackend();
  
  if (backend !== 'pg' || !isPgAvailable() || !isVectorAvailable()) {
    return res.status(503).json({ 
      error: 'Semantic search requires PostgreSQL with vector support',
      backend 
    });
  }
  
  const similar = await pgFindSimilar(prompt, limit);
  
  res.json({
    prompt,
    similar: similar.map(e => ({
      prompt: e.prompt,
      response: e.response,
      model: e.model,
      similarity: Math.round(e.similarity * 100) / 100,
      hits: e.hits,
      age: Date.now() - e.createdAt,
    })),
    count: similar.length,
    backend: 'pg'
  });
});

// List all available response templates
app.get('/cache/templates', optionalApiKeyAuth, (req, res) => {
  const format = req.query.format as string;
  
  if (format === 'ids') {
    return res.json({ templates: TEMPLATES.map(t => t.id) });
  }
  
  res.json({
    templates: TEMPLATES.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      format: t.format,
    })),
    count: TEMPLATES.length
  });
});

// Analyze a prompt's DNA - fingerprint + category + complexity + similar cached entries
app.post('/cache/analyze', optionalApiKeyAuth, async (req, res) => {
  const { prompt } = req.body;
  
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
    return res.status(400).json({ error: 'prompt (string, min 3 chars) is required' });
  }
  
  const dna = extractPromptDNA(prompt);
  
  // Find similar cached entries using prompt DNA
  let similarPrompts: Array<{ prompt: string; similarity: number; response: string; model: string }> = [];
  
  if (isPgAvailable() && isVectorAvailable()) {
    try {
      const pgSimilar = await pgFindSimilar(prompt, 5);
      similarPrompts = pgSimilar.map(e => ({
        prompt: e.prompt,
        response: e.response,
        model: e.model,
        similarity: Math.round(e.similarity * 100) / 100
      }));
    } catch {}
  }
  
  // Also try in-memory DNA-based search across memory cache
  if (similarPrompts.length === 0) {
    const targetDNA = dna;
    for (const [key, entry] of memoryCache) {
      if (isExpired(entry)) continue;
      const entryDNA = extractPromptDNA(entry.prompt);
      const sim = calculateSimilarity(targetDNA, entryDNA);
      if (sim >= 0.5) {
        similarPrompts.push({
          prompt: entry.prompt,
          response: entry.response,
          model: entry.model,
          similarity: Math.round(sim * 100) / 100
        });
      }
    }
    similarPrompts.sort((a, b) => b.similarity - a.similarity);
    similarPrompts = similarPrompts.slice(0, 5);
  }
  
  res.json({
    prompt,
    dna: {
      fingerprint: dna.dna,
      category: dna.category,
      complexity: dna.complexity,
      complexityLabel: ['Very Simple', 'Simple', 'Basic', 'Intermediate', 'Advanced', 'Complex', 'Very Complex', 'Expert', 'Specialized', 'Highly Specialized', 'Cutting Edge'][dna.complexity],
      keywords: dna.keywords,
      length: dna.length
    },
    similarPrompts,
    templates: {
      suggested: dna.category === 'code' ? ['json', 'markdown-list'] 
        : dna.category === 'write' ? ['markdown-list', 'html-wrapper', 'json-structured']
        : dna.category === 'creative' ? ['markdown-list', 'text-plain']
        : ['json', 'markdown-list', 'text-plain'],
      available: TEMPLATES.map(t => t.id)
    }
  });
});

// Refresh TTL - extend expiration of existing cache entry
app.put('/cache/refresh', optionalApiKeyAuth, async (req, res) => {
  const { prompt, ttl } = req.body;
  const newTtl = ttl || 3600000; // default 1 hour
  
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  
  const key = hashPrompt(prompt);
  const backend = getBackend();
  let success = false;
  
  if (backend === 'pg') {
    success = await pgRefreshTTL(key, newTtl);
  } else if (backend === 'redis' && redis) {
    try {
      const data = await redis.get(`prompt:${key}`);
      if (data) {
        const entry = JSON.parse(data);
        entry.createdAt = Date.now();
        entry.ttl = newTtl;
        await redis.set(`prompt:${key}`, JSON.stringify(entry));
        success = true;
      }
    } catch {}
  } else {
    const entry = memoryCache.get(key);
    if (entry) {
      entry.createdAt = Date.now();
      entry.ttl = newTtl;
      memoryCache.set(key, entry);
      success = true;
    }
  }
  
  if (success) {
    res.json({ success: true, key, newTtl, backend });
  } else {
    res.status(404).json({ error: 'Cache entry not found' });
  }
});

// ═══════════════════════════════════════════════════════════════
// CACHE CONFIGURATION — model-specific TTLs, strategies, presets
// ═══════════════════════════════════════════════════════════════

type CacheStrategy = 'balanced' | 'aggressive' | 'conservative';

interface ModelConfig {
  ttl: number;
  maxAge: number;
  hitBoost: boolean;
}

interface CacheConfig {
  defaultStrategy: CacheStrategy;
  defaults: Record<string, ModelConfig>;
  globalMaxTtl: number;
  evictionPolicy: 'lru' | 'ttl' | 'hits';
}

const PRESETS: Record<CacheStrategy, Partial<CacheConfig>> = {
  balanced: {
    globalMaxTtl: 4 * 60 * 60 * 1000,
    evictionPolicy: 'ttl',
  },
  aggressive: {
    globalMaxTtl: 24 * 60 * 60 * 1000,
    evictionPolicy: 'hits',
  },
  conservative: {
    globalMaxTtl: 60 * 60 * 1000,
    evictionPolicy: 'ttl',
  },
};

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  ttl: 3600000,
  maxAge: 86400000,
  hitBoost: true,
};

const cacheConfig: CacheConfig = {
  defaultStrategy: 'balanced',
  defaults: {
    'gpt-4':          { ttl: 3600000,  maxAge: 86400000,  hitBoost: true },
    'gpt-4-turbo':    { ttl: 1800000,  maxAge: 43200000,  hitBoost: true },
    'gpt-3.5-turbo':  { ttl: 7200000,  maxAge: 172800000, hitBoost: true },
    'claude-3':       { ttl: 3600000,  maxAge: 86400000,  hitBoost: true },
    'claude-3.5':     { ttl: 1800000,  maxAge: 43200000,  hitBoost: true },
    'default':        { ...DEFAULT_MODEL_CONFIG },
  },
  globalMaxTtl: PRESETS.balanced.globalMaxTtl!,
  evictionPolicy: 'ttl',
};

function applyStrategy(strategy: CacheStrategy) {
  const preset = PRESETS[strategy];
  if (preset.globalMaxTtl) cacheConfig.globalMaxTtl = preset.globalMaxTtl;
  if (preset.evictionPolicy) cacheConfig.evictionPolicy = preset.evictionPolicy;
  cacheConfig.defaultStrategy = strategy;
}

function effectiveTtl(model: string, requestedTtl: number): number {
  const modelCfg = cacheConfig.defaults[model] || cacheConfig.defaults['default'];
  const maxAllowed = Math.min(requestedTtl, modelCfg.maxAge, cacheConfig.globalMaxTtl);
  return Math.max(60000, maxAllowed);
}

function parseDuration(s: string): number | null {
  const match = String(s).match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[match[2]];
}

// GET /cache/config — return current cache configuration
app.get('/cache/config', optionalApiKeyAuth, (_req, res) => {
  res.json({
    strategy: cacheConfig.defaultStrategy,
    globalMaxTtl: cacheConfig.globalMaxTtl,
    globalMaxTtlLabel: `${Math.round(cacheConfig.globalMaxTtl / 3600000)}h`,
    evictionPolicy: cacheConfig.evictionPolicy,
    modelDefaults: Object.fromEntries(
      Object.entries(cacheConfig.defaults).map(([k, v]) => [
        k,
        { ...v, ttlLabel: `${Math.round(v.ttl / 60000)}m`, maxAgeLabel: `${Math.round(v.maxAge / 3600000)}h` },
      ])
    ),
    presets: Object.fromEntries(
      Object.entries(PRESETS).map(([k, v]) => [
        k,
        { ...v, globalMaxTtlLabel: v.globalMaxTtl ? `${Math.round(v.globalMaxTtl / 3600000)}h` : null },
      ])
    ),
  });
});

// POST /cache/config — update cache configuration
app.post('/cache/config', optionalApiKeyAuth, (req, res) => {
  const { strategy, model, ttl, maxAge, globalMaxTtl, evictionPolicy } = req.body;
  const changes: string[] = [];

  if (strategy) {
    if (!PRESETS[strategy as CacheStrategy]) {
      return res.status(400).json({ error: `Invalid strategy. Use: ${Object.keys(PRESETS).join(', ')}` });
    }
    applyStrategy(strategy as CacheStrategy);
    changes.push(`strategy=${strategy}`);
  }

  if (globalMaxTtl !== undefined) {
    const ms = typeof globalMaxTtl === 'number' ? globalMaxTtl : parseDuration(String(globalMaxTtl));
    if (!ms || ms < 60000) {
      return res.status(400).json({ error: 'globalMaxTtl must be >= 60000ms (1 minute)' });
    }
    cacheConfig.globalMaxTtl = ms;
    changes.push(`globalMaxTtl=${ms}ms`);
  }

  if (evictionPolicy) {
    if (!['lru', 'ttl', 'hits'].includes(evictionPolicy)) {
      return res.status(400).json({ error: 'evictionPolicy must be: lru, ttl, or hits' });
    }
    cacheConfig.evictionPolicy = evictionPolicy;
    changes.push(`evictionPolicy=${evictionPolicy}`);
  }

  if (model && (ttl !== undefined || maxAge !== undefined)) {
    if (!cacheConfig.defaults[model]) {
      cacheConfig.defaults[model] = { ...DEFAULT_MODEL_CONFIG };
    }
    if (ttl !== undefined) {
      cacheConfig.defaults[model].ttl = Math.max(60000, ttl);
      changes.push(`model.${model}.ttl=${ttl}ms`);
    }
    if (maxAge !== undefined) {
      cacheConfig.defaults[model].maxAge = Math.max(60000, maxAge);
      changes.push(`model.${model}.maxAge=${maxAge}ms`);
    }
  }

  if (changes.length === 0) {
    return res.status(400).json({ error: 'No valid config fields provided' });
  }

  console.log(`⚙️ Cache config updated: ${changes.join(', ')}`);
  res.json({ success: true, applied: changes, config: { strategy: cacheConfig.defaultStrategy, globalMaxTtl: cacheConfig.globalMaxTtl, evictionPolicy: cacheConfig.evictionPolicy } });
});

// Export all cache entries (for backup/migration) - must be before :prompt(*) route
app.get('/cache/export', async (req, res) => {
  const format = (req.query.format as 'json' | 'csv') || 'json';
  const model = req.query.model as string | undefined;
  
  const entries: Array<{
    key: string;
    prompt: string;
    response: string;
    model: string;
    createdAt: number;
    ttl: number;
    hits: number;
  }> = [];
  
  // Collect from PostgreSQL
  if (isPgAvailable()) {
    try {
      const result = await pool.query(
        'SELECT * FROM prompt_cache' + (model ? ' WHERE model = $1' : ''),
        model ? [model] : []
      );
      for (const row of result.rows) {
        if (Date.now() <= row.created_at + row.ttl) {
          entries.push({
            key: row.key,
            prompt: row.prompt,
            response: row.response,
            model: row.model,
            createdAt: row.created_at,
            ttl: row.ttl,
            hits: row.hits,
          });
        }
      }
    } catch {}
  }
  
  // Collect from Redis
  if (useRedis && redis) {
    try {
      const keys = await redis.keys('prompt:*');
      for (const k of keys) {
        const data = await redis.get(k);
        if (data) {
          const entry = JSON.parse(data);
          if (!model || entry.model === model) {
            if (Date.now() <= entry.createdAt + entry.ttl) {
              entries.push({
                key: k.replace('prompt:', ''),
                prompt: entry.prompt,
                response: entry.response,
                model: entry.model,
                createdAt: entry.createdAt,
                ttl: entry.ttl,
                hits: entry.hits,
              });
            }
          }
        }
      }
    } catch {}
  }
  
  // Collect from memory
  for (const [key, entry] of memoryCache) {
    if (!model || entry.model === model) {
      if (Date.now() <= entry.createdAt + entry.ttl) {
        entries.push({
          key,
          prompt: entry.prompt,
          response: entry.response,
          model: entry.model,
          createdAt: entry.createdAt,
          ttl: entry.ttl,
          hits: entry.hits,
        });
      }
    }
  }
  
  if (format === 'csv') {
    const header = 'key,prompt,response,model,createdAt,ttl,hits\n';
    const rows = entries.map(e => 
      `"${e.key}","${e.prompt.replace(/"/g, '""')}","${e.response.replace(/"/g, '""')}","${e.model}",${e.createdAt},${e.ttl},${e.hits}`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=prompt-cache-export.csv');
    res.send(header + rows);
  } else {
    res.json({
      exported: entries.length,
      backend: getBackend(),
      model: model || 'all',
      entries
    });
  }
});

// Import cache entries (from export or migration)
app.post('/cache/import', async (req, res) => {
  const { entries, mode = 'merge' } = req.body;
  
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries array required' });
  }
  
  if (entries.length > 1000) {
    return res.status(400).json({ error: 'Maximum 1000 entries per import' });
  }
  
  if (!['merge', 'replace'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be merge or replace' });
  }
  
  // If replace mode, clear cache first
  if (mode === 'replace') {
    if (isPgAvailable()) {
      await pgClear();
    } else if (useRedis && redis) {
      try {
        const keys = await redis.keys('prompt:*');
        if (keys.length) await redis.del(...keys);
      } catch {}
    }
    memoryCache.clear();
  }
  
  let imported = 0;
  let failed = 0;
  const errors: string[] = [];
  
  for (const item of entries) {
    const { prompt, response, model, ttl, createdAt, hits } = item;
    
    if (!prompt || !response) {
      failed++;
      errors.push('prompt and response required');
      continue;
    }
    
    const key = hashPrompt(prompt);
    const entry: CacheEntry = {
      prompt,
      response,
      model: model || 'gpt-4',
      createdAt: createdAt || Date.now(),
      ttl: ttl || 3600000,
      hits: hits || 0,
    };
    
    let ok = false;
    
    if (isPgAvailable()) {
      ok = await pgSet(key, entry);
    }
    
    if (!ok && useRedis && redis) {
      try {
        await redis.setex(`prompt:${key}`, Math.floor(entry.ttl / 1000), JSON.stringify(entry));
        ok = true;
      } catch {}
    }
    
    if (!ok) {
      memoryCache.set(key, entry);
      ok = true;
    }
    
    if (ok) imported++;
    else {
      failed++;
      errors.push(`Failed to import: ${key}`);
    }
  }
  
  res.json({
    success: true,
    total: entries.length,
    imported,
    failed,
    mode,
    errors: errors.slice(0, 5)
  });
});

// Get cached entry content by key (for debugging/inspection) - MUST be before :prompt route
app.get('/cache/key/:key', async (req, res) => {
  const { key } = req.params;
  
  if (!key || key.length < 8) {
    return res.status(400).json({ error: 'Valid cache key required' });
  }
  
  let entry: CacheEntry | null = null;
  let backend = 'memory';
  
  // Try PostgreSQL first
  if (isPgAvailable()) {
    entry = await pgGet(key);
    if (entry) backend = 'pg';
  }
  
  // Try Redis
  if (!entry && useRedis && redis) {
    try {
      const data = await redis.get(`prompt:${key}`);
      if (data) {
        entry = JSON.parse(data);
        backend = 'redis';
      }
    } catch {}
  }
  
  // Try memory
  if (!entry) {
    entry = memoryCache.get(key) || null;
    if (entry) backend = 'memory';
  }
  
  if (!entry) {
    return res.status(404).json({ error: 'Cache entry not found' });
  }
  
  // Check if expired
  if (isExpired(entry)) {
    if (isPgAvailable()) await pgDel(key);
    else if (useRedis && redis) await redis.del(`prompt:${key}`);
    else memoryCache.delete(key);
    return res.status(404).json({ error: 'Cache entry expired' });
  }
  
  res.json({
    key,
    prompt: entry.prompt,
    response: entry.response,
    model: entry.model,
    hits: entry.hits,
    createdAt: entry.createdAt,
    age: Date.now() - entry.createdAt,
    ttl: entry.ttl,
    expiresIn: entry.ttl - (Date.now() - entry.createdAt),
    backend
  });
});

// Get cached prompt (rate limited: 200 req/min)

// Get total cache entry count
app.get('/cache/count', async (req, res) => {
  const model = req.query.model as string | undefined;
  let count = 0;
  let backend = getBackend();
  
  if (backend === 'pg') {
    try {
      const result = model
        ? await pool.query('SELECT COUNT(*) FROM prompt_cache WHERE model = $1 AND created_at + ttl > $2', [model, Date.now()])
        : await pool.query('SELECT COUNT(*) FROM prompt_cache WHERE created_at + ttl > $1', [Date.now()]);
      count = parseInt(result.rows[0].count);
    } catch {}
  } else if (backend === 'redis' && redis) {
    try {
      const keys = await redis.keys('prompt:*');
      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const entry = JSON.parse(data);
          if (!model || entry.model === model) {
            if (Date.now() <= entry.createdAt + entry.ttl) {
              count++;
            }
          }
        }
      }
    } catch {}
  } else {
    for (const entry of memoryCache.values()) {
      if (!model || entry.model === model) {
        if (Date.now() <= entry.createdAt + entry.ttl) {
          count++;
        }
      }
    }
  }
  
  res.json({ count, model: model || 'all', backend });
});

app.get('/cache/:prompt(*)', rateLimiter({ windowMs: 60000, maxRequests: 200 }), async (req, res) => {
  const startTime = Date.now();
  const apiKey = req.headers['x-api-key'] as string;
  const key = hashPrompt(req.params.prompt);
  
  let entry: CacheEntry | null = null;

  // Try PostgreSQL first
  if (isPgAvailable()) {
    entry = await pgGet(key);
    if (entry) {
      entry.hits++;
      await pgSet(key, entry);
      const latency = Date.now() - startTime;
      analytics.recordRequest(true, latency, entry.model, false, apiKey);
      recordAnalytics(apiKey, true, latency, entry.model);
      const pgTransform = {
        uppercase: req.query.uppercase === 'true',
        lowercase: req.query.lowercase === 'true',
        trim: req.query.trim !== 'false',
        escape: req.query.escape === 'true',
      };
      const pgTemplateId = req.query.template as string;
      let pgResponse = entry.response;
      if (pgTemplateId || pgTransform.uppercase || pgTransform.lowercase || pgTransform.escape) {
        pgResponse = transformResponse(entry.response, { ...pgTransform, template: pgTemplateId });
      }
      const pgResult: any = { cached: true, response: pgResponse, model: entry.model, hits: entry.hits, age: Date.now() - entry.createdAt, backend: 'pg' };
      if (pgTemplateId) { pgResult.template = pgTemplateId; pgResult.formatted = true; }
      return res.json(pgResult);
    }
  }

  // Try Redis
  if (useRedis && redis) {
    try {
      const data = await redis.get(`prompt:${key}`);
      if (data) {
        entry = JSON.parse(data);
      }
    } catch {}
  } else {
    entry = memoryCache.get(key) || null;
  }

  if (!entry) {
    // Try semantic search as fallback
    if (isPgAvailable() && isVectorAvailable()) {
      const semanticEntry = await pgSemanticSearch(req.params.prompt);
      if (semanticEntry) {
        const latency = Date.now() - startTime;
        analytics.recordRequest(true, latency, semanticEntry.model, false, apiKey);
        recordAnalytics(apiKey, true, latency, semanticEntry.model);
        return res.json({
          cached: true,
          semantic: true,
          similarity: 'high',
          response: semanticEntry.response,
          model: semanticEntry.model,
          hits: semanticEntry.hits,
          age: Date.now() - semanticEntry.createdAt,
          backend: 'pg-semantic'
        });
      }
    }
    const latency = Date.now() - startTime;
    analytics.recordRequest(false, latency, req.query.model as string, false, apiKey);
    recordAnalytics(apiKey, false, latency, req.query.model as string);
    return res.json({ cached: false });
  }

  // Check TTL
  if (isExpired(entry)) {
    if (isPgAvailable()) {
      await pgDel(key);
    } else if (useRedis && redis) {
      await redis.del(`prompt:${key}`);
    } else {
      memoryCache.delete(key);
    }
    const latency = Date.now() - startTime;
    analytics.recordRequest(false, latency, entry.model, false, apiKey);
    recordAnalytics(apiKey, false, latency, entry.model);
    return res.json({ cached: false, expired: true });
  }

  entry.hits++;
  
  // Update hits in cache
  if (isPgAvailable()) {
    await pgSet(key, entry);
  } else if (useRedis && redis) {
    await redis.set(`prompt:${key}`, JSON.stringify(entry), 'EX', Math.floor((entry.createdAt + entry.ttl - Date.now()) / 1000));
  } else {
    memoryCache.set(key, entry);
  }

  const latency = Date.now() - startTime;
  analytics.recordRequest(true, latency, entry.model, false, apiKey);
  recordAnalytics(apiKey, true, latency, entry.model);

  // Apply template/format if requested
  const templateId = req.query.template as string;
  const transform = {
    uppercase: req.query.uppercase === 'true',
    lowercase: req.query.lowercase === 'true',
    trim: req.query.trim !== 'false', // default true
    escape: req.query.escape === 'true',
  };

  let response = entry.response;
  if (templateId || transform.uppercase || transform.lowercase || transform.escape) {
    response = transformResponse(entry.response, { ...transform, template: templateId });
  }

  const result: any = {
    cached: true,
    response,
    model: entry.model,
    hits: entry.hits,
    age: Date.now() - entry.createdAt,
    backend: getBackend()
  };

  if (templateId) {
    result.template = templateId;
    result.formatted = true;
  }

  res.json(result);
});

// ===== Request Deduplication Endpoints =====

// Check if a request is in-flight (for polling/waiting)
app.get('/dedupe/status', optionalApiKeyAuth, async (req, res) => {
  const prompt = req.query.prompt as string;
  if (!prompt) {
    return res.status(400).json({ error: 'prompt query parameter required' });
  }
  
  const key = hashPrompt(prompt);
  const inFlight = inFlightRequests.get(key);
  
  if (inFlight) {
    res.json({ 
      inFlight: true, 
      waiting: true,
      key,
      waitingSince: inFlight.createdAt
    });
  } else {
    res.json({ inFlight: false, waiting: false, key });
  }
});

// Register that we're about to make an LLM call (start deduplication)
// If another request is already in-flight, this waits for it and returns cached result
app.post('/dedupe/register', optionalApiKeyAuth, async (req, res) => {
  const { prompt, model } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'prompt required' });
  }
  
  const key = hashPrompt(prompt);
  
  // Check if already cached (fast path)
  let entry: CacheEntry | null = null;
  let backend = 'memory';
  
  if (isPgAvailable()) {
    entry = await pgGet(key);
    if (entry) backend = 'pg';
  }
  
  if (!entry && useRedis && redis) {
    try {
      const data = await redis.get(`prompt:${key}`);
      if (data) {
        entry = JSON.parse(data);
        backend = 'redis';
      }
    } catch {}
  }
  
  if (!entry) {
    entry = memoryCache.get(key) || null;
    if (entry) backend = 'memory';
  }
  
  // Return cached if exists and not expired
  if (entry && Date.now() <= entry.createdAt + entry.ttl) {
    entry.hits++;
    if (isPgAvailable()) await pgSet(key, entry);
    else if (useRedis && redis) {
      await redis.set(`prompt:${key}`, JSON.stringify(entry), 'EX', Math.floor((entry.createdAt + entry.ttl - Date.now()) / 1000));
    } else {
      memoryCache.set(key, entry);
    }
    return res.json({ 
      cached: true, 
      response: entry.response, 
      model: entry.model,
      backend
    });
  }
  
  // Check for in-flight request
  const registration = registerInFlightRequest(key);
  
  if (registration.isDuplicate && registration.promise) {
    // Someone else is already making this request - wait for it
    try {
      const result = await registration.promise;
      return res.json({ 
        cached: false, 
        deduplicated: true, 
        response: result.response, 
        model: result.model || model || 'gpt-4',
        backend: 'dedupe'
      });
    } catch (err) {
      // In-flight request failed, proceed with our own
    }
  }
  
  // We're the first - proceed with LLM call
  res.json({ 
    inFlight: true, 
    proceed: true, 
    key,
    message: 'Make your LLM call, then POST to /dedupe/complete'
  });
});

// Complete a deduplication request - call this after LLM responds
app.post('/dedupe/complete', optionalApiKeyAuth, async (req, res) => {
  const { prompt, response, model, ttl, error } = req.body;
  
  if (!prompt || (!response && !error)) {
    return res.status(400).json({ error: 'prompt and (response or error) required' });
  }
  
  const key = hashPrompt(prompt);
  const cacheTtl = ttl || 3600000;
  
  if (error) {
    // Mark in-flight as failed
    completeInFlightRequest(key, error, true);
    return res.json({ success: false, error, deduplicated: false });
  }
  
  // Cache the response
  const entry: CacheEntry = {
    prompt,
    response,
    model: model || 'gpt-4',
    createdAt: Date.now(),
    ttl: cacheTtl,
    hits: 1
  };
  
  let backend = 'memory';
  let ok = false;
  
  if (isPgAvailable()) {
    ok = await pgSet(key, entry);
    if (ok) backend = 'pg';
  }
  
  if (!ok && useRedis && redis) {
    try {
      await redis.setex(`prompt:${key}`, Math.floor(cacheTtl / 1000), JSON.stringify(entry));
      ok = true;
      backend = 'redis';
    } catch {}
  }
  
  if (!ok) {
    memoryCache.set(key, entry);
    ok = true;
  }
  
  // Complete the in-flight request so waiters get the result
  completeInFlightRequest(key, { response, model: entry.model });
  
  res.json({ 
    success: true, 
    key, 
    cached: ok,
    backend,
    deduplicated: true
  });
});

// Get stats
app.get('/stats', async (req, res) => {
  const backend = getBackend();
  let stats: any = { backend };

  if (backend === 'pg') {
    const pg = await pgStats();
    stats.pg = pg;
  } else if (backend === 'redis' && redis) {
    try {
      const keys = await redis.keys('prompt:*');
      stats.redis = { entries: keys.length };
      let totalHits = 0;
      for (const key of keys.slice(0, 100)) {
        const data = await redis.get(key);
        if (data) {
          const entry = JSON.parse(data);
          totalHits += entry.hits || 0;
        }
      }
      stats.totalHits = totalHits;
    } catch {}
  } else {
    const totalHits = Array.from(memoryCache.values()).reduce((sum, e) => sum + (e.hits || 0), 0);
    stats.memory = { entries: memoryCache.size, totalHits };
  }

  res.json(stats);
});

// Get usage stats for an API key
app.get('/usage/:apiKey', optionalApiKeyAuth, async (req, res) => {
  const { apiKey } = req.params;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }
  
  const stats = getUsageStats(apiKey);
  const tierInfo = TIERS[stats.tier] || TIERS.free;
  
  res.json({
    apiKey: apiKey.slice(0, 8) + '...',
    ...stats,
    tierLimit: tierInfo.requestsPerDay,
    features: {
      semanticSearch: tierInfo.semanticSearch,
      maxCacheSize: tierInfo.cacheSize
    }
  });
});

// Detailed analytics (content-negotiated: JSON API vs HTML dashboard)
app.get('/analytics', async (req, res) => {
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) {
    return res.sendFile(path.join(__dirname, '..', 'analytics.html'));
  }
  const period = (req.query.period as '1h' | '24h' | '7d' | '30d') || '24h';
  const data = analytics.getAnalytics(period);
  res.json(data);
});

// Clear cache
app.delete('/cache', async (req, res) => {
  if (isPgAvailable()) {
    await pgClear();
  } else if (useRedis && redis) {
    try {
      const keys = await redis.keys('prompt:*');
      if (keys.length) {
        await redis.del(...keys);
      }
    } catch {}
  }
  
  memoryCache.clear();
  res.json({ success: true, cleared: 'all' });
});

// Delete specific entry
app.delete('/cache/:prompt(*)', async (req, res) => {
  const key = hashPrompt(req.params.prompt);
  
  if (isPgAvailable()) {
    await pgDel(key);
  } else if (useRedis && redis) {
    await redis.del(`prompt:${key}`);
  }
  memoryCache.delete(key);
  
  res.json({ success: true, key });
});

// ===== New: TTL Update, Export, Import =====

// Update TTL on existing cache entry (extend without re-caching)
app.patch('/cache/:prompt(*)', async (req, res) => {
  const { ttl } = req.body;
  const key = hashPrompt(req.params.prompt);
  
  if (ttl === undefined || typeof ttl !== 'number' || ttl < 0) {
    return res.status(400).json({ error: 'ttl (positive number in ms) required' });
  }
  
  let updated = false;
  let entry: CacheEntry | null = null;
  
  // Try PostgreSQL first
  if (isPgAvailable()) {
    entry = await pgGet(key);
    if (entry) {
      entry.ttl = ttl;
      await pgSet(key, entry);
      updated = true;
    }
  }
  
  // Try Redis
  if (!updated && useRedis && redis) {
    try {
      const data = await redis.get(`prompt:${key}`);
      if (data) {
        const parsed = JSON.parse(data) as CacheEntry;
        parsed.ttl = ttl;
        await redis.setex(`prompt:${key}`, Math.floor(ttl / 1000), JSON.stringify(parsed));
        updated = true;
      }
    } catch {}
  }
  
  // Try memory
  if (!updated) {
    entry = memoryCache.get(key) || null;
    if (entry) {
      entry.ttl = ttl;
      memoryCache.set(key, entry);
      updated = true;
    }
  }
  
  if (!updated) {
    return res.status(404).json({ error: 'Cache entry not found' });
  }
  
  res.json({ success: true, key, newTtl: ttl });
});
// Stripe checkout session
app.post('/checkout', async (req, res) => {
  const { tier, customerId, email } = req.body;
  
  if (!tier || !['pro', 'enterprise'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier. Use pro or enterprise.' });
  }
  
  try {
    // Get or create customer
    let custId = customerId;
    if (!custId && email) {
      const { getOrCreateCustomer } = await import('./services/stripe.js');
      custId = await getOrCreateCustomer(email);
    }
    
    const { createCheckoutSession } = await import('./services/stripe.js');
    const result = await createCheckoutSession(
      tier, 
      custId,
      `${process.env.FRONTEND_URL || 'http://localhost:3000'}/success?session_id={CHECKOUT_SESSION_ID}`,
      `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pricing`
    );
    
    res.json({ url: result.url, sessionId: result.sessionId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get subscription status
app.get('/subscription/:apiKey', async (req, res) => {
  // In production, look up the API key in database and return subscription status
  // For now, return demo status
  res.json({ tier: 'free', requestsRemaining: 1000 });
});

// ===== API Key Management =====

// Generate new API key
app.post('/keys', async (req, res) => {
  const { name, tier = 'free' } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'name required' });
  }
  
  if (!['free', 'pro', 'enterprise'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier. Use free, pro, or enterprise' });
  }
  
  const { generateAPIKey } = await import('./services/apiKeys.js');
  const apiKey = generateAPIKey(name, tier);
  
  res.json({
    success: true,
    id: apiKey.id,
    key: apiKey.key,
    name: apiKey.name,
    tier: apiKey.tier,
    requestsLimit: apiKey.requestsLimit,
    createdAt: new Date(apiKey.createdAt).toISOString()
  });
});

// List all API keys
app.get('/keys', async (req, res) => {
  const { getAllAPIKeys } = await import('./services/apiKeys.js');
  const keys = getAllAPIKeys();
  
  res.json({
    total: keys.length,
    keys: keys.map(k => ({
      id: k.id,
      name: k.name,
      tier: k.tier,
      requestsToday: k.requestsToday,
      requestsLimit: k.requestsLimit,
      createdAt: new Date(k.createdAt).toISOString(),
      lastUsed: new Date(k.lastUsed).toISOString(),
      active: k.active
    }))
  });
});

// Revoke an API key
app.delete('/keys/:keyId', async (req, res) => {
  const { keyId } = req.params;
  const { getAllAPIKeys, revokeAPIKey } = await import('./services/apiKeys.js');
  
  const keys = getAllAPIKeys();
  const keyObj = keys.find(k => k.id === keyId);
  
  if (!keyObj) {
    return res.status(404).json({ error: 'API key not found' });
  }
  
  const revoked = revokeAPIKey(keyObj.key);
  
  res.json({ success: revoked, keyId, name: keyObj.name });
});

// Get specific API key details
app.get('/keys/:keyId', async (req, res) => {
  const { keyId } = req.params;
  const { getAllAPIKeys } = await import('./services/apiKeys.js');
  
  const keys = getAllAPIKeys();
  const keyObj = keys.find(k => k.id === keyId);
  
  if (!keyObj) {
    return res.status(404).json({ error: 'API key not found' });
  }
  
  res.json({
    id: keyObj.id,
    name: keyObj.name,
    tier: keyObj.tier,
    requestsToday: keyObj.requestsToday,
    requestsLimit: keyObj.requestsLimit,
    createdAt: new Date(keyObj.createdAt).toISOString(),
    lastUsed: new Date(keyObj.lastUsed).toISOString(),
    active: keyObj.active
  });
});

// Root route - serve landing page
import fs from 'fs';
import path from 'path';
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'landing.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard.html'));
});

// Serve static files
app.use(express.static('.'));
const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(async () => {
  let cleaned = 0;
  if (isPgAvailable()) {
    cleaned = await pgCleanup();
  }
  // Memory cleanup
  for (const [key, entry] of memoryCache.entries()) {
    if (isExpired(entry)) {
      memoryCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} expired entries`);
  }
}, CLEANUP_INTERVAL);

// ===== Webhook Configuration =====
app.post('/webhooks', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url required' });
  }
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  webhookNotifier.setWebhook(url);
  res.json({ success: true, url, message: 'Webhook URL configured' });
});

app.get('/webhooks', (req, res) => {
  const stats = webhookNotifier.getStats();
  const recent = webhookNotifier.getEvents(10);
  res.json({
    configured: webhookNotifier.getWebhook() !== null,
    url: webhookNotifier.getWebhook(),
    stats,
    recentEvents: recent.map(e => ({ type: e.type, timestamp: e.timestamp, data: e.data })),
  });
});

app.delete('/webhooks', (req, res) => {
  webhookNotifier.clearWebhook();
  res.json({ success: true, message: 'Webhook cleared' });
});

app.post('/webhooks/test', async (req, res) => {
  const result = await webhookNotifier.notifyCacheHit({
    test: true,
    message: 'Test event from PromptCache',
    timestamp: Date.now(),
  });
  res.json({ success: result.success, error: result.error });
});

// ===== Enhanced Health & Monitoring =====
app.get('/health/detailed', async (req, res) => {
  const memSize = memoryCache.size;
  let redisSize = 0;
  let pgSize = 0;

  if (useRedis && redis) {
    try { redisSize = await redis.dbsize(); } catch {}
  }

  if (isPgAvailable()) {
    try {
      const pg = await pgStats();
      pgSize = pg.entries;
    } catch {}
  }

  const summary = healthMonitor.getSummary();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: summary.uptime,
    cache: {
      backend: getBackend(),
      pgEntries: pgSize,
      redisEntries: redisSize,
      memoryEntries: memSize,
    },
    recent: summary.recent,
    history: summary.history,
    webhook: {
      configured: webhookNotifier.getWebhook() !== null,
    },
  });
});

// ===== Stripe webhook
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'] as string;
  
  try {
    const { handleWebhook } = await import('./services/stripe.js');
    const result = await handleWebhook(req.body as string, signature);
    
    console.log(`📦 Stripe webhook: ${result.type}`);
    
    // Handle specific events
    if (result.type === 'subscription_created') {
      // TODO: Update API key tier in database
      console.log(`✅ Subscription created: ${result.data.subscriptionId}`);
    }
    
    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// CONTEXT OPTIMIZATION ENDPOINTS
// Based on: https://github.com/muratcankoylan/agent-skills-for-context-engineering
// Stacks with PromptCache: PromptCache caches WHAT, Context Opt reduces HOW MUCH
// ═══════════════════════════════════════════════════════════════

// ─── Token Estimation & Context Stats ────────────────────────────────────────

app.post('/context/estimate', optionalApiKeyAuth, async (req, res) => {
  const { texts } = req.body;
  
  if (!Array.isArray(texts)) {
    return res.status(400).json({ error: 'texts array required' });
  }
  
  const tokens = texts.map((t) => estimateTokens(String(t)));
  const total = tokens.reduce((a, b) => a + b, 0);
  const utilization = estimateContextUtilization(texts);
  const contextLimit = 128000; // Standard context window

  res.json({
    tokensPerText: tokens,
    totalTokens: total,
    utilizationPercent: Math.round(utilization * 100),
    contextLimit,
    compactTriggered: shouldCompact(total, contextLimit),
    partitionRecommended: shouldPartition(total, contextLimit, 3),
    strategies: [
      { name: "KV-cache ordering", applicable: true, hitRateBoost: "70%+ on stable prompts" },
      { name: "Observation masking", applicable: utilization > 0.5, reduction: "60-80% on masked obs" },
      { name: "Compaction", applicable: utilization > 0.7, reduction: "50-70%" },
      { name: "Partitioning", applicable: utilization > 0.6, overhead: "~500 tokens" },
    ],
  });
});

// ─── KV-Cache Optimization ───────────────────────────────────────────────────

app.post('/context/kvcache-order', optionalApiKeyAuth, async (req, res) => {
  const { system, tools, templates, history, query } = req.body as KVCachePrompt;
  
  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }
  
  const ordered = orderForKVCaching({ system: system || "", tools: tools || "", templates: templates || "", history: history || "", query });
  const originalTokens = estimateTokens([system, tools, templates, history, query].filter(Boolean).join("\n"));
  const orderedTokens = estimateTokens(ordered);

  res.json({
    ordered,
    originalTokens,
    orderedTokens,
    cacheStabilityNote: "Stable content (system, tools) now in prefix for maximum KV-cache hit rate",
    rule: "System (no timestamps) → Tools → Templates → History → Query (always last)",
  });
});

// ─── Observation Masking ─────────────────────────────────────────────────────

app.post('/context/mask', optionalApiKeyAuth, async (req, res) => {
  const { content, summary } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'content required' });
  }
  
  const autoSummary = summary || extractKeyFromContent(content);
  const masked = maskObservation(content, autoSummary);

  res.json({
    original: content.slice(0, 200) + (content.length > 200 ? "..." : ""),
    originalLength: content.length,
    maskedReference: `[Obs:${masked.refId} elided. Key: ${masked.summary}. Full content retrievable.]`,
    maskedLength: masked.maskedLength,
    reductionPercent: masked.reduction,
    refId: masked.refId,
    note: "Store refId in context. Retrieve with GET /context/observe/:refId",
  });
});

app.get('/context/observe/:refId', optionalApiKeyAuth, async (req, res) => {
  const { refId } = req.params;
  const content = maskObservationRetrieval(refId);
  
  if (!content) {
    return res.status(404).json({ error: 'Observation not found or expired' });
  }
  
  res.json({ refId, content, retrieved: true });
});

app.post('/context/auto-mask', optionalApiKeyAuth, async (req, res) => {
  const { outputs } = req.body;
  
  if (!Array.isArray(outputs)) {
    return res.status(400).json({ error: 'outputs array required' });
  }
  
  const results = autoMaskToolOutputs(outputs, 3, 500);
  
  res.json({
    total: results.length,
    masked: results.filter((r) => r.masked).length,
    results: results.map((r) => ({
      masked: r.masked,
      preview: r.content?.slice(0, 150) + (r.content && r.content.length > 150 ? "..." : ""),
      ref: r.ref ? { refId: r.ref.refId, reductionPercent: r.ref.reduction } : null,
    })),
  });
});

// ─── Compaction ──────────────────────────────────────────────────────────────

app.post('/context/compact', optionalApiKeyAuth, async (req, res) => {
  const { messages, triggerOnly } = req.body;
  
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }
  
  const contextLimit = 128000;
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(String(m.content || "")), 0);
  const utilization = totalTokens / contextLimit;

  if (triggerOnly) {
    return res.json({
      totalTokens,
      utilizationPercent: Math.round(utilization * 100),
      compactTriggered: shouldCompact(totalTokens, contextLimit),
      threshold: "70%",
      message: shouldCompact(totalTokens, contextLimit)
        ? "Compaction recommended — context utilization above 70%"
        : "Context utilization within acceptable range",
    });
  }

  // Perform compaction using local summarization
  const summary = await summarizeMessages(messages);
  const compactedTokens = estimateTokens(summary);
  const report = generateOptimizationReport(totalTokens, compactedTokens, ["compaction"]);

  res.json({
    originalTokens: totalTokens,
    compactedTokens,
    reductionPercent: report.reductions[0],
    summary,
    report,
    strategies: {
      "1_KV_cache_order": "reorder prompts so system/tools are in prefix",
      "2_observation_masking": "compress old verbose tool outputs",
      "3_compaction": "summarize accumulated context",
      "4_partitioning": "split across sub-agents if >60% load",
    },
    priorityOrder: "Apply in order: KV-cache first (zero risk), then masking, then compaction",
  });
});

// ─── Partitioning ────────────────────────────────────────────────────────────

app.post('/context/partition', optionalApiKeyAuth, async (req, res) => {
  const { content, partitionCount } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'content required' });
  }
  
  const count = Math.max(2, Math.min(10, partitionCount || 3));
  const totalTokens = estimateTokens(content);
  const contextLimit = 128000;

  if (!shouldPartition(totalTokens, contextLimit, count)) {
    return res.json({
      recommended: false,
      reason: totalTokens / contextLimit <= 0.6
        ? "Context utilization below 60% — partitioning overhead not justified"
        : `Need 3+ subtasks for partitioning to pay off (got ${count})`,
      totalTokens,
      utilizationPercent: Math.round((totalTokens / contextLimit) * 100),
    });
  }

  const result = partitionContext(content, count);

  res.json({
    recommended: true,
    partitions: result.partitions,
    totalTokens: result.totalTokens,
    coordinatorOverhead: result.coordinatorOverhead,
    netSavings: result.netSavings,
    tip: "Run each partition in a sub-agent with clean context, aggregate results in coordinator",
  });
});

// ─── Optimization Report ─────────────────────────────────────────────────────

app.get('/context/report', optionalApiKeyAuth, async (req, res) => {
  const { beforeTokens, afterTokens, strategies } = req.query;
  
  const before = parseInt(beforeTokens as string) || 0;
  const after = parseInt(afterTokens as string) || 0;
  const stratList = strategies ? String(strategies).split(",") : ["KV-cache", "masking", "compaction"];

  if (!beforeTokens || !afterTokens) {
    // Return the optimization guide
    return res.json({
      guide: "Context Optimization — stacks with PromptCache",
      promptCache: "Caches WHAT is said (responses)",
      contextOpt: "Reduces HOW MUCH is said (tokens)",
      strategies: [
        { name: "KV-Cache Ordering", risk: "none", gain: "70%+ cache hit rate", implementation: "PUT system/tools first in prompt, query last" },
        { name: "Observation Masking", risk: "low", gain: "60-80% reduction on masked obs", implementation: "POST /context/mask with content + summary" },
        { name: "Compaction", risk: "medium", gain: "50-70% reduction", implementation: "POST /context/compact with messages array" },
        { name: "Partitioning", risk: "medium", gain: "varies by task", implementation: "POST /context/partition with content + count" },
      ],
      quickStart: {
        estimate: "POST /context/estimate with {texts: [...]}",
        kvOptimize: "POST /context/kvcache-order with {system, tools, history, query}",
        mask: "POST /context/mask with {content, summary}",
        compact: "POST /context/compact with {messages: [...]}",
        partition: "POST /context/partition with {content, count}",
      },
    });
  }

  const report = generateOptimizationReport(before, after, stratList);
  res.json({ report });
});

// ─── Helper functions ────────────────────────────────────────────────────────

function extractKeyFromContent(content: string): string {
  const firstPart = content.split(/[.!?]/).slice(0, 2).join(".").trim();
  const metrics = content.match(/\d+(?:\.\d+)?(?:%|ms|GB|MB|KB| tokens)?/g);
  const metricStr = metrics ? ` Metrics: ${metrics.slice(0, 5).join(", ")}` : "";
  return (firstPart + metricStr).slice(0, 200);
}

function maskObservationRetrieval(refId: string): string | null {
  // Simple in-memory lookup for masked observations
  const storeKey = `ctx_opt_obs_${refId}`;
  const cached = memoryCache.get(storeKey);
  return cached ? cached.response : null;
}

async function summarizeMessages(
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  // Lightweight local summarization using extraction
  const decisions: string[] = [];
  const facts: string[] = [];
  
  for (const msg of messages) {
    const lower = msg.content.toLowerCase();
    
    // Extract decisions
    if (/decided|chose|agreed|concluded|selected|final/i.test(lower)) {
      decisions.push(msg.content.slice(0, 150));
    }
    
    // Extract numeric facts
    const numbers = msg.content.match(/\d+(?:\.\d+)?\s*(?:%|ms|GB|MB|KB|hours?|days?|users?|requests?)?/gi);
    if (numbers && numbers.length > 0) {
      facts.push(numbers.slice(0, 3).join(", "));
    }
  }

  const summary = [
    decisions.length > 0 ? `DECISIONS:\n${decisions.slice(0, 5).map((d, i) => `${i + 1}. ${d}`).join("\n")}` : null,
    facts.length > 0 ? `KEY METRICS:\n${[...new Set(facts)].slice(0, 10).join("\n")}` : null,
    `[Context compacted from ${messages.length} messages]`,
  ].filter(Boolean).join("\n\n");

  return summary || "[No extractable content — context was mostly filler]";
}

// ═══════════════════════════════════════════════════════════════

// ─── Analytics API Router ─────────────────────────────────────────────────────
app.use('/api/analytics', createAnalyticsRouter(getAPIKeyTier));

// ─── Startup ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 PromptCache running on port ${PORT}`);
});

export default app;
