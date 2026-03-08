// Usage Alerting
export interface AlertConfig {
  email: string;
  thresholdPercent: number; // 80% = alert at 80% usage
}

const alerts: AlertConfig[] = [];

export function checkUsage(apiKey: string, usage: number, limit: number): void {
  const percent = (usage / limit) * 100;
  if (percent >= 80) {
    console.log(`⚠️ Usage at ${percent}% for ${apiKey}`);
    // Send alert...
  }
}

export function addAlert(config: AlertConfig): void {
  alerts.push(config);
}
