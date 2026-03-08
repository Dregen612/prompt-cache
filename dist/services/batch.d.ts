export declare function batchCache(requests: Array<{
    prompt: string;
    response: string;
}>): Promise<void>;
export declare function batchGet(prompts: string[]): Promise<Array<{
    prompt: string;
    cached: boolean;
}>>;
//# sourceMappingURL=batch.d.ts.map