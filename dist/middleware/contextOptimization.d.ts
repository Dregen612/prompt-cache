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
export declare function estimateTokens(text: string): number;
export declare function estimateContextUtilization(texts: string[], contextLimit?: number): number;
export interface KVCachePrompt {
    system: string;
    tools: string;
    templates: string;
    history: string;
    query: string;
}
/**
 * Reorder a prompt structure for maximum KV-cache hit rate.
 * Stable content first (prefix), dynamic content last.
 *
 * Rule: Even a single whitespace change in the prefix
 * invalidates the ENTIRE cached block downstream.
 */
export declare function orderForKVCaching(prompt: KVCachePrompt): string;
export interface MaskedObservation {
    refId: string;
    summary: string;
    originalLength: number;
    maskedLength: number;
    reduction: number;
}
export declare function maskObservation(content: string, summary: string, maxAgeMs?: number): MaskedObservation;
export declare function retrieveObservation(refId: string): string | null;
/**
 * Auto-mask verbose tool outputs that are >3 turns old
 * and whose key points have been extracted.
 */
export declare function autoMaskToolOutputs(outputs: Array<{
    content: string;
    turnAge: number;
    summary?: string;
}>, maskAfterTurns?: number, minLength?: number): Array<{
    masked: boolean;
    content: string | null;
    ref?: MaskedObservation;
}>;
export interface CompactionResult {
    originalTokens: number;
    compactedTokens: number;
    reductionPercent: number;
    summary: string;
}
export interface CompactionConfig {
    triggerThreshold: number;
    targetReduction: number;
    maxReduction: number;
}
/**
 * Determine if compaction should be triggered based on context utilization.
 */
export declare function shouldCompact(contextTokens: number, contextLimit?: number, config?: Partial<CompactionConfig>): boolean;
/**
 * Compact a list of messages/documents into a summary.
 * Preserves: decisions, commitments, user preferences, key facts.
 * Removes: filler, boilerplate, exploratory turns, raw tool output.
 */
export declare function compactContext(messages: Array<{
    role: string;
    content: string;
}>, summaryModel: (text: string) => Promise<string>): Promise<CompactionResult>;
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
export declare function shouldPartition(totalTokens: number, contextLimit?: number, subtaskCount?: number): boolean;
/**
 * Partition content into sub-agent sized chunks.
 */
export declare function partitionContext(content: string, partitionCount: number): PartitionResult;
export interface OptimizationReport {
    originalTokens: number;
    finalTokens: number;
    strategies: string[];
    reductions: number[];
    timestamp: number;
}
export declare function generateOptimizationReport(before: number, after: number, strategies: string[]): OptimizationReport;
//# sourceMappingURL=contextOptimization.d.ts.map