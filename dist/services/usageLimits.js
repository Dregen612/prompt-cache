"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIERS = void 0;
exports.getUsage = getUsage;
exports.recordRequest = recordRequest;
exports.getUsageStats = getUsageStats;
exports.getAllUsageStats = getAllUsageStats;
exports.TIERS = {
    free: {
        name: 'Free',
        requestsPerDay: 1000,
        cacheSize: 100,
        semanticSearch: false,
        price: 0
    },
    pro: {
        name: 'Pro',
        requestsPerDay: 50000,
        cacheSize: 10000,
        semanticSearch: true,
        price: 29
    },
    enterprise: {
        name: 'Enterprise',
        requestsPerDay: -1, // unlimited
        cacheSize: -1,
        semanticSearch: true,
        price: 99
    }
};
const usageRecords = new Map();
function getUsage(key) {
    const today = new Date().toISOString().split('T')[0];
    if (!usageRecords.has(key)) {
        usageRecords.set(key, []);
    }
    const records = usageRecords.get(key);
    let todayRecord = records.find(r => r.date === today);
    if (!todayRecord) {
        todayRecord = { key, date: today, requests: 0, cacheHits: 0 };
        records.push(todayRecord);
    }
    return todayRecord;
}
function recordRequest(key, isCacheHit = false) {
    const usage = getUsage(key);
    // Get tier for this key (default to free)
    const keyTier = 'free'; // Would look up from DB
    const tier = exports.TIERS[keyTier];
    // Check limits
    if (tier.requestsPerDay > 0 && usage.requests >= tier.requestsPerDay) {
        return { allowed: false, remaining: 0, tier: keyTier };
    }
    usage.requests++;
    if (isCacheHit) {
        usage.cacheHits++;
    }
    const remaining = tier.requestsPerDay > 0 ? tier.requestsPerDay - usage.requests : -1;
    return { allowed: true, remaining, tier: keyTier };
}
function getUsageStats(key) {
    const usage = getUsage(key);
    const tier = exports.TIERS['free'];
    return {
        today: {
            requests: usage.requests,
            cacheHits: usage.cacheHits,
            hitRate: usage.requests > 0 ? (usage.cacheHits / usage.requests) * 100 : 0
        },
        tier: 'free',
        limit: tier.requestsPerDay,
        remaining: tier.requestsPerDay - usage.requests
    };
}
function getAllUsageStats() {
    const stats = [];
    for (const [key, records] of usageRecords) {
        const totalRequests = records.reduce((sum, r) => sum + r.requests, 0);
        const totalHits = records.reduce((sum, r) => sum + r.cacheHits, 0);
        stats.push({
            key: key.slice(0, 12) + '...',
            requests: totalRequests,
            hits: totalHits,
            hitRate: totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0
        });
    }
    return stats;
}
//# sourceMappingURL=usageLimits.js.map