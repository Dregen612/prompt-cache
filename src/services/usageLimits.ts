// Usage Limits & Tier Management
import { validateAPIKey } from './apiKeys';

export interface Tier {
  name: string;
  requestsPerDay: number;
  cacheSize: number; // max cached entries
  semanticSearch: boolean;
  price: number; // monthly price
}

export const TIERS: { [key: string]: Tier } = {
  free: {
    name: 'Free',
    requestsPerDay: 1000,
    cacheSize: 100,
    semanticSearch: false,
    price: 0
  },
  pro: {
    name: 'Pro',
    requestsPerDay: 50000,
    cacheSize: 10000,
    semanticSearch: true,
    price: 29
  },
  enterprise: {
    name: 'Enterprise',
    requestsPerDay: -1, // unlimited
    cacheSize: -1,
    semanticSearch: true,
    price: 99
  }
};

interface UsageRecord {
  key: string;
  date: string; // YYYY-MM-DD
  requests: number;
  cacheHits: number;
}

const usageRecords: Map<string, UsageRecord[]> = new Map();

function getUsage(key: string): UsageRecord {
  const today = new Date().toISOString().split('T')[0];
  
  if (!usageRecords.has(key)) {
    usageRecords.set(key, []);
  }
  
  const records = usageRecords.get(key)!;
  let todayRecord = records.find(r => r.date === today);
  
  if (!todayRecord) {
    todayRecord = { key, date: today, requests: 0, cacheHits: 0 };
    records.push(todayRecord);
  }
  
  return todayRecord;
}

export function recordRequest(key: string, isCacheHit: boolean = false): { allowed: boolean; remaining: number; tier: string } {
  // Look up the actual tier from the API key
  const keyInfo = validateAPIKey(key);
  const keyTier = keyInfo.valid && keyInfo.apiKey ? keyInfo.apiKey.tier : 'free';
  
  const tier = TIERS[keyTier];
  const usage = getUsage(key);
  
  // Check limits (unlimited = -1)
  if (tier.requestsPerDay > 0 && usage.requests >= tier.requestsPerDay) {
    return { allowed: false, remaining: 0, tier: keyTier };
  }
  
  usage.requests++;
  if (isCacheHit) {
    usage.cacheHits++;
  }
  
  const remaining = tier.requestsPerDay > 0 ? tier.requestsPerDay - usage.requests : -1;
  
  return { allowed: true, remaining, tier: keyTier };
}

export function getUsageStats(key: string): {
  today: { requests: number; cacheHits: number; hitRate: number };
  tier: string;
  limit: number;
  remaining: number;
} {
  const keyInfo = validateAPIKey(key);
  const keyTier = keyInfo.valid && keyInfo.apiKey ? keyInfo.apiKey.tier : 'free';
  const tier = TIERS[keyTier];
  const usage = getUsage(key);
  
  return {
    today: {
      requests: usage.requests,
      cacheHits: usage.cacheHits,
      hitRate: usage.requests > 0 ? (usage.cacheHits / usage.requests) * 100 : 0
    },
    tier: keyTier,
    limit: tier.requestsPerDay,
    remaining: tier.requestsPerDay > 0 ? tier.requestsPerDay - usage.requests : -1
  };
}

export function getAllUsageStats(): { key: string; requests: number; hits: number; hitRate: number }[] {
  const stats: { key: string; requests: number; hits: number; hitRate: number }[] = [];
  
  for (const [key, records] of usageRecords) {
    const totalRequests = records.reduce((sum, r) => sum + r.requests, 0);
    const totalHits = records.reduce((sum, r) => sum + r.cacheHits, 0);
    
    stats.push({
      key: key.slice(0, 12) + '...',
      requests: totalRequests,
      hits: totalHits,
      hitRate: totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0
    });
  }
  
  return stats;
}
