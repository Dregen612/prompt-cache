"use strict";
// Prompt DNA Service - Semantic Fingerprinting
// Extracts the "essence" of a prompt for better matching
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPromptDNA = extractPromptDNA;
exports.calculateSimilarity = calculateSimilarity;
exports.findSimilarPrompts = findSimilarPrompts;
exports.explainDNA = explainDNA;
const crypto_1 = __importDefault(require("crypto"));
// Simple word importance weights
const IMPORTANCE_WEIGHTS = {
    // High importance - core meaning
    'what': 2, 'how': 2, 'why': 2, 'when': 2, 'where': 2, 'who': 2,
    'explain': 3, 'describe': 3, 'compare': 3, 'analyze': 3, 'create': 3,
    'write': 2, 'generate': 2, 'make': 1, 'get': 1, 'find': 2,
    // Low importance - filler
    'the': 0.1, 'a': 0.1, 'an': 0.1, 'is': 0.2, 'are': 0.2,
    'to': 0.1, 'of': 0.1, 'in': 0.1, 'for': 0.1, 'with': 0.2,
    'please': 0.3, 'can': 0.2, 'could': 0.2, 'would': 0.2,
    // Action modifiers
    'quick': 2, 'fast': 2, 'short': 1.5, 'long': 1.5, 'detailed': 2,
    'simple': 1.5, 'complex': 2, 'easy': 1, 'hard': 1.5,
    // Domain indicators
    'code': 3, 'python': 3, 'javascript': 3, 'api': 3, 'function': 2.5,
    'email': 2, 'summary': 2.5, 'list': 1.5, 'table': 1.5,
};
// Extract Prompt DNA - a semantic fingerprint
function extractPromptDNA(prompt) {
    // Normalize
    const normalized = prompt.toLowerCase().trim();
    const words = normalized.split(/\s+/).filter(w => w.length > 0);
    // Extract keywords with importance
    const keywordMap = new Map();
    words.forEach(word => {
        const cleaned = word.replace(/[^a-z]/g, '');
        const weight = IMPORTANCE_WEIGHTS[cleaned] || 1;
        const current = keywordMap.get(cleaned) || 0;
        keywordMap.set(cleaned, current + weight);
    });
    // Sort by importance and take top keywords
    const keywords = Array.from(keywordMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word]) => word);
    // Calculate complexity score (0-10)
    const uniqueWords = new Set(words).size;
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
    const complexity = Math.min(10, Math.round((uniqueWords / words.length * 5) +
        (avgWordLength / 10 * 3) +
        (words.length > 50 ? 2 : words.length / 25)));
    // Detect category
    const category = detectCategory(normalized);
    // Generate DNA hash (the fingerprint)
    const dnaInput = keywords.join('|') + '|' + complexity + '|' + category;
    const dna = crypto_1.default.createHash('sha256').update(dnaInput).digest('hex').slice(0, 16);
    return {
        dna,
        keywords,
        complexity,
        category,
        length: prompt.length
    };
}
// Detect prompt category
function detectCategory(prompt) {
    const categories = {
        'code': ['code', 'function', 'class', 'api', 'python', 'javascript', 'javascript', 'sql', 'html', 'css', 'debug', 'fix', 'error'],
        'write': ['write', 'create', 'generate', 'make', 'draft', 'compose', 'produce'],
        'explain': ['explain', 'describe', 'what is', 'how does', 'tell me about', 'meaning'],
        'summarize': ['summarize', 'summary', 'shorten', 'condense', 'tldr', 'key points'],
        'list': ['list', 'give me', 'provide', 'enumerate', 'all the', 'items'],
        'compare': ['compare', 'versus', 'vs', 'difference', 'similar', 'different'],
        'analyze': ['analyze', 'analyse', 'evaluate', 'assess', 'review', 'examine'],
        'translate': ['translate', 'convert', 'translation', 'spanish', 'french', 'chinese', 'language'],
        'math': ['calculate', 'compute', 'solve', 'equation', 'math', 'number', 'formula'],
        'creative': ['story', 'poem', 'song', 'joke', 'creative', 'funny', 'imagine'],
    };
    for (const [cat, keywords] of Object.entries(categories)) {
        if (keywords.some(k => prompt.includes(k))) {
            return cat;
        }
    }
    return 'general';
}
// Compare two prompts for similarity
function calculateSimilarity(dna1, dna2) {
    // Keyword overlap (50% weight)
    const common = dna1.keywords.filter(k => dna2.keywords.includes(k));
    const keywordScore = (common.length * 2) / (dna1.keywords.length + dna2.keywords.length);
    // Category match (20% weight)
    const categoryScore = dna1.category === dna2.category ? 1 : 0;
    // Complexity similarity (30% weight)
    const complexityDiff = Math.abs(dna1.complexity - dna2.complexity);
    const complexityScore = Math.max(0, 1 - complexityDiff / 10);
    return (keywordScore * 0.5) + (categoryScore * 0.2) + (complexityScore * 0.3);
}
// Semantic search with DNA
function findSimilarPrompts(targetDNA, cachedEntries, threshold = 0.6) {
    const results = cachedEntries.map(entry => {
        const similarity = calculateSimilarity(targetDNA, entry.dna);
        return { prompt: entry.prompt, similarity };
    });
    return results
        .filter(r => r.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity);
}
// Get explanation of DNA
function explainDNA(dna) {
    const complexityLabels = ['Very Simple', 'Simple', 'Basic', 'Intermediate', 'Advanced', 'Complex', 'Very Complex', 'Expert', 'Specialized', 'Highly Specialized', 'Cutting Edge'];
    return `
🎯 Prompt DNA Analysis:
━━━━━━━━━━━━━━━━━━━━━
• Category: ${dna.category.toUpperCase()}
• Complexity: ${complexityLabels[dna.complexity]} (${dna.complexity}/10)
• Keywords: ${dna.keywords.join(', ')}
• Length: ${dna.length} chars
• DNA: ${dna.dna}
  `.trim();
}
//# sourceMappingURL=promptDNA.js.map