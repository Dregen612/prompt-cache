"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimiter = rateLimiter;
const rateLimits = new Map();
function rateLimiter(config) {
    return (req, res, next) => {
        const key = req.headers['x-api-key'] || req.ip || 'unknown';
        const now = Date.now();
        let record = rateLimits.get(key);
        if (!record || now > record.resetTime) {
            record = { count: 0, resetTime: now + config.windowMs };
            rateLimits.set(key, record);
        }
        record.count++;
        if (record.count > config.maxRequests) {
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }
        next();
    };
}
//# sourceMappingURL=rateLimit.js.map