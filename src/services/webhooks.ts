// Webhook Notifier for PromptCache
export interface WebhookEvent {
  id: string;
  type: 'cache_hit' | 'cache_miss' | 'error' | 'signup' | 'upgrade' | 'cache_warm';
  data: Record<string, unknown>;
  timestamp: number;
}

export class WebhookNotifier {
  private webhookUrl: string | null = null;
  private events: WebhookEvent[] = [];
  private maxEvents = 1000;

  setWebhook(url: string): void {
    this.webhookUrl = url;
    console.log(`🔗 Webhook configured: ${url}`);
  }

  getWebhook(): string | null {
    return this.webhookUrl;
  }

  clearWebhook(): void {
    this.webhookUrl = null;
    console.log(`🔗 Webhook cleared`);
  }

  async send(event: WebhookEvent): Promise<{ success: boolean; error?: string }> {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    if (!this.webhookUrl) return { success: false, error: 'No webhook URL configured' };

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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`❌ Webhook failed: ${msg}`);
      return { success: false, error: msg };
    }
  }

  async notifyCacheHit(data: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    return this.send({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'cache_hit',
      data,
      timestamp: Date.now(),
    });
  }

  async notifyCacheMiss(data: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    return this.send({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'cache_miss',
      data,
      timestamp: Date.now(),
    });
  }

  async notifyError(error: string, data: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    return this.send({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'error',
      data: { error, ...data },
      timestamp: Date.now(),
    });
  }

  async notifySignup(data: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    return this.send({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'signup',
      data,
      timestamp: Date.now(),
    });
  }

  async notifyUpgrade(data: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    return this.send({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'upgrade',
      data,
      timestamp: Date.now(),
    });
  }

  async notifyCacheWarm(data: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    return this.send({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'cache_warm',
      data,
      timestamp: Date.now(),
    });
  }

  getEvents(limit = 100): WebhookEvent[] {
    return this.events.slice(-limit);
  }

  getEventsByType(type: WebhookEvent['type']): WebhookEvent[] {
    return this.events.filter(e => e.type === type);
  }

  getStats(): { totalEvents: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const e of this.events) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { totalEvents: this.events.length, byType };
  }
}

export const webhookNotifier = new WebhookNotifier();
