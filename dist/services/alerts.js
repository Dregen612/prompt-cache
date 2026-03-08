"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkUsage = checkUsage;
exports.addAlert = addAlert;
const alerts = [];
function checkUsage(apiKey, usage, limit) {
    const percent = (usage / limit) * 100;
    if (percent >= 80) {
        console.log(`⚠️ Usage at ${percent}% for ${apiKey}`);
        // Send alert...
    }
}
function addAlert(config) {
    alerts.push(config);
}
//# sourceMappingURL=alerts.js.map