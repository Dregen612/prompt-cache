# PromptCache

Intelligent LLM Prompt Caching API - Reduce your LLM costs by 70-90% through intelligent caching, deduplication, and semantic search.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
npm start
```

## Features

- 🚀 **Multi-tier Caching** - PostgreSQL (with vector search), Redis, or in-memory
- 🔄 **Request Deduplication** - Prevent duplicate LLM calls
- 📊 **Analytics Dashboard** - Track hit rates and cost savings
- 🔑 **API Key Management** - Tiered access (free/pro/enterprise)
- 💳 **Stripe Integration** - Subscription billing
- 🔍 **Semantic Search** - Find similar cached prompts via pgvector
- 📦 **Batch Operations** - Cache multiple prompts at once
- 🔌 **Import/Export** - Backup and migrate cache

## API Overview

| Endpoint | Description |
|----------|-------------|
| `POST /cache` | Cache a prompt |
| `GET /cache/:prompt` | Retrieve cached response |
| `POST /cache/batch` | Batch cache multiple prompts |
| `GET /cache/batch` | Batch retrieve cached responses |
| `POST /dedupe/register` | Register in-flight LLM request |
| `POST /dedupe/complete` | Complete deduplication |
| `GET /analytics` | View usage analytics |
| `POST /keys` | Generate API key |

See [API.md](./API.md) for complete documentation.

## Environment Variables

```bash
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost/promptcache
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=sk_test_...
FRONTEND_URL=http://localhost:3000
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client    │────▶│  PromptCache │────▶│  LLM API   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌─────────┐ ┌──────────┐
        │ Postgres  │ │  Redis  │ │  Memory  │
        │ +Vector   │ │         │ │          │
        └──────────┘ └─────────┘ └──────────┘
```

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Web Framework:** Express
- **Database:** PostgreSQL with pgvector
- **Cache:** Redis (optional)
- **Payments:** Stripe

## License

MIT
