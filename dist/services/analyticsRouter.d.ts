import { Router } from 'express';
export declare function recordAnalytics(apiKey: string | undefined, cached: boolean, latency: number, model: string): void;
type Tier = 'free' | 'pro' | 'enterprise';
export declare function createAnalyticsRouter(getKeyTier: (key: string) => Tier | undefined): Router;
export {};
//# sourceMappingURL=analyticsRouter.d.ts.map