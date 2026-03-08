"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookNotifier = exports.WebhookNotifier = void 0;
class WebhookNotifier {
    constructor() {
        this.webhookUrl = null;
        this.events = [];
    }
    // Configure webhook URL
    setWebhook(url) {
        this.webhookUrl = url;
        console.log(`🔗 Webhook configured: ${url}`);
    }
    // Send event to webhook
    async send(event) {
        this.events.push(event);
        if (!this.webhookUrl)
            return false;
        try {
            const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
            await axios.post(this.webhookUrl, event, {
                timeout: 5000
            });
            console.log(`📤 Webhook sent: ${event.type}`);
            return true;
        }
        catch (e) {
            console.log(`❌ Webhook failed: ${e}`);
            return false;
        }
    }
    // Convenience methods
    async notifyCacheHit(data) {
        await this.send({
            id: `evt-${Date.now()}`,
            type: 'cache_hit',
            data,
            timestamp: Date.now()
        });
    }
    async notifyCacheMiss(data) {
        await this.send({
            id: `evt-${Date.now()}`,
            type: 'cache_miss',
            data,
            timestamp: Date.now()
        });
    }
    async notifyError(error, data) {
        await this.send({
            id: `evt-${Date.now()}`,
            type: 'error',
            data: { error, ...data },
            timestamp: Date.now()
        });
    }
    // Get recent events
    getEvents(limit = 100) {
        return this.events.slice(-limit);
    }
    // Get events by type
    getEventsByType(type) {
        return this.events.filter(e => e.type === type);
    }
}
exports.WebhookNotifier = WebhookNotifier;
exports.webhookNotifier = new WebhookNotifier();
//# sourceMappingURL=webhooks.js.map