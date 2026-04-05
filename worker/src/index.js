const QUIVER_URL = 'https://api.quiverquant.com/beta/live/congresstrading';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
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

function daysBetween(a, b) {
  if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.round(Math.abs(a - b) / (1000 * 60 * 60 * 24));
}

async function fetchTrades(days) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const res = await fetch(QUIVER_URL, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) throw new Error(`Quiver API error: ${res.status}`);

  const data = await res.json();
  const trades = [];

  for (const t of data) {
    const disc = parseDate(t.ReportDate);
    const trans = parseDate(t.TransactionDate);
    if (!disc || disc < cutoff) continue;
    if (!t.Ticker || t.Ticker === '--' || t.Ticker === 'N/A') continue;

    trades.push({
      member: (t.Representative || '').trim(),
      chamber: t.House === 'Senate' ? 'Senate' : 'House',
      party: t.Party || '',
      state: '',
      ticker: t.Ticker.toUpperCase(),
      company: t.Description || t.Ticker,
      type: /purchase/i.test(t.Transaction) ? 'Buy' : 'Sell',
      amount: t.Range || '',
      transactionDate: t.TransactionDate || '',
      disclosureDate: t.ReportDate || '',
      daysLate: daysBetween(disc, trans),
    });
  }

  // Sort by disclosure date descending
  trades.sort((a, b) => {
    const da = parseDate(a.disclosureDate) || new Date(0);
    const db = parseDate(b.disclosureDate) || new Date(0);
    return db - da;
  });

  return trades.slice(0, 50);
}

async function handleAnalyze(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { system, user, model = 'gpt-4o', json_mode = false } = body;
  if (!system || !user) {
    return jsonResponse({ error: 'Missing system or user prompt' }, 400);
  }

  const payload = {
    model,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
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
    return jsonResponse({ error: `OpenAI error ${res.status}`, detail: errText }, 502);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return jsonResponse({ content });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const token = request.headers.get('X-App-Token');
    if (!token || token !== env.APP_TOKEN) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(request.url);

    if (url.pathname === '/trades' && request.method === 'GET') {
      try {
        const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10) || 30, 365);
        const trades = await fetchTrades(days);
        return jsonResponse(trades);
      } catch (e) {
        return jsonResponse({ error: 'Failed to fetch trades', detail: e.message }, 500);
      }
    }

    if (url.pathname === '/analyze' && request.method === 'POST') {
      return handleAnalyze(request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
