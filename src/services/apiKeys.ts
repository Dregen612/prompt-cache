// API Key Management Service
import crypto from 'crypto';

interface APIKey {
  key: string;
  name: string;
  tier: 'free' | 'pro' | 'enterprise';
  created: number;
  lastUsed: number;
  requests: number;
  cacheHits: number;
  active: boolean;
}

// In-memory store (would use DB in production)
const apiKeys: Map<string, APIKey> = new Map();

// Generate new API key
export function generateAPIKey(name: string = 'Default', tier: 'free' | 'pro' | 'enterprise' = 'free'): string {
  const prefix = tier === 'free' ? 'pc_live' : tier === 'pro' ? 'pc_pro' : 'pc_ent';
  const randomPart = crypto.randomBytes(16).toString('hex');
  const key = `${prefix}_sk_${randomPart}`;
  
  apiKeys.set(key, {
    key,
    name,
    tier,
    created: Date.now(),
    lastUsed: 0,
    requests: 0,
    cacheHits: 0,
    active: true
  });
  
  return key;
}

// Validate API key
export function validateAPIKey(key: string): { valid: boolean; keyData?: APIKey; error?: string; tier?: string } {
  const keyData = apiKeys.get(key);
  
  if (!keyData) {
    return { valid: false, error: 'Invalid API key' };
  }
  
  if (!keyData.active) {
    return { valid: false, error: 'API key has been revoked' };
  }
  
  // Update usage stats
  keyData.lastUsed = Date.now();
  keyData.requests++;
  
  return { valid: true, keyData, tier: keyData.tier };
}

// Get all keys (for admin)
export function getAllKeys(): APIKey[] {
  return Array.from(apiKeys.values());
}

// Revoke a key
export function revokeAPIKey(key: string): boolean {
  const keyData = apiKeys.get(key);
  if (!keyData) return false;
  
  keyData.active = false;
  return true;
}

// Delete a key
export function deleteAPIKey(key: string): boolean {
  return apiKeys.delete(key);
}

// Get key stats
export function getKeyStats(key: string): APIKey | null {
  return apiKeys.get(key) || null;
}

// Initialize with a default key for testing
if (apiKeys.size === 0) {
  generateAPIKey('Development');
}

export { APIKey };
