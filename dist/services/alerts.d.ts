export interface AlertConfig {
    email: string;
    thresholdPercent: number;
}
export declare function checkUsage(apiKey: string, usage: number, limit: number): void;
export declare function addAlert(config: AlertConfig): void;
//# sourceMappingURL=alerts.d.ts.map