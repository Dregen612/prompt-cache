export declare function initPgCache(): Promise<void>;
export declare function isPgAvailable(): boolean;
export declare function isVectorAvailable(): boolean;
export interface CacheEntry {
    prompt: string;
    response: string;
    model: string;
    createdAt: number;
    ttl: number;
    hits: number;
}
export declare function pgSet(key: string, entry: CacheEntry, embedding?: number[]): Promise<boolean>;
export declare function pgGet(key: string): Promise<CacheEntry | null>;
export declare function pgSemanticSearch(prompt: string, threshold?: number): Promise<CacheEntry | null>;
export declare function pgDel(key: string): Promise<void>;
export declare function pgClear(): Promise<void>;
export declare function pgStats(): Promise<{
    entries: number;
    totalHits: number;
}>;
export declare function pgCleanup(): Promise<number>;
//# sourceMappingURL=pgCache.d.ts.map