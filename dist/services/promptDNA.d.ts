export declare function extractPromptDNA(prompt: string): {
    dna: string;
    keywords: string[];
    complexity: number;
    category: string;
    length: number;
};
export declare function calculateSimilarity(dna1: {
    keywords: string[];
    complexity: number;
    category: string;
}, dna2: {
    keywords: string[];
    complexity: number;
    category: string;
}): number;
export declare function findSimilarPrompts(targetDNA: ReturnType<typeof extractPromptDNA>, cachedEntries: Array<{
    prompt: string;
    dna: ReturnType<typeof extractPromptDNA>;
}>, threshold?: number): Array<{
    prompt: string;
    similarity: number;
}>;
export declare function explainDNA(dna: ReturnType<typeof extractPromptDNA>): string;
//# sourceMappingURL=promptDNA.d.ts.map