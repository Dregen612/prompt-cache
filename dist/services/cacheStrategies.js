"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheManager = void 0;
class CacheManager {
    get(strategy, key) {
        switch (strategy) {
            case 'cache-first': return this.cacheFirst(key);
            case 'network-first': return this.networkFirst(key);
            case 'stale-while-revalidate': return this.staleWhileRevalidate(key);
        }
    }
    cacheFirst(key) { }
    networkFirst(key) { }
    staleWhileRevalidate(key) { }
}
exports.CacheManager = CacheManager;
//# sourceMappingURL=cacheStrategies.js.map