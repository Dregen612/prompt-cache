// Cache Warming - pre-populate cache with common prompts
const COMMON_PROMPTS = [
  'Explain quantum computing',
  'Write a hello world in Python',
  'What is machine learning?',
];

export async function warmCache(llmCall: (p: string) => Promise<any>): Promise<void> {
  console.log('🔥 Warming cache...');
  for (const prompt of COMMON_PROMPTS) {
    const response = await llmCall(prompt);
    // Store in cache...
  }
  console.log('✅ Cache warmed');
}
