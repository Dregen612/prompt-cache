"use strict";
// Analytics Router Service — PromptCache
// Provides detailed savings analytics per user (by API key tier)
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordAnalytics = recordAnalytics;
exports.createAnalyticsRouter = createAnalyticsRouter;
const express_1 = require("express");
// In-memory rolling 30-day store (keyed by apiKey or 'anon' for unauthenticated)
const dailyStore = new Map(); // key -> dateStr -> record
const modelStore = new Map(); // key -> model -> record
const MAX_DAYS = 30;
// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() {
    return new Date().toISOString().split('T')[0];
}
function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
}
function ensureDay(key, dateStr) {
    if (!dailyStore.has(key))
        dailyStore.set(key, new Map());
    const dayMap = dailyStore.get(key);
    if (!dayMap.has(dateStr)) {
        dayMap.set(dateStr, { date: dateStr, requests: 0, cacheHits: 0, tokensOriginal: 0, tokensCached: 0, latencySum: 0, latencyCount: 0 });
    }
    return dayMap.get(dateStr);
}
function ensureModel(key, model) {
    if (!modelStore.has(key))
        modelStore.set(key, new Map());
    const modelMap = modelStore.get(key);
    if (!modelMap.has(model)) {
        modelMap.set(model, { model, requests: 0, cacheHits: 0, tokensOriginal: 0, tokensCached: 0, latencySum: 0, latencyCount: 0 });
    }
    return modelMap.get(model);
}
function recordAnalytics(apiKey, cached, latency, model) {
    const key = apiKey || 'anon';
    const dateStr = todayStr();
    const day = ensureDay(key, dateStr);
    const mdl = ensureModel(key, model || 'unknown');
    // Rough token estimates: 500 tokens for a cache miss (full LLM call),
    // 150 tokens for a cache hit (serving cached response)
    const tokensOriginal = cached ? 0 : 500;
    const tokensCached = cached ? 150 : 0;
    day.requests++;
    if (cached)
        day.cacheHits++;
    day.tokensOriginal += tokensOriginal;
    day.tokensCached += tokensCached;
    day.latencySum += latency;
    day.latencyCount++;
    mdl.requests++;
    if (cached)
        mdl.cacheHits++;
    mdl.tokensOriginal += tokensOriginal;
    mdl.tokensCached += tokensCached;
    mdl.latencySum += latency;
    mdl.latencyCount++;
    // Trim old entries beyond MAX_DAYS
    const dayMap = dailyStore.get(key);
    for (const d of dayMap.keys()) {
        if (d < daysAgo(MAX_DAYS))
            dayMap.delete(d);
    }
}
// ─── Demo data (Free tier) ────────────────────────────────────────────────────
function getDemoSummary() {
    return {
        totalRequests: 1247,
        cacheHits: 892,
        cacheHitRate: 0.715,
        totalTokensOriginal: 890000,
        totalTokensCached: 670000,
        totalCostOriginal: 8.90,
        totalCostWithCache: 2.20,
        savings: 6.70,
        savingsPercent: 75.3,
        period: '30d',
        demo: true,
    };
}
function getDemoTimeline() {
    const days = [];
    const seeds = [42, 18, 67, 93, 25, 71, 39, 55, 88, 12, 76, 44, 91, 28, 63, 80, 17, 95, 33, 60, 84, 21, 73, 48, 15, 89, 36, 62, 79, 24];
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const base = seeds[29 - i] % 35 + 15;
        const hitRate = 0.60 + (seeds[29 - i] % 30) / 100;
        const hits = Math.floor(base * hitRate);
        const savings = parseFloat((hits * 0.15 * (0.85 + (seeds[29 - i] % 30) / 100)).toFixed(2));
        days.push({ date: dateStr, requests: base, cacheHits: hits, savings });
    }
    return { days, demo: true };
}
function getDemoModels() {
    return {
        models: [
            { model: 'gpt-4', requests: 500, cacheHitRate: 0.72, savings: 3.20 },
            { model: 'gpt-3.5-turbo', requests: 400, cacheHitRate: 0.78, savings: 2.10 },
            { model: 'claude-3-opus', requests: 200, cacheHitRate: 0.65, savings: 1.80 },
            { model: 'claude-3-haiku', requests: 147, cacheHitRate: 0.60, savings: 0.60 },
        ],
        demo: true,
    };
}
// ─── Cost calculation ─────────────────────────────────────────────────────────
function calcCost(tokens) {
    // GPT-4-class pricing: $0.03/1K tokens input
    return parseFloat((tokens * 0.03 / 1000).toFixed(4));
}
// ─── Real data aggregation ────────────────────────────────────────────────────
function getRealSummary(key) {
    const dayMap = dailyStore.get(key) || new Map();
    let totalRequests = 0, cacheHits = 0, tokensOriginal = 0, tokensCached = 0, latencySum = 0, latencyCount = 0;
    for (const day of dayMap.values()) {
        totalRequests += day.requests;
        cacheHits += day.cacheHits;
        tokensOriginal += day.tokensOriginal;
        tokensCached += day.tokensCached;
        latencySum += day.latencySum;
        latencyCount += day.latencyCount;
    }
    const cacheHitRate = totalRequests > 0 ? cacheHits / totalRequests : 0;
    const totalCostOriginal = calcCost(tokensOriginal);
    const totalCostWithCache = calcCost(tokensCached);
    const savings = totalCostOriginal - totalCostWithCache;
    const savingsPercent = totalCostOriginal > 0 ? (savings / totalCostOriginal) * 100 : 0;
    const avgLatency = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;
    return {
        totalRequests,
        cacheHits,
        cacheHitRate: parseFloat(cacheHitRate.toFixed(3)),
        totalTokensOriginal: Math.round(tokensOriginal),
        totalTokensCached: Math.round(tokensCached),
        totalCostOriginal: parseFloat(totalCostOriginal.toFixed(2)),
        totalCostWithCache: parseFloat(totalCostWithCache.toFixed(2)),
        savings: parseFloat(savings.toFixed(2)),
        savingsPercent: parseFloat(savingsPercent.toFixed(1)),
        period: '30d',
        avgLatency,
        demo: false,
    };
}
function getRealTimeline(key) {
    const dayMap = dailyStore.get(key) || new Map();
    const days = [];
    for (let i = 29; i >= 0; i--) {
        const dateStr = daysAgo(i);
        const day = dayMap.get(dateStr);
        if (day) {
            const costOriginal = calcCost(day.tokensOriginal);
            const costCached = calcCost(day.tokensCached);
            const savings = costOriginal - costCached;
            days.push({ date: dateStr, requests: day.requests, cacheHits: day.cacheHits, savings: parseFloat(savings.toFixed(2)) });
        }
        else {
            days.push({ date: dateStr, requests: 0, cacheHits: 0, savings: 0 });
        }
    }
    return { days, demo: false };
}
function getRealModels(key) {
    const modelMap = modelStore.get(key) || new Map();
    const models = [];
    for (const mdl of modelMap.values()) {
        const cacheHitRate = mdl.requests > 0 ? mdl.cacheHits / mdl.requests : 0;
        const costOriginal = calcCost(mdl.tokensOriginal);
        const costCached = calcCost(mdl.tokensCached);
        const savings = costOriginal - costCached;
        models.push({
            model: mdl.model,
            requests: mdl.requests,
            cacheHitRate: parseFloat(cacheHitRate.toFixed(3)),
            savings: parseFloat(savings.toFixed(2)),
        });
    }
    // Sort by requests descending
    models.sort((a, b) => b.requests - a.requests);
    return { models, demo: false };
}
function getTierFromKey(apiKey, getKeyTier) {
    if (!apiKey)
        return 'free';
    const tier = getKeyTier(apiKey);
    return tier || 'free';
}
// ─── Router factory ───────────────────────────────────────────────────────────
function createAnalyticsRouter(getKeyTier) {
    const router = (0, express_1.Router)();
    // GET /api/analytics/summary
    router.get('/summary', (req, res) => {
        const apiKey = req.headers['x-api-key'];
        const tier = getTierFromKey(apiKey, getKeyTier);
        if (tier === 'free') {
            return res.json(getDemoSummary());
        }
        return res.json(getRealSummary(apiKey || 'anon'));
    });
    // GET /api/analytics/timeline
    router.get('/timeline', (req, res) => {
        const apiKey = req.headers['x-api-key'];
        const tier = getTierFromKey(apiKey, getKeyTier);
        if (tier === 'free') {
            return res.json(getDemoTimeline());
        }
        return res.json(getRealTimeline(apiKey || 'anon'));
    });
    // GET /api/analytics/models
    router.get('/models', (req, res) => {
        const apiKey = req.headers['x-api-key'];
        const tier = getTierFromKey(apiKey, getKeyTier);
        if (tier === 'free') {
            return res.json(getDemoModels());
        }
        return res.json(getRealModels(apiKey || 'anon'));
    });
    return router;
}
//# sourceMappingURL=analyticsRouter.js.map