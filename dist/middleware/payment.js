"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requirePayment = requirePayment;
exports.getPaymentRequirement = getPaymentRequirement;
exports.hasPaymentHeader = hasPaymentHeader;
// Price per cache hit: $0.001 USDC
const CACHE_HIT_PRICE_USDC = 0.001;
// Payment requirement for cache access
const paymentRequirement = {
    protocol: 'x402',
    currency: 'USDC',
    amount: CACHE_HIT_PRICE_USDC,
    beneficiary: process.env.X402_BENEFICIARY_ADDRESS || '0x0000000000000000000000000000000000000000',
    description: 'PromptCache - Pay per cache hit',
    period: 3600, // 1 hour
};
// Middleware to require payment for cache access
function requirePayment(required = true) {
    return (req, res, next) => {
        // Skip payment if disabled or in test mode
        if (!required || process.env.X402_DISABLED === 'true') {
            return next();
        }
        // Use x402 middleware
        x402Middleware({
            payment: paymentRequirement,
            debug: process.env.NODE_ENV !== 'production',
        })(req, res, (err) => {
            if (err) {
                // Payment required - x402 middleware sent 402 response
                console.log('💰 Payment required for cache access');
                return;
            }
            next();
        });
    };
}
// Get payment requirement (for clients to see price)
function getPaymentRequirement() {
    return {
        price: CACHE_HIT_PRICE_USDC,
        currency: 'USDC',
        description: paymentRequirement.description,
        beneficiary: paymentRequirement.beneficiary,
    };
}
// Optional: Check if request already has valid payment
function hasPaymentHeader(req) {
    const auth = req.headers['x-payment'];
    return !!auth;
}
//# sourceMappingURL=payment.js.map