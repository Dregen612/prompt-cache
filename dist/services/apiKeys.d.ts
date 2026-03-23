export interface APIKey {
    id: string;
    key: string;
    name: string;
    tier: 'free' | 'pro' | 'enterprise';
    requestsToday: number;
    requestsLimit: number;
    createdAt: number;
    lastUsed: number;
    active: boolean;
}
export declare function generateAPIKey(name: string, tier?: 'free' | 'pro' | 'enterprise'): APIKey;
export declare function validateAPIKey(key: string): {
    valid: boolean;
    apiKey?: APIKey;
    error?: string;
};
export declare function recordRequest(key: string): void;
export declare function getAllAPIKeys(): APIKey[];
export declare function getAPIKey(key: string): APIKey | undefined;
export declare function getAPIKeyTier(key: string): 'free' | 'pro' | 'enterprise' | undefined;
export declare function revokeAPIKey(key: string): boolean;
export declare function resetDailyLimits(): void;
//# sourceMappingURL=apiKeys.d.ts.map