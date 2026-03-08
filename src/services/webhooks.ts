// Webhook Notifier for PromptCache
export interface WebhookEvent {
  id: string;
  type: 'cache_hit' | 'cache_miss' | 'error' | 'signup' | 'upgrade';
  data: any;
  timestamp: number;
}

export class WebhookNotifier {
  private webhookUrl: string | null = null;
  private events: WebhookEvent[] = [];
  
  // Configure webhook URL
  setWebhook(url: string): void {
    this.webhookUrl = url;
    console.log(`🔗 Webhook configured: ${url}`);
  }
  
  // Send event to webhook
  async send(event: WebhookEvent): Promise<boolean> {
    this.events.push(event);
    
    if (!this.webhookUrl) return false;
    
    try {
      const axios = (await import('axios')).default;
      await axios.post(this.webhookUrl, event, {
        timeout: 5000
      });
      console.log(`📤 Webhook sent: ${event.type}`);
      return true;
    } catch (e) {
      console.log(`❌ Webhook failed: ${e}`);
      return false;
    }
  }
  
  // Convenience methods
  async notifyCacheHit(data: any): Promise<void> {
    await this.send({
      id: `evt-${Date.now()}`,
      type: 'cache_hit',
      data,
      timestamp: Date.now()
    });
  }
  
  async notifyCacheMiss(data: any): Promise<void> {
    await this.send({
      id: `evt-${Date.now()}`,
      type: 'cache_miss',
      data,
      timestamp: Date.now()
    });
  }
  
  async notifyError(error: string, data: any): Promise<void> {
    await this.send({
      id: `evt-${Date.now()}`,
      type: 'error',
      data: { error, ...data },
      timestamp: Date.now()
    });
  }
  
  // Get recent events
  getEvents(limit = 100): WebhookEvent[] {
    return this.events.slice(-limit);
  }
  
  // Get events by type
  getEventsByType(type: WebhookEvent['type']): WebhookEvent[] {
    return this.events.filter(e => e.type === type);
  }
}

export const webhookNotifier = new WebhookNotifier();
