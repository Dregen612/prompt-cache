"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthMonitor = exports.HealthMonitor = void 0;
class HealthMonitor {
    constructor() {
        this.snapshots = [];
        this.maxSnapshots = 1440; // 24hrs at 1/min
        this.recentHits = 0;
        this.recentMisses = 0;
        this.recentErrors = 0;
        this.recentRequests = 0;
        this.startTime = Date.now();
    }
    recordHit() {
        this.recentHits++;
        this.recentRequests++;
    }
    recordMiss() {
        this.recentMisses++;
        this.recentRequests++;
    }
    recordError() {
        this.recentErrors++;
        this.recentRequests++;
    }
    recordRequest(isHit, responseTimeMs) {
        if (isHit)
            this.recentHits++;
        else
            this.recentMisses++;
        this.recentRequests++;
        if (responseTimeMs > 5000)
            this.recentErrors++; // count slow responses as partial errors
    }
    prune() {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        this.snapshots = this.snapshots.filter(s => s.timestamp > cutoff);
    }
    getUptime() {
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
    getSummary() {
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
    reset() {
        this.recentHits = 0;
        this.recentMisses = 0;
        this.recentErrors = 0;
        this.recentRequests = 0;
    }
    addSnapshot(snapshot) {
        this.snapshots.push(snapshot);
        if (this.snapshots.length > this.maxSnapshots) {
            this.snapshots = this.snapshots.slice(-this.maxSnapshots);
        }
    }
}
exports.HealthMonitor = HealthMonitor;
exports.healthMonitor = new HealthMonitor();
//# sourceMappingURL=healthMonitor.js.map