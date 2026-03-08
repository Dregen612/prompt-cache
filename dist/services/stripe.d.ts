export declare const stripe: null;
export declare function createCustomer(): Promise<void>;
export interface Subscription {
    id: string;
    customerId: string;
    tier: string;
    status: string;
    currentPeriodEnd: number;
    requestsThisPeriod: number;
}
export declare const STRIPE_PRICES: {
    pro: string;
    enterprise: string;
};
export declare const TIERS: {
    free: {
        requests: number;
        price: number;
    };
    pro: {
        requests: number;
        price: number;
    };
    enterprise: {
        requests: number;
        price: number;
    };
};
export interface Subscription {
    id: string;
    customerId: string;
    tier: string;
    status: string;
    currentPeriodEnd: number;
    requestsThisPeriod: number;
}
export declare function createPortalSession(customerId: string, returnUrl?: string): Promise<string>;
export declare function getOrCreateCustomer(email: string, name?: string): Promise<string>;
export declare function cancelSubscription(subscriptionId: string): Promise<boolean>;
export declare function canMakeRequest(tier: 'free' | 'pro' | 'enterprise', requestsUsed: number): boolean;
export declare function getTierFromPrice(priceId: string): 'pro' | 'enterprise' | null;
//# sourceMappingURL=stripe.d.ts.map