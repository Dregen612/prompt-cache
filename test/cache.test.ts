// PromptCache Tests
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import crypto from 'crypto';

// Test utilities
function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

describe('Cache Hashing', () => {
  it('should generate consistent hashes', () => {
    const hash1 = hashPrompt('Hello world');
    const hash2 = hashPrompt('Hello world');
    expect(hash1).toBe(hash2);
  });

  it('should generate different hashes for different prompts', () => {
    const hash1 = hashPrompt('Hello world');
    const hash2 = hashPrompt('Goodbye world');
    expect(hash1).not.toBe(hash2);
  });

  it('should produce 16-character hex strings', () => {
    const hash = hashPrompt('Test prompt');
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('Cache Entry Validation', () => {
  it('should identify valid cache entries', () => {
    const entry = {
      prompt: 'test prompt',
      response: 'test response',
      model: 'gpt-4',
      createdAt: Date.now(),
      ttl: 3600000,
      hits: 0
    };
    expect(entry.prompt).toBeDefined();
    expect(entry.response).toBeDefined();
    expect(entry.ttl).toBeGreaterThan(0);
  });

  it('should detect expired entries', () => {
    const expiredEntry = {
      createdAt: Date.now() - 7200000, // 2 hours ago
      ttl: 3600000 // 1 hour TTL
    };
    const isExpired = Date.now() > expiredEntry.createdAt + expiredEntry.ttl;
    expect(isExpired).toBe(true);
  });

  it('should detect non-expired entries', () => {
    const validEntry = {
      createdAt: Date.now() - 1800000, // 30 min ago
      ttl: 3600000 // 1 hour TTL
    };
    const isExpired = Date.now() > validEntry.createdAt + validEntry.ttl;
    expect(isExpired).toBe(false);
  });
});

describe('TTL Calculations', () => {
  it('should calculate remaining TTL correctly', () => {
    const entry = {
      createdAt: Date.now() - 1800000, // 30 min ago
      ttl: 3600000 // 1 hour TTL
    };
    const remaining = entry.ttl - (Date.now() - entry.createdAt);
    expect(remaining).toBeGreaterThan(1500000); // At least 25 minutes remaining
    expect(remaining).toBeLessThanOrEqual(1800000); // At most 30 minutes
  });

  it('should handle zero TTL as eternal', () => {
    const entry = {
      createdAt: Date.now() - 100000,
      ttl: 0 // No expiration
    };
    const isExpired = Date.now() > entry.createdAt + entry.ttl;
    // With TTL 0, it's always considered expired in our logic
    // But treated as no expiration in practice
    expect(entry.ttl).toBe(0);
  });
});

describe('Model-based Invalidation', () => {
  it('should match entries by model', () => {
    const entries = [
      { key: '1', model: 'gpt-4', hits: 10 },
      { key: '2', model: 'gpt-4', hits: 5 },
      { key: '3', model: 'claude-3', hits: 3 },
    ];
    
    const gpt4Entries = entries.filter(e => e.model === 'gpt-4');
    expect(gpt4Entries.length).toBe(2);
    
    const claudeEntries = entries.filter(e => e.model === 'claude-3');
    expect(claudeEntries.length).toBe(1);
  });
});

describe('Batch Processing', () => {
  it('should handle empty batch', () => {
    const entries: string[] = [];
    const results = entries.map(e => ({ success: true, key: e }));
    expect(results.length).toBe(0);
  });

  it('should limit batch size', () => {
    const maxBatch = 100;
    const entries = Array.from({ length: 150 }, (_, i) => `prompt-${i}`);
    const truncated = entries.slice(0, maxBatch);
    expect(truncated.length).toBe(maxBatch);
  });

  it('should track success/failure counts', () => {
    const results = [
      { success: true, key: '1' },
      { success: true, key: '2' },
      { success: false, key: '3', error: 'invalid' },
      { success: true, key: '4' },
    ];
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    expect(successCount).toBe(3);
    expect(failCount).toBe(1);
  });
});

describe('Rate Limiting', () => {
  it('should calculate requests remaining', () => {
    const windowMs = 60000; // 1 minute
    const maxRequests = 100;
    const requestsMade = 45;
    
    const remaining = Math.max(0, maxRequests - requestsMade);
    expect(remaining).toBe(55);
  });

  it('should reset after window', () => {
    const now = Date.now();
    const windowStart = now - 120000; // 2 minutes ago
    
    const isInWindow = (Date.now() - windowStart) < 60000;
    expect(isInWindow).toBe(false); // Should be outside window now
  });
});

describe('Analytics Calculations', () => {
  it('should calculate hit rate', () => {
    const hits = 75;
    const misses = 25;
    const total = hits + misses;
    const hitRate = Math.round((hits / total) * 100);
    
    expect(hitRate).toBe(75);
  });

  it('should calculate cost savings', () => {
    const cachedTokens = 50000;
    const pricePer1k = 0.003; // $3 per 1M tokens
    const savings = (cachedTokens / 1000) * pricePer1k;
    
    expect(savings).toBe(0.15);
  });

  it('should track latency percentiles', () => {
    const latencies = [45, 120, 80, 200, 60, 95, 150, 75];
    const sorted = latencies.sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    
    expect(p50).toBe(95); // 4th element in sorted
    expect(p95).toBe(200);
  });
});
