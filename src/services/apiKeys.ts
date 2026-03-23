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
}

// In-memory store (would use DB in production)
const apiKeys: Map<string, APIKey> = new Map();

// Generate new API key
export function generateAPIKey(name: string, tier: 'free' | 'pro' | 'enterprise' = 'free'): APIKey {
  const id = crypto.randomBytes(8).toString('hex');
  const key = `pc_${tier}_sk_${crypto.randomBytes(24).toString('hex')}`;
  
  const limits = {
    free: 1000,
    pro: 100000,
    enterprise: Infinity
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
    active: true
  };
  
  apiKeys.set(key, apiKey);
  
  return apiKey;
}

// Validate API key
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
  
  // Update last used
  apiKey.lastUsed = Date.now();
  
  return { valid: true, apiKey };
}

// Record request
export function recordRequest(key: string): void {
  const apiKey = apiKeys.get(key);
  if (apiKey) {
    apiKey.requestsToday++;
  }
}

// Get all keys
export function getAllAPIKeys(): APIKey[] {
  return Array.from(apiKeys.values());
}

// Get key by key string
export function getAPIKey(key: string): APIKey | undefined {
  return apiKeys.get(key);
}

// Get tier for an API key (undefined if not found/invalid)
export function getAPIKeyTier(key: string): 'free' | 'pro' | 'enterprise' | undefined {
  const apiKey = apiKeys.get(key);
  return apiKey?.tier;
}

// Revoke key
export function revokeAPIKey(key: string): boolean {
  const apiKey = apiKeys.get(key);
  if (apiKey) {
    apiKey.active = false;
    return true;
  }
  return false;
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
