export interface WebhookEvent {
    id: string;
    type: 'cache_hit' | 'cache_miss' | 'error' | 'signup' | 'upgrade';
    data: any;
    timestamp: number;
}
export declare class WebhookNotifier {
    private webhookUrl;
    private events;
    setWebhook(url: string): void;
    send(event: WebhookEvent): Promise<boolean>;
    notifyCacheHit(data: any): Promise<void>;
    notifyCacheMiss(data: any): Promise<void>;
    notifyError(error: string, data: any): Promise<void>;
    getEvents(limit?: number): WebhookEvent[];
    getEventsByType(type: WebhookEvent['type']): WebhookEvent[];
}
export declare const webhookNotifier: WebhookNotifier;
//# sourceMappingURL=webhooks.d.ts.map