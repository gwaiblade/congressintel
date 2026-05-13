# CongressIntel — Build CLAUDE.md

Complements the global rules in `~/.claude/CLAUDE.md` — pre-flight, terminology,
cross-workspace, write safety, and behavioral sections live there.

## Header

- **Purpose** — Web app that surfaces U.S. congressional stock disclosures, scores them for insider-risk with GPT-4o-mini, and runs a 6-step deep-analysis pipeline on selected trades with GPT-4o.
- **Owner** — Personal (single operator, single shared bearer token).
- **GitHub repo** — `gwaiblade/congressintel` (public).
- **Local path** — `/Users/mujiri/Library/CloudStorage/Dropbox/+Work/AI Works/congressintel/`

## Stack

- **Frontend** — Vite 6 + React 18.3, plain JSX, no router. Single-page app.
- **Backend** — Cloudflare Worker (Node-compatible JS, `wrangler@^3`). Single file, no framework.
- **External data** — Quiver Quant (trades), Yahoo Finance v8 chart endpoint (live price for valuation step).
- **AI** — OpenAI API: `gpt-4o-mini` for risk scoring, `gpt-4o` for the 6-step pipeline.
- **Runtime** — Node 20 in GitHub Actions; CF Workers compatibility date `2024-12-01`.

## Commands

All commands assume you are in the repo root unless noted.

| Action | Command |
|---|---|
| Install (frontend) | `cd congressintel && npm install` |
| Install (worker) | `cd worker && npm install` |
| Run frontend (dev) | `cd congressintel && npm run dev` → `http://localhost:5173/congressintel/` |
| Run worker (dev) | `cd worker && npx wrangler dev` → `http://localhost:8787` |
| Build frontend | `cd congressintel && npm run build` |
| Test | No test suite. Manual smoke-tests via `curl` against the worker. |
| **Deploy frontend** | `git push` to `main` → GitHub Actions → GitHub Pages (~2 min). Live at https://gwaiblade.github.io/congressintel/ |
| **Deploy worker** | `cd worker && npx wrangler deploy`. Live at https://congressintel-api.mujiri.workers.dev |

Two deploy targets — they are independent. A frontend push does NOT redeploy the worker, and vice versa.

## Architecture

- **Entry points:**
  - Frontend: `congressintel/src/main.jsx` → `App.jsx` (the entire UI lives in `App.jsx`, ~800 lines).
  - Worker: `worker/src/index.js` (~240 lines). `export default { fetch }`. Two routes: `GET /trades`, `POST /analyze`.
- **`congressintel/`** — Vite + React frontend. `vite.config.js` sets `base: '/congressintel/'` for GitHub Pages subpath. `.env` (gitignored) holds the local-dev value for `VITE_WORKER_URL`. The access token is **not** an env var — see Secrets section.
- **`worker/`** — Cloudflare Worker. `wrangler.toml` declares the worker name `congressintel-api` and compatibility date. `.wrangler/` is local build cache (gitignored).
- **`.github/workflows/deploy.yml`** — Auto-builds the frontend with GitHub Actions secrets and publishes to Pages on every push to `main`.
- **Surprises:**
  - The worker's `/analyze` endpoint is generic (system + user + model), but it sniffs the user prompt for the step-5 (valuation) signature `^Valuation and technical snapshot for {TICKER}:` and silently injects live market data fetched from Yahoo. No API surface change — purely server-side enrichment.
  - The frontend `App.jsx` carries the 6-step pipeline (one call per step) — the worker doesn't know about steps; the contract is just "give me a chat completion."
  - Trade data is real (Quiver). State, committee, sector, and risk-score are AI-inferred at scan time — render boundary must keep this distinction clear.

## External services

- **Quiver Quant** — `https://api.quiverquant.com/beta/live/congresstrading` (no auth required for the free endpoint we use).
- **Yahoo Finance** — `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}` (unofficial, no key; requires a User-Agent header to avoid 401 from CF Workers).
- **OpenAI** — `https://api.openai.com/v1/chat/completions`.
- **Cloudflare Workers** — hosts the API at `congressintel-api.mujiri.workers.dev`.
- **GitHub Pages** — hosts the frontend at `gwaiblade.github.io/congressintel`.

## Secrets

Never paste actual values into commits, summaries, or chat.

| Secret | Lives in | How loaded |
|---|---|---|
| `OPENAI_API_KEY` | Cloudflare Worker secret | Set via `wrangler secret put OPENAI_API_KEY` or the Cloudflare dashboard. Accessed in code as `env.OPENAI_API_KEY`. |
| `APP_TOKEN` | Cloudflare Worker secret | Same path. Current value is `ci-henry-2026`. All worker requests must send `X-App-Token: <APP_TOKEN>`. |
| `VITE_WORKER_URL` | GitHub repo secret (CI) + `congressintel/.env` (local dev) | Inlined by Vite at build time. |
| Access token (what `X-App-Token` carries) | **Browser `localStorage` only** (key: `ci_app_token`) | Entered by the user in the in-app TokenGate on first visit. Never embedded in the production JS bundle. "Sign out" in the header clears it. |

`.env` and `.dev.vars` are gitignored at the repo root.

## Gotchas

- **⚠️ Dropbox CloudStorage sync race.** The workspace lives inside `~/Library/CloudStorage/Dropbox/...`. On at least one occasion (April 2026), Dropbox synced an older version of `worker/src/index.js` back over locally-edited code after the file had been deployed via `wrangler deploy`. Result: live worker had new code, local source did not, `git status` was clean — a silent regression risk. **After editing worker source, verify `git status` shows the file as modified before stepping away.** If `git status` is unexpectedly clean after edits, check `worker/.wrangler/tmp/*/index.js` for the bundled-but-newer version, and re-apply.
- **Yahoo Finance needs a User-Agent.** `query1.finance.yahoo.com` returns 401 to Cloudflare Workers without one. The worker sets `User-Agent: Mozilla/5.0 (compatible; CongressIntel/1.0)`. Don't remove it.
- **Valuation-step injection is by prompt sniffing.** The worker matches `/^Valuation and technical snapshot for ([A-Z0-9.\-]{1,10}):/` against the user prompt. If you change the frontend's step-5 prompt wording in `App.jsx`, the worker will silently stop injecting live price data. Keep them in sync, or refactor to an explicit `step`/`ticker` field in the request body.
- **Access token lives in `localStorage`, not env.** Vite is *not* given the token at build time — entering it via the TokenGate stores it under `localStorage["ci_app_token"]`. If you fork the repo or migrate to a new device, you have to enter the token again. Don't add `VITE_APP_TOKEN` back to the build env; it is intentionally absent.
- **OpenAI spending cap is still the ultimate backstop.** Set at https://platform.openai.com/settings/organization/billing.
- **Wrangler version.** Pinned at `^3`; `wrangler@4` exists but hasn't been validated against this worker. If upgrading, regression-test `/trades` and `/analyze` end-to-end.
- **Worker has no persistent state.** No KV, no D1, no Durable Objects. Watchlists, alerts, history — all would require new infra.
- **OpenAI `max_tokens` is 4000** in the worker. Large prompt blowing the response budget shows up as a truncated/JSON-parse error in the frontend. Either reduce input size or raise the cap.

## Status

**Live:**
- Frontend at https://gwaiblade.github.io/congressintel/
- Worker at https://congressintel-api.mujiri.workers.dev (version with Yahoo Finance valuation-step injection deployed 2026-04-26).
- GitHub Actions auto-deploy on push to `main`.

**Pending / next up:**
- Set OpenAI spending cap (operator action; not code).
- GitHub PAT in the local `git remote` is expired — next `git push` will need a fresh token rotated in via `git remote set-url origin https://gwaiblade:<TOKEN>@github.com/gwaiblade/congressintel.git` (with `repo` + `workflow` scopes).

**Known issues:**
- The Dropbox sync race described above is unresolved. Workaround is the verification habit; the real fix would be moving the workspace out of CloudStorage onto a non-synced disk.
- No pagination — worker caps at 50 trades per `/trades` call.

**Backlog (no commitment):**
- Filters by party / chamber / sector / score threshold.
- Watchlist (members, tickers) — needs storage.
- High-risk-trade email alerts — needs scheduler + email provider.
- PDF / CSV export of deep analysis.
- Better data source (paid Quiver tier or direct EFD scrape) for richer fields.
