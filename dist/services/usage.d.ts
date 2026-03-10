export interface UsageRecord {
    id: number;
    apiKey: string;
    prompt: string;
    cached: boolean;
    latency: number;
    tokens: number;
    cost: number;
    timestamp: number;
}
export declare class UsageTracker {
    track(req: any, res: any, next: any): Promise<void>;
    private store;
    getStats(apiKey: string, days?: number): Promise<null>;
    getAllTimeStats(): Promise<null>;
}
export declare const usageTracker: UsageTracker;
//# sourceMappingURL=usage.d.ts.map