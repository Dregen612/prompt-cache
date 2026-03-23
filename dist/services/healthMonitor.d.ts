export interface HealthSnapshot {
    timestamp: number;
    backend: 'pg' | 'redis' | 'memory';
    cacheEntries: number;
    cacheHits: number;
    cacheMisses: boolean;
    responseTimeMs: number;
    errorRate: number;
}
export declare class HealthMonitor {
    private startTime;
    private snapshots;
    private maxSnapshots;
    private recentHits;
    private recentMisses;
    private recentErrors;
    private recentRequests;
    constructor();
    recordHit(): void;
    recordMiss(): void;
    recordError(): void;
    recordRequest(isHit: boolean, responseTimeMs: number): void;
    private prune;
    getUptime(): {
        seconds: number;
        human: string;
        startTime: number;
    };
    getSummary(): {
        uptime: {
            seconds: number;
            human: string;
            startTime: number;
        };
        recent: {
            hits: number;
            misses: number;
            requests: number;
            hitRate: number;
            errorRate: number;
        };
        history: {
            period: string;
            avgHitRate: number;
            peakEntries: number;
        };
    };
    reset(): void;
    addSnapshot(snapshot: HealthSnapshot): void;
}
export declare const healthMonitor: HealthMonitor;
//# sourceMappingURL=healthMonitor.d.ts.map