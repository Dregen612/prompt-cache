// Usage Tracking for PromptCache
import { pg } from './pgClient';

export interface UsageRecord {
  id: number;
  apiKey: string;
  prompt: string;
  cached: boolean;
  latency: number;
  tokens: number;
  cost: number;
  timestamp: number;
}

export class UsageTracker {
  // Track API usage
  async track(req: any, res: any, next: any) {
    const start = Date.now();
    
    // Store original json
    const originalJson = res.json.bind(res);
    
    res.json = (data: any) => {
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
  
  private async store(record: Omit<UsageRecord, 'id' | 'timestamp'>) {
    try {
      await pg.query(
        `INSERT INTO usage (api_key, prompt, cached, latency, tokens, cost)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [record.apiKey, record.prompt, record.cached, record.latency, record.tokens, record.cost]
      );
    } catch (e) {
      // Silent fail - don't break API
    }
  }
  
  // Get usage stats for an API key
  async getStats(apiKey: string, days = 7) {
    try {
      const result = await pg.query(`
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
    } catch (e) {
      return null;
    }
  }
  
  // Get all-time stats
  async getAllTimeStats() {
    try {
      const result = await pg.query(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN cached THEN 1 ELSE 0 END) as cache_hits,
          SUM(tokens) as total_tokens,
          SUM(cost) as total_cost,
          COUNT(DISTINCT api_key) as unique_keys
        FROM usage
      `);
      
      return result.rows[0];
    } catch (e) {
      return null;
    }
  }
}

export const usageTracker = new UsageTracker();
