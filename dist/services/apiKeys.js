"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAPIKey = generateAPIKey;
exports.validateAPIKey = validateAPIKey;
exports.recordRequest = recordRequest;
exports.getAllAPIKeys = getAllAPIKeys;
exports.getAPIKey = getAPIKey;
exports.getAPIKeyTier = getAPIKeyTier;
exports.revokeAPIKey = revokeAPIKey;
exports.resetDailyLimits = resetDailyLimits;
// API Key Management for PromptCache
const crypto_1 = __importDefault(require("crypto"));
// In-memory store (would use DB in production)
const apiKeys = new Map();
// Generate new API key
function generateAPIKey(name, tier = 'free') {
    const id = crypto_1.default.randomBytes(8).toString('hex');
    const key = `pc_${tier}_sk_${crypto_1.default.randomBytes(24).toString('hex')}`;
    const limits = {
        free: 1000,
        pro: 100000,
        enterprise: Infinity
    };
    const apiKey = {
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
function validateAPIKey(key) {
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
function recordRequest(key) {
    const apiKey = apiKeys.get(key);
    if (apiKey) {
        apiKey.requestsToday++;
    }
}
// Get all keys
function getAllAPIKeys() {
    return Array.from(apiKeys.values());
}
// Get key by key string
function getAPIKey(key) {
    return apiKeys.get(key);
}
// Get tier for an API key (undefined if not found/invalid)
function getAPIKeyTier(key) {
    const apiKey = apiKeys.get(key);
    return apiKey?.tier;
}
// Revoke key
function revokeAPIKey(key) {
    const apiKey = apiKeys.get(key);
    if (apiKey) {
        apiKey.active = false;
        return true;
    }
    return false;
}
// Reset daily limits (called at midnight)
function resetDailyLimits() {
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
//# sourceMappingURL=apiKeys.js.map