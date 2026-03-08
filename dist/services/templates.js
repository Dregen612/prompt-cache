"use strict";
// Response Templates & Transformation Service
// Pre-defined output formats for cached responses
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATES = void 0;
exports.applyTemplate = applyTemplate;
exports.transformResponse = transformResponse;
// Built-in templates
exports.TEMPLATES = [
    {
        id: 'json',
        name: 'JSON',
        description: 'Format response as valid JSON',
        format: 'json',
        template: '{response}'
    },
    {
        id: 'json-structured',
        name: 'Structured JSON',
        description: 'JSON with metadata wrapper',
        format: 'json',
        template: `{
  "result": "{response}",
  "cached": true,
  "timestamp": "{timestamp}"
}`
    },
    {
        id: 'markdown-list',
        name: 'Markdown List',
        description: 'Format as markdown list',
        format: 'markdown',
        template: `## Result

{response}

---
*Cached by PromptCache*`
    },
    {
        id: 'csv-row',
        name: 'CSV Row',
        description: 'Single CSV row',
        format: 'csv',
        template: 'response,source,cache_time\n"{response}","promptcache","{timestamp}"'
    },
    {
        id: 'html-wrapper',
        name: 'HTML',
        description: 'Wrap in HTML page',
        format: 'html',
        template: `<!DOCTYPE html>
<html>
<head><title>Result</title></head>
<body>
{response}
</body>
</html>`
    },
    {
        id: 'text-plain',
        name: 'Plain Text',
        description: 'Plain text output',
        format: 'text',
        template: '{response}'
    },
    {
        id: 'slack-block',
        name: 'Slack Block',
        description: 'Formatted for Slack',
        format: 'json',
        template: `{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "{response}"
      }
    }
  ]
}`
    },
    {
        id: 'discord-embed',
        name: 'Discord Embed',
        description: 'Discord rich embed',
        format: 'json',
        template: `{
  "embeds": [{
    "description": "{response}",
    "color": 65280
  }]
}`
    }
];
// Apply template to response
function applyTemplate(templateId, response) {
    const template = exports.TEMPLATES.find(t => t.id === templateId);
    if (!template) {
        return { success: false, error: `Template '${templateId}' not found` };
    }
    const timestamp = new Date().toISOString();
    let formatted = template.template
        .replace(/{response}/g, response)
        .replace(/{timestamp}/g, timestamp);
    // Validate JSON if needed
    if (template.format === 'json') {
        try {
            JSON.parse(formatted);
        }
        catch (e) {
            return { success: false, error: 'Invalid JSON output' };
        }
    }
    return { success: true, formatted };
}
// Transform response based on type
function transformResponse(response, options) {
    let result = response;
    if (options.trim)
        result = result.trim();
    if (options.uppercase)
        result = result.toUpperCase();
    if (options.lowercase)
        result = result.toLowerCase();
    if (options.escape)
        result = result.replace(/"/g, '\\"');
    // Apply template if specified
    if (options.template) {
        const applied = applyTemplate(options.template, result);
        if (applied.success) {
            result = applied.formatted;
        }
    }
    else if (options.format === 'json') {
        result = JSON.stringify({ result });
    }
    return result;
}
//# sourceMappingURL=templates.js.map