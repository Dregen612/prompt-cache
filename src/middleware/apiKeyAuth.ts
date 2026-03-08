// API Key Authentication Middleware
import { Request, Response, NextFunction } from 'express';
import { validateAPIKey, APIKey } from '../services/apiKeys';

declare global {
  namespace Express {
    interface Request {
      apiKey?: APIKey;
    }
  }
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'] as string;
  
  if (!key) {
    return res.status(401).json({ error: 'API key required. Include X-API-Key header.' });
  }
  
  const result = validateAPIKey(key);
  
  if (!result.valid) {
    return res.status(401).json({ error: result.error });
  }
  
  // Attach API key to request
  req.apiKey = result.keyData;
  
  next();
}

// Optional auth - doesn't fail if no key, but attaches if valid
export function optionalApiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'] as string;
  
  if (key) {
    const result = validateAPIKey(key);
    if (result.valid) {
      req.apiKey = result.keyData;
    }
  }
  
  next();
}
