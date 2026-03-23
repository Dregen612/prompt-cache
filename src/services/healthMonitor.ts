// Health Monitor - tracks uptime, cache health, and system metrics
export interface HealthSnapshot {
  timestamp: number;
  backend: 'pg' | 'redis' | 'memory';
  cacheEntries: number;
  cacheHits: number;
  cacheMisses: boolean; // true if any miss since last snapshot
  responseTimeMs: number;
  errorRate: number; // 0-1
}

export class HealthMonitor {
  private startTime: number;
  private snapshots: HealthSnapshot[] = [];
  private maxSnapshots = 1440; // 24hrs at 1/min
  private recentHits = 0;
  private recentMisses = 0;
  private recentErrors = 0;
  private recentRequests = 0;

  constructor() {
    this.startTime = Date.now();
  }

  recordHit(): void {
    this.recentHits++;
    this.recentRequests++;
  }

  recordMiss(): void {
    this.recentMisses++;
    this.recentRequests++;
  }

  recordError(): void {
    this.recentErrors++;
    this.recentRequests++;
  }

  recordRequest(isHit: boolean, responseTimeMs: number): void {
    if (isHit) this.recentHits++;
    else this.recentMisses++;
    this.recentRequests++;
    if (responseTimeMs > 5000) this.recentErrors++; // count slow responses as partial errors
  }

  private prune(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.snapshots = this.snapshots.filter(s => s.timestamp > cutoff);
  }

  getUptime(): { seconds: number; human: string; startTime: number } {
    const seconds = Math.floor((Date.now() - this.startTime) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return {
      seconds,
      human: h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`,
      startTime: this.startTime,
    };
  }

  getSummary(): {
    uptime: { seconds: number; human: string; startTime: number };
    recent: { hits: number; misses: number; requests: number; hitRate: number; errorRate: number };
    history: { period: string; avgHitRate: number; peakEntries: number };
  } {
    const uptime = this.getUptime();
    const totalRequests = this.recentHits + this.recentMisses;
    const hitRate = totalRequests > 0 ? (this.recentHits / totalRequests) * 100 : 0;
    const errorRate = totalRequests > 0 ? (this.recentErrors / totalRequests) * 100 : 0;

    // Calculate history stats
    this.prune();
    let avgHitRate = hitRate;
    let peakEntries = 0;
    if (this.snapshots.length > 0) {
      const sumHits = this.snapshots.reduce((sum, s) => sum + (s.cacheHits ? 1 : 0), 0);
      avgHitRate = this.snapshots.length > 0 ? (sumHits / this.snapshots.length) * 100 : 0;
      peakEntries = Math.max(...this.snapshots.map(s => s.cacheEntries));
    }

    return {
      uptime,
      recent: {
        hits: this.recentHits,
        misses: this.recentMisses,
        requests: this.recentRequests,
        hitRate: Math.round(hitRate * 10) / 10,
        errorRate: Math.round(errorRate * 10) / 10,
      },
      history: {
        period: '24h',
        avgHitRate: Math.round(avgHitRate * 10) / 10,
        peakEntries,
      },
    };
  }

  reset(): void {
    this.recentHits = 0;
    this.recentMisses = 0;
    this.recentErrors = 0;
    this.recentRequests = 0;
  }

  addSnapshot(snapshot: HealthSnapshot): void {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }
  }
}

export const healthMonitor = new HealthMonitor();
