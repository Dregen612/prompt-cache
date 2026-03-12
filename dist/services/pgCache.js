"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.initPgCache = initPgCache;
exports.isPgAvailable = isPgAvailable;
exports.isVectorAvailable = isVectorAvailable;
exports.pgSet = pgSet;
exports.pgGet = pgGet;
exports.pgSemanticSearch = pgSemanticSearch;
exports.pgDel = pgDel;
exports.pgClear = pgClear;
exports.pgStats = pgStats;
exports.pgCleanup = pgCleanup;
exports.pgClearByModel = pgClearByModel;
exports.pgGetKeys = pgGetKeys;
exports.pgStatsByModel = pgStatsByModel;
exports.pgPrefixSearch = pgPrefixSearch;
exports.pgRefreshTTL = pgRefreshTTL;
const pg_1 = require("pg");
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://adamwallace@/openclaw_memory?host=/tmp',
});
let pgAvailable = false;
let vectorAvailable = false;
// Simple hash-based embedding for fuzzy matching
function simpleEmbedding(text) {
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
async function initPgCache() {
    try {
        // Enable vector extension
        await exports.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
        vectorAvailable = true;
        await exports.pool.query(`
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
    }
    catch (err) {
        console.log('⚠️ PostgreSQL unavailable, using memory fallback');
        pgAvailable = false;
    }
}
function isPgAvailable() {
    return pgAvailable;
}
function isVectorAvailable() {
    return vectorAvailable;
}
async function pgSet(key, entry, embedding) {
    if (!pgAvailable)
        return false;
    try {
        const emb = embedding || simpleEmbedding(entry.prompt);
        await exports.pool.query(`INSERT INTO prompt_cache (key, prompt, response, model, created_at, ttl, hits, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (key) DO UPDATE SET
         prompt = EXCLUDED.prompt,
         response = EXCLUDED.response,
         model = EXCLUDED.model,
         created_at = EXCLUDED.created_at,
         ttl = EXCLUDED.ttl,
         hits = EXCLUDED.hits,
         embedding = EXCLUDED.embedding`, [key, entry.prompt, entry.response, entry.model, entry.createdAt, entry.ttl, entry.hits, JSON.stringify(emb)]);
        return true;
    }
    catch {
        return false;
    }
}
async function pgGet(key) {
    if (!pgAvailable)
        return null;
    try {
        const result = await exports.pool.query('SELECT * FROM prompt_cache WHERE key = $1', [key]);
        if (result.rows.length === 0)
            return null;
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
    }
    catch {
        return null;
    }
}
// Semantic search - find similar prompts
async function pgSemanticSearch(prompt, threshold = 0.7) {
    if (!pgAvailable || !vectorAvailable)
        return null;
    try {
        const emb = simpleEmbedding(prompt);
        const result = await exports.pool.query(`SELECT *, (embedding <=> $1::vector) as distance 
       FROM prompt_cache 
       WHERE created_at + ttl > $2
       ORDER BY embedding <=> $1::vector
       LIMIT 1`, [JSON.stringify(emb), Date.now()]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        if (row.distance > (1 - threshold))
            return null;
        // Update hits
        await exports.pool.query('UPDATE prompt_cache SET hits = hits + 1 WHERE key = $1', [row.key]);
        return {
            prompt: row.prompt,
            response: row.response,
            model: row.model,
            createdAt: row.created_at,
            ttl: row.ttl,
            hits: row.hits + 1,
        };
    }
    catch {
        return null;
    }
}
async function pgDel(key) {
    if (!pgAvailable)
        return;
    try {
        await exports.pool.query('DELETE FROM prompt_cache WHERE key = $1', [key]);
    }
    catch { }
}
async function pgClear() {
    if (!pgAvailable)
        return;
    try {
        await exports.pool.query('DELETE FROM prompt_cache');
    }
    catch { }
}
async function pgStats() {
    if (!pgAvailable)
        return { entries: 0, totalHits: 0 };
    try {
        const count = await exports.pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(hits), 0) as hits FROM prompt_cache');
        return {
            entries: parseInt(count.rows[0].cnt),
            totalHits: parseInt(count.rows[0].hits),
        };
    }
    catch {
        return { entries: 0, totalHits: 0 };
    }
}
async function pgCleanup() {
    if (!pgAvailable)
        return 0;
    try {
        const result = await exports.pool.query('DELETE FROM prompt_cache WHERE created_at + ttl < $1', [Date.now()]);
        return result.rowCount || 0;
    }
    catch {
        return 0;
    }
}
// Clear cache by model (useful when model updates)
async function pgClearByModel(model) {
    if (!pgAvailable)
        return 0;
    try {
        const result = await exports.pool.query('DELETE FROM prompt_cache WHERE model = $1', [model]);
        return result.rowCount || 0;
    }
    catch {
        return 0;
    }
}
// Get all cache keys with metadata (for listing)
async function pgGetKeys(limit = 100, offset = 0) {
    if (!pgAvailable)
        return [];
    try {
        const result = await exports.pool.query('SELECT key, model, hits, created_at, ttl FROM prompt_cache ORDER BY hits DESC LIMIT $1 OFFSET $2', [limit, offset]);
        return result.rows.map(row => ({
            key: row.key,
            model: row.model,
            hits: row.hits,
            createdAt: row.created_at,
            ttl: row.ttl,
        }));
    }
    catch {
        return [];
    }
}
// Get cache size by model
async function pgStatsByModel() {
    if (!pgAvailable)
        return {};
    try {
        const result = await exports.pool.query('SELECT model, COUNT(*) as cnt, COALESCE(SUM(hits), 0) as hits FROM prompt_cache GROUP BY model');
        const stats = {};
        for (const row of result.rows) {
            stats[row.model] = {
                count: parseInt(row.cnt),
                hits: parseInt(row.hits),
            };
        }
        return stats;
    }
    catch {
        return {};
    }
}
// Prefix search - find cached prompts starting with given prefix
async function pgPrefixSearch(prefix, limit = 10) {
    if (!pgAvailable)
        return [];
    try {
        const result = await exports.pool.query(`SELECT * FROM prompt_cache 
       WHERE prompt ILIKE $1 AND created_at + ttl > $2
       ORDER BY hits DESC 
       LIMIT $3`, [`${prefix}%`, Date.now(), limit]);
        return result.rows.map(row => ({
            prompt: row.prompt,
            response: row.response,
            model: row.model,
            createdAt: row.created_at,
            ttl: row.ttl,
            hits: row.hits,
        }));
    }
    catch {
        return [];
    }
}
// Refresh TTL - extend expiration without changing content
async function pgRefreshTTL(key, newTtl) {
    if (!pgAvailable)
        return false;
    try {
        await exports.pool.query('UPDATE prompt_cache SET created_at = $1, ttl = $2 WHERE key = $3', [Date.now(), newTtl, key]);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=pgCache.js.map