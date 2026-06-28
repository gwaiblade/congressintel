// House trades are produced by the manually-triggered GitHub Action (.github/workflows/fetch-trades.yml)
// and served as a static file from GitHub Pages. No auth needed on this GET — it's public data.
const TRADES_JSON_URL = 'https://gwaiblade.github.io/congressintel/trades.json';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

const ALLOWED_ORIGINS = [
  'https://gwaiblade.github.io',
  'http://localhost:5173',
];

const ALLOWED_MODELS = ['gpt-4o-mini', 'gpt-4o'];

// Step 5 (valuation) prompts from the frontend always start with this signature.
// Matching here lets us inject live price data without touching the API contract.
const VALUATION_STEP_RE = /^Valuation and technical snapshot for ([A-Z0-9.\-]{1,10}):/;

function corsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

function parseDate(str) {
  if (!str) return null;
  const dashParts = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dashParts) return new Date(parseInt(dashParts[1]), parseInt(dashParts[2]) - 1, parseInt(dashParts[3]));
  const slashParts = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashParts) return new Date(parseInt(slashParts[3]), parseInt(slashParts[1]) - 1, parseInt(slashParts[2]));
  return null;
}

async function fetchTrades(days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Pull the pre-parsed static feed. Edge-cache for 5 min: it only changes once daily.
  const res = await fetch(TRADES_JSON_URL, {
    headers: { 'Accept': 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`trades.json fetch error: ${res.status}`);

  const all = await res.json();
  if (!Array.isArray(all)) throw new Error('trades.json malformed');

  // Records arrive already normalized (member, chamber, party, state, ticker, company,
  // type, amount, transactionDate, disclosureDate, daysLate). Filter by disclosure window.
  const trades = all.filter((t) => {
    const disc = parseDate(t.disclosureDate);
    return disc && disc >= cutoff && t.ticker && t.ticker !== '--';
  });

  trades.sort((a, b) => {
    const da = parseDate(a.disclosureDate) || new Date(0);
    const db = parseDate(b.disclosureDate) || new Date(0);
    return db - da;
  });

  return trades.slice(0, 50);
}

async function fetchLivePrice(ticker) {
  try {
    const res = await fetch(
      `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
      {
        headers: {
          Accept: 'application/json',
          // Yahoo's edge sometimes 401s unidentified clients from CF Workers.
          'User-Agent': 'Mozilla/5.0 (compatible; CongressIntel/1.0)',
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;

    const price = meta.regularMarketPrice;
    const prevClose =
      typeof meta.chartPreviousClose === 'number'
        ? meta.chartPreviousClose
        : meta.previousClose;
    const pctChange =
      typeof prevClose === 'number' && prevClose !== 0
        ? ((price - prevClose) / prevClose) * 100
        : null;

    return {
      price,
      prevClose: typeof prevClose === 'number' ? prevClose : null,
      pctChange,
      high52: typeof meta.fiftyTwoWeekHigh === 'number' ? meta.fiftyTwoWeekHigh : null,
      low52: typeof meta.fiftyTwoWeekLow === 'number' ? meta.fiftyTwoWeekLow : null,
      currency: meta.currency || 'USD',
    };
  } catch {
    return null;
  }
}

function formatLiveDataBlock(p) {
  const num = (n) => (typeof n === 'number' && isFinite(n) ? n.toFixed(2) : 'n/a');
  const pct = (n) =>
    typeof n === 'number' && isFinite(n)
      ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
      : 'n/a';
  return [
    'LIVE MARKET DATA (as of today):',
    `Current price: $${num(p.price)}`,
    `Previous close: $${num(p.prevClose)}`,
    `Change today: ${pct(p.pctChange)}`,
    `52-week range: $${num(p.low52)} – $${num(p.high52)}`,
    '',
    'Use these exact figures in your analysis. Do not estimate or invent price data.',
    '',
    '---',
    '',
  ].join('\n');
}

async function handleAnalyze(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request);
  }

  const { system, user, model = 'gpt-4o', json_mode = false } = body;
  if (!system || !user) {
    return jsonResponse({ error: 'Missing system or user prompt' }, 400, request);
  }
  if (!ALLOWED_MODELS.includes(model)) {
    return jsonResponse({ error: 'Invalid model' }, 400, request);
  }

  // Step 5 only: inject live market data so GPT isn't guessing prices.
  // Detection is by prompt signature; failures fall through silently.
  let userContent = user;
  const valuationMatch =
    typeof user === 'string' ? user.match(VALUATION_STEP_RE) : null;
  if (valuationMatch) {
    const ticker = valuationMatch[1];
    const live = await fetchLivePrice(ticker);
    if (live) {
      userContent = formatLiveDataBlock(live) + user;
    }
  }

  const payload = {
    model,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  };

  if (json_mode) {
    payload.response_format = { type: 'json_object' };
  }

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    return jsonResponse({ error: `OpenAI error ${res.status}`, detail: errText }, 502, request);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return jsonResponse({ content }, 200, request);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const token = request.headers.get('X-App-Token');
    if (!token || token !== env.APP_TOKEN) {
      return jsonResponse({ error: 'Unauthorized' }, 401, request);
    }

    const url = new URL(request.url);

    if (url.pathname === '/trades' && request.method === 'GET') {
      try {
        const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10) || 30, 365);
        const trades = await fetchTrades(days);
        return jsonResponse(trades, 200, request);
      } catch {
        // Static feed unreachable/malformed — surface as an outage, not "no trades" (C6).
        return jsonResponse({ error: 'data unavailable' }, 503, request);
      }
    }

    if (url.pathname === '/analyze' && request.method === 'POST') {
      return handleAnalyze(request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404, request);
  },
};
