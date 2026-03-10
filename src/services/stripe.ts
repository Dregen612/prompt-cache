// Stripe Subscription Service for PromptCache
// Stripe is disabled for now - using free tier model

export const stripe = null;

export interface Subscription {
  id: string;
  customerId: string;
  tier: string;
  status: string;
  currentPeriodEnd: number;
  requestsThisPeriod: number;
}

// Price IDs
export const STRIPE_PRICES = {
  pro: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_monthly',
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise_monthly',
};

export const TIERS = {
  free: { requests: 1000, price: 0 },
  pro: { requests: 100000, price: 29 },
  enterprise: { requests: Infinity, price: 99 },
};

export async function createCheckoutSession(
  tier: 'pro' | 'enterprise',
  customerId?: string,
  successUrl?: string,
  cancelUrl?: string
): Promise<{ url: string; sessionId: string }> {
  throw new Error('Stripe payments not yet enabled');
}

export async function getSubscription(subscriptionId: string): Promise<Subscription | null> {
  return null;
}

export async function getOrCreateCustomer(email: string): Promise<string> {
  throw new Error('Stripe payments not yet enabled');
}

export async function createCustomer(email: string, name?: string): Promise<string> {
  throw new Error('Stripe payments not yet enabled');
}

export async function handleWebhook(body: string, signature: string): Promise<{ received: true; type?: string; data?: any }> {
  return { received: true };
}

export async function getAllAPIKeys(): Promise<any[]> {
  return [];
}
