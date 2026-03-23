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

// ─── Token Estimation ────────────────────────────────────────────────────────

// Rough token estimate: ~4 chars per token for English
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateContextUtilization(
  texts: string[],
  contextLimit: number = 128000
): number {
  const totalTokens = texts.reduce((sum, t) => sum + estimateTokens(t), 0);
  return totalTokens / contextLimit;
}

// ─── Strategy 1: KV-Cache Optimization ──────────────────────────────────────

export interface KVCachePrompt {
  system: string;       // Most stable — goes first
  tools: string;        // Stable across requests
  templates: string;    // Frequently reused
  history: string;      // Grows but shares prefix
  query: string;        // Dynamic — always last
}

/**
 * Reorder a prompt structure for maximum KV-cache hit rate.
 * Stable content first (prefix), dynamic content last.
 * 
 * Rule: Even a single whitespace change in the prefix
 * invalidates the ENTIRE cached block downstream.
 */
export function orderForKVCaching(prompt: KVCachePrompt): string {
  const parts: string[] = [
    stripDynamicFromSystem(prompt.system),  // System WITHOUT timestamps/session counters
    prompt.tools,
    prompt.templates,
    prompt.history,
    prompt.query,  // Always last — most dynamic
  ];
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Remove dynamic content from system prompts that would break KV-cache.
 * Timestamps, session counters, request IDs — move these to user messages.
 */
function stripDynamicFromSystem(system: string): string {
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

// ─── Strategy 2: Observation Masking ────────────────────────────────────────

export interface MaskedObservation {
  refId: string;
  summary: string;
  originalLength: number;
  maskedLength: number;
  reduction: number; // percentage
}

// In-memory store for masked observations (replace with DB for production)
const observationStore = new Map<string, { content: string; createdAt: number }>();
let observationCounter = 0;

export function maskObservation(
  content: string,
  summary: string,
  maxAgeMs: number = 3600000
): MaskedObservation {
  // Generate stable ref ID
  const refId = `obs_${Date.now()}_${++observationCounter}`;
  
  // Store original for retrieval
  observationStore.set(refId, { content, createdAt: Date.now() });
  
  // Prune old observations
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, obs] of observationStore) {
    if (obs.createdAt < cutoff) observationStore.delete(id);
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

export function retrieveObservation(refId: string): string | null {
  return observationStore.get(refId)?.content || null;
}

/**
 * Auto-mask verbose tool outputs that are >3 turns old
 * and whose key points have been extracted.
 */
export function autoMaskToolOutputs(
  outputs: Array<{ content: string; turnAge: number; summary?: string }>,
  maskAfterTurns: number = 3,
  minLength: number = 500
): Array<{ masked: boolean; content: string | null; ref?: MaskedObservation }> {
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
function extractKeySummary(content: string): string {
  // Take first 2 sentences + key metrics
  const firstPart = content.split(/[.!?]/).slice(0, 3).join(".").trim();
  const metrics = content.match(/\d+(?:\.\d+)?(?:%|ms|GB|MB|KB| tokens)?/g);
  const metricStr = metrics ? ` Metrics: ${metrics.slice(0, 5).join(", ")}` : "";
  return (firstPart + metricStr).slice(0, 200);
}

// ─── Strategy 3: Compaction ──────────────────────────────────────────────────

export interface CompactionResult {
  originalTokens: number;
  compactedTokens: number;
  reductionPercent: number;
  summary: string;
}

export interface CompactionConfig {
  triggerThreshold: number;  // 0.7 = trigger at 70% context utilization
  targetReduction: number;   // 0.5 = target 50% reduction
  maxReduction: number;      // 0.7 = hard cap at 70% reduction
}

const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  triggerThreshold: 0.7,
  targetReduction: 0.5,
  maxReduction: 0.7,
};

/**
 * Determine if compaction should be triggered based on context utilization.
 */
export function shouldCompact(
  contextTokens: number,
  contextLimit: number = 128000,
  config: Partial<CompactionConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  return contextTokens / contextLimit > cfg.triggerThreshold;
}

/**
 * Compact a list of messages/documents into a summary.
 * Preserves: decisions, commitments, user preferences, key facts.
 * Removes: filler, boilerplate, exploratory turns, raw tool output.
 */
export async function compactContext(
  messages: Array<{ role: string; content: string }>,
  summaryModel: (text: string) => Promise<string>
): Promise<CompactionResult> {
  const originalText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const originalTokens = estimateTokens(originalText);

  // Group by type and apply different summarization strategies
  const toolOutputs = messages.filter((m) => m.role === "tool" || m.role === "assistant");
  const conversation = messages.filter(
    (m) => m.role === "user" || m.role === "system"
  );
  const decisions = extractDecisions(messages);

  // Summarize tool outputs aggressively (they dominate context)
  let toolSummary = "";
  if (toolOutputs.length > 0) {
    toolSummary = await summaryModel(
      `[TOOL OUTPUTS — ${toolOutputs.length} entries]\n` +
      toolOutputs.map((m) => m.content).join("\n")
    );
  }

  // Summarize conversation lightly
  let convSummary = "";
  if (conversation.length > 0) {
    convSummary = await summaryModel(
      conversation.map((m) => `${m.role}: ${m.content}`).join("\n")
    );
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

function extractDecisions(
  messages: Array<{ role: string; content: string }>
): string {
  // Extract decision patterns from conversation
  const decisionPatterns = [
    /(?:decided|chose|selected|agreed|concluded|determined)[:\s]/gi,
    /(?:the answer is|response:|answer:)/gi,
    /(?:final|result|outcome)[:\s]/gi,
  ];

  const decisions: string[] = [];
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

// ─── Strategy 4: Context Partitioning ─────────────────────────────────────────

export interface PartitionResult {
  partitions: Array<{
    id: string;
    content: string;
    estimatedTokens: number;
  }>;
  totalTokens: number;
  coordinatorOverhead: number;
  netSavings: number;
}

/**
 * Estimate whether partitioning would save tokens vs. coordinator overhead.
 * Break-even: typically 3+ independent subtasks.
 */
export function shouldPartition(
  totalTokens: number,
  contextLimit: number = 128000,
  subtaskCount: number = 1
): boolean {
  // Partition overhead: ~500 tokens for coordinator
  const coordinatorOverhead = 500;
  const netSavings = subtaskCount * 2000 - coordinatorOverhead; // rough estimate
  return totalTokens / contextLimit > 0.6 && subtaskCount >= 3 && netSavings > 0;
}

/**
 * Partition content into sub-agent sized chunks.
 */
export function partitionContext(
  content: string,
  partitionCount: number
): PartitionResult {
  const totalTokens = estimateTokens(content);
  const targetTokens = Math.ceil(totalTokens / partitionCount);
  const lines = content.split("\n");
  
  const partitions: PartitionResult["partitions"] = [];
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

// ─── Context Optimization Summary ─────────────────────────────────────────────

export interface OptimizationReport {
  originalTokens: number;
  finalTokens: number;
  strategies: string[];
  reductions: number[];
  timestamp: number;
}

export function generateOptimizationReport(
  before: number,
  after: number,
  strategies: string[]
): OptimizationReport {
  return {
    originalTokens: before,
    finalTokens: after,
    strategies,
    reductions: strategies.map(() => Math.round((1 - after / before) * 100)),
    timestamp: Date.now(),
  };
}
