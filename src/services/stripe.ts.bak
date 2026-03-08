// Stripe Subscription Service for PromptCache
// Stripe disabled for Vercel deployment
export const stripe = null;
export async function createCheckoutSession() { throw new Error('Stripe disabled'); }
export async function getSubscription() { return null; }
export async function getCustomerByEmail() { return null; }
export async function createCustomer() { throw new Error('Stripe disabled'); }
export async function handleWebhook() { return { received: true }; }
export interface Subscription { id: string; customerId: string; tier: string; status: string; currentPeriodEnd: number; requestsThisPeriod: number; }

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2026-02-25.clover' as any,
});

// Price IDs (would be real IDs in production)
export const STRIPE_PRICES = {
  pro: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_monthly',
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise_monthly',
};

export const TIERS = {
  free: { requests: 1000, price: 0 },
  pro: { requests: 100000, price: 29 },
  enterprise: { requests: Infinity, price: 99 },
};

export interface Subscription {
  id: string;
  customerId: string;
  tier: string;
  status: string;
  currentPeriodEnd: number;
  requestsThisPeriod: number;
}

// Create checkout session
export async function createCheckoutSession(
  tier: 'pro' | 'enterprise',
  customerId?: string,
  successUrl?: string,
  cancelUrl?: string
): Promise<{ url: string; sessionId: string }> {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: STRIPE_PRICES[tier],
        quantity: 1,
      },
    ],
    success_url: successUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pricing`,
    customer: customerId,
    metadata: {
      tier,
    },
  });

  return { url: session.url!, sessionId: session.id };
}

// Create customer portal session
export async function createPortalSession(
  customerId: string,
  returnUrl?: string
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard`,
  });

  return session.url;
}

// Get subscription status
export async function getSubscription(subscriptionId: string): Promise<Subscription | null> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    
    return {
      id: sub.id,
      customerId: sub.customer as string,
      tier: sub.metadata?.tier || 'pro',
      status: sub.status,
      currentPeriodEnd: sub.current_period_end as any * 1000,
      requestsThisPeriod: 0, // Would track in DB
    };
  } catch (e) {
    return null;
  }
}

// Get customer by email
export async function getCustomerByEmail(email: string): Promise<string | null> {
  const customers = await stripe.customers.list({ email, limit: 1 });
  return customers.data[0]?.id || null;
}

// Create or get customer
export async function getOrCreateCustomer(email: string, name?: string): Promise<string> {
  const existing = await getCustomerByEmail(email);
  if (existing) return existing;
  
  const customer = await stripe.customers.create({ email, name });
  return customer.id;
}

// Cancel subscription
export async function cancelSubscription(subscriptionId: string): Promise<boolean> {
  try {
    await stripe.subscriptions.cancel(subscriptionId);
    return true;
  } catch (e) {
    return false;
  }
}

// Check if request is allowed based on tier
export function canMakeRequest(tier: 'free' | 'pro' | 'enterprise', requestsUsed: number): boolean {
  const limit = TIERS[tier].requests;
  return requestsUsed < limit;
}

// Get tier from price ID
export function getTierFromPrice(priceId: string): 'pro' | 'enterprise' | null {
  if (priceId === STRIPE_PRICES.pro) return 'pro';
  if (priceId === STRIPE_PRICES.enterprise) return 'enterprise';
  return null;
}

// Webhook handler
export async function handleWebhook(
  payload: string,
  signature: string
): Promise<{ type: string; data: any }> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event: Stripe.Event;
  
  if (webhookSecret) {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } else {
    event = JSON.parse(payload);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object as Stripe.Checkout.Session;
      return { 
        type: 'subscription_created', 
        data: { 
          subscriptionId: session.subscription,
          customerId: session.customer,
          tier: session.metadata?.tier 
        } 
      };
    
    case 'customer.subscription.updated':
      const sub = event.data.object as Stripe.Subscription;
      return { 
        type: 'subscription_updated', 
        data: { 
          subscriptionId: sub.id,
          status: sub.status,
          currentPeriodEnd: sub.current_period_end as any * 1000
        } 
      };
    
    case 'customer.subscription.deleted':
      const deletedSub = event.data.object as Stripe.Subscription;
      return { 
        type: 'subscription_canceled', 
        data: { subscriptionId: deletedSub.id } 
      };
    
    default:
      return { type: 'unknown', data: event.data.object };
  }
}
