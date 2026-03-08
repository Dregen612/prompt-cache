export type CacheStrategy = 'cache-first' | 'network-first' | 'stale-while-revalidate';
export declare class CacheManager {
    get(strategy: CacheStrategy, key: string): void;
    private cacheFirst;
    private networkFirst;
    private staleWhileRevalidate;
}
//# sourceMappingURL=cacheStrategies.d.ts.map