"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIERS = exports.STRIPE_PRICES = exports.stripe = void 0;
exports.createCheckoutSession = createCheckoutSession;
exports.getSubscription = getSubscription;
exports.getCustomerByEmail = getCustomerByEmail;
exports.createCustomer = createCustomer;
exports.handleWebhook = handleWebhook;
exports.createCheckoutSession = createCheckoutSession;
exports.createPortalSession = createPortalSession;
exports.getSubscription = getSubscription;
exports.getCustomerByEmail = getCustomerByEmail;
exports.getOrCreateCustomer = getOrCreateCustomer;
exports.cancelSubscription = cancelSubscription;
exports.canMakeRequest = canMakeRequest;
exports.getTierFromPrice = getTierFromPrice;
exports.handleWebhook = handleWebhook;
// Stripe Subscription Service for PromptCache
// Stripe disabled for Vercel deployment
exports.stripe = null;
async function createCheckoutSession() { throw new Error('Stripe disabled'); }
async function getSubscription() { return null; }
async function getCustomerByEmail() { return null; }
async function createCustomer() { throw new Error('Stripe disabled'); }
async function handleWebhook() { return { received: true }; }
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    apiVersion: '2026-02-25.clover',
});
// Price IDs (would be real IDs in production)
exports.STRIPE_PRICES = {
    pro: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_monthly',
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise_monthly',
};
exports.TIERS = {
    free: { requests: 1000, price: 0 },
    pro: { requests: 100000, price: 29 },
    enterprise: { requests: Infinity, price: 99 },
};
// Create checkout session
async function createCheckoutSession(tier, customerId, successUrl, cancelUrl) {
    const session = await exports.stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
            {
                price: exports.STRIPE_PRICES[tier],
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
    return { url: session.url, sessionId: session.id };
}
// Create customer portal session
async function createPortalSession(customerId, returnUrl) {
    const session = await exports.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard`,
    });
    return session.url;
}
// Get subscription status
async function getSubscription(subscriptionId) {
    try {
        const sub = await exports.stripe.subscriptions.retrieve(subscriptionId);
        return {
            id: sub.id,
            customerId: sub.customer,
            tier: sub.metadata?.tier || 'pro',
            status: sub.status,
            currentPeriodEnd: sub.current_period_end * 1000,
            requestsThisPeriod: 0, // Would track in DB
        };
    }
    catch (e) {
        return null;
    }
}
// Get customer by email
async function getCustomerByEmail(email) {
    const customers = await exports.stripe.customers.list({ email, limit: 1 });
    return customers.data[0]?.id || null;
}
// Create or get customer
async function getOrCreateCustomer(email, name) {
    const existing = await getCustomerByEmail(email);
    if (existing)
        return existing;
    const customer = await exports.stripe.customers.create({ email, name });
    return customer.id;
}
// Cancel subscription
async function cancelSubscription(subscriptionId) {
    try {
        await exports.stripe.subscriptions.cancel(subscriptionId);
        return true;
    }
    catch (e) {
        return false;
    }
}
// Check if request is allowed based on tier
function canMakeRequest(tier, requestsUsed) {
    const limit = exports.TIERS[tier].requests;
    return requestsUsed < limit;
}
// Get tier from price ID
function getTierFromPrice(priceId) {
    if (priceId === exports.STRIPE_PRICES.pro)
        return 'pro';
    if (priceId === exports.STRIPE_PRICES.enterprise)
        return 'enterprise';
    return null;
}
// Webhook handler
async function handleWebhook(payload, signature) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    if (webhookSecret) {
        event = exports.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    }
    else {
        event = JSON.parse(payload);
    }
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            return {
                type: 'subscription_created',
                data: {
                    subscriptionId: session.subscription,
                    customerId: session.customer,
                    tier: session.metadata?.tier
                }
            };
        case 'customer.subscription.updated':
            const sub = event.data.object;
            return {
                type: 'subscription_updated',
                data: {
                    subscriptionId: sub.id,
                    status: sub.status,
                    currentPeriodEnd: sub.current_period_end * 1000
                }
            };
        case 'customer.subscription.deleted':
            const deletedSub = event.data.object;
            return {
                type: 'subscription_canceled',
                data: { subscriptionId: deletedSub.id }
            };
        default:
            return { type: 'unknown', data: event.data.object };
    }
}
//# sourceMappingURL=stripe.js.map