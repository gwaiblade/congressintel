# CongressIntel

U.S. Congressional Trading Intelligence System. Two-tier AI pipeline that scores congressional stock disclosures for insider-risk potential. Trade data comes from [Quiver Quant](https://api.quiverquant.com/). Live valuation data on the deep-analysis pipeline comes from Yahoo Finance.

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
VITE_WORKER_URL=http://localhost:8787
```

For production, set the same value as a **GitHub repo secret** (Settings > Secrets and variables > Actions):
- `VITE_WORKER_URL` — your deployed worker URL (e.g. `https://congressintel-api.your-subdomain.workers.dev`)

**Access token:** Not an env var anymore. On first visit, the app prompts for the token (the same string as `APP_TOKEN` on the Worker) and stores it in `localStorage`. It is never embedded in the production JS bundle. Click "Sign out" in the header to clear it from this browser.

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
1. Set `VITE_WORKER_URL` as a GitHub repo secret
2. Enabled GitHub Pages with source set to "GitHub Actions"

If you previously had a `VITE_APP_TOKEN` repo secret, you can delete it — the build no longer reads it. The access token now lives only in users' browsers (`localStorage`), not in the production bundle.

## How It Works

**Quick Scan** — Fetches real congressional stock disclosures from Quiver Quant's `live/congresstrading` feed, then scores each trade with GPT-4o-mini for insider risk signals. Real fields (member, ticker, amount, dates, party, chamber) come from Quiver. State, committee, sector, and risk score are AI-inferred.

**Deep Analysis** — Six-step pipeline (GPT-4o) for selected trades: committee roles, legislative influence, trade sizing, news context, valuation snapshot, and retail action guidance. The valuation step is augmented server-side with live market data (current price, % change today, 52-week range) from Yahoo Finance — GPT does not invent prices.

## Disclaimer

Educational use only. Not financial advice. Not affiliated with any U.S. government body.
