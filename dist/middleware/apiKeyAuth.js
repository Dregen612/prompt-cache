"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuth = apiKeyAuth;
exports.optionalApiKeyAuth = optionalApiKeyAuth;
const apiKeys_1 = require("../services/apiKeys");
function apiKeyAuth(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!key) {
        return res.status(401).json({ error: 'API key required. Include X-API-Key header.' });
    }
    const result = (0, apiKeys_1.validateAPIKey)(key);
    if (!result.valid) {
        return res.status(401).json({ error: result.error });
    }
    // Attach API key to request
    req.apiKey = result.keyData;
    next();
}
// Optional auth - doesn't fail if no key, but attaches if valid
function optionalApiKeyAuth(req, res, next) {
    const key = req.headers['x-api-key'];
    if (key) {
        const result = (0, apiKeys_1.validateAPIKey)(key);
        if (result.valid) {
            req.apiKey = result.keyData;
        }
    }
    next();
}
//# sourceMappingURL=apiKeyAuth.js.map