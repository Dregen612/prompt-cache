// Stub - stripe.ts disabled for build
export async function getOrCreateCustomer(email: string): Promise<string> {
  return 'cus_stub';
}

export interface CheckoutSession {
  id: string;
  url: string;
  sessionId?: string;
}

export async function createCheckoutSession(tier: string, customerId?: string, successUrl?: string, cancelUrl?: string): Promise<CheckoutSession> {
  return { id: 'cs_stub', url: '#', sessionId: 'cs_stub' };
}

export interface WebhookResult {
  type: string;
  data: any;
  received: boolean;
}

export async function handleWebhook(body: string, signature: string): Promise<WebhookResult> {
  return { type: 'stub', data: {}, received: true };
}

export interface Subscription {
  status: string;
}

export async function getSubscription(subscriptionId: string): Promise<Subscription> {
  return { status: 'active' };
}

export interface Customer {
  id: string;
}

export async function getCustomerByEmail(email: string): Promise<Customer | null> {
  return null;
}
