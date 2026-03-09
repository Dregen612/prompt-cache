import { Router } from 'express';
import { pool } from './db';

const router = Router();

router.get('/stats', async (req, res) => {
  try {
    const [total, hits, misses] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM cache_entries'),
      pool.query("SELECT COUNT(*) as count FROM cache_entries WHERE hit_count > 0"),
      pool.query("SELECT COUNT(*) as count FROM cache_entries WHERE hit_count = 0")
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
