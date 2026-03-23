declare class AnalyticsTracker {
    private requests;
    private readonly MAX_REQUESTS;
    recordRequest(cached: boolean, latency: number, model?: string, error?: boolean, apiKey?: string): void;
    getAnalytics(period?: '1h' | '24h' | '7d' | '30d'): {
        period: "1h" | "24h" | "7d" | "30d";
        totalRequests: number;
        cacheHits: number;
        cacheMisses: number;
        errors: number;
        avgLatency: number;
        tokensSaved: number;
        costSaved: number;
        hitRate: number;
        topModels: {
            model: string;
            requests: number;
        }[];
        hourlyRequests: {
            hour: number;
            requests: number;
        }[];
    };
    reset(): void;
}
export declare const analytics: AnalyticsTracker;
export {};
//# sourceMappingURL=analytics.d.ts.map