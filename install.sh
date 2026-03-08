#!/bin/bash
# PromptCache installer script

cd /Users/adamwallace/.openclaw/workspace/prompt-cache

echo "Installing dependencies..."
npm install

echo "Starting server..."
npm run dev &

echo "Waiting for server..."
sleep 5

echo "Testing..."
curl -s localhost:3000/health || echo "Server not responding"

echo "DONE"
