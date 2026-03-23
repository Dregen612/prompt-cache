"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookNotifier = exports.WebhookNotifier = void 0;
class WebhookNotifier {
    constructor() {
        this.webhookUrl = null;
        this.events = [];
        this.maxEvents = 1000;
    }
    setWebhook(url) {
        this.webhookUrl = url;
        console.log(`🔗 Webhook configured: ${url}`);
    }
    getWebhook() {
        return this.webhookUrl;
    }
    clearWebhook() {
        this.webhookUrl = null;
        console.log(`🔗 Webhook cleared`);
    }
    async send(event) {
        this.events.push(event);
        if (this.events.length > this.maxEvents) {
            this.events = this.events.slice(-this.maxEvents);
        }
        if (!this.webhookUrl)
            return { success: false, error: 'No webhook URL configured' };
        try {
            const response = await fetch(this.webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'PromptCache/1.0',
                    'X-PromptCache-Event': event.type,
                },
                body: JSON.stringify(event),
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) {
                return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
            }
            console.log(`📤 Webhook sent: ${event.type}`);
            return { success: true };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`❌ Webhook failed: ${msg}`);
            return { success: false, error: msg };
        }
    }
    async notifyCacheHit(data) {
        return this.send({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: 'cache_hit',
            data,
            timestamp: Date.now(),
        });
    }
    async notifyCacheMiss(data) {
        return this.send({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: 'cache_miss',
            data,
            timestamp: Date.now(),
        });
    }
    async notifyError(error, data) {
        return this.send({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: 'error',
            data: { error, ...data },
            timestamp: Date.now(),
        });
    }
    async notifySignup(data) {
        return this.send({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: 'signup',
            data,
            timestamp: Date.now(),
        });
    }
    async notifyUpgrade(data) {
        return this.send({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: 'upgrade',
            data,
            timestamp: Date.now(),
        });
    }
    async notifyCacheWarm(data) {
        return this.send({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: 'cache_warm',
            data,
            timestamp: Date.now(),
        });
    }
    getEvents(limit = 100) {
        return this.events.slice(-limit);
    }
    getEventsByType(type) {
        return this.events.filter(e => e.type === type);
    }
    getStats() {
        const byType = {};
        for (const e of this.events) {
            byType[e.type] = (byType[e.type] || 0) + 1;
        }
        return { totalEvents: this.events.length, byType };
    }
}
exports.WebhookNotifier = WebhookNotifier;
exports.webhookNotifier = new WebhookNotifier();
//# sourceMappingURL=webhooks.js.map