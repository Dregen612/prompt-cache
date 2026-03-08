export declare class SemanticCache {
    getEmbedding(text: string): Promise<number[]>;
    private simpleEmbedding;
    findSimilar(prompt: string, threshold?: number): Promise<any | null>;
    store(prompt: string, response: string, model: string, ttl: number): Promise<void>;
}
export declare const semanticCache: SemanticCache;
//# sourceMappingURL=semanticCache.d.ts.map