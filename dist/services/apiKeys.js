"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAPIKey = generateAPIKey;
exports.validateAPIKey = validateAPIKey;
exports.getAllKeys = getAllKeys;
exports.revokeAPIKey = revokeAPIKey;
exports.deleteAPIKey = deleteAPIKey;
exports.getKeyStats = getKeyStats;
// API Key Management Service
const crypto_1 = __importDefault(require("crypto"));
// In-memory store (would use DB in production)
const apiKeys = new Map();
// Generate new API key
function generateAPIKey(name = 'Default', tier = 'free') {
    const prefix = tier === 'free' ? 'pc_live' : tier === 'pro' ? 'pc_pro' : 'pc_ent';
    const randomPart = crypto_1.default.randomBytes(16).toString('hex');
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
function validateAPIKey(key) {
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
function getAllKeys() {
    return Array.from(apiKeys.values());
}
// Revoke a key
function revokeAPIKey(key) {
    const keyData = apiKeys.get(key);
    if (!keyData)
        return false;
    keyData.active = false;
    return true;
}
// Delete a key
function deleteAPIKey(key) {
    return apiKeys.delete(key);
}
// Get key stats
function getKeyStats(key) {
    return apiKeys.get(key) || null;
}
// Initialize with a default key for testing
if (apiKeys.size === 0) {
    generateAPIKey('Development');
}
//# sourceMappingURL=apiKeys.js.map