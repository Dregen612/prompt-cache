"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateCustomer = getOrCreateCustomer;
exports.createCheckoutSession = createCheckoutSession;
exports.handleWebhook = handleWebhook;
exports.getSubscription = getSubscription;
exports.getCustomerByEmail = getCustomerByEmail;
// Stub - stripe.ts disabled for build
async function getOrCreateCustomer(email) {
    return 'cus_stub';
}
async function createCheckoutSession(tier, customerId, successUrl, cancelUrl) {
    return { id: 'cs_stub', url: '#', sessionId: 'cs_stub' };
}
async function handleWebhook(body, signature) {
    return { type: 'stub', data: {}, received: true };
}
async function getSubscription(subscriptionId) {
    return { status: 'active' };
}
async function getCustomerByEmail(email) {
    return null;
}
//# sourceMappingURL=stripe.js.map