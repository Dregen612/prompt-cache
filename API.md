# PromptCache API

Production-ready intelligent LLM prompt caching API that reduces costs by 70-90% through intelligent caching, deduplication, and semantic search.

## Base URL
```
http://localhost:3000
```

## Authentication

All endpoints (except `/health`, `/`, `/dashboard`, `/analytics`) support optional API key authentication via the `X-API-Key` header:

```bash
curl -H "X-API-Key: pc_free_sk_yourkey" https://api.promptcache.com/cache
```

Generate keys via `POST /keys`.

## Endpoints

### Health & Status

#### GET /health
Returns service health and cache backend status.

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-18T02:00:00.000Z",
  "cache": {
    "backend": "pg",
    "pgEntries": 150,
    "redisEntries": 0,
    "memoryEntries": 0
  }
}
```

#### GET /stats
Get cache statistics.

```bash
curl http://localhost:3000/stats
```

---

### Cache Operations

#### POST /cache
Cache a prompt response.

```bash
curl -X POST http://localhost:3000/cache \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a haiku about coding",
    "response": "Code flows like streams,\nLogic weaves through silicon minds,\nPrograms come alive.",
    "model": "gpt-4",
    "ttl": 3600000
  }'
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| prompt | string | Yes | The prompt to cache |
| response | string | Yes | The LLM response to cache |
| model | string | No | Model identifier (default: gpt-4) |
| ttl | number | No | Time to live in ms (default: 3600000 = 1hr) |

**Response:**
```json
{
  "success": true,
  "key": "a1b2c3d4e5f6",
  "backend": "pg"
}
```

---

#### GET /cache/:prompt
Retrieve a cached response. Automatically falls back to semantic search if exact match not found.

```bash
curl "http://localhost:3000/cache/Write%20a%20haiku%20about%20coding"
```

**Response (cache hit):**
```json
{
  "cached": true,
  "response": "Code flows like streams,\nLogic weaves through silicon minds,\nPrograms come alive.",
  "model": "gpt-4",
  "hits": 5,
  "age": 300000,
  "backend": "pg"
}
```

**Response (cache miss):**
```json
{
  "cached": false
}
```

---

#### DELETE /cache/:prompt
Delete a specific cached entry.

```bash
curl -X DELETE "http://localhost:3000/cache/Write%20a%20haiku%20about%20coding"
```

**Response:**
```json
{
  "success": true,
  "key": "a1b2c3d4e5f6"
}
```

---

#### PATCH /cache/:prompt
Update TTL on existing cache entry without re-caching.

```bash
curl -X PATCH "http://localhost:3000/cache/Write%20a%20haiku%20about%20coding" \
  -H "Content-Type: application/json" \
  -d '{"ttl": 7200000}'
```

**Response:**
```json
{
  "success": true,
  "key": "a1b2c3d4e5f6",
  "newTtl": 7200000
}
```

---

### Batch Operations

#### POST /cache/batch
Cache multiple prompts at once (max 100).

```bash
curl -X POST http://localhost:3000/cache/batch \
  -H "Content-Type: application/json" \
  -d '{
    "entries": [
      {"prompt": "Prompt 1", "response": "Response 1", "model": "gpt-4"},
      {"prompt": "Prompt 2", "response": "Response 2", "model": "gpt-4"}
    ],
    "ttl": 3600000
  }'
```

---

#### GET /cache/batch
Retrieve multiple cached responses at once.

```bash
curl "http://localhost:3000/cache/batch?prompts=Prompt%201,Prompt%202"
```

**Response:**
```json
{
  "total": 2,
  "hits": 2,
  "misses": 0,
  "results": [
    {"prompt": "Prompt 1", "cached": true, "response": "Response 1", "model": "gpt-4", "hits": 1},
    {"prompt": "Prompt 2", "cached": true, "response": "Response 2", "model": "gpt-4", "hits": 1}
  ],
  "backend": "pg"
}
```

---

### Cache Management

#### POST /cache/cleanup
Trigger manual cleanup of expired entries.

```bash
curl -X POST http://localhost:3000/cache/cleanup
```

---

#### DELETE /cache
Clear all cache entries.

```bash
curl -X DELETE http://localhost:3000/cache
```

---

#### DELETE /cache/model/:model
Clear cache entries for a specific model.

```bash
curl -X DELETE http://localhost:3000/cache/model/gpt-4
```

---

#### GET /cache/keys
List all cache keys (paginated).

```bash
curl "http://localhost:3000/cache/keys?limit=10&offset=0"
```

---

#### GET /cache/stats/by-model
Get cache statistics grouped by model.

```bash
curl http://localhost:3000/cache/stats/by-model
```

---

### Search

#### GET /cache/search
Prefix search for autocomplete-style queries.

```bash
curl "http://localhost:3000/cache/search?prefix=Write&limit=10"
```

---

#### GET /cache/similar/:prompt
Find semantically similar cached prompts. Useful for prompt clustering, cache exploration, and pre-checking if a new prompt might overlap with existing cache entries.

```bash
curl "http://localhost:3000/cache/similar/Write%20a%20poem%20about%20programming?limit=5"
```

**Response:**
```json
{
  "prompt": "Write a poem about programming",
  "similar": [
    {
      "prompt": "Write a short poem about computers",
      "response": "Machines that think and learn...",
      "model": "gpt-4",
      "similarity": 0.73,
      "hits": 0,
      "age": 3693
    }
  ],
  "count": 1,
  "backend": "pg"
}
```

| Field | Type | Description |
|-------|------|-------------|
| similarity | number | Cosine similarity 0–1 (higher = more similar) |
| limit | number | Max results, default 5, max 20 |

**Note:** Requires PostgreSQL with vector support. Read-only operation (does not increment hit counts).

---

#### PUT /cache/refresh
Extend TTL of existing cache entry.

```bash
curl -X PUT http://localhost:3000/cache/refresh \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Write a haiku", "ttl": 7200000}'
```

---

### Import/Export

#### GET /cache/export
Export all cache entries (for backup/migration).

```bash
curl "http://localhost:3000/cache/export?format=json"
# Or CSV
curl "http://localhost:3000/cache/export?format=csv" -o backup.csv
```

---

#### POST /cache/import
Import cache entries.

```bash
curl -X POST http://localhost:3000/cache/import \
  -H "Content-Type: application/json" \
  -d '{
    "entries": [
      {"prompt": "p1", "response": "r1", "model": "gpt-4", "ttl": 3600000}
    ],
    "mode": "merge"
  }'
```

`mode`: "merge" (add to existing) or "replace" (clear and replace)

---

### Cache Warming

#### POST /cache/warm
Pre-populate cache with prompts using an LLM.

```bash
curl -X POST http://localhost:3000/cache/warm \
  -H "Content-Type: application/json" \
  -d '{
    "prompts": [
      {"prompt": "Common prompt 1", "response": "Expected response 1"},
      {"prompt": "Common prompt 2", "response": "Expected response 2"}
    ],
    "model": "gpt-4",
    "ttl": 86400000
  }'
```

Requires `LLM_WARM_ENDPOINT` and `LLM_WARM_KEY` env vars to auto-generate responses.

---

### Request Deduplication

Prevents duplicate LLM calls when multiple requests come in simultaneously.

#### POST /dedupe/register
Register an in-flight LLM request.

```bash
curl -X POST http://localhost:3000/dedupe/register \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Your prompt here"}'
```

**Response (proceed with LLM call):**
```json
{
  "inFlight": true,
  "proceed": true,
  "key": "abc123",
  "message": "Make your LLM call, then POST to /dedupe/complete"
}
```

**Response (use cached result):**
```json
{
  "cached": true,
  "response": "...",
  "model": "gpt-4",
  "backend": "dedupe"
}
```

---

#### POST /dedupe/complete
Complete deduplication after LLM responds.

```bash
curl -X POST http://localhost:3000/dedupe/complete \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Your prompt here",
    "response": "LLM response here",
    "model": "gpt-4",
    "ttl": 3600000
  }'
```

---

#### GET /dedupe/status
Check if a request is in-flight.

```bash
curl "http://localhost:3000/dedupe/status?prompt=Your%20prompt"
```

---

### API Key Management

#### POST /keys
Generate a new API key.

```bash
curl -X POST http://localhost:3000/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "tier": "pro"}'
```

**Tiers:** `free`, `pro`, `enterprise`

---

#### GET /keys
List all API keys.

```bash
curl http://localhost:3000/keys
```

---

#### GET /keys/:keyId
Get specific API key details.

```bash
curl http://localhost:3000/keys/key_id_here
```

---

#### DELETE /keys/:keyId
Revoke an API key.

```bash curl -X DELETE http://localhost:3000/keys/key_id_here
```

---

### Usage & Analytics

#### GET /usage/:apiKey
Get usage statistics for an API key.

```bash
curl http://localhost:3000/usage/pc_free_sk_yourkey
```

---

#### GET /analytics
Get detailed analytics.

```bash
curl "http://localhost:3000/analytics?period=24h"
```

**Periods:** `1h`, `24h`, `7d`, `30d`

---

### Subscription (Stripe)

#### POST /checkout
Create Stripe checkout session.

```bash
curl -X POST http://localhost:3000/checkout \
  -H "Content-Type: application/json" \
  -d '{"tier": "pro", "email": "user@example.com"}'
```

---

#### GET /subscription/:apiKey
Get subscription status.

```bash
curl http://localhost:3000/subscription/pc_free_sk_yourkey
```

---

### Static Pages

| Endpoint | Description |
|----------|-------------|
| GET / | Landing page |
| GET /dashboard | Dashboard |
| GET /analytics | Analytics dashboard |

---

## Rate Limits

- `/cache` POST: 100 req/min
- `/cache` GET: 200 req/min
- Authenticated: Based on tier (free: 1000/day, pro: 100000/day, enterprise: unlimited)

Rate limit headers included in responses:
- `RateLimit-Limit`
- `RateLimit-Remaining`
- `Cache-Hits`
- `Cache-Misses`

---

## Cache Backends

Priority order:
1. **PostgreSQL** (with pgvector) - Persistent, supports semantic search
2. **Redis** - Fast in-memory
3. **Memory** - Fallback

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| PORT | Server port (default: 3000) |
| DATABASE_URL | PostgreSQL connection string |
| REDIS_URL | Redis connection string |
| STRIPE_SECRET_KEY | Stripe API key |
| FRONTEND_URL | Frontend URL for redirects |
| LLM_WARM_ENDPOINT | Endpoint for cache warming |
| LLM_WARM_KEY | API key for cache warming |

---

## Cost Savings Example

Without cache: 10,000 GPT-4 calls @ $0.03/1k = $300/month

With 80% cache hit rate: 2,000 GPT-4 calls + 8,000 cache hits = $60/month

**Savings: 80%**
