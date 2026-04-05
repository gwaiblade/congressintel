const HOUSE_URL = 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/fillings.json';
const SENATE_URL = 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/data/fillings.json';
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
  // Handle MM/DD/YYYY
  const slashParts = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashParts) return new Date(parseInt(slashParts[3]), parseInt(slashParts[1]) - 1, parseInt(slashParts[2]));
  // Handle YYYY-MM-DD
  const dashParts = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dashParts) return new Date(parseInt(dashParts[1]), parseInt(dashParts[2]) - 1, parseInt(dashParts[3]));
  return null;
}

function formatDate(str) {
  const d = parseDate(str);
  if (!d || isNaN(d.getTime())) return str || '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.round(Math.abs(a - b) / (1000 * 60 * 60 * 24));
}

async function fetchTrades(days) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const trades = [];

  const [houseRes, senateRes] = await Promise.all([
    fetch(HOUSE_URL).catch(() => null),
    fetch(SENATE_URL).catch(() => null),
  ]);

  if (houseRes?.ok) {
    try {
      const data = await houseRes.json();
      for (const t of data) {
        const disc = parseDate(t.disclosure_date);
        const trans = parseDate(t.transaction_date);
        if (!disc || disc < cutoff) continue;
        if (!t.ticker || t.ticker === '--' || t.ticker === 'N/A' || t.ticker === '') continue;
        trades.push({
          member: (t.representative || '').replace(/^Hon\.\s*/i, '').trim(),
          chamber: 'House',
          state: t.district ? t.district.slice(0, 2).toUpperCase() : '',
          ticker: t.ticker.toUpperCase(),
          company: t.asset_description || '',
          type: /purchase/i.test(t.type) ? 'Buy' : 'Sell',
          amount: t.amount || '',
          transactionDate: formatDate(t.transaction_date),
          disclosureDate: formatDate(t.disclosure_date),
          daysLate: daysBetween(disc, trans),
        });
      }
    } catch (e) {
      console.error('House parse error:', e.message);
    }
  }

  if (senateRes?.ok) {
    try {
      const data = await senateRes.json();
      for (const t of data) {
        const disc = parseDate(t.disclosure_date);
        const trans = parseDate(t.transaction_date);
        if (!disc || disc < cutoff) continue;
        if (!t.ticker || t.ticker === '--' || t.ticker === 'N/A' || t.ticker === '') continue;
        trades.push({
          member: (t.senator || '').trim(),
          chamber: 'Senate',
          state: '',
          ticker: t.ticker.toUpperCase(),
          company: t.asset_description || '',
          type: /purchase/i.test(t.type) ? 'Buy' : 'Sell',
          amount: t.amount || '',
          transactionDate: formatDate(t.transaction_date),
          disclosureDate: formatDate(t.disclosure_date),
          daysLate: daysBetween(disc, trans),
        });
      }
    } catch (e) {
      console.error('Senate parse error:', e.message);
    }
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
    max_tokens: 2000,
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
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Auth check
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
