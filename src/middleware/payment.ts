import { Request, Response, NextFunction } from 'express';
import x402 from '@coinbase/x402';

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
export function requirePayment(required: boolean = true) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip payment if disabled or in test mode
    if (!required || process.env.X402_DISABLED === 'true') {
      return next();
    }

    // Use x402 middleware
    x402Middleware({
      payment: paymentRequirement,
      debug: process.env.NODE_ENV !== 'production',
    })(req, res, (err: any) => {
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
export function getPaymentRequirement() {
  return {
    price: CACHE_HIT_PRICE_USDC,
    currency: 'USDC',
    description: paymentRequirement.description,
    beneficiary: paymentRequirement.beneficiary,
  };
}

// Optional: Check if request already has valid payment
export function hasPaymentHeader(req: Request): boolean {
  const auth = req.headers['x-payment'];
  return !!auth;
}

// Type for x402Middleware
declare function x402Middleware(options: {
  payment: typeof paymentRequirement;
  debug?: boolean;
}): (req: Request, res: Response, next: (err?: any) => void) => void;
