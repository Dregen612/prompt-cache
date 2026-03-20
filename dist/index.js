"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ioredis_1 = __importDefault(require("ioredis"));
const crypto_1 = __importDefault(require("crypto"));
const stripe_1 = __importDefault(require("stripe"));
const pgCache_1 = require("./services/pgCache");
const apiKeyAuth_1 = require("./middleware/apiKeyAuth");
const rateLimit_1 = require("./middleware/rateLimit");
const usageLimits_1 = require("./services/usageLimits");
const analytics_1 = require("./services/analytics");
// Stripe setup
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    apiVersion: '2026-02-25.clover',
});
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use(express_1.default.json());
// Initialize PostgreSQL cache
(0, pgCache_1.initPgCache)().then(() => { });
// Redis client (optional - falls back to memory)
let redis = null;
let useRedis = false;
try {
    redis = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379');
    redis.on('error', () => {
        console.log('⚠️ Redis unavailable, using in-memory cache');
        redis = null;
    });
    redis.on('connect', () => {
        console.log('🔗 Connected to Redis');
        useRedis = true;
    });
}
catch {
    console.log('⚠️ Redis not available, using in-memory cache');
}
const memoryCache = new Map();
// ===== Request Deduplication (prevents duplicate LLM calls) =====
const inFlightRequests = new Map();
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
function registerInFlightRequest(key) {
    const existing = inFlightRequests.get(key);
    if (existing) {
        return { isDuplicate: true, promise: existing.promise };
    }
    let resolveFn;
    let rejectFn;
    const promise = new Promise((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
    });
    inFlightRequests.set(key, {
        promise,
        resolve: resolveFn,
        reject: rejectFn,
        createdAt: Date.now()
    });
    return { isDuplicate: false };
}
// Complete an in-flight request (called when LLM responds)
function completeInFlightRequest(key, response, isError = false) {
    const req = inFlightRequests.get(key);
    if (req) {
        if (isError) {
            req.reject(response);
        }
        else {
            req.resolve(response);
        }
        inFlightRequests.delete(key);
    }
}
function hashPrompt(prompt) {
    return crypto_1.default.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}
function isExpired(entry) {
    return Date.now() > entry.createdAt + entry.ttl;
}
// Get best available backend
function getBackend() {
    if ((0, pgCache_1.isPgAvailable)())
        return 'pg';
    if (useRedis)
        return 'redis';
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
        }
        catch { }
    }
    if ((0, pgCache_1.isPgAvailable)()) {
        try {
            const pg = await (0, pgCache_1.pgStats)();
            pgSize = pg.entries;
        }
        catch { }
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
app.post('/cache', (0, rateLimit_1.rateLimiter)({ windowMs: 60000, maxRequests: 100 }), async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const usage = apiKey ? (0, usageLimits_1.recordRequest)(apiKey, false) : { allowed: true, remaining: -1, tier: 'free' };
    if (!usage.allowed) {
        return res.status(429).json({ error: 'Daily limit exceeded', tier: usage.tier, remaining: 0 });
    }
    const { prompt, response, model, ttl = 3600000 } = req.body;
    if (!prompt || !response) {
        return res.status(400).json({ error: 'prompt and response required' });
    }
    const key = hashPrompt(prompt);
    const entry = {
        prompt,
        response,
        model: model || 'gpt-4',
        createdAt: Date.now(),
        ttl,
        hits: 0
    };
    // Try PostgreSQL first
    if ((0, pgCache_1.isPgAvailable)()) {
        const ok = await (0, pgCache_1.pgSet)(key, entry);
        if (ok) {
            return res.json({ success: true, key, backend: 'pg' });
        }
    }
    // Try Redis
    if (useRedis && redis) {
        try {
            await redis.setex(`prompt:${key}`, Math.floor(ttl / 1000), JSON.stringify(entry));
            return res.json({ success: true, key, backend: 'redis' });
        }
        catch (e) {
            console.error('Redis write failed, falling back to memory');
        }
    }
    // Fall back to memory
    memoryCache.set(key, entry);
    res.json({ success: true, key, backend: 'memory' });
});
// Stream cached response or proxy+cache LLM streaming response via SSE
app.post('/cache/stream', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const usage = apiKey ? (0, usageLimits_1.recordRequest)(apiKey, false) : { allowed: true, remaining: -1, tier: 'free' };
    if (!usage.allowed) {
        return res.status(429).json({ error: 'Daily limit exceeded', tier: usage.tier, remaining: 0 });
    }
    const { prompt, model = 'gpt-4', llmEndpoint, llmKey, ttl = 3600000 } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'prompt required' });
    }
    const key = hashPrompt(prompt);
    const startTime = Date.now();
    // 1. Check cache first
    let entry = null;
    if ((0, pgCache_1.isPgAvailable)()) {
        entry = await (0, pgCache_1.pgGet)(key);
    }
    if (!entry && useRedis && redis) {
        try {
            const data = await redis.get(`prompt:${key}`);
            if (data)
                entry = JSON.parse(data);
        }
        catch { }
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
        const words = entry.response.split(' ');
        for (let i = 0; i < words.length; i++) {
            res.write(`event: chunk\n`);
            res.write(`data: ${JSON.stringify({ text: words[i] + (i < words.length - 1 ? ' ' : ''), done: false })}\n\n`);
            await new Promise(r => setImmediate(r));
        }
        // Update hits (fire-and-forget)
        if ((0, pgCache_1.isPgAvailable)()) {
            entry.hits++;
            (0, pgCache_1.pgSet)(key, entry).catch(() => { });
        }
        else if (useRedis && redis) {
            entry.hits++;
            redis.set(`prompt:${key}`, JSON.stringify(entry), 'EX', Math.floor((entry.createdAt + entry.ttl - Date.now()) / 1000)).catch(() => { });
        }
        else {
            entry.hits++;
            memoryCache.set(key, entry);
        }
        const latency = Date.now() - startTime;
        analytics_1.analytics.recordRequest(true, latency, entry.model);
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
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]')
                    continue;
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed.choices?.[0]?.delta?.content || parsed.delta?.content || '';
                    if (text) {
                        fullResponse += text;
                        res.write(`event: chunk\n`);
                        res.write(`data: ${JSON.stringify({ text, done: false })}\n\n`);
                    }
                }
                catch {
                    // Skip malformed JSON
                }
            }
        }
        // Cache the complete response
        if (fullResponse) {
            const cacheEntry = {
                prompt,
                response: fullResponse,
                model,
                createdAt: Date.now(),
                ttl,
                hits: 1,
            };
            if ((0, pgCache_1.isPgAvailable)()) {
                (0, pgCache_1.pgSet)(key, cacheEntry).catch(() => { });
            }
            else if (useRedis && redis) {
                redis.setex(`prompt:${key}`, Math.floor(ttl / 1000), JSON.stringify(cacheEntry)).catch(() => { });
            }
            else {
                memoryCache.set(key, cacheEntry);
            }
        }
        const latency = Date.now() - startTime;
        analytics_1.analytics.recordRequest(false, latency, model);
        res.write(`event: done\n`);
        res.write(`data: ${JSON.stringify({ latency, cached: false, key, fullResponse: fullResponse.length })}\n\n`);
        res.end();
    }
    catch (err) {
        console.error('Stream error:', err);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Stream failed', details: err.message });
        }
        res.end();
    }
});
// Batch cache multiple prompts at once
app.post('/cache/batch', apiKeyAuth_1.optionalApiKeyAuth, async (req, res) => {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'entries array required' });
    }
    if (entries.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 entries per batch' });
    }
    const ttl = req.body.ttl || 3600000;
    const results = [];
    for (const item of entries) {
        const { prompt, response, model } = item;
        if (!prompt || !response) {
            results.push({ success: false, key: '', error: 'prompt and response required' });
            continue;
        }
        const key = hashPrompt(prompt);
        const entry = {
            prompt,
            response,
            model: model || 'gpt-4',
            createdAt: Date.now(),
            ttl,
            hits: 0
        };
        let ok = false;
        // Try PostgreSQL first
        if ((0, pgCache_1.isPgAvailable)()) {
            ok = await (0, pgCache_1.pgSet)(key, entry);
        }
        // Try Redis
        if (!ok && useRedis && redis) {
            try {
                await redis.setex(`prompt:${key}`, Math.floor(ttl / 1000), JSON.stringify(entry));
                ok = true;
            }
            catch { }
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
app.get('/cache/batch', apiKeyAuth_1.optionalApiKeyAuth, async (req, res) => {
    const prompts = req.query.prompts?.split(',').map(p => p.trim()).filter(Boolean) || [];
    if (prompts.length === 0) {
        return res.status(400).json({ error: 'prompts query parameter required (comma-separated)' });
    }
    if (prompts.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 prompts per batch' });
    }
    const results = [];
    for (const prompt of prompts) {
        const key = hashPrompt(prompt);
        let entry = null;
        let backend = 'memory';
        // Try PostgreSQL first
        if ((0, pgCache_1.isPgAvailable)()) {
            entry = await (0, pgCache_1.pgGet)(key);
            if (entry)
                backend = 'pg';
        }
        // Try Redis
        if (!entry && useRedis && redis) {
            try {
                const data = await redis.get(`prompt:${key}`);
                if (data) {
                    entry = JSON.parse(data);
                    backend = 'redis';
                }
            }
            catch { }
        }
        // Try memory
        if (!entry) {
            entry = memoryCache.get(key) || null;
            backend = 'memory';
        }
        if (!entry) {
            // Try semantic search
            if ((0, pgCache_1.isPgAvailable)() && (0, pgCache_1.isVectorAvailable)()) {
                const semanticEntry = await (0, pgCache_1.pgSemanticSearch)(prompt);
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
            if ((0, pgCache_1.isPgAvailable)())
                await (0, pgCache_1.pgDel)(key);
            else if (useRedis && redis)
                await redis.del(`prompt:${key}`);
            else
                memoryCache.delete(key);
            results.push({ prompt, cached: false, expired: true });
            continue;
        }
        entry.hits++;
        // Update hits
        if ((0, pgCache_1.isPgAvailable)()) {
            await (0, pgCache_1.pgSet)(key, entry);
        }
        else if (useRedis && redis) {
            await redis.set(`prompt:${key}`, JSON.stringify(entry), 'EX', Math.floor((entry.createdAt + entry.ttl - Date.now()) / 1000));
        }
        else {
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
app.post('/cache/warm', apiKeyAuth_1.optionalApiKeyAuth, async (req, res) => {
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
    const results = [];
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
                    const llmData = await llmRes.json();
                    cachedResponse = llmData.response || llmData.content || llmData.text;
                }
                catch (e) {
                    results.push({ prompt, success: false, error: e.message });
                    continue;
                }
            }
            else {
                results.push({ prompt, success: false, error: 'No response provided and LLM endpoint not configured' });
                continue;
            }
        }
        if (!cachedResponse) {
            results.push({ prompt, success: false, error: 'No response generated' });
            continue;
        }
        const key = hashPrompt(prompt);
        const entry = {
            prompt,
            response: cachedResponse,
            model: warmModel,
            createdAt: Date.now(),
            ttl: warmTtl,
            hits: 0
        };
        let ok = false;
        if ((0, pgCache_1.isPgAvailable)()) {
            ok = await (0, pgCache_1.pgSet)(key, entry);
        }
        if (!ok && useRedis && redis) {
            try {
                await redis.setex(`prompt:${key}`, Math.floor(warmTtl / 1000), JSON.stringify(entry));
                ok = true;
            }
            catch { }
        }
        if (!ok) {
            memoryCache.set(key, entry);
            ok = true;
        }
        if (ok)
            warmed++;
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
    if ((0, pgCache_1.isPgAvailable)()) {
        cleaned = await (0, pgCache_1.pgCleanup)();
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
    if ((0, pgCache_1.isPgAvailable)()) {
        cleared = await (0, pgCache_1.pgClearByModel)(model);
    }
    else if (useRedis && redis) {
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
        }
        catch { }
    }
    else {
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
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
    const offset = parseInt(req.query.offset) || 0;
    let keys = [];
    let backend = 'memory';
    if ((0, pgCache_1.isPgAvailable)()) {
        keys = await (0, pgCache_1.pgGetKeys)(limit, offset);
        backend = 'pg';
    }
    else if (useRedis && redis) {
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
        }
        catch { }
    }
    else {
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
    let stats = {};
    let backend = getBackend();
    if (backend === 'pg') {
        stats = await (0, pgCache_1.pgStatsByModel)();
    }
    else if (backend === 'redis' && redis) {
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
        }
        catch { }
    }
    else {
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
app.get('/cache/search', apiKeyAuth_1.optionalApiKeyAuth, async (req, res) => {
    const prefix = req.query.prefix;
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    if (!prefix || prefix.length < 2) {
        return res.status(400).json({ error: 'Prefix must be at least 2 characters' });
    }
    const backend = getBackend();
    let results = [];
    if (backend === 'pg') {
        results = await (0, pgCache_1.pgPrefixSearch)(prefix, limit);
    }
    else if (backend === 'redis' && redis) {
        try {
            const keys = await redis.keys('prompt:*');
            for (const key of keys) {
                const data = await redis.get(key);
                if (data) {
                    const entry = JSON.parse(data);
                    if (entry.prompt.toLowerCase().startsWith(prefix.toLowerCase())) {
                        results.push(entry);
                        if (results.length >= limit)
                            break;
                    }
                }
            }
        }
        catch { }
    }
    else {
        for (const entry of memoryCache.values()) {
            if (entry.prompt.toLowerCase().startsWith(prefix.toLowerCase())) {
                results.push(entry);
                if (results.length >= limit)
                    break;
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
app.get('/cache/similar/:prompt(*)', apiKeyAuth_1.optionalApiKeyAuth, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);
    const prompt = req.params.prompt;
    if (!prompt || prompt.trim().length < 3) {
        return res.status(400).json({ error: 'prompt must be at least 3 characters' });
    }
    const backend = getBackend();
    if (backend !== 'pg' || !(0, pgCache_1.isPgAvailable)() || !(0, pgCache_1.isVectorAvailable)()) {
        return res.status(503).json({
            error: 'Semantic search requires PostgreSQL with vector support',
            backend
        });
    }
    const similar = await (0, pgCache_1.pgFindSimilar)(prompt, limit);
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
// Refresh TTL - extend expiration of existing cache entry
app.put('/cache/refresh', apiKeyAuth_1.optionalApiKeyAuth, async (req, res) => {
    const { prompt, ttl } = req.body;
    const newTtl = ttl || 3600000; // default 1 hour
    if (!prompt) {
        return res.status(400).json({ error: 'prompt is required' });
    }
    const key = hashPrompt(prompt);
    const backend = getBackend();
    let success = false;
    if (backend === 'pg') {
        success = await (0, pgCache_1.pgRefreshTTL)(key, newTtl);
    }
    else if (backend === 'redis' && redis) {
        try {
            const data = await redis.get(`prompt:${key}`);
            if (data) {
                const entry = JSON.parse(data);
                entry.createdAt = Date.now();
                entry.ttl = newTtl;
                await redis.set(`prompt:${key}`, JSON.stringify(entry));
                success = true;
            }
        }
        catch { }
    }
    else {
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
    }
    else {
        res.status(404).json({ error: 'Cache entry not found' });
    }
});
// Export all cache entries (for backup/migration) - must be before :prompt(*) route
app.get('/cache/export', async (req, res) => {
    const format = req.query.format || 'json';
    const model = req.query.model;
    const entries = [];
    // Collect from PostgreSQL
    if ((0, pgCache_1.isPgAvailable)()) {
        try {
            const result = await pgCache_1.pool.query('SELECT * FROM prompt_cache' + (model ? ' WHERE model = $1' : ''), model ? [model] : []);
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
        }
        catch { }
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
        }
        catch { }
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
        const rows = entries.map(e => `"${e.key}","${e.prompt.replace(/"/g, '""')}","${e.response.replace(/"/g, '""')}","${e.model}",${e.createdAt},${e.ttl},${e.hits}`).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=prompt-cache-export.csv');
        res.send(header + rows);
    }
    else {
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
        if ((0, pgCache_1.isPgAvailable)()) {
            await (0, pgCache_1.pgClear)();
        }
        else if (useRedis && redis) {
            try {
                const keys = await redis.keys('prompt:*');
                if (keys.length)
                    await redis.del(...keys);
            }
            catch { }
        }
        memoryCache.clear();
    }
    let imported = 0;
    let failed = 0;
    const errors = [];
    for (const item of entries) {
        const { prompt, response, model, ttl, createdAt, hits } = item;
        if (!prompt || !response) {
            failed++;
            errors.push('prompt and response required');
            continue;
        }
        const key = hashPrompt(prompt);
        const entry = {
            prompt,
            response,
            model: model || 'gpt-4',
            createdAt: createdAt || Date.now(),
            ttl: ttl || 3600000,
            hits: hits || 0,
        };
        let ok = false;
        if ((0, pgCache_1.isPgAvailable)()) {
            ok = await (0, pgCache_1.pgSet)(key, entry);
        }
        if (!ok && useRedis && redis) {
            try {
                await redis.setex(`prompt:${key}`, Math.floor(entry.ttl / 1000), JSON.stringify(entry));
                ok = true;
            }
            catch { }
        }
        if (!ok) {
            memoryCache.set(key, entry);
            ok = true;
        }
        if (ok)
            imported++;
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
    let entry = null;
    let backend = 'memory';
    // Try PostgreSQL first
    if ((0, pgCache_1.isPgAvailable)()) {
        entry = await (0, pgCache_1.pgGet)(key);
        if (entry)
            backend = 'pg';
    }
    // Try Redis
    if (!entry && useRedis && redis) {
        try {
            const data = await redis.get(`prompt:${key}`);
            if (data) {
                entry = JSON.parse(data);
                backend = 'redis';
            }
        }
        catch { }
    }
    // Try memory
    if (!entry) {
        entry = memoryCache.get(key) || null;
        if (entry)
            backend = 'memory';
    }
    if (!entry) {
        return res.status(404).json({ error: 'Cache entry not found' });
    }
    // Check if expired
    if (isExpired(entry)) {
        if ((0, pgCache_1.isPgAvailable)())
            await (0, pgCache_1.pgDel)(key);
        else if (useRedis && redis)
            await redis.del(`prompt:${key}`);
        else
            memoryCache.delete(key);
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
app.get('/cache/:prompt(*)', (0, rateLimit_1.rateLimiter)({ windowMs: 60000, maxRequests: 200 }), async (req, res) => {
    const startTime = Date.now();
    const apiKey = req.headers['x-api-key'];
    const key = hashPrompt(req.params.prompt);
    let entry = null;
    // Try PostgreSQL first
    if ((0, pgCache_1.isPgAvailable)()) {
        entry = await (0, pgCache_1.pgGet)(key);
        if (entry) {
            entry.hits++;
            await (0, pgCache_1.pgSet)(key, entry);
            const latency = Date.now() - startTime;
            analytics_1.analytics.recordRequest(true, latency, entry.model);
            return res.json({
                cached: true,
                response: entry.response,
                model: entry.model,
                hits: entry.hits,
                age: Date.now() - entry.createdAt,
                backend: 'pg'
            });
        }
    }
    // Try Redis
    if (useRedis && redis) {
        try {
            const data = await redis.get(`prompt:${key}`);
            if (data) {
                entry = JSON.parse(data);
            }
        }
        catch { }
    }
    else {
        entry = memoryCache.get(key) || null;
    }
    if (!entry) {
        // Try semantic search as fallback
        if ((0, pgCache_1.isPgAvailable)() && (0, pgCache_1.isVectorAvailable)()) {
            const semanticEntry = await (0, pgCache_1.pgSemanticSearch)(req.params.prompt);
            if (semanticEntry) {
                const latency = Date.now() - startTime;
                analytics_1.analytics.recordRequest(true, latency, semanticEntry.model);
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
        analytics_1.analytics.recordRequest(false, latency, req.query.model);
        return res.json({ cached: false });
    }
    // Check TTL
    if (isExpired(entry)) {
        if ((0, pgCache_1.isPgAvailable)()) {
            await (0, pgCache_1.pgDel)(key);
        }
        else if (useRedis && redis) {
            await redis.del(`prompt:${key}`);
        }
        else {
            memoryCache.delete(key);
        }
        const latency = Date.now() - startTime;
        analytics_1.analytics.recordRequest(false, latency, entry.model);
        return res.json({ cached: false, expired: true });
    }
    entry.hits++;
    // Update hits in cache
    if ((0, pgCache_1.isPgAvailable)()) {
        await (0, pgCache_1.pgSet)(key, entry);
    }
    else if (useRedis && redis) {
        await redis.set(`prompt:${key}`, JSON.stringify(entry), 'EX', Math.floor((entry.createdAt + entry.ttl - Date.now()) / 1000));
    }
    else {
        memoryCache.set(key, entry);
    }
    const latency = Date.now() - startTime;
    analytics_1.analytics.recordRequest(true, latency, entry.model);
    res.json({
        cached: true,
        response: entry.response,
        model: entry.model,
        hits: entry.hits,
        age: Date.now() - entry.createdAt,
        backend: getBackend()
    });
});
// ===== Request Deduplication Endpoints =====
// Check if a request is in-flight (for polling/waiting)
app.get('/dedupe/status', apiKeyAuth_1.optionalApiKeyAuth, async (req, res) => {
    const prompt = req.query.prompt;
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
    }
    else {
        res.json({ inFlight: false, waiting: false, key });
    }
});
// Register that we're about to make an LLM call (start deduplication)
// If another request is already in-flight, this waits for it and returns cached result
app.post('/dedupe/register', apiKeyAuth_1.optionalApiKeyAuth, async (req, res) => {
    const { prompt, model } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'prompt required' });
    }
    const key = hashPrompt(prompt);
    // Check if already cached (fast path)
    let entry = null;
    let backend = 'memory';
    if ((0, pgCache_1.isPgAvailable)()) {
        entry = await (0, pgCache_1.pgGet)(key);
        if (entry)
            backend = 'pg';
    }
    if (!entry && useRedis && redis) {
        try {
            const data = await redis.get(`prompt:${key}`);
            if (data) {
                entry = JSON.parse(data);
                backend = 'redis';
            }
        }
        catch { }
    }
    if (!entry) {
        entry = memoryCache.get(key) || null;
        if (entry)
            backend = 'memory';
    }
    // Return cached if exists and not expired
    if (entry && Date.now() <= entry.createdAt + entry.ttl) {
        entry.hits++;
        if ((0, pgCache_1.isPgAvailable)())
            await (0, pgCache_1.pgSet)(key, entry);
        else if (useRedis && redis) {
            await redis.set(`prompt:${key}`, JSON.stringify(entry), 'EX', Math.floor((entry.createdAt + entry.ttl - Date.now()) / 1000));
        }
        else {
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
        }
        catch (err) {
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
app.post('/dedupe/complete', apiKeyAuth_1.optionalApiKeyAuth, async (req, res) => {
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
    const entry = {
        prompt,
        response,
        model: model || 'gpt-4',
        createdAt: Date.now(),
        ttl: cacheTtl,
        hits: 1
    };
    let backend = 'memory';
    let ok = false;
    if ((0, pgCache_1.isPgAvailable)()) {
        ok = await (0, pgCache_1.pgSet)(key, entry);
        if (ok)
            backend = 'pg';
    }
    if (!ok && useRedis && redis) {
        try {
            await redis.setex(`prompt:${key}`, Math.floor(cacheTtl / 1000), JSON.stringify(entry));
            ok = true;
            backend = 'redis';
        }
        catch { }
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
    let stats = { backend };
    if (backend === 'pg') {
        const pg = await (0, pgCache_1.pgStats)();
        stats.pg = pg;
    }
    else if (backend === 'redis' && redis) {
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
        }
        catch { }
    }
    else {
        const totalHits = Array.from(memoryCache.values()).reduce((sum, e) => sum + (e.hits || 0), 0);
        stats.memory = { entries: memoryCache.size, totalHits };
    }
    res.json(stats);
});
// Get usage stats for an API key
app.get('/usage/:apiKey', apiKeyAuth_1.optionalApiKeyAuth, async (req, res) => {
    const { apiKey } = req.params;
    if (!apiKey) {
        return res.status(400).json({ error: 'API key required' });
    }
    const stats = (0, usageLimits_1.getUsageStats)(apiKey);
    const tierInfo = usageLimits_1.TIERS[stats.tier] || usageLimits_1.TIERS.free;
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
// Detailed analytics
app.get('/analytics', async (req, res) => {
    const period = req.query.period || '24h';
    const data = analytics_1.analytics.getAnalytics(period);
    res.json(data);
});
// Clear cache
app.delete('/cache', async (req, res) => {
    if ((0, pgCache_1.isPgAvailable)()) {
        await (0, pgCache_1.pgClear)();
    }
    else if (useRedis && redis) {
        try {
            const keys = await redis.keys('prompt:*');
            if (keys.length) {
                await redis.del(...keys);
            }
        }
        catch { }
    }
    memoryCache.clear();
    res.json({ success: true, cleared: 'all' });
});
// Delete specific entry
app.delete('/cache/:prompt(*)', async (req, res) => {
    const key = hashPrompt(req.params.prompt);
    if ((0, pgCache_1.isPgAvailable)()) {
        await (0, pgCache_1.pgDel)(key);
    }
    else if (useRedis && redis) {
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
    let entry = null;
    // Try PostgreSQL first
    if ((0, pgCache_1.isPgAvailable)()) {
        entry = await (0, pgCache_1.pgGet)(key);
        if (entry) {
            entry.ttl = ttl;
            await (0, pgCache_1.pgSet)(key, entry);
            updated = true;
        }
    }
    // Try Redis
    if (!updated && useRedis && redis) {
        try {
            const data = await redis.get(`prompt:${key}`);
            if (data) {
                const parsed = JSON.parse(data);
                parsed.ttl = ttl;
                await redis.setex(`prompt:${key}`, Math.floor(ttl / 1000), JSON.stringify(parsed));
                updated = true;
            }
        }
        catch { }
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
// Clear cache by model
app.delete('/cache/model/:model', async (req, res) => {
    const { model } = req.params;
    if (!model) {
        return res.status(400).json({ error: 'model parameter required' });
    }
    let cleared = 0;
    if ((0, pgCache_1.isPgAvailable)()) {
        cleared = await (0, pgCache_1.pgClearByModel)(model);
    }
    else if (useRedis && redis) {
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
        }
        catch { }
    }
    else {
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
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
    const offset = parseInt(req.query.offset) || 0;
    let keys = [];
    let backend = 'memory';
    if ((0, pgCache_1.isPgAvailable)()) {
        keys = await (0, pgCache_1.pgGetKeys)(limit, offset);
        backend = 'pg';
    }
    else if (useRedis && redis) {
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
        }
        catch { }
    }
    else {
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
    let stats = {};
    let backend = getBackend();
    if (backend === 'pg') {
        stats = await (0, pgCache_1.pgStatsByModel)();
    }
    else if (backend === 'redis' && redis) {
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
        }
        catch { }
    }
    else {
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
            const { getOrCreateCustomer } = await Promise.resolve().then(() => __importStar(require('./services/stripe.js')));
            custId = await getOrCreateCustomer(email);
        }
        const { createCheckoutSession } = await Promise.resolve().then(() => __importStar(require('./services/stripe.js')));
        const result = await createCheckoutSession(tier, custId, `${process.env.FRONTEND_URL || 'http://localhost:3000'}/success?session_id={CHECKOUT_SESSION_ID}`, `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pricing`);
        res.json({ url: result.url, sessionId: result.sessionId });
    }
    catch (error) {
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
    const { generateAPIKey } = await Promise.resolve().then(() => __importStar(require('./services/apiKeys.js')));
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
    const { getAllAPIKeys } = await Promise.resolve().then(() => __importStar(require('./services/apiKeys.js')));
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
    const { getAllAPIKeys, revokeAPIKey } = await Promise.resolve().then(() => __importStar(require('./services/apiKeys.js')));
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
    const { getAllAPIKeys } = await Promise.resolve().then(() => __importStar(require('./services/apiKeys.js')));
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
const path_1 = __importDefault(require("path"));
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'landing.html'));
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'dashboard.html'));
});
app.get('/analytics', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'analytics.html'));
});
// Serve static files
app.use(express_1.default.static('.'));
const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(async () => {
    let cleaned = 0;
    if ((0, pgCache_1.isPgAvailable)()) {
        cleaned = await (0, pgCache_1.pgCleanup)();
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
// Stripe webhook
app.post('/webhook/stripe', express_1.default.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];
    try {
        const { handleWebhook } = await Promise.resolve().then(() => __importStar(require('./services/stripe.js')));
        const result = await handleWebhook(req.body, signature);
        console.log(`📦 Stripe webhook: ${result.type}`);
        // Handle specific events
        if (result.type === 'subscription_created') {
            // TODO: Update API key tier in database
            console.log(`✅ Subscription created: ${result.data.subscriptionId}`);
        }
        res.json({ received: true });
    }
    catch (error) {
        console.error('Webhook error:', error.message);
        res.status(400).json({ error: error.message });
    }
});
// Get cached entry content by key (for debugging/inspection)
app.get('/cache/key/:key', async (req, res) => {
    const { key } = req.params;
    if (!key || key.length < 8) {
        return res.status(400).json({ error: 'Valid cache key required' });
    }
    let entry = null;
    let backend = 'memory';
    // Try PostgreSQL first
    if ((0, pgCache_1.isPgAvailable)()) {
        entry = await (0, pgCache_1.pgGet)(key);
        if (entry)
            backend = 'pg';
    }
    // Try Redis
    if (!entry && useRedis && redis) {
        try {
            const data = await redis.get(`prompt:${key}`);
            if (data) {
                entry = JSON.parse(data);
                backend = 'redis';
            }
        }
        catch { }
    }
    // Try memory
    if (!entry) {
        entry = memoryCache.get(key) || null;
        if (entry)
            backend = 'memory';
    }
    if (!entry) {
        return res.status(404).json({ error: 'Cache entry not found' });
    }
    // Check if expired
    if (isExpired(entry)) {
        if ((0, pgCache_1.isPgAvailable)())
            await (0, pgCache_1.pgDel)(key);
        else if (useRedis && redis)
            await redis.del(`prompt:${key}`);
        else
            memoryCache.delete(key);
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
app.listen(PORT, () => {
    console.log(`🚀 PromptCache running on port ${PORT}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map