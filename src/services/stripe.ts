// Stripe Subscription Service for PromptCache
// Checkout sessions, customer management, and webhook handling
// Tier upgrades flow through apiKeys.ts

import Stripe from 'stripe';
import {
  updateAPIKeyTier,
  getAPIKeyByCustomer,
  linkAPIKeyToCustomer,
  findAPIKeyByEmail,
  generateAPIKey,
} from './apiKeys';

// Only initialize Stripe if we have a real key
const stripeKey = process.env.STRIPE_SECRET_KEY;
export const stripe = stripeKey && !stripeKey.includes('placeholder')
  ? new Stripe(stripeKey, { apiVersion: '2026-02-25.clover' as any })
  : null;

export const stripeEnabled = stripe !== null;

export interface Subscription {
  id: string;
  customerId: string;
  tier: 'pro' | 'enterprise';
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

// Determine tier from Stripe price ID
function tierFromPriceId(priceId: string): 'pro' | 'enterprise' | 'free' {
  if (priceId === STRIPE_PRICES.enterprise) return 'enterprise';
  if (priceId === STRIPE_PRICES.pro) return 'pro';
  return 'free';
}

export async function createCheckoutSession(
  tier: 'pro' | 'enterprise',
  customerId?: string,
  successUrl?: string,
  cancelUrl?: string,
  apiKeyId?: string
): Promise<{ url: string; sessionId: string }> {
  if (!stripe) {
    throw new Error('Stripe not configured. Set STRIPE_SECRET_KEY environment variable.');
  }

  const priceId = tier === 'pro' ? STRIPE_PRICES.pro : STRIPE_PRICES.enterprise;

  const sessionParams: any = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pricing`,
    metadata: {},
  };

  if (apiKeyId) {
    sessionParams.metadata.api_key_id = apiKeyId;
  }

  if (customerId) {
    sessionParams.customer = customerId;
  } else {
    sessionParams.customer_creation = 'always';
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return { url: session.url!, sessionId: session.id };
}

export async function getOrCreateCustomer(email: string, name?: string): Promise<string> {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  const customers = await stripe.customers.list({ email, limit: 1 });
  if (customers.data.length > 0) {
    return customers.data[0].id;
  }

  const customer = await stripe.customers.create({ email, name });
  return customer.id;
}

export async function createCustomer(email: string, name?: string): Promise<string> {
  return getOrCreateCustomer(email, name);
}

export async function getSubscription(subscriptionId: string): Promise<Subscription | null> {
  if (!stripe) return null;

  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId) as any;
    return {
      id: sub.id,
      customerId: sub.customer as string,
      tier: 'pro',
      status: sub.status,
      currentPeriodEnd: sub.current_period_end as number,
      requestsThisPeriod: 0,
    };
  } catch {
    return null;
  }
}

// ── Webhook Handler ──────────────────────────────────────────────────────────

export async function handleWebhook(
  body: string,
  signature: string
): Promise<{ received: true; type?: string }> {
  if (!stripe) {
    console.log('⚠️ Stripe not configured — webhook ignored');
    return { received: true };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('❌ STRIPE_WEBHOOK_SECRET not set — cannot verify webhook');
    return { received: true };
  }

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }

  console.log(`📦 Stripe webhook: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const apiKeyId = session.metadata?.api_key_id;

      if (session.mode === 'subscription' && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = sub.items.data[0]?.price.id;
        const newTier = tierFromPriceId(priceId);

        if (apiKeyId) {
          linkAPIKeyToCustomer(apiKeyId, session.customer as string);
          const upgraded = updateAPIKeyTier(apiKeyId, newTier);
          if (upgraded) {
            console.log(`🎉 Checkout complete: API key ${apiKeyId} upgraded to ${newTier}`);
          }
        } else {
          // No metadata — try to find key by customer email
          try {
            const customer = await stripe.customers.retrieve(session.customer as string);
            if (!('deleted' in customer) && customer.email) {
              const existingKey = findAPIKeyByEmail(customer.email);
              if (existingKey) {
                linkAPIKeyToCustomer(existingKey.id, session.customer as string);
                updateAPIKeyTier(existingKey.id, newTier);
                console.log(`🎉 Checkout complete: ${existingKey.name} upgraded to ${newTier}`);
              }
            }
          } catch {}
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const customerId = sub.customer as string;
      const priceId = sub.items.data[0]?.price.id;
      const newTier = tierFromPriceId(priceId);
      const apiKey = getAPIKeyByCustomer(customerId);

      if (apiKey) {
        if (sub.status === 'active') {
          updateAPIKeyTier(apiKey.id, newTier);
          console.log(`🔄 Subscription updated: ${apiKey.name} → ${newTier}`);
        } else if (sub.status === 'canceled' || sub.status === 'past_due') {
          updateAPIKeyTier(apiKey.id, 'free');
          console.log(`⬇️ Subscription ${sub.status}: ${apiKey.name} downgraded to free`);
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customerId = sub.customer as string;
      const apiKey = getAPIKeyByCustomer(customerId);

      if (apiKey) {
        updateAPIKeyTier(apiKey.id, 'free');
        console.log(`⬇️ Subscription deleted: ${apiKey.name} downgraded to free`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer as string;
      const apiKey = getAPIKeyByCustomer(customerId);
      if (apiKey) {
        console.log(`⚠️ Payment failed for ${apiKey.name}`);
      }
      break;
    }
  }

  return { received: true, type: event.type };
}
