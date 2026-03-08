import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const cache = new Map<string, { prompt: string; response: string; model: string; createdAt: number; ttl: number; hits: number }>();

function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { method, url } = req;
  
  // Parse path from url
  const path = url?.split('?')[0] || '/';
  
  // Handle different routes
  if (path === '/v1/cache' || path === '/cache') {
    if (method === 'GET') {
      // Get cached response
      const prompt = Array.isArray(req.query.prompt) ? req.query.prompt[0] : req.query.prompt;
      const model = Array.isArray(req.query.model) ? req.query.model[0] : req.query.model || 'default';
      
      if (!prompt) {
        return res.status(400).json({ error: 'prompt is required' });
      }
      
      const key = `${hashPrompt(prompt)}:${model}`;
      const entry = cache.get(key);
      
      if (entry && (entry.ttl === 0 || Date.now() < entry.createdAt + entry.ttl)) {
        entry.hits++;
        return res.status(200).json({ 
          cached: true, 
          response: entry.response,
          hits: entry.hits 
        });
      }
      
      return res.status(404).json({ cached: false, error: 'Not found' });
    }
    
    if (method === 'POST') {
      const { prompt, response, model = 'default', ttl = 3600000 } = req.body;
      
      if (!prompt || !response) {
        return res.status(400).json({ error: 'prompt and response required' });
      }
      
      const key = `${hashPrompt(prompt)}:${model}`;
      cache.set(key, { prompt, response, model, createdAt: Date.now(), ttl, hits: 0 });
      
      return res.status(201).json({ cached: true, key });
    }
    
    if (method === 'DELETE') {
      const prompt = Array.isArray(req.query.prompt) ? req.query.prompt[0] : req.query.prompt;
      const model = Array.isArray(req.query.model) ? req.query.model[0] : req.query.model || 'default';
      
      if (!prompt) {
        return res.status(400).json({ error: 'prompt is required' });
      }
      
      const key = `${hashPrompt(prompt)}:${model}`;
      cache.delete(key);
      
      return res.status(200).json({ deleted: true });
    }
  }
  
  if (path === '/v1/stats' || path === '/stats') {
    return res.status(200).json({ 
      totalEntries: cache.size,
      entries: Array.from(cache.entries()).map(([k, v]) => ({ key: k, hits: v.hits, createdAt: v.createdAt }))
    });
  }
  
  if (path === '/v1/clear' || path === '/clear') {
    cache.clear();
    return res.status(200).json({ cleared: true });
  }
  
  // Health check
  if (path === '/health' || path === '/') {
    return res.status(200).json({ status: 'ok', cacheSize: cache.size });
  }
  
  return res.status(404).json({ error: 'Not found' });
}
