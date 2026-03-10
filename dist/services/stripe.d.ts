export declare const stripe: null;
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
export declare function createCheckoutSession(tier: 'pro' | 'enterprise', customerId?: string, successUrl?: string, cancelUrl?: string): Promise<{
    url: string;
    sessionId: string;
}>;
export declare function getSubscription(subscriptionId: string): Promise<Subscription | null>;
export declare function getOrCreateCustomer(email: string): Promise<string>;
export declare function createCustomer(email: string, name?: string): Promise<string>;
export declare function handleWebhook(body: string, signature: string): Promise<{
    received: true;
    type?: string;
    data?: any;
}>;
export declare function getAllAPIKeys(): Promise<any[]>;
//# sourceMappingURL=stripe.d.ts.map