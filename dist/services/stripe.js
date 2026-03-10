"use strict";
// Stripe Subscription Service for PromptCache
// Stripe is disabled for now - using free tier model
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIERS = exports.STRIPE_PRICES = exports.stripe = void 0;
exports.createCheckoutSession = createCheckoutSession;
exports.getSubscription = getSubscription;
exports.getOrCreateCustomer = getOrCreateCustomer;
exports.createCustomer = createCustomer;
exports.handleWebhook = handleWebhook;
exports.getAllAPIKeys = getAllAPIKeys;
exports.stripe = null;
// Price IDs
exports.STRIPE_PRICES = {
    pro: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_monthly',
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise_monthly',
};
exports.TIERS = {
    free: { requests: 1000, price: 0 },
    pro: { requests: 100000, price: 29 },
    enterprise: { requests: Infinity, price: 99 },
};
async function createCheckoutSession(tier, customerId, successUrl, cancelUrl) {
    throw new Error('Stripe payments not yet enabled');
}
async function getSubscription(subscriptionId) {
    return null;
}
async function getOrCreateCustomer(email) {
    throw new Error('Stripe payments not yet enabled');
}
async function createCustomer(email, name) {
    throw new Error('Stripe payments not yet enabled');
}
async function handleWebhook(body, signature) {
    return { received: true };
}
async function getAllAPIKeys() {
    return [];
}
//# sourceMappingURL=stripe.js.map