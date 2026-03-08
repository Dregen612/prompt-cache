"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usageTracker = exports.UsageTracker = void 0;
// Usage Tracking for PromptCache
const pgClient_1 = require("./pgClient");
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
        try {
            await pgClient_1.pg.query(`INSERT INTO usage (api_key, prompt, cached, latency, tokens, cost)
         VALUES ($1, $2, $3, $4, $5, $6)`, [record.apiKey, record.prompt, record.cached, record.latency, record.tokens, record.cost]);
        }
        catch (e) {
            // Silent fail - don't break API
        }
    }
    // Get usage stats for an API key
    async getStats(apiKey, days = 7) {
        try {
            const result = await pgClient_1.pg.query(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN cached THEN 1 ELSE 0 END) as cache_hits,
          SUM(tokens) as total_tokens,
          SUM(cost) as total_cost,
          AVG(latency) as avg_latency
        FROM usage
        WHERE api_key = $1
        AND timestamp > NOW() - INTERVAL '${days} days'
      `, [apiKey]);
            return result.rows[0];
        }
        catch (e) {
            return null;
        }
    }
    // Get all-time stats
    async getAllTimeStats() {
        try {
            const result = await pgClient_1.pg.query(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN cached THEN 1 ELSE 0 END) as cache_hits,
          SUM(tokens) as total_tokens,
          SUM(cost) as total_cost,
          COUNT(DISTINCT api_key) as unique_keys
        FROM usage
      `);
            return result.rows[0];
        }
        catch (e) {
            return null;
        }
    }
}
exports.UsageTracker = UsageTracker;
exports.usageTracker = new UsageTracker();
//# sourceMappingURL=usage.js.map