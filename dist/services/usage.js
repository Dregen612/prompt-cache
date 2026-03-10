"use strict";
// Usage Tracking for PromptCache
// pg client not available - using analytics.ts instead
Object.defineProperty(exports, "__esModule", { value: true });
exports.usageTracker = exports.UsageTracker = void 0;
class UsageTracker {
    // Track API usage
    async track(req, res, next) {
        const start = Date.now();
        // Store original json
        const originalJson = res.json.bind(res);
        res.json = (data) => {
            const latency = Date.now() - start;
            // Calculate cost (mock - would use real pricing)
            const tokens = data.tokens || 0;
            const cost = tokens * 0.0001; // $0.0001 per token
            // Store usage
            this.store({
                apiKey: req.headers['x-api-key'] || 'unknown',
                prompt: req.params.prompt || req.body?.prompt || '',
                cached: data.cached || false,
                latency,
                tokens,
                cost
            });
            return originalJson(data);
        };
        next();
    }
    async store(record) {
        // Using analytics.ts for tracking instead
    }
    // Get usage stats for an API key
    async getStats(apiKey, days = 7) {
        return null;
    }
    // Get all-time stats
    async getAllTimeStats() {
        return null;
    }
}
exports.UsageTracker = UsageTracker;
exports.usageTracker = new UsageTracker();
//# sourceMappingURL=usage.js.map