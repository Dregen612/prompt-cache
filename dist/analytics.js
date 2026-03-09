"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("./db");
const router = (0, express_1.Router)();
router.get('/stats', async (req, res) => {
    try {
        const [total, hits, misses] = await Promise.all([
            db_1.pool.query('SELECT COUNT(*) as count FROM cache_entries'),
            db_1.pool.query("SELECT COUNT(*) as count FROM cache_entries WHERE hit_count > 0"),
            db_1.pool.query("SELECT COUNT(*) as count FROM cache_entries WHERE hit_count = 0")
        ]);
        const hitRate = total.rows[0].count > 0
            ? ((hits.rows[0].count / total.rows[0].count) * 100).toFixed(1)
            : '0';
        res.json({
            totalRequests: parseInt(total.rows[0].count),
            cacheHits: parseInt(hits.rows[0].count),
            cacheMisses: parseInt(misses.rows[0].count),
            hitRate: hitRate + '%'
        });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
exports.default = router;
//# sourceMappingURL=analytics.js.map