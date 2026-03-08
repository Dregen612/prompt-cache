// Batch Operations
export async function batchCache(requests: Array<{prompt: string, response: string}>): Promise<void> {
  for (const req of requests) {
    // Cache each...
  }
}

export async function batchGet(prompts: string[]): Promise<Array<{prompt: string, cached: boolean}>> {
  return prompts.map(p => ({ prompt: p, cached: false }));
}
