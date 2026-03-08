# PromptCache API

## Endpoints

### POST /cache
Cache a prompt response.

```json
{
  "prompt": "your prompt",
  "response": "cached response", 
  "model": "gpt-4",
  "ttl": 3600000
}
```

### GET /cache/:prompt
Get cached response.

### POST /checkout
Create Stripe checkout.

### GET /analytics
Get usage analytics.
