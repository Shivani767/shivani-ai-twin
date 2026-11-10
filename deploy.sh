#!/usr/bin/env bash
# Deploy Shivani AI to Vercel + Render from a machine with the Vercel CLI installed.
# The Gemini API key is NEVER stored in this file; it lives only as an environment
# variable on the Render (backend) and Vercel (frontend) deployment settings.
set -euo pipefail

if ! vercel whoami >/dev/null 2>&1; then
  echo "Run 'vercel login' first if you are not authenticated."
  vercel login
fi

# Pull server configuration from your existing Vercel project (one-time per project).
vercel pull --yes

# Production build + deploy.
vercel build
vercel deploy --prod --yes

echo
echo "Frontend is live."
echo "Set these environment variables on the Render (backend) deployment:"
echo "  GEMINI_API_KEY = your Gemini API key"
echo "  GEMINI_MODEL   = gemini-2.5-flash"
echo "  ALLOWED_ORIGINS= https://YOUR-FRONTEND.vercel.app"
echo "Then redeploy the Render backend, then re-run: vercel deploy --prod --yes"
