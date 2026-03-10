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
export declare function pgClearByModel(model: string): Promise<number>;
export declare function pgGetKeys(limit?: number, offset?: number): Promise<Array<{
    key: string;
    model: string;
    hits: number;
    createdAt: number;
    ttl: number;
}>>;
export declare function pgStatsByModel(): Promise<Record<string, {
    count: number;
    hits: number;
}>>;
//# sourceMappingURL=pgCache.d.ts.map