export interface WebhookEvent {
    id: string;
    type: 'cache_hit' | 'cache_miss' | 'error' | 'signup' | 'upgrade' | 'cache_warm';
    data: Record<string, unknown>;
    timestamp: number;
}
export declare class WebhookNotifier {
    private webhookUrl;
    private events;
    private maxEvents;
    setWebhook(url: string): void;
    getWebhook(): string | null;
    clearWebhook(): void;
    send(event: WebhookEvent): Promise<{
        success: boolean;
        error?: string;
    }>;
    notifyCacheHit(data: Record<string, unknown>): Promise<{
        success: boolean;
        error?: string;
    }>;
    notifyCacheMiss(data: Record<string, unknown>): Promise<{
        success: boolean;
        error?: string;
    }>;
    notifyError(error: string, data: Record<string, unknown>): Promise<{
        success: boolean;
        error?: string;
    }>;
    notifySignup(data: Record<string, unknown>): Promise<{
        success: boolean;
        error?: string;
    }>;
    notifyUpgrade(data: Record<string, unknown>): Promise<{
        success: boolean;
        error?: string;
    }>;
    notifyCacheWarm(data: Record<string, unknown>): Promise<{
        success: boolean;
        error?: string;
    }>;
    getEvents(limit?: number): WebhookEvent[];
    getEventsByType(type: WebhookEvent['type']): WebhookEvent[];
    getStats(): {
        totalEvents: number;
        byType: Record<string, number>;
    };
}
export declare const webhookNotifier: WebhookNotifier;
//# sourceMappingURL=webhooks.d.ts.map