// API Key Management for PromptCache
import crypto from 'crypto';

export interface APIKey {
  id: string;
  key: string;
  name: string;
  tier: 'free' | 'pro' | 'enterprise';
  requestsToday: number;
  requestsLimit: number;
  createdAt: number;
  lastUsed: number;
  active: boolean;
  stripeCustomerId?: string;
}

// In-memory store (would use DB in production)
const apiKeys: Map<string, APIKey> = new Map();

export function generateAPIKey(name: string, tier: 'free' | 'pro' | 'enterprise' = 'free', stripeCustomerId?: string): APIKey {
  const id = crypto.randomBytes(8).toString('hex');
  const key = `pc_${tier}_sk_${crypto.randomBytes(24).toString('hex')}`;

  const limits: Record<string, number> = {
    free: 1000,
    pro: 100000,
    enterprise: Infinity,
  };

  const apiKey: APIKey = {
    id,
    key,
    name,
    tier,
    requestsToday: 0,
    requestsLimit: limits[tier],
    createdAt: Date.now(),
    lastUsed: Date.now(),
    active: true,
    stripeCustomerId,
  };

  apiKeys.set(key, apiKey);
  return apiKey;
}

export function validateAPIKey(key: string): { valid: boolean; apiKey?: APIKey; error?: string } {
  const apiKey = apiKeys.get(key);

  if (!apiKey) {
    return { valid: false, error: 'Invalid API key' };
  }

  if (!apiKey.active) {
    return { valid: false, error: 'API key is disabled' };
  }

  if (apiKey.requestsToday >= apiKey.requestsLimit) {
    return { valid: false, error: 'Rate limit exceeded' };
  }

  apiKey.lastUsed = Date.now();
  return { valid: true, apiKey };
}

export function recordRequest(key: string): void {
  const apiKey = apiKeys.get(key);
  if (apiKey) {
    apiKey.requestsToday++;
  }
}

export function getAllAPIKeys(): APIKey[] {
  return Array.from(apiKeys.values());
}

export function getAPIKey(key: string): APIKey | undefined {
  return apiKeys.get(key);
}

export function getAPIKeyTier(key: string): 'free' | 'pro' | 'enterprise' | undefined {
  const apiKey = apiKeys.get(key);
  return apiKey?.tier;
}

export function revokeAPIKey(key: string): boolean {
  const apiKey = apiKeys.get(key);
  if (apiKey) {
    apiKey.active = false;
    return true;
  }
  return false;
}

// Upgrade/downgrade an API key's tier (called by Stripe webhook)
export function updateAPIKeyTier(apiKeyId: string, newTier: 'free' | 'pro' | 'enterprise'): boolean {
  const limits: Record<string, number> = {
    free: 1000,
    pro: 100000,
    enterprise: Infinity,
  };

  for (const apiKey of apiKeys.values()) {
    if (apiKey.id === apiKeyId) {
      apiKey.tier = newTier;
      apiKey.requestsLimit = limits[newTier];
      apiKey.requestsToday = 0; // reset daily count on tier change
      console.log(`✅ API key "${apiKey.name}" (${apiKeyId}) tier → ${newTier}`);
      return true;
    }
  }
  return false;
}

// Find API key by Stripe customer ID (for webhook tier upgrades)
export function getAPIKeyByCustomer(customerId: string): APIKey | undefined {
  for (const apiKey of apiKeys.values()) {
    if (apiKey.stripeCustomerId === customerId) {
      return apiKey;
    }
  }
  return undefined;
}

// Link a Stripe customer ID to an API key (called after checkout)
export function linkAPIKeyToCustomer(apiKeyId: string, customerId: string): boolean {
  for (const apiKey of apiKeys.values()) {
    if (apiKey.id === apiKeyId) {
      apiKey.stripeCustomerId = customerId;
      return true;
    }
  }
  return false;
}

// Find API key by email address embedded in key name
export function findAPIKeyByEmail(email: string): APIKey | undefined {
  const lower = email.toLowerCase();
  for (const apiKey of apiKeys.values()) {
    if (apiKey.name.toLowerCase().includes(lower)) {
      return apiKey;
    }
  }
  return undefined;
}

// Reset daily limits (called at midnight)
export function resetDailyLimits(): void {
  for (const apiKey of apiKeys.values()) {
    apiKey.requestsToday = 0;
  }
  console.log('🔄 Daily request limits reset');
}

// Initialize with a demo key if none exist
if (apiKeys.size === 0) {
  generateAPIKey('Demo Key', 'free');
  console.log('🔑 Demo API key created');
}
