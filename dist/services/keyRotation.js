"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyRotator = void 0;
// API Key Rotation
class KeyRotator {
    constructor() {
        this.keys = [];
        this.currentIndex = 0;
    }
    addKey(key) {
        this.keys.push(key);
    }
    getNextKey() {
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }
    rotate() {
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    }
}
exports.KeyRotator = KeyRotator;
//# sourceMappingURL=keyRotation.js.map