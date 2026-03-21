export interface Tier {
    name: string;
    requestsPerDay: number;
    cacheSize: number;
    semanticSearch: boolean;
    price: number;
}
export declare const TIERS: {
    [key: string]: Tier;
};
export declare function recordRequest(key: string, isCacheHit?: boolean): {
    allowed: boolean;
    remaining: number;
    tier: string;
};
export declare function getUsageStats(key: string): {
    today: {
        requests: number;
        cacheHits: number;
        hitRate: number;
    };
    tier: string;
    limit: number;
    remaining: number;
};
export declare function getAllUsageStats(): {
    key: string;
    requests: number;
    hits: number;
    hitRate: number;
}[];
//# sourceMappingURL=usageLimits.d.ts.map