"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.semanticCache = exports.SemanticCache = void 0;
// Enhanced PromptCache with Semantic Search
const pgClient_js_1 = require("./pgClient.js");
// Semantic cache using embeddings
class SemanticCache {
    // Generate embedding for prompt
    async getEmbedding(text) {
        try {
            const response = await fetch('https://api.minimax.chat/v1/text/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.MINIMAX_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'embo-01',
                    text
                })
            });
            const data = await response.json();
            return data.data?.[0]?.embedding || [];
        }
        catch (e) {
            // Fallback: simple hash-based embedding
            return this.simpleEmbedding(text);
        }
    }
    // Simple fallback embedding
    simpleEmbedding(text) {
        const embedding = new Array(1536).fill(0);
        for (let i = 0; i < text.length; i++) {
            embedding[i % 1536] += text.charCodeAt(i) / 255;
        }
        return embedding.map(v => v / text.length);
    }
    // Find similar cached prompts
    async findSimilar(prompt, threshold = 0.85) {
        const embedding = await this.getEmbedding(prompt);
        try {
            // Query using pgvector
            const result = await pgClient_js_1.pg.query(`
        SELECT prompt, response, model, 
               1 - (embedding <=> $1::vector) as similarity
        FROM cache 
        WHERE embedding <=> $1::vector < $2
        ORDER BY similarity DESC 
        LIMIT 1
      `, [embedding, 1 - threshold]);
            if (result.rows.length > 0) {
                return {
                    ...result.rows[0],
                    cached: true,
                    similarity: result.rows[0].similarity
                };
            }
        }
        catch (e) {
            console.log('Vector search not available, using exact match');
        }
        return null;
    }
    // Store in cache with embedding
    async store(prompt, response, model, ttl) {
        const embedding = await this.getEmbedding(prompt);
        const expiresAt = Date.now() + ttl;
        try {
            await pgClient_js_1.pg.query(`
        INSERT INTO cache (prompt, response, model, embedding, expires_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [prompt, response, model, embedding, new Date(expiresAt)]);
        }
        catch (e) {
            console.log('Store error:', e);
        }
    }
}
exports.SemanticCache = SemanticCache;
exports.semanticCache = new SemanticCache();
//# sourceMappingURL=semanticCache.js.map