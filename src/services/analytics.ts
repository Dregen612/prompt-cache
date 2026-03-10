// Real-time analytics tracking for PromptCache

interface RequestLog {
  timestamp: number;
  cached: boolean;
  latency: number;
  model?: string;
  error?: boolean;
}

class AnalyticsTracker {
  private requests: RequestLog[] = [];
  private readonly MAX_REQUESTS = 10000; // Keep last 10k

  recordRequest(cached: boolean, latency: number, model?: string, error = false) {
    this.requests.push({
      timestamp: Date.now(),
      cached,
      latency,
      model,
      error
    });

    // Trim old requests
    if (this.requests.length > this.MAX_REQUESTS) {
      this.requests = this.requests.slice(-this.MAX_REQUESTS);
    }
  }

  getAnalytics(period: '1h' | '24h' | '7d' | '30d' = '24h') {
    const now = Date.now();
    const periodMs = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    }[period];

    const cutoff = now - periodMs;
    const filtered = this.requests.filter(r => r.timestamp >= cutoff);

    const totalRequests = filtered.length;
    const cacheHits = filtered.filter(r => r.cached).length;
    const cacheMisses = filtered.filter(r => !r.cached).length;
    const errors = filtered.filter(r => r.error).length;
    const latencies = filtered.map(r => r.latency);
    const avgLatency = latencies.length > 0 
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

    // Group by model
    const modelCounts: Record<string, number> = {};
    filtered.forEach(r => {
      if (r.model) {
        modelCounts[r.model] = (modelCounts[r.model] || 0) + 1;
      }
    });
    const topModels = Object.entries(modelCounts)
      .map(([model, requests]) => ({ model, requests }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 5);

    // Hourly breakdown for 24h
    const hourlyRequests: { hour: number; requests: number }[] = [];
    for (let i = 0; i < 24; i++) {
      const hourStart = now - (23 - i) * 60 * 60 * 1000;
      const hourEnd = hourStart + 60 * 60 * 1000;
      const count = filtered.filter(r => r.timestamp >= hourStart && r.timestamp < hourEnd).length;
      hourlyRequests.push({ hour: i, requests: count });
    }

    // Estimate tokens/cost saved (rough: $0.001 per cached request)
    const tokensSaved = cacheHits * 150; // avg 150 tokens per cached response
    const costSaved = parseFloat((cacheHits * 0.001).toFixed(2));

    return {
      period,
      totalRequests,
      cacheHits,
      cacheMisses,
      errors,
      avgLatency,
      tokensSaved,
      costSaved,
      hitRate: totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 100) : 0,
      topModels,
      hourlyRequests
    };
  }

  reset() {
    this.requests = [];
  }
}

export const analytics = new AnalyticsTracker();
