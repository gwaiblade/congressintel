# CongressIntel

U.S. Congressional Trading Intelligence System. Two-tier AI pipeline that scores congressional stock disclosures for insider risk potential.

## Architecture

```
congressintel/   Vite + React frontend (deployed to GitHub Pages)
worker/          Cloudflare Worker backend (proxies OpenAI, fetches trade data)
.github/         GitHub Actions auto-deploy on push to main
```

## Environment Variables

### Cloudflare Worker (set in dashboard or via Wrangler CLI)

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Your OpenAI API key (from platform.openai.com) |
| `APP_TOKEN` | Shared secret for frontend-to-worker auth (pick any string, e.g. `ci-henry-2026`) |

Set via dashboard: **Cloudflare Dashboard > Workers & Pages > congressintel-api > Settings > Variables and Secrets**

Or via CLI:
```bash
cd worker
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_TOKEN
```

### Frontend (local `.env` file in `congressintel/`)

Create `congressintel/.env`:
```
VITE_APP_TOKEN=ci-henry-2026
VITE_WORKER_URL=http://localhost:8787
```

For production, set the same values as **GitHub repo secrets** (Settings > Secrets and variables > Actions):
- `VITE_APP_TOKEN` — same value as `APP_TOKEN` in Cloudflare
- `VITE_WORKER_URL` — your deployed worker URL (e.g. `https://congressintel-api.your-subdomain.workers.dev`)

### GitHub Pages

Go to **repo Settings > Pages > Source** and set to **GitHub Actions**.

## Setup

### 1. Deploy the Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

Note the deployed URL (e.g. `https://congressintel-api.your-subdomain.workers.dev`). Add env vars in Cloudflare dashboard.

### 2. Local Development

Terminal 1 — Worker:
```bash
cd worker
npm install
# Create worker/.dev.vars with your secrets for local dev:
# OPENAI_API_KEY=sk-...
# APP_TOKEN=ci-henry-2026
npm run dev
```

Terminal 2 — Frontend:
```bash
cd congressintel
npm install
npm run dev
```

### 3. Deploy Frontend

Push to `main` and GitHub Actions auto-deploys to GitHub Pages. Make sure you've:
1. Set `VITE_WORKER_URL` and `VITE_APP_TOKEN` as GitHub repo secrets
2. Enabled GitHub Pages with source set to "GitHub Actions"

## How It Works

**Quick Scan** — Fetches real congressional stock disclosures from House and Senate Stock Watcher feeds, then scores each trade with GPT-4o-mini for insider risk signals.

**Deep Analysis** — Six-step pipeline (GPT-4o) for selected trades: committee roles, legislative influence, trade sizing, news context, valuation snapshot, and retail action guidance.

## Disclaimer

Educational use only. Not financial advice. Not affiliated with any U.S. government body.
