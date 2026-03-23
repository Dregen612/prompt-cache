"use strict";
/**
 * Context Optimization Middleware
 * Based on: https://github.com/muratcankoylan/agent-skills-for-context-engineering
 *
 * Stack with PromptCache:
 *   PromptCache  = caches WHAT is said (responses)
 *   Context Opt = reduces HOW MUCH is said (token efficiency)
 *
 * Four strategies (applied in priority order):
 *   1. KV-Cache Optimization  — prompt ordering for cache reuse (zero quality risk)
 *   2. Observation Masking    — compress verbose tool outputs (60-80% reduction)
 *   3. Compaction            — summarize when context > 70% (50-70% reduction)
 *   4. Context Partitioning   — split across sub-agents (>60% context load)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateTokens = estimateTokens;
exports.estimateContextUtilization = estimateContextUtilization;
exports.orderForKVCaching = orderForKVCaching;
exports.maskObservation = maskObservation;
exports.retrieveObservation = retrieveObservation;
exports.autoMaskToolOutputs = autoMaskToolOutputs;
exports.shouldCompact = shouldCompact;
exports.compactContext = compactContext;
exports.shouldPartition = shouldPartition;
exports.partitionContext = partitionContext;
exports.generateOptimizationReport = generateOptimizationReport;
// ─── Token Estimation ────────────────────────────────────────────────────────
// Rough token estimate: ~4 chars per token for English
const CHARS_PER_TOKEN = 4;
function estimateTokens(text) {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}
function estimateContextUtilization(texts, contextLimit = 128000) {
    const totalTokens = texts.reduce((sum, t) => sum + estimateTokens(t), 0);
    return totalTokens / contextLimit;
}
/**
 * Reorder a prompt structure for maximum KV-cache hit rate.
 * Stable content first (prefix), dynamic content last.
 *
 * Rule: Even a single whitespace change in the prefix
 * invalidates the ENTIRE cached block downstream.
 */
function orderForKVCaching(prompt) {
    const parts = [
        stripDynamicFromSystem(prompt.system), // System WITHOUT timestamps/session counters
        prompt.tools,
        prompt.templates,
        prompt.history,
        prompt.query, // Always last — most dynamic
    ];
    return parts.filter(Boolean).join("\n\n");
}
/**
 * Remove dynamic content from system prompts that would break KV-cache.
 * Timestamps, session counters, request IDs — move these to user messages.
 */
function stripDynamicFromSystem(system) {
    // Remove date/time patterns that change every request
    return system
        .replace(/Current (date|time|timestamp):\s*\{[^}]+\}/gi, "")
        .replace(/\{(?:today|now|currentTime|currentDate)[^}]*\}/gi, "")
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[DATE_REDACTED]")
        .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/gi, "[TIME_REDACTED]")
        .replace(/Session:\s*\d+/g, "Session: [ID]")
        .replace(/Request\s*#\d+/g, "Request #[ID]")
        .trim();
}
// In-memory store for masked observations (replace with DB for production)
const observationStore = new Map();
let observationCounter = 0;
function maskObservation(content, summary, maxAgeMs = 3600000) {
    // Generate stable ref ID
    const refId = `obs_${Date.now()}_${++observationCounter}`;
    // Store original for retrieval
    observationStore.set(refId, { content, createdAt: Date.now() });
    // Prune old observations
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, obs] of observationStore) {
        if (obs.createdAt < cutoff)
            observationStore.delete(id);
    }
    const originalLength = content.length;
    const maskedLength = `[Obs:${refId} elided. Key: ${summary}]`.length;
    return {
        refId,
        summary,
        originalLength,
        maskedLength,
        reduction: Math.round((1 - maskedLength / originalLength) * 100),
    };
}
function retrieveObservation(refId) {
    return observationStore.get(refId)?.content || null;
}
/**
 * Auto-mask verbose tool outputs that are >3 turns old
 * and whose key points have been extracted.
 */
function autoMaskToolOutputs(outputs, maskAfterTurns = 3, minLength = 500) {
    return outputs.map((output) => {
        // Never mask recent outputs
        if (output.turnAge < maskAfterTurns) {
            return { masked: false, content: output.content };
        }
        // Mask long verbose outputs (>500 chars) that have had time to be summarized
        if (output.content.length < minLength) {
            return { masked: false, content: output.content };
        }
        const summary = output.summary || extractKeySummary(output.content);
        const ref = maskObservation(output.content, summary);
        return {
            masked: true,
            content: `[Obs:${ref.refId} elided. Key: ${summary}. Full content retrievable.]`,
            ref,
        };
    });
}
// Extract key summary from verbose content
function extractKeySummary(content) {
    // Take first 2 sentences + key metrics
    const firstPart = content.split(/[.!?]/).slice(0, 3).join(".").trim();
    const metrics = content.match(/\d+(?:\.\d+)?(?:%|ms|GB|MB|KB| tokens)?/g);
    const metricStr = metrics ? ` Metrics: ${metrics.slice(0, 5).join(", ")}` : "";
    return (firstPart + metricStr).slice(0, 200);
}
const DEFAULT_COMPACTION_CONFIG = {
    triggerThreshold: 0.7,
    targetReduction: 0.5,
    maxReduction: 0.7,
};
/**
 * Determine if compaction should be triggered based on context utilization.
 */
function shouldCompact(contextTokens, contextLimit = 128000, config = {}) {
    const cfg = { ...DEFAULT_COMPACTION_CONFIG, ...config };
    return contextTokens / contextLimit > cfg.triggerThreshold;
}
/**
 * Compact a list of messages/documents into a summary.
 * Preserves: decisions, commitments, user preferences, key facts.
 * Removes: filler, boilerplate, exploratory turns, raw tool output.
 */
async function compactContext(messages, summaryModel) {
    const originalText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const originalTokens = estimateTokens(originalText);
    // Group by type and apply different summarization strategies
    const toolOutputs = messages.filter((m) => m.role === "tool" || m.role === "assistant");
    const conversation = messages.filter((m) => m.role === "user" || m.role === "system");
    const decisions = extractDecisions(messages);
    // Summarize tool outputs aggressively (they dominate context)
    let toolSummary = "";
    if (toolOutputs.length > 0) {
        toolSummary = await summaryModel(`[TOOL OUTPUTS — ${toolOutputs.length} entries]\n` +
            toolOutputs.map((m) => m.content).join("\n"));
    }
    // Summarize conversation lightly
    let convSummary = "";
    if (conversation.length > 0) {
        convSummary = await summaryModel(conversation.map((m) => `${m.role}: ${m.content}`).join("\n"));
    }
    const summary = [
        decisions ? `DECISIONS: ${decisions}\n` : "",
        convSummary ? `CONVERSATION: ${convSummary}\n` : "",
        toolSummary ? `TOOL RESULTS: ${toolSummary}\n` : "",
        `[Compacted from ${messages.length} messages, ${originalTokens} tokens]`,
    ].filter(Boolean).join("\n");
    const compactedTokens = estimateTokens(summary);
    return {
        originalTokens,
        compactedTokens,
        reductionPercent: Math.round((1 - compactedTokens / originalTokens) * 100),
        summary,
    };
}
function extractDecisions(messages) {
    // Extract decision patterns from conversation
    const decisionPatterns = [
        /(?:decided|chose|selected|agreed|concluded|determined)[:\s]/gi,
        /(?:the answer is|response:|answer:)/gi,
        /(?:final|result|outcome)[:\s]/gi,
    ];
    const decisions = [];
    for (const msg of messages) {
        for (const pattern of decisionPatterns) {
            const matches = msg.content.match(pattern);
            if (matches) {
                decisions.push(msg.content.slice(0, 200));
                break;
            }
        }
    }
    return decisions.slice(0, 5).join(" | ");
}
/**
 * Estimate whether partitioning would save tokens vs. coordinator overhead.
 * Break-even: typically 3+ independent subtasks.
 */
function shouldPartition(totalTokens, contextLimit = 128000, subtaskCount = 1) {
    // Partition overhead: ~500 tokens for coordinator
    const coordinatorOverhead = 500;
    const netSavings = subtaskCount * 2000 - coordinatorOverhead; // rough estimate
    return totalTokens / contextLimit > 0.6 && subtaskCount >= 3 && netSavings > 0;
}
/**
 * Partition content into sub-agent sized chunks.
 */
function partitionContext(content, partitionCount) {
    const totalTokens = estimateTokens(content);
    const targetTokens = Math.ceil(totalTokens / partitionCount);
    const lines = content.split("\n");
    const partitions = [];
    let currentPartition = "";
    let currentTokens = 0;
    for (const line of lines) {
        const lineTokens = estimateTokens(line);
        if (currentTokens + lineTokens > targetTokens && currentPartition) {
            partitions.push({
                id: `part_${partitions.length + 1}`,
                content: currentPartition.trim(),
                estimatedTokens: currentTokens,
            });
            currentPartition = "";
            currentTokens = 0;
        }
        currentPartition += line + "\n";
        currentTokens += lineTokens;
    }
    // Final partition
    if (currentPartition.trim()) {
        partitions.push({
            id: `part_${partitions.length + 1}`,
            content: currentPartition.trim(),
            estimatedTokens: currentTokens,
        });
    }
    const coordinatorOverhead = 500;
    return {
        partitions,
        totalTokens,
        coordinatorOverhead,
        netSavings: totalTokens - partitions.reduce((s, p) => s + p.estimatedTokens, 0) - coordinatorOverhead,
    };
}
function generateOptimizationReport(before, after, strategies) {
    return {
        originalTokens: before,
        finalTokens: after,
        strategies,
        reductions: strategies.map(() => Math.round((1 - after / before) * 100)),
        timestamp: Date.now(),
    };
}
//# sourceMappingURL=contextOptimization.js.map