import { useState, useEffect } from "react";

const WORKER_URL = import.meta.env.VITE_WORKER_URL || "http://localhost:8787";

/* -- ACCESS TOKEN -----------------------------------------
 * Stored in localStorage, never embedded in the build. User enters it
 * through the TokenGate on first visit and on any 401 from the worker.
 * ---------------------------------------------------------- */
const TOKEN_KEY = "ci_app_token";

function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

class UnauthorizedError extends Error {
  constructor(msg) { super(msg); this.name = "UnauthorizedError"; }
}

/* -- THEME ------------------------------------------------- */
const T = {
  bg:       "#f4f6f9",
  surface:  "#ffffff",
  surface2: "#edf0f5",
  border:   "#d8dde6",
  borderHi: "#b8c0cc",
  navy:     "#1e3560",
  navyMid:  "#2a4a80",
  navyFaint:"#eef1f8",
  text:     "#1a2535",
  text2:    "#4a5a6e",
  text3:    "#8a98a8",
  green:    "#0a7a45",
  greenBg:  "#e8f7f0",
  red:      "#c0302a",
  redBg:    "#fdf0ef",
  orange:   "#c8620a",
  orangeBg: "#fdf4e8",
  amber:    "#c8960a",
  amberBg:  "#fdf8e8",
};

const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const FONT_MONO = "'Courier New', Courier, monospace";
const FONT_SERIF = "Georgia, 'Times New Roman', serif";

/* -- API (via Cloudflare Worker) --------------------------- */
async function workerFetch(path, options = {}) {
  const token = getStoredToken();
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-App-Token": token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    setStoredToken(""); // clear bad token; gate will re-prompt
    throw new UnauthorizedError("Access token invalid or missing.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function fetchTrades(days = 30) {
  return workerFetch(`/trades?days=${days}`);
}

async function callAnalyze(system, user, model = "gpt-4o", jsonMode = false) {
  const data = await workerFetch("/analyze", {
    method: "POST",
    body: JSON.stringify({ system, user, model, json_mode: jsonMode }),
  });
  return data.content || "";
}

function parseJSON(text) {
  try {
    const clean = text.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(clean.slice(clean.search(/[\[{]/)));
  } catch {
    const m = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("JSON parse failed");
  }
}

/* -- HELPERS ----------------------------------------------- */
function scoreColor(s) {
  if (s >= 7.5) return T.red;
  if (s >= 5.5) return T.orange;
  if (s >= 3.5) return T.amber;
  return T.text3;
}
function scoreBg(s) {
  if (s >= 7.5) return T.redBg;
  if (s >= 5.5) return T.orangeBg;
  if (s >= 3.5) return T.amberBg;
  return T.surface2;
}
function scoreLabel(s) {
  if (s >= 8) return "HIGH ALERT";
  if (s >= 6) return "ELEVATED";
  if (s >= 4) return "MODERATE";
  return "LOW";
}
function partyColor(p) { return p === "R" ? "#c0302a" : "#2a6ab0"; }
function partyBg(p)    { return p === "R" ? "#fdf0ef" : "#eef4fc"; }

const STEPS = [
  { id:1, key:"roles",     label:"Committee Roles" },
  { id:2, key:"influence", label:"Legislative Influence" },
  { id:3, key:"sizing",    label:"Trade Sizing & Pattern" },
  { id:4, key:"news",      label:"News Context" },
  { id:5, key:"valuation", label:"Valuation Snapshot" },
  { id:6, key:"verdict",   label:"Verdict & Action" },
];

/* -- TOKEN GATE -------------------------------------------- */
function TokenGate({ onSubmit, error }) {
  const [value, setValue] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const v = value.trim();
    if (v) onSubmit(v);
  };
  return (
    <div style={{ background:T.bg, minHeight:"100vh",
      fontFamily:FONT_BODY, color:T.text, display:"flex",
      alignItems:"center", justifyContent:"center", padding:"20px" }}>
      <form onSubmit={submit}
        style={{ background:T.surface, border:`1px solid ${T.border}`,
          borderTop:`3px solid ${T.navy}`, borderRadius:"4px",
          padding:"36px", maxWidth:"460px", width:"100%" }}>
        <div style={{ fontFamily:FONT_SERIF, fontSize:"22px", color:T.navy,
          marginBottom:"12px", fontWeight:"bold" }}>
          CongressIntel
        </div>
        <div style={{ fontSize:"14px", color:T.text2, lineHeight:"1.6",
          marginBottom:"24px" }}>
          Enter your access token to continue. Stored locally in this browser
          only — never sent anywhere except this app's worker.
        </div>
        <input type="password" value={value} autoFocus
          onChange={(e) => setValue(e.target.value)}
          placeholder="Access token"
          style={{ width:"100%", padding:"12px 14px", fontSize:"14px",
            fontFamily:FONT_MONO, border:`1px solid ${T.border}`,
            borderRadius:"4px", boxSizing:"border-box",
            background:T.surface2, color:T.text }}/>
        {error && (
          <div style={{ marginTop:"14px", background:T.redBg,
            border:`1px solid ${T.red}`, borderRadius:"4px",
            padding:"10px 14px", fontSize:"13px", color:T.red }}>
            {error}
          </div>
        )}
        <button type="submit" disabled={!value.trim()}
          style={{ marginTop:"20px", width:"100%", background:T.navy,
            border:"none", color:"#fff", padding:"12px 28px", fontSize:"14px",
            fontWeight:"600", borderRadius:"4px",
            cursor: value.trim() ? "pointer" : "not-allowed",
            opacity: value.trim() ? 1 : 0.5,
            fontFamily:FONT_BODY, letterSpacing:"0.02em" }}>
          Unlock
        </button>
        <div style={{ marginTop:"18px", fontSize:"12px", color:T.text3,
          lineHeight:"1.5" }}>
          Don't have a token? This app is single-user. Contact the operator.
        </div>
      </form>
    </div>
  );
}

/* -- IDLE -------------------------------------------------- */
function IdleScreen({ onScan, error }) {
  return (
    <div>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`,
        borderTop:`3px solid ${T.navy}`, borderRadius:"4px",
        padding:"40px 36px", marginBottom:"20px" }}>
        <div style={{ fontFamily:FONT_SERIF, fontSize:"22px", color:T.navy,
          marginBottom:"16px", fontWeight:"bold" }}>
          System Ready
        </div>
        <div style={{ fontSize:"15px", color:T.text2, lineHeight:"1.8", maxWidth:"640px" }}>
          CongressIntel monitors U.S. congressional stock disclosures and runs a
          two-tier intelligence pipeline to surface trades with elevated insider risk.
        </div>
        <div style={{ marginTop:"24px", display:"flex", flexDirection:"column", gap:"12px" }}>
          {[
            ["Tier 1 — Quick Scan", "Scores all recent disclosures across committee relevance, trade size, timing, and late-filing delay."],
            ["Tier 2 — Deep Analysis", "Six-step pipeline: committee roles, legislative influence, trade patterns, news context, valuation, and retail action guidance."],
          ].map(([title, desc]) => (
            <div key={title} style={{ display:"flex", gap:"14px", padding:"14px 16px",
              background:T.navyFaint, borderRadius:"4px", border:`1px solid ${T.border}` }}>
              <div style={{ width:"8px", height:"8px", borderRadius:"50%",
                background:T.navy, flexShrink:0, marginTop:"6px" }}/>
              <div>
                <div style={{ fontSize:"14px", fontWeight:"600", color:T.navy, marginBottom:"4px" }}>
                  {title}
                </div>
                <div style={{ fontSize:"14px", color:T.text2 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop:"32px" }}>
          <button onClick={onScan}
            style={{ background:T.navy, border:"none", color:"#fff",
              padding:"14px 36px", fontSize:"15px", fontWeight:"600",
              borderRadius:"4px", cursor:"pointer", fontFamily:FONT_BODY,
              letterSpacing:"0.02em", minWidth:"180px" }}>
            Run Quick Scan
          </button>
        </div>
      </div>
      {error && (
        <div style={{ background:T.redBg, border:`1px solid ${T.red}`,
          borderRadius:"4px", padding:"14px 18px", fontSize:"14px", color:T.red }}>
          Error: {error}
        </div>
      )}
      <div style={{ fontSize:"12px", color:T.text3, lineHeight:"1.7" }}>
        Educational use only · Real STOCK Act disclosure data · Not financial advice
      </div>
    </div>
  );
}

/* -- SCANNING ---------------------------------------------- */
function ScanningScreen() {
  const [lines, setLines] = useState(["Initializing intelligence protocol..."]);
  const [dots, setDots] = useState(0);
  const MSGS = [
    "Connecting to disclosure feeds...",
    "Parsing House filings (STOCK Act)...",
    "Parsing Senate filings...",
    "Resolving committee assignments...",
    "Correlating sector exposure...",
    "Running insider risk model...",
    "Finalizing quick scan report...",
  ];
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => { if (i < MSGS.length) setLines((l) => [...l, MSGS[i++]]); }, 700);
    const d = setInterval(() => setDots((x) => (x+1)%4), 380);
    return () => { clearInterval(t); clearInterval(d); };
  }, []);
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`,
      borderTop:`3px solid ${T.navy}`, borderRadius:"4px",
      padding:"36px", minHeight:"280px" }}>
      <div style={{ fontSize:"13px", fontWeight:"600", color:T.navy,
        letterSpacing:"0.12em", marginBottom:"24px", fontFamily:FONT_MONO }}>
        SCANNING{".".repeat(dots)}
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize:"14px",
          color: i===lines.length-1 ? T.navy : T.text2,
          marginBottom:"10px", paddingLeft:"16px",
          borderLeft:`3px solid ${i===lines.length-1 ? T.navy : T.border}`,
          fontWeight: i===lines.length-1 ? "500" : "400" }}>
          {i < lines.length-1 ? `\u2713  ${l}` : `\u2192  ${l}`}
        </div>
      ))}
    </div>
  );
}

/* -- TRADE CARD (mobile) ----------------------------------- */
function TradeCard({ trade, isSelected, onToggle }) {
  const sc = scoreColor(trade.score);
  const sb = scoreBg(trade.score);
  return (
    <div onClick={onToggle}
      style={{ background: isSelected ? T.navyFaint : T.surface,
        border: `1px solid ${isSelected ? T.navy : T.border}`,
        borderLeft: `4px solid ${sc}`,
        borderRadius:"4px", padding:"16px", cursor:"pointer",
        transition:"all 0.15s" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap", marginBottom:"6px" }}>
            <span style={{ fontSize:"16px", fontWeight:"700",
              fontFamily:FONT_MONO, color:T.navy }}>{trade.ticker}</span>
            <span style={{ fontSize:"13px", color:T.text2 }}>{trade.company}</span>
          </div>
          <div style={{ fontSize:"14px", fontWeight:"600", color:T.text, marginBottom:"8px" }}>
            {trade.member}
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"8px" }}>
            <span style={{ fontSize:"12px", padding:"2px 8px", borderRadius:"3px",
              background:partyBg(trade.party), color:partyColor(trade.party), fontWeight:"600" }}>
              {trade.party}-{trade.state}
            </span>
            <span style={{ fontSize:"12px", padding:"2px 8px", borderRadius:"3px",
              background:T.surface2, color:T.text2 }}>{trade.chamber}</span>
            <span style={{ fontSize:"12px", padding:"2px 8px", borderRadius:"3px",
              background: trade.type==="Buy" ? T.greenBg : T.redBg,
              color: trade.type==="Buy" ? T.green : T.red, fontWeight:"600" }}>
              {trade.type==="Buy" ? "\u25B2 Buy" : "\u25BC Sell"}
            </span>
            <span style={{ fontSize:"12px", color:T.text2 }}>{trade.amount}</span>
          </div>
          <div style={{ fontSize:"12px", color:T.text3, marginTop:"6px" }}>{trade.committee}</div>
        </div>
        <div style={{ textAlign:"center", marginLeft:"14px", flexShrink:0 }}>
          <div style={{ width:"56px", height:"56px", borderRadius:"6px",
            background:sb, border:`1px solid ${sc}20`,
            display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center" }}>
            <div style={{ fontSize:"20px", fontWeight:"800",
              fontFamily:FONT_MONO, color:sc, lineHeight:1 }}>
              {trade.score.toFixed(1)}
            </div>
            <div style={{ fontSize:"8px", color:sc, letterSpacing:"0.06em",
              marginTop:"2px", fontWeight:"600" }}>
              {scoreLabel(trade.score)}
            </div>
          </div>
          {isSelected && (
            <div style={{ fontSize:"11px", color:T.navy, marginTop:"6px", fontWeight:"600" }}>
              {"\u2713"} Selected
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -- QUICK SCAN -------------------------------------------- */
function QuickScanScreen({ trades, selected, setSelected, onAnalyze, isMobile }) {
  const toggle = (id) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const sorted = [...trades].sort((a, b) => b.score - a.score);

  return (
    <div>
      {/* Header row */}
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"flex-start", marginBottom:"20px", flexWrap:"wrap", gap:"12px" }}>
        <div>
          <div style={{ fontFamily:FONT_SERIF, color:T.navy,
            fontSize:isMobile?"20px":"24px", fontWeight:"bold" }}>
            Quick Scan Results
          </div>
          <div style={{ fontSize:"14px", color:T.text2, marginTop:"4px" }}>
            {trades.length} trades ranked by insider risk
            {selected.size > 0 && ` \u00B7 ${selected.size} selected`}
          </div>
        </div>
        {selected.size > 0 && (
          <button onClick={onAnalyze}
            style={{ background:T.navy, border:"none", color:"#fff",
              padding:isMobile?"12px 20px":"12px 28px",
              fontSize:"14px", fontWeight:"600", borderRadius:"4px",
              cursor:"pointer", fontFamily:FONT_BODY, whiteSpace:"nowrap" }}>
            Deep Analyze ({selected.size})
          </button>
        )}
      </div>

      {/* Risk legend */}
      <div style={{ display:"flex", gap:"16px", marginBottom:"16px",
        flexWrap:"wrap", padding:"12px 16px",
        background:T.surface, border:`1px solid ${T.border}`, borderRadius:"4px" }}>
        <span style={{ fontSize:"12px", color:T.text2, fontWeight:"600" }}>RISK LEVELS:</span>
        {[[T.red,"High Alert","8+"], [T.orange,"Elevated","6\u20138"],
          [T.amber,"Moderate","4\u20136"], [T.text3,"Low","0\u20134"]].map(([c,l,r]) => (
          <div key={l} style={{ display:"flex", alignItems:"center", gap:"6px" }}>
            <div style={{ width:"10px", height:"10px", borderRadius:"50%", background:c }}/>
            <span style={{ fontSize:"13px", color:T.text2 }}>
              <strong style={{ color:c }}>{l}</strong> ({r})
            </span>
          </div>
        ))}
      </div>

      {/* Mobile: cards */}
      {isMobile ? (
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          {sorted.map((t) => (
            <TradeCard key={t.id} trade={t}
              isSelected={selected.has(t.id)}
              onToggle={() => toggle(t.id)} />
          ))}
        </div>
      ) : (
        /* Desktop: table */
        <div style={{ background:T.surface, border:`1px solid ${T.border}`,
          borderRadius:"4px", overflow:"hidden" }}>
          <div style={{ display:"grid",
            gridTemplateColumns:"32px 200px 1fr 90px 120px 130px 100px",
            padding:"10px 16px", background:T.surface2,
            borderBottom:`1px solid ${T.border}`,
            fontSize:"11px", fontWeight:"700", color:T.text2,
            letterSpacing:"0.08em", textTransform:"uppercase" }}>
            <span/><span>Member</span><span>{"Ticker \u00B7 Company"}</span>
            <span>Type</span><span>Amount</span><span>Disclosed</span>
            <span style={{textAlign:"right"}}>Risk Score</span>
          </div>
          {sorted.map((t, idx) => {
            const isSel = selected.has(t.id);
            const sc = scoreColor(t.score);
            const sb = scoreBg(t.score);
            return (
              <div key={t.id} onClick={() => toggle(t.id)}
                style={{ display:"grid",
                  gridTemplateColumns:"32px 200px 1fr 90px 120px 130px 100px",
                  padding:"12px 16px",
                  borderBottom: idx < sorted.length-1 ? `1px solid ${T.border}` : "none",
                  background: isSel ? T.navyFaint : "transparent",
                  cursor:"pointer", alignItems:"center",
                  transition:"background 0.12s" }}>
                <div style={{ width:"18px", height:"18px", borderRadius:"3px",
                  border:`2px solid ${isSel ? T.navy : T.borderHi}`,
                  background: isSel ? T.navy : "transparent",
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {isSel && <span style={{ color:"#fff", fontSize:"11px", lineHeight:1 }}>{"\u2713"}</span>}
                </div>
                <div>
                  <div style={{ fontSize:"14px", fontWeight:"600", color:T.text }}>
                    {t.member}
                  </div>
                  <div style={{ display:"flex", gap:"6px", marginTop:"4px", flexWrap:"wrap" }}>
                    <span style={{ fontSize:"11px", padding:"1px 6px", borderRadius:"3px",
                      background:partyBg(t.party), color:partyColor(t.party), fontWeight:"700" }}>
                      {t.party}-{t.state}
                    </span>
                    <span style={{ fontSize:"11px", color:T.text3 }}>{t.chamber}</span>
                  </div>
                </div>
                <div>
                  <div style={{ display:"flex", alignItems:"baseline", gap:"10px" }}>
                    <span style={{ fontSize:"15px", fontWeight:"700",
                      fontFamily:FONT_MONO, color:T.navy }}>{t.ticker}</span>
                    <span style={{ fontSize:"13px", color:T.text2 }}>{t.company}</span>
                  </div>
                  <div style={{ fontSize:"11px", color:T.text3, marginTop:"3px" }}>{t.committee}</div>
                </div>
                <div style={{ fontSize:"13px", fontWeight:"600",
                  color: t.type==="Buy" ? T.green : T.red }}>
                  {t.type==="Buy" ? "\u25B2 Buy" : "\u25BC Sell"}
                </div>
                <div style={{ fontSize:"13px", color:T.text2 }}>{t.amount}</div>
                <div>
                  <div style={{ fontSize:"13px", color:T.text2 }}>{t.disclosedDate}</div>
                  {t.daysLate > 20 && (
                    <div style={{ fontSize:"11px", color:T.orange, marginTop:"2px",
                      fontWeight:"600" }}>+{t.daysLate}d late</div>
                  )}
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ display:"inline-flex", flexDirection:"column",
                    alignItems:"center", padding:"6px 10px", borderRadius:"4px",
                    background:sb, minWidth:"60px" }}>
                    <span style={{ fontSize:"18px", fontWeight:"800",
                      fontFamily:FONT_MONO, color:sc, lineHeight:1 }}>
                      {t.score.toFixed(1)}
                    </span>
                    <span style={{ fontSize:"9px", color:sc,
                      fontWeight:"700", letterSpacing:"0.06em", marginTop:"2px" }}>
                      {scoreLabel(t.score)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Top risk note */}
      {sorted[0] && selected.size === 0 && (
        <div style={{ marginTop:"14px", padding:"12px 16px",
          background:T.amberBg, border:`1px solid ${T.amber}40`,
          borderRadius:"4px", fontSize:"14px", color:T.text2 }}>
          <strong style={{ color:T.amber }}>Highest Risk: {sorted[0].ticker}</strong>
          {" \u00B7 "}{sorted[0].scoreReason}
        </div>
      )}

      {/* Sticky bottom CTA on mobile */}
      {isMobile && selected.size > 0 && (
        <div style={{ position:"sticky", bottom:"16px", marginTop:"16px",
          padding:"12px 16px", background:T.navy,
          borderRadius:"6px", textAlign:"center" }}>
          <button onClick={onAnalyze}
            style={{ background:"transparent", border:"none", color:"#fff",
              fontSize:"15px", fontWeight:"700", cursor:"pointer",
              fontFamily:FONT_BODY, width:"100%" }}>
            Run Deep Analysis — {selected.size} trade{selected.size>1?"s":""} selected
          </button>
        </div>
      )}

      {!isMobile && selected.size > 0 && (
        <div style={{ marginTop:"20px", textAlign:"right" }}>
          <button onClick={onAnalyze}
            style={{ background:T.navy, border:"none", color:"#fff",
              padding:"14px 36px", fontSize:"15px", fontWeight:"600",
              borderRadius:"4px", cursor:"pointer", fontFamily:FONT_BODY }}>
            Run Deep Analysis ({selected.size} selected)
          </button>
        </div>
      )}
    </div>
  );
}

/* -- ANALYZING --------------------------------------------- */
function AnalyzingScreen({ trade, step, results }) {
  if (!trade) return null;
  return (
    <div>
      <div style={{ marginBottom:"24px" }}>
        <div style={{ fontFamily:FONT_SERIF, color:T.navy,
          fontSize:"24px", fontWeight:"bold" }}>
          Deep Analysis Pipeline
        </div>
        <div style={{ fontSize:"15px", color:T.text2, marginTop:"6px" }}>
          {trade.member}{" \u00B7 "}{trade.type==="Buy" ? "\u25B2 Buy" : "\u25BC Sell"} {trade.ticker}{" \u00B7 "}{trade.amount}
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
        {STEPS.map((s) => {
          const done = step > s.id, active = step === s.id;
          return (
            <div key={s.id} style={{ display:"flex", gap:"14px" }}>
              <div style={{ flexShrink:0, width:"32px", height:"32px", borderRadius:"50%",
                border:`2px solid ${done ? T.green : active ? T.navy : T.border}`,
                background: done ? T.greenBg : active ? T.navyFaint : T.surface,
                display:"flex", alignItems:"center", justifyContent:"center",
                marginTop:"2px", fontSize:"13px", fontWeight:"700",
                color: done ? T.green : active ? T.navy : T.text3 }}>
                {done ? "\u2713" : active ? "\u2192" : s.id}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:"13px", fontWeight:"700", letterSpacing:"0.06em",
                  textTransform:"uppercase",
                  color: done ? T.green : active ? T.navy : T.text3,
                  paddingTop:"7px" }}>
                  {s.label}
                </div>
                {done && results[s.key] && (
                  <div style={{ marginTop:"8px", padding:"16px 18px",
                    background:T.surface, border:`1px solid ${T.border}`,
                    borderLeft:`3px solid ${T.green}`,
                    borderRadius:"0 4px 4px 0",
                    fontSize:"14px", color:T.text2, lineHeight:"1.85",
                    whiteSpace:"pre-wrap" }}>
                    {results[s.key]}
                  </div>
                )}
                {active && (
                  <div style={{ marginTop:"8px", padding:"12px 16px",
                    background:T.navyFaint, border:`1px solid ${T.navy}30`,
                    borderRadius:"4px", fontSize:"13px", color:T.navyMid,
                    fontWeight:"500" }}>
                    Analyzing…
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -- RESULTS ----------------------------------------------- */
function ResultsScreen({ results, isMobile, onBack }) {
  const [activeIdx, setActiveIdx] = useState(0);
  if (!results.length) return null;
  const { trade, analysis } = results[activeIdx];
  const sc = scoreColor(trade.score);
  const sb = scoreBg(trade.score);

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", marginBottom:"24px", flexWrap:"wrap", gap:"12px" }}>
        <div>
          <div style={{ fontFamily:FONT_SERIF, color:T.navy,
            fontSize:isMobile?"20px":"26px", fontWeight:"bold" }}>
            Intelligence Report
          </div>
          <div style={{ fontSize:"14px", color:T.text2, marginTop:"4px" }}>
            {results.length} trade{results.length!==1?"s":""} analyzed
          </div>
        </div>
        <button onClick={onBack}
          style={{ background:"transparent", border:`1px solid ${T.borderHi}`,
            color:T.text2, padding:"9px 20px", cursor:"pointer",
            fontSize:"14px", borderRadius:"4px", fontFamily:FONT_BODY }}>
          {"\u2190"} Back to Scan
        </button>
      </div>

      {/* Trade tabs */}
      {results.length > 1 && (
        <div style={{ display:"flex", gap:"6px", marginBottom:"20px",
          flexWrap:"wrap", overflowX:"auto" }}>
          {results.map((r, i) => (
            <button key={i} onClick={() => setActiveIdx(i)}
              style={{ background: i===activeIdx ? T.navy : T.surface,
                border:`1px solid ${i===activeIdx ? T.navy : T.border}`,
                color: i===activeIdx ? "#fff" : T.text2,
                padding:"8px 18px", cursor:"pointer", fontSize:"13px",
                fontWeight:"600", borderRadius:"4px",
                fontFamily:FONT_MONO }}>
              {r.trade.ticker}
            </button>
          ))}
        </div>
      )}

      {/* Trade summary card */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}`,
        borderTop:`3px solid ${T.navy}`, borderRadius:"4px",
        padding:isMobile?"18px":"24px 28px", marginBottom:"24px" }}>
        <div style={{ display:"flex", justifyContent:"space-between",
          alignItems:"flex-start", flexWrap:"wrap", gap:"16px" }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:"12px", flexWrap:"wrap" }}>
              <div style={{ fontFamily:FONT_MONO, fontSize:isMobile?"28px":"36px",
                color:T.navy, fontWeight:"800" }}>
                {trade.ticker}
              </div>
              <div style={{ fontSize:"16px", color:T.text2 }}>{trade.company}</div>
            </div>
            <div style={{ marginTop:"14px", display:"flex", flexWrap:"wrap", gap:"10px" }}>
              <span style={{ fontSize:"14px", padding:"4px 12px", borderRadius:"4px",
                background:T.surface2, border:`1px solid ${T.border}` }}>
                <span style={{ color:T.text2 }}>Member </span>
                <strong style={{ color:T.text, fontFamily:FONT_SERIF }}>{trade.member}</strong>
              </span>
              <span style={{ fontSize:"14px", padding:"4px 12px", borderRadius:"4px",
                background:partyBg(trade.party), border:`1px solid ${partyColor(trade.party)}30` }}>
                <strong style={{ color:partyColor(trade.party) }}>{trade.party}-{trade.state}</strong>
              </span>
              <span style={{ fontSize:"14px", padding:"4px 12px", borderRadius:"4px",
                background:T.surface2, border:`1px solid ${T.border}` }}>
                {trade.chamber}
              </span>
              <span style={{ fontSize:"14px", padding:"4px 12px", borderRadius:"4px",
                background: trade.type==="Buy" ? T.greenBg : T.redBg,
                border:`1px solid ${trade.type==="Buy" ? T.green : T.red}30` }}>
                <strong style={{ color: trade.type==="Buy" ? T.green : T.red }}>
                  {trade.type==="Buy" ? "\u25B2 Buy" : "\u25BC Sell"}
                </strong>
                <span style={{ color:T.text2, marginLeft:"8px" }}>{trade.amount}</span>
              </span>
            </div>
          </div>
          {/* Score badge */}
          <div style={{ textAlign:"center", padding:"18px 24px",
            background:sb, borderRadius:"6px",
            border:`1px solid ${sc}30`, minWidth:"100px" }}>
            <div style={{ fontSize:isMobile?"44px":"52px", fontFamily:FONT_MONO,
              color:sc, fontWeight:"800", lineHeight:1 }}>
              {trade.score.toFixed(1)}
            </div>
            <div style={{ fontSize:"11px", color:sc, fontWeight:"800",
              letterSpacing:"0.1em", marginTop:"4px" }}>
              {scoreLabel(trade.score)}
            </div>
            <div style={{ fontSize:"11px", color:T.text3, marginTop:"4px" }}>
              Insider Risk
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline outputs */}
      <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
        {STEPS.map((s) => (
          <div key={s.key}
            style={{ background:T.surface, border:`1px solid ${T.border}`,
              borderLeft: s.key==="verdict" ? `4px solid ${T.navy}` : `1px solid ${T.border}`,
              borderRadius:"4px", overflow:"hidden" }}>
            <div style={{ padding:"12px 18px",
              background: s.key==="verdict" ? T.navyFaint : T.surface2,
              borderBottom:`1px solid ${T.border}`,
              display:"flex", alignItems:"center", gap:"10px" }}>
              <div style={{ width:"22px", height:"22px", borderRadius:"50%",
                background:T.greenBg, border:`1px solid ${T.green}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                flexShrink:0, fontSize:"11px", color:T.green, fontWeight:"700" }}>
                {"\u2713"}
              </div>
              <span style={{ fontSize:"13px", fontWeight:"700",
                color: s.key==="verdict" ? T.navy : T.text,
                letterSpacing:"0.06em", textTransform:"uppercase" }}>
                {s.label}
              </span>
            </div>
            <div style={{ padding:isMobile?"16px":"18px 20px",
              fontSize:"14px", color:T.text2, lineHeight:"1.9",
              whiteSpace:"pre-wrap" }}>
              {analysis[s.key] || "\u2014"}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop:"28px", padding:"14px 18px",
        background:T.amberBg, border:`1px solid ${T.amber}40`,
        borderRadius:"4px", fontSize:"13px", color:T.text2, lineHeight:"1.7" }}>
        <strong style={{ color:T.amber }}>{"\u26A0"} Disclaimer:</strong> Analysis generated by AI using
        real STOCK Act disclosure data for educational purposes only. Not financial advice. Not affiliated with
        any U.S. government body. Consult a licensed financial advisor before investing.
      </div>
    </div>
  );
}

/* -- ROOT -------------------------------------------------- */
export default function CongressIntel() {
  const [phase,          setPhase]          = useState("idle");
  const [trades,         setTrades]         = useState([]);
  const [selected,       setSelected]       = useState(new Set());
  const [currentTrade,   setCurrentTrade]   = useState(null);
  const [pipelineStep,   setPipelineStep]   = useState(0);
  const [pipelineResults,setPipelineResults]= useState({});
  const [allResults,     setAllResults]     = useState([]);
  const [error,          setError]          = useState("");
  const [isMobile,       setIsMobile]       = useState(false);
  const [hasToken,       setHasToken]       = useState(() => Boolean(getStoredToken()));
  const [tokenError,     setTokenError]     = useState("");

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 680);
    check();
    window.addEventListener("resize", check);
    try {
      const s = localStorage.getItem("ci_v4");
      if (s) {
        const p = JSON.parse(s);
        if (p.phase==="quickscan" && p.trades?.length) {
          setTrades(p.trades); setPhase("quickscan");
        } else if (p.phase==="results" && p.allResults?.length) {
          setTrades(p.trades||[]); setAllResults(p.allResults); setPhase("results");
        }
      }
    } catch {}
    return () => window.removeEventListener("resize", check);
  }, []);

  const save = (d) => { try { localStorage.setItem("ci_v4", JSON.stringify(d)); } catch {} };

  const runQuickScan = async () => {
    setPhase("scanning"); setError("");
    try {
      // Fetch real trades from Quiver Quant via worker
      const rawTrades = await fetchTrades(30);
      if (!rawTrades.length) throw new Error("No recent trades found in disclosure feeds.");

      // Score trades with AI — enrich with state, committee, sector, risk score
      const text = await callAnalyze(
        "You are a U.S. congressional trading intelligence analyst. Score real congressional stock disclosures for insider risk. Return ONLY a valid JSON object.",
        `Score these real congressional stock trades for insider risk potential. Each trade already has member name, party, chamber, ticker, type, amount, and filing dates. For each trade, add the member's state (2-letter), most relevant committee assignment, the stock's sector, and assign an insider risk score from 1.0 to 10.0 based on: committee relevance to the traded sector, trade size, filing delay, and timing signals.

Real trades data:
${JSON.stringify(rawTrades.slice(0, 12))}

Return a JSON object with this exact structure:
{"trades":[{"id":<sequential 1-N>,"member":"<name>","party":"<R|D>","chamber":"<House|Senate>","state":"<2-letter>","committee":"<most relevant committee>","ticker":"<TICKER>","company":"<company name>","sector":"<sector>","type":"<Buy|Sell>","amount":"<amount range>","disclosedDate":"<YYYY-MM-DD>","daysLate":<number>,"score":<1.0-10.0>,"scoreReason":"<one sentence>"}]}

Use the real party affiliations provided. Be accurate with state and committee assignments. Score honestly based on the actual risk signals in the data.`,
        "gpt-4o-mini",
        true
      );
      const parsed = parseJSON(text);
      const data = parsed.trades || parsed;
      setTrades(data); setSelected(new Set()); setPhase("quickscan");
      save({ phase:"quickscan", trades:data });
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        setHasToken(false);
        setTokenError("That token didn't work. Try again.");
        setPhase("idle");
        return;
      }
      setError("Scan failed: " + e.message); setPhase("idle");
    }
  };

  const runDeepAnalysis = async () => {
    if (!selected.size) return;
    const sel = trades.filter((t) => selected.has(t.id));
    const results = [];
    for (const trade of sel) {
      setCurrentTrade(trade); setPhase("analyzing"); setPipelineStep(0); setPipelineResults({});
      const ctx = `Member: ${trade.member} (${trade.party}-${trade.state}), ${trade.chamber}. Committee: ${trade.committee}. Trade: ${trade.type} ${trade.ticker} (${trade.company}, ${trade.sector}). Amount: ${trade.amount}. Disclosed: ${trade.disclosedDate} (${trade.daysLate} days late).`;
      const prompts = [
        ["Congressional analyst. Specific, concise. 2-3 paragraphs.", `Analyze this member's committee roles and relevance to the trade:\n${ctx}\nCover key committees, any chair/ranking role, and direct overlap with ${trade.company}'s sector.`],
        ["Congressional analyst. Specific, concise. 2-3 paragraphs.", `Analyze legislative influence relevant to this trade:\n${ctx}\nCover recent bills/votes in ${trade.sector}, regulatory overlap, and pending legislation affecting ${trade.company}.`],
        ["Congressional trading analyst. Concise. 2 paragraphs.", `Analyze trade sizing and disclosure pattern:\n${ctx}\nCover whether ${trade.amount} is significant, what the ${trade.daysLate}-day delay signals, and what the ${trade.type} direction suggests.`],
        ["Financial news analyst. Concise. 2 paragraphs.", `Describe news context for this trade:\n${ctx}\nCover what was happening at ${trade.company} and in ${trade.sector} around disclosure and what an insider might have known.`],
        ["Financial analyst. Concise. Use bullet points for metrics.", `Valuation and technical snapshot for ${trade.ticker}:\n${ctx}\nCover valuation context, sector tailwinds/headwinds, key risks, and retail entry point.`],
        ["Trading intelligence analyst. Direct and actionable.", `Verdict and retail action guide:\n${ctx}\nInsider Risk: ${trade.score}/10.\n\nFormat:\nVERDICT: [FOLLOW / MONITOR / AVOID] \u2014 brief reason\n\nRETAIL TIMING: when to act\n\nENTRY STRATEGY: price range, position size, catalyst\n\nKEY RISKS:\n\u2022 risk 1\n\u2022 risk 2\n\u2022 risk 3\n\nEXIT TARGET: timeline and level`],
      ];
      const sr = {};
      let aborted = false;
      for (let i = 0; i < prompts.length; i++) {
        setPipelineStep(i+1);
        try { sr[STEPS[i].key] = await callAnalyze(prompts[i][0], prompts[i][1], "gpt-4o"); }
        catch (e) {
          if (e instanceof UnauthorizedError) {
            setHasToken(false);
            setTokenError("That token didn't work. Try again.");
            setPhase("idle");
            aborted = true;
            break;
          }
          sr[STEPS[i].key] = "Analysis unavailable for this step.";
        }
        setPipelineResults({...sr});
      }
      if (aborted) return;
      results.push({ trade, analysis:{...sr} });
    }
    setAllResults(results); setPhase("results");
    save({ phase:"results", trades, allResults:results });
  };

  const signOut = () => {
    setStoredToken("");
    setHasToken(false);
    setTokenError("");
    setPhase("idle"); setTrades([]); setSelected(new Set());
    setAllResults([]); setError(""); setPipelineResults({});
    try { localStorage.removeItem("ci_v4"); } catch {}
  };

  const submitToken = (t) => {
    setStoredToken(t);
    setHasToken(true);
    setTokenError("");
  };

  const reset = () => {
    setPhase("idle"); setTrades([]); setSelected(new Set());
    setAllResults([]); setError(""); setPipelineResults({});
    try { localStorage.removeItem("ci_v4"); } catch {}
  };

  if (!hasToken) {
    return <TokenGate onSubmit={submitToken} error={tokenError}/>;
  }

  return (
    <div style={{ background:T.bg, minHeight:"100vh",
      fontFamily:FONT_BODY, color:T.text }}>
      <div style={{ maxWidth:"1100px", margin:"0 auto",
        padding:isMobile?"14px 14px":"28px 28px" }}>

        {/* Header */}
        <div style={{ background:T.surface, border:`1px solid ${T.border}`,
          borderTop:`4px solid ${T.navy}`,
          padding:isMobile?"16px 18px":"20px 28px",
          marginBottom:"24px", borderRadius:"4px",
          display:"flex", justifyContent:"space-between",
          alignItems:"center", flexWrap:"wrap", gap:"12px" }}>
          <div>
            <h1 style={{ fontFamily:FONT_SERIF, fontSize:isMobile?"22px":"32px",
              fontWeight:"bold", color:T.navy,
              letterSpacing:"0.04em", margin:0 }}>
              CongressIntel
            </h1>
            <div style={{ fontSize:"12px", color:T.text3,
              letterSpacing:"0.1em", marginTop:"4px",
              textTransform:"uppercase" }}>
              U.S. Congressional Trading Intelligence
            </div>
            <div style={{ display:"flex", gap:"8px", marginTop:"8px", flexWrap:"wrap" }}>
              <span style={{ fontSize:"11px", padding:"2px 10px", borderRadius:"3px",
                background:T.greenBg, color:T.green,
                fontWeight:"600", border:`1px solid ${T.green}40` }}>
                Live Data
              </span>
              <span style={{ fontSize:"11px", padding:"2px 10px", borderRadius:"3px",
                background:T.surface2, color:T.text3, border:`1px solid ${T.border}` }}>
                Not Financial Advice
              </span>
            </div>
          </div>
          <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
            {phase !== "idle" && (
              <button onClick={reset}
                style={{ background:"transparent", border:`1px solid ${T.borderHi}`,
                  color:T.text2, padding:"8px 18px", cursor:"pointer",
                  fontSize:"13px", borderRadius:"4px",
                  fontFamily:FONT_BODY, fontWeight:"500" }}>
                {"\u21BA"} Reset
              </button>
            )}
            <button onClick={signOut}
              title="Clear access token from this browser"
              style={{ background:"transparent", border:"none",
                color:T.text3, padding:"8px 4px", cursor:"pointer",
                fontSize:"12px", fontFamily:FONT_BODY,
                textDecoration:"underline" }}>
              Sign out
            </button>
          </div>
        </div>

        {phase==="idle"      && <IdleScreen onScan={runQuickScan} error={error}/>}
        {phase==="scanning"  && <ScanningScreen/>}
        {phase==="quickscan" && <QuickScanScreen trades={trades} selected={selected}
                                  setSelected={setSelected} onAnalyze={runDeepAnalysis}
                                  isMobile={isMobile}/>}
        {phase==="analyzing" && <AnalyzingScreen trade={currentTrade}
                                  step={pipelineStep} results={pipelineResults}/>}
        {phase==="results"   && <ResultsScreen results={allResults}
                                  isMobile={isMobile} onBack={()=>setPhase("quickscan")}/>}
      </div>
    </div>
  );
}
