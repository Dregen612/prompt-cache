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
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const ioredis_1 = __importDefault(require("ioredis"));
const crypto_1 = __importDefault(require("crypto"));
const stripe_1 = __importDefault(require("stripe"));
const pgCache_1 = require("./services/pgCache");
const apiKeyAuth_1 = require("./middleware/apiKeyAuth");
// Stripe setup
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    apiVersion: '2026-02-25.clover',
});
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use(express_1.default.json());
// Serve landing page at root
app.get('/', (req, res) => {
    const htmlPath = path_1.default.join(__dirname, '..', 'landing.html');
    if (fs_1.default.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    }
    else {
        res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>PromptCache</title></head>
      <body style="background:#030307;color:#f8fafc;font-family:system-ui;padding:2rem;">
        <h1>🚀 PromptCache API</h1>
        <p>Pay-per-call AI caching with crypto.</p>
        <ul>
          <li><a href="/health" style="color:#6366f1;">/health</a> - Health check</li>
          <li><a href="/cache/test" style="color:#6365f1;">/cache/test</a> - Test cache</li>
        </ul>
      </body>
      </html>
    `);
    }
});
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
// Cache a prompt with TTL
app.post('/cache', async (req, res) => {
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
// Batch get multiple cached prompts (requires payment for cache hits)
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
    res.json({
        total: prompts.length,
        hits: hitCount,
        misses: prompts.length - hitCount,
        results,
        backend: getBackend()
    });
});
// Get cached prompt (requires payment for cache hits)
app.get('/cache/:prompt(*)', async (req, res) => {
    const key = hashPrompt(req.params.prompt);
    let entry = null;
    // Try PostgreSQL first
    if ((0, pgCache_1.isPgAvailable)()) {
        entry = await (0, pgCache_1.pgGet)(key);
        if (entry) {
            entry.hits++;
            await (0, pgCache_1.pgSet)(key, entry);
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
    res.json({
        cached: true,
        response: entry.response,
        model: entry.model,
        hits: entry.hits,
        age: Date.now() - entry.createdAt,
        backend: getBackend()
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
// Detailed analytics
app.get('/analytics', async (req, res) => {
    const backend = getBackend();
    const now = Date.now();
    // Simulate activity data (in production, track this in DB)
    const analytics = {
        period: '24h',
        totalRequests: Math.floor(Math.random() * 1000) + 500,
        cacheHits: Math.floor(Math.random() * 800) + 200,
        cacheMisses: Math.floor(Math.random() * 200) + 50,
        avgLatency: Math.floor(Math.random() * 200) + 50,
        tokensSaved: Math.floor(Math.random() * 50000) + 10000,
        costSaved: Math.floor(Math.random() * 10) + 2,
        topModels: [
            { model: 'gpt-4o-mini', requests: Math.floor(Math.random() * 500) },
            { model: 'claude-3-haiku', requests: Math.floor(Math.random() * 300) },
            { model: 'gemini-1.5-flash', requests: Math.floor(Math.random() * 200) },
        ],
        hourlyRequests: Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            requests: Math.floor(Math.random() * 100)
        })),
        hitRate: 0,
    };
    analytics.hitRate = Math.round((analytics.cacheHits / analytics.totalRequests) * 100);
    res.json(analytics);
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
// ============================================
// API Key Management
// ============================================
const apiKeys_1 = require("./services/apiKeys");
// Create new API key
app.post('/api/keys', (req, res) => {
    try {
        const { name } = req.body;
        const key = (0, apiKeys_1.generateAPIKey)(name || 'API Key');
        res.json({
            success: true,
            key,
            message: 'Store this key securely - it will not be shown again!'
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// List all keys (admin)
app.get('/api/keys', (req, res) => {
    try {
        const keys = (0, apiKeys_1.getAllKeys)().map(k => ({
            key: k.key.slice(0, 12) + '...' + k.key.slice(-4),
            name: k.name,
            created: new Date(k.created).toISOString(),
            lastUsed: k.lastUsed ? new Date(k.lastUsed).toISOString() : null,
            requests: k.requests,
            active: k.active
        }));
        res.json({ keys });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Revoke API key
app.delete('/api/keys/:key', (req, res) => {
    try {
        const { key } = req.params;
        const success = (0, apiKeys_1.revokeAPIKey)(key);
        res.json({ success, message: success ? 'Key revoked' : 'Key not found' });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Validate key (check if active)
app.get('/api/keys/validate/:key', (req, res) => {
    try {
        const { key } = req.params;
        const result = (0, apiKeys_1.validateAPIKey)(key);
        res.json({
            valid: result.valid,
            keyData: result.keyData ? {
                name: result.keyData.name,
                requests: result.keyData.requests
            } : null
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Analytics & Stats
app.get('/api/analytics', (req, res) => {
    try {
        const keys = (0, apiKeys_1.getAllKeys)();
        const totalRequests = keys.reduce((sum, k) => sum + k.requests, 0);
        const totalCacheHits = keys.reduce((sum, k) => sum + k.cacheHits, 0);
        res.json({
            totalKeys: keys.length,
            totalRequests,
            totalCacheHits,
            hitRate: totalRequests > 0 ? (totalCacheHits / totalRequests) * 100 : 0,
            keys: keys.map(k => ({
                key: k.key.slice(0, 12) + '...',
                name: k.name,
                tier: k.tier,
                requests: k.requests,
                hits: k.cacheHits,
                active: k.active
            }))
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Cache stats
app.get('/api/cache/stats', (req, res) => {
    try {
        res.json({
            pgAvailable: (0, pgCache_1.isPgAvailable)(),
            vectorAvailable: (0, pgCache_1.isVectorAvailable)(),
            memoryEntries: memoryCache.size,
            ...(0, pgCache_1.pgStats)()
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Available tiers
app.get('/api/tiers', (req, res) => {
    res.json({
        tiers: {
            free: { name: 'Free', requestsPerDay: 1000, price: 0 },
            pro: { name: 'Pro', requestsPerDay: 50000, price: 29 },
            enterprise: { name: 'Enterprise', requestsPerDay: -1, price: 99 }
        }
    });
});
app.listen(PORT, () => {
    console.log(`🚀 PromptCache running on port ${PORT}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map