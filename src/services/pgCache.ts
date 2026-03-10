import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://adamwallace@/openclaw_memory?host=/tmp',
});

let pgAvailable = false;
let vectorAvailable = false;

// Simple hash-based embedding for fuzzy matching
function simpleEmbedding(text: string): number[] {
  const words = text.toLowerCase().split(/\s+/);
  const embedding = new Array(384).fill(0);
  words.forEach((word, i) => {
    let hash = 0;
    for (let j = 0; j < word.length; j++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(j);
      hash = hash & hash;
    }
    embedding[Math.abs(hash) % 384] += 1;
  });
  // Normalize
  const mag = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return mag > 0 ? embedding.map(v => v / mag) : embedding;
}

export async function initPgCache(): Promise<void> {
  try {
    // Enable vector extension
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    vectorAvailable = true;
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prompt_cache (
        key VARCHAR(16) PRIMARY KEY,
        prompt TEXT NOT NULL,
        response TEXT NOT NULL,
        model VARCHAR(50) DEFAULT 'gpt-4',
        created_at BIGINT NOT NULL,
        ttl INTEGER DEFAULT 3600000,
        hits INTEGER DEFAULT 0,
        embedding vector(384)
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_cache_created ON prompt_cache(created_at);
      CREATE INDEX IF NOT EXISTS idx_prompt_cache_embedding ON prompt_cache USING ivfflat (embedding vector_cosine_ops);
    `);
    pgAvailable = true;
    console.log('🔗 PostgreSQL cache initialized with vector support');
  } catch (err) {
    console.log('⚠️ PostgreSQL unavailable, using memory fallback');
    pgAvailable = false;
  }
}

export function isPgAvailable(): boolean {
  return pgAvailable;
}

export function isVectorAvailable(): boolean {
  return vectorAvailable;
}

export interface CacheEntry {
  prompt: string;
  response: string;
  model: string;
  createdAt: number;
  ttl: number;
  hits: number;
}

export async function pgSet(key: string, entry: CacheEntry, embedding?: number[]): Promise<boolean> {
  if (!pgAvailable) return false;
  try {
    const emb = embedding || simpleEmbedding(entry.prompt);
    await pool.query(
      `INSERT INTO prompt_cache (key, prompt, response, model, created_at, ttl, hits, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (key) DO UPDATE SET
         prompt = EXCLUDED.prompt,
         response = EXCLUDED.response,
         model = EXCLUDED.model,
         created_at = EXCLUDED.created_at,
         ttl = EXCLUDED.ttl,
         hits = EXCLUDED.hits,
         embedding = EXCLUDED.embedding`,
      [key, entry.prompt, entry.response, entry.model, entry.createdAt, entry.ttl, entry.hits, JSON.stringify(emb)]
    );
    return true;
  } catch {
    return false;
  }
}

export async function pgGet(key: string): Promise<CacheEntry | null> {
  if (!pgAvailable) return null;
  try {
    const result = await pool.query(
      'SELECT * FROM prompt_cache WHERE key = $1',
      [key]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    // Check TTL
    if (Date.now() > row.created_at + row.ttl) {
      await pgDel(key);
      return null;
    }
    return {
      prompt: row.prompt,
      response: row.response,
      model: row.model,
      createdAt: row.created_at,
      ttl: row.ttl,
      hits: row.hits,
    };
  } catch {
    return null;
  }
}

// Semantic search - find similar prompts
export async function pgSemanticSearch(prompt: string, threshold = 0.7): Promise<CacheEntry | null> {
  if (!pgAvailable || !vectorAvailable) return null;
  
  try {
    const emb = simpleEmbedding(prompt);
    const result = await pool.query(
      `SELECT *, (embedding <=> $1::vector) as distance 
       FROM prompt_cache 
       WHERE created_at + ttl > $2
       ORDER BY embedding <=> $1::vector
       LIMIT 1`,
      [JSON.stringify(emb), Date.now()]
    );
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    if (row.distance > (1 - threshold)) return null;
    
    // Update hits
    await pool.query(
      'UPDATE prompt_cache SET hits = hits + 1 WHERE key = $1',
      [row.key]
    );
    
    return {
      prompt: row.prompt,
      response: row.response,
      model: row.model,
      createdAt: row.created_at,
      ttl: row.ttl,
      hits: row.hits + 1,
    };
  } catch {
    return null;
  }
}

export async function pgDel(key: string): Promise<void> {
  if (!pgAvailable) return;
  try {
    await pool.query('DELETE FROM prompt_cache WHERE key = $1', [key]);
  } catch {}
}

export async function pgClear(): Promise<void> {
  if (!pgAvailable) return;
  try {
    await pool.query('DELETE FROM prompt_cache');
  } catch {}
}

export async function pgStats(): Promise<{ entries: number; totalHits: number }> {
  if (!pgAvailable) return { entries: 0, totalHits: 0 };
  try {
    const count = await pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(hits), 0) as hits FROM prompt_cache');
    return {
      entries: parseInt(count.rows[0].cnt),
      totalHits: parseInt(count.rows[0].hits),
    };
  } catch {
    return { entries: 0, totalHits: 0 };
  }
}

export async function pgCleanup(): Promise<number> {
  if (!pgAvailable) return 0;
  try {
    const result = await pool.query(
      'DELETE FROM prompt_cache WHERE created_at + ttl < $1',
      [Date.now()]
    );
    return result.rowCount || 0;
  } catch {
    return 0;
  }
}

// Clear cache by model (useful when model updates)
export async function pgClearByModel(model: string): Promise<number> {
  if (!pgAvailable) return 0;
  try {
    const result = await pool.query(
      'DELETE FROM prompt_cache WHERE model = $1',
      [model]
    );
    return result.rowCount || 0;
  } catch {
    return 0;
  }
}

// Get all cache keys with metadata (for listing)
export async function pgGetKeys(limit = 100, offset = 0): Promise<Array<{key: string; model: string; hits: number; createdAt: number; ttl: number}>> {
  if (!pgAvailable) return [];
  try {
    const result = await pool.query(
      'SELECT key, model, hits, created_at, ttl FROM prompt_cache ORDER BY hits DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return result.rows.map(row => ({
      key: row.key,
      model: row.model,
      hits: row.hits,
      createdAt: row.created_at,
      ttl: row.ttl,
    }));
  } catch {
    return [];
  }
}

// Get cache size by model
export async function pgStatsByModel(): Promise<Record<string, { count: number; hits: number }>> {
  if (!pgAvailable) return {};
  try {
    const result = await pool.query(
      'SELECT model, COUNT(*) as cnt, COALESCE(SUM(hits), 0) as hits FROM prompt_cache GROUP BY model'
    );
    const stats: Record<string, { count: number; hits: number }> = {};
    for (const row of result.rows) {
      stats[row.model] = {
        count: parseInt(row.cnt),
        hits: parseInt(row.hits),
      };
    }
    return stats;
  } catch {
    return {};
  }
}
