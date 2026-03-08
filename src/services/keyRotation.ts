// API Key Rotation
export class KeyRotator {
  private keys: string[] = [];
  private currentIndex = 0;
  
  addKey(key: string): void {
    this.keys.push(key);
  }
  
  getNextKey(): string {
    const key = this.keys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return key;
  }
  
  rotate(): void {
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
  }
}
