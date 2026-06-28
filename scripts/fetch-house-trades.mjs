// House Clerk disclosure ingestion (Phase 1 — House only).
//
// Pipeline:
//   1. Download the current + previous year FD.zip (covers the Jan boundary, C7).
//   2. Unzip and parse the XML index; select Periodic Transaction Reports (FilingType "P").
//   3. Incrementally fetch only PTR PDFs whose DocID is not already in trades.json (C8).
//   4. Extract the transaction table from each PDF, normalize to the worker's trade shape (C3/C5).
//   5. Merge with existing records, prune to the last year, write congressintel/public/trades.json.
//
// The PDF parser is deliberately best-effort: e-filed PTRs are clean text tables, but layouts
// vary (wrapped asset names, owner codes, options). Rows we cannot confidently parse are counted
// and skipped rather than guessed. Validate counts against real output after each run.
//
// No API key, no auth — all sources are public. Runs in GitHub Actions (Node 20) or locally.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const ZIP_BASE = 'https://disclosures-clerk.house.gov/public_disc/financial-pdfs';
const PTR_BASE = 'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs';
const USER_AGENT =
  'CongressIntel/1.0 (+https://github.com/gwaiblade/congressintel; House disclosure ingest)';
const THROTTLE_MS = 200; // polite delay between PDF fetches
const OUT_PATH = fileURLToPath(new URL('../congressintel/public/trades.json', import.meta.url));
const PRUNE_DAYS = 365; // keep ~1y of records; worker filters to the requested window

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MM/DD/YYYY or M/D/YYYY -> YYYY-MM-DD (also passes through YYYY-MM-DD). Returns null if unparseable.
function toIso(str) {
  if (!str) return null;
  const iso = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

function daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return 0;
  const a = new Date(isoA + 'T00:00:00Z');
  const b = new Date(isoB + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round(Math.abs(a - b) / 86_400_000);
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Returns the filing index records for one year, or [] if the zip is missing/unparseable.
function loadYearIndex(workDir, year) {
  const xmlPath = join(workDir, `${year}FD.xml`);
  if (!existsSync(xmlPath)) return [];
  const parser = new XMLParser();
  const doc = parser.parse(readFileSync(xmlPath, 'utf8'));
  const members = doc?.FinancialDisclosure?.Member;
  if (!members) return [];
  return Array.isArray(members) ? members : [members];
}

// Reconstruct visual text lines from a PDF buffer, ordered top-to-bottom, then flattened
// into a single space-joined blob (so wrapped cells / amounts don't break the row regex).
async function extractText(buf) {
  // pdfjs legacy build runs single-threaded in Node — no workerSrc needed.
  const pdf = await getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items } = await page.getTextContent();
    const rows = new Map();
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]); // group by baseline
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const text = rows
        .get(y)
        .sort((a, b) => a.x - b.x)
        .map((o) => o.s)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) lines.push(text);
    }
    page.cleanup();
  }
  await pdf.destroy();
  // Strip control chars (PDF checkbox/form glyphs surface as NUL etc.) before collapsing space.
  return lines.join(' ').replace(/[\x00-\x1F]/g, ' ').replace(/\s+/g, ' ');
}

// pdfjs linearizes the transaction table unpredictably: the asset name wraps across lines
// and the amount range splits, so the ticker can land before OR after the type/date/amount
// run. We therefore anchor on the reliable sequence and locate the ticker separately.
//
//   anchor:  <P|S|E> [ (partial) ] <txn date> <notif date> <amount-low>
//   ticker:  (<TICKER>) [<asset-type-code>]   — nearest occurrence to the anchor
const ANCHOR_RE =
  /\b([PSE])\b(?:\s*\(partial\))?\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(Over\s+\$[\d,]+|\$[\d,]+)/g;
const TICKER_RE = /\(([A-Z][A-Z0-9.\-]{0,9})\)\s*\[[A-Za-z]{1,3}\]/g;
const TYPE_MAP = { P: 'Buy', S: 'Sell' }; // E (exchange) is intentionally skipped in v1.

// House PTR amounts come from a fixed bracket set keyed by their lower bound. Capturing the
// low value is robust even when the range wraps across PDF lines; we map it to the label.
const AMOUNT_BY_LOW = new Map([
  [1, '$1 - $1,000'],
  [1001, '$1,001 - $15,000'],
  [15001, '$15,001 - $50,000'],
  [50001, '$50,001 - $100,000'],
  [100001, '$100,001 - $250,000'],
  [250001, '$250,001 - $500,000'],
  [500001, '$500,001 - $1,000,000'],
  [1000001, '$1,000,001 - $5,000,000'],
  [5000001, '$5,000,001 - $25,000,000'],
  [25000001, '$25,000,001 - $50,000,000'],
  [50000001, 'Over $50,000,000'],
]);

function canonicalAmount(raw) {
  if (/over/i.test(raw)) return 'Over $50,000,000';
  const low = parseInt(raw.replace(/[^\d]/g, ''), 10);
  return AMOUNT_BY_LOW.get(low) || raw.replace(/\s+/g, ' ').trim();
}

// Best-effort issuer name from the text just before the anchor. The AI scoring step re-derives
// the canonical company from the ticker, so this only needs to be a reasonable hint.
function cleanCompany(pre, ticker) {
  let s = pre.split(/:\s*New\b/).pop(); // drop fields trailing the previous transaction
  s = s.replace(/.*Gains\s*>\s*\$?200\??/is, ''); // drop the column header if present
  s = s
    .replace(TICKER_RE, ' ')
    .replace(/\$[\d,]+(\s*-\s*\$[\d,]+)?/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, ' ')
    .replace(/\b(SP|JT|DC|F|S|O|D|U)\b/g, ' ') // owner / single-letter column codes
    .replace(/\s+/g, ' ')
    .trim();
  return (
    s
      .split(' ')
      .filter(Boolean)
      .slice(-7)
      .join(' ')
      .replace(/^[^A-Za-z0-9]+/, '') // strip leading colons / punctuation
      .trim() || ticker
  );
}

const TICKER_MAX_DIST = 90; // chars; beyond this a ticker belongs to a different transaction

// Government / municipal bonds and treasuries carry no equity ticker. Their rows sit next to
// tickered rows in the linearized text, so without this guard a bond can borrow a neighbor's
// ticker. The "<coupon>% DUE <date>" / "Treasury Note" signatures identify them reliably.
const FIXED_INCOME_RE = /%\s*due\b|\btreasury (note|bond|bill)s?\b|\bgo bd\b|\bmuni/i;

function parseFiling(text, filing) {
  const anchors = [...text.matchAll(ANCHOR_RE)];
  const tickers = [...text.matchAll(TICKER_RE)];

  // Assign each ticker to its single nearest anchor (globally). This stops a tickerless
  // transaction (bond/treasury) from stealing a neighbor's ticker via a local search.
  const byAnchor = anchors.map(() => []);
  for (const tk of tickers) {
    let best = -1;
    let bestD = Infinity;
    anchors.forEach((an, ai) => {
      const d = Math.abs(tk.index - an.index);
      if (d < bestD) {
        bestD = d;
        best = ai;
      }
    });
    if (best >= 0) byAnchor[best].push({ sym: tk[1].toUpperCase(), d: bestD });
  }

  const rows = [];
  anchors.forEach((a, ai) => {
    const type = TYPE_MAP[a[1]];
    if (!type) return; // exchange / unknown

    const cands = byAnchor[ai].sort((x, y) => x.d - y.d);
    if (!cands.length || cands[0].d > TICKER_MAX_DIST) return; // tickerless -> skip, don't fabricate
    const ticker = cands[0].sym;
    if (!ticker || ticker === '--') return;

    const prevEnd = ai > 0 ? anchors[ai - 1].index + anchors[ai - 1][0].length : 0;
    const winStart = Math.max(prevEnd, a.index - 180);

    // Skip fixed-income rows even if an equity ticker sits nearby (don't fabricate a ticker).
    const assetText = text.slice(winStart, Math.min(text.length, a.index + a[0].length + 80));
    if (FIXED_INCOME_RE.test(assetText)) return;

    const transactionDate = toIso(a[2]);
    rows.push({
      docId: filing.docId,
      member: filing.member,
      chamber: 'House',
      party: '', // inferred downstream by the AI scoring step from the member name (C4)
      state: filing.state,
      ticker,
      company: cleanCompany(text.slice(winStart, a.index), ticker),
      type,
      amount: canonicalAmount(a[4]),
      transactionDate,
      disclosureDate: filing.disclosureDate,
      daysLate: daysBetween(filing.disclosureDate, transactionDate),
    });
  });
  return { rows, skippedNoTicker: 0 };
}

function loadExisting() {
  if (!existsSync(OUT_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function main() {
  const thisYear = new Date().getUTCFullYear();
  const years = [thisYear, thisYear - 1];

  const existing = loadExisting();
  const seenDocIds = new Set(existing.map((t) => t.docId).filter(Boolean));
  console.log(`Existing records: ${existing.length} (${seenDocIds.size} known DocIDs)`);

  const workDir = mkdtempSync(join(tmpdir(), 'house-fd-'));
  const ptrFilings = [];

  // 1–2: download + unzip each year, collect new PTR filings from the index.
  for (const year of years) {
    try {
      const zipPath = join(workDir, `${year}FD.zip`);
      writeFileSync(zipPath, await download(`${ZIP_BASE}/${year}FD.zip`));
      execFileSync('unzip', ['-o', zipPath, '-d', workDir], { stdio: 'ignore' });
      const index = loadYearIndex(workDir, year);
      const ptrs = index.filter((r) => String(r.FilingType) === 'P');
      console.log(`${year}: ${index.length} filings, ${ptrs.length} PTRs`);
      for (const r of ptrs) {
        const docId = String(r.DocID);
        if (seenDocIds.has(docId)) continue; // incremental (C8)
        ptrFilings.push({
          year,
          docId,
          member: `${r.First ?? ''} ${r.Last ?? ''}`.replace(/\s+/g, ' ').trim(),
          state: (String(r.StateDst || '').match(/^[A-Z]{2}/) || [''])[0],
          disclosureDate: toIso(r.FilingDate),
        });
      }
    } catch (e) {
      console.warn(`WARN: ${year} index failed: ${e.message}`);
    }
  }

  console.log(`New PTR filings to fetch: ${ptrFilings.length}`);

  // Optional cap for local validation runs, e.g. LIMIT=20. Unset in CI -> fetch all.
  const LIMIT = parseInt(process.env.LIMIT || '0', 10);
  const toFetch = LIMIT > 0 ? ptrFilings.slice(0, LIMIT) : ptrFilings;
  if (LIMIT > 0) console.log(`LIMIT=${LIMIT}: sampling first ${toFetch.length} of ${ptrFilings.length}`);

  // 3–4: fetch + parse each new PTR PDF.
  const fresh = [];
  let parsed = 0,
    failed = 0,
    emptyRows = 0;
  for (const filing of toFetch) {
    try {
      const buf = await download(`${PTR_BASE}/${filing.year}/${filing.docId}.pdf`);
      const text = await extractText(buf);
      const { rows } = parseFiling(text, filing);
      if (rows.length === 0) emptyRows++;
      fresh.push(...rows);
      parsed++;
    } catch (e) {
      failed++;
      console.warn(`WARN: PTR ${filing.docId} failed: ${e.message}`);
    }
    await sleep(THROTTLE_MS);
  }

  // 5: merge, prune, write.
  const cutoff = new Date(Date.now() - PRUNE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const merged = [...existing, ...fresh].filter(
    (t) => t.disclosureDate && t.disclosureDate >= cutoff
  );
  merged.sort((a, b) => (b.disclosureDate || '').localeCompare(a.disclosureDate || ''));

  rmSync(workDir, { recursive: true, force: true });
  writeFileSync(OUT_PATH, JSON.stringify(merged, null, 2) + '\n');

  console.log(
    `Done. PDFs parsed: ${parsed}, failed: ${failed}, no-extractable-rows: ${emptyRows}. ` +
      `New trades: ${fresh.length}. Total after prune: ${merged.length}. -> ${OUT_PATH}`
  );
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
