// Rate Limiting Middleware
import { Request, Response, NextFunction } from 'express';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const rateLimits = new Map<string, { count: number; resetTime: number }>();

export function rateLimiter(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['x-api-key'] as string || req.ip || 'unknown';
    const now = Date.now();
    
    let record = rateLimits.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 0, resetTime: now + config.windowMs };
      rateLimits.set(key, record);
    }
    
    record.count++;
    
    if (record.count > config.maxRequests) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    next();
  };
}
