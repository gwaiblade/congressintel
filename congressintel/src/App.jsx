import { useState, useEffect } from "react";

const WORKER_URL = import.meta.env.VITE_WORKER_URL || "http://localhost:8787";
const APP_TOKEN = import.meta.env.VITE_APP_TOKEN || "";

const T = {
  bg: "#050608", surface: "#08090e", surface2: "#0d0f16",
  border: "#181d2a", borderBright: "#252d42",
  gold: "#f0c040", goldMid: "#c49a30", goldDim: "#5a4512", goldFaint: "#100d02",
  text: "#d8e4f0", text2: "#7a90a8", text3: "#3a4858",
  green: "#27c96e", red: "#e8404a", orange: "#f5963a",
};

async function workerFetch(path, options = {}) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-App-Token": APP_TOKEN,
      ...(options.headers || {}),
    },
  });
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
    const start = clean.search(/[\[{]/);
    return JSON.parse(clean.slice(start));
  } catch {
    const m = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("JSON parse failed");
  }
}

function scoreColor(s) {
  if (s >= 7.5) return T.red;
  if (s >= 5.5) return T.orange;
  if (s >= 3.5) return T.gold;
  return T.text2;
}
function scoreLabel(s) {
  if (s >= 8) return "HIGH ALERT";
  if (s >= 6) return "ELEVATED";
  if (s >= 4) return "MODERATE";
  return "LOW";
}
function partyColor(p) { return p === "R" ? "#e05555" : "#5aaaf0"; }

const STEPS = [
  { id: 1, key: "roles",     label: "COMMITTEE ROLES" },
  { id: 2, key: "influence", label: "LEGISLATIVE INFLUENCE" },
  { id: 3, key: "sizing",    label: "TRADE SIZING & PATTERN" },
  { id: 4, key: "news",      label: "NEWS CONTEXT" },
  { id: 5, key: "valuation", label: "VALUATION SNAPSHOT" },
  { id: 6, key: "verdict",   label: "VERDICT & ACTION" },
];

function CornerBox({ children, style = {} }) {
  return (
    <div style={{ position: "relative", border: `1px solid ${T.borderBright}`, ...style }}>
      {[
        { top:"10px", left:"10px",  borderTop:`2px solid ${T.gold}`, borderLeft:`2px solid ${T.gold}` },
        { top:"10px", right:"10px", borderTop:`2px solid ${T.gold}`, borderRight:`2px solid ${T.gold}` },
        { bottom:"10px", left:"10px",  borderBottom:`2px solid ${T.gold}`, borderLeft:`2px solid ${T.gold}` },
        { bottom:"10px", right:"10px", borderBottom:`2px solid ${T.gold}`, borderRight:`2px solid ${T.gold}` },
      ].map((c, i) => (
        <div key={i} style={{ position:"absolute", width:"14px", height:"14px", ...c }} />
      ))}
      {children}
    </div>
  );
}

/* -- IDLE ------------------------------------------------ */
function IdleScreen({ onScan, error, isMobile }) {
  return (
    <div>
      <CornerBox style={{ padding: isMobile ? "32px 20px" : "56px 52px", marginBottom: "28px" }}>
        <div style={{ fontFamily:"Georgia,serif", fontSize:"20px", color:T.gold, marginBottom:"22px", letterSpacing:"0.08em" }}>
          SYSTEM READY
        </div>
        <div style={{ fontSize:"15px", color:T.text2, lineHeight:"2.0", maxWidth:"660px" }}>
          CongressIntel runs a two-tier intelligence pipeline on U.S. congressional stock
          disclosures, surfacing trades with elevated insider risk potential.<br/><br/>
          <span style={{color:T.text}}>&#9654; TIER 1 — QUICK SCAN:</span> Scores all recent disclosures
          across committee relevance, trade size, timing, and late-filing delay.<br/>
          <span style={{color:T.text}}>&#9654; TIER 2 — DEEP ANALYSIS:</span> Six-step pipeline —
          committee roles, legislative influence, trade patterns, news context,
          valuation, and retail action guidance.
        </div>
        {!isMobile ? (
          <div style={{ marginTop:"40px" }}>
            <button
              onClick={onScan}
              style={{ background:T.goldFaint, border:`1px solid ${T.goldMid}`, color:T.gold,
                padding:"15px 44px", fontSize:"14px", letterSpacing:"0.2em",
                cursor:"pointer", fontFamily:"'Courier New',monospace" }}
              onMouseEnter={(e)=>{ e.target.style.background=T.goldDim; e.target.style.borderColor=T.gold; }}
              onMouseLeave={(e)=>{ e.target.style.background=T.goldFaint; e.target.style.borderColor=T.goldMid; }}>
              &#9654; RUN QUICK SCAN
            </button>
          </div>
        ) : (
          <div style={{ marginTop:"24px", fontSize:"13px", color:T.goldMid,
            border:`1px solid ${T.goldDim}`, padding:"12px 16px", display:"inline-block" }}>
            &#9888; DESKTOP REQUIRED TO RUN ANALYSIS
          </div>
        )}
      </CornerBox>
      {error && (
        <div style={{ border:`1px solid ${T.red}`, background:"rgba(232,64,74,0.06)",
          padding:"14px 18px", fontSize:"14px", color:T.red, marginBottom:"16px" }}>
          &#9632; ERROR: {error}
        </div>
      )}
      <div style={{ fontSize:"12px", color:T.text3, lineHeight:"1.8" }}>
        EDUCATIONAL USE ONLY · Illustrative examples · Not financial advice
      </div>
    </div>
  );
}

/* -- SCANNING -------------------------------------------- */
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
    <div style={{ border:`1px solid ${T.border}`, padding:"36px", minHeight:"300px" }}>
      <div style={{ color:T.gold, fontSize:"15px", letterSpacing:"0.18em", marginBottom:"28px" }}>
        &#9632; SCANNING{".".repeat(dots)}
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize:"14px", color:i===lines.length-1?T.text:T.text2,
          marginBottom:"11px", paddingLeft:"16px",
          borderLeft:`2px solid ${i===lines.length-1?T.goldMid:T.border}` }}>
          {i < lines.length-1 ? `\u2713 ${l}` : `\u25B6 ${l}`}
        </div>
      ))}
    </div>
  );
}

/* -- QUICK SCAN ------------------------------------------ */
function QuickScanScreen({ trades, selected, setSelected, onAnalyze, isMobile }) {
  const toggle = (id) => {
    if (isMobile) return;
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const sorted = [...trades].sort((a, b) => b.score - a.score);

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start",
        marginBottom:"22px", flexWrap:"wrap", gap:"14px" }}>
        <div>
          <div style={{ fontFamily:"Georgia,serif", color:T.gold,
            fontSize:isMobile?"18px":"24px", letterSpacing:"0.08em" }}>
            QUICK SCAN RESULTS
          </div>
          <div style={{ fontSize:"13px", color:T.text2, marginTop:"6px" }}>
            {trades.length} trades · ranked by insider risk
            {!isMobile && " · click rows to select for deep analysis"}
          </div>
        </div>
        {!isMobile && selected.size > 0 && (
          <button onClick={onAnalyze}
            style={{ background:T.goldFaint, border:`1px solid ${T.gold}`, color:T.gold,
              padding:"12px 30px", fontSize:"14px", letterSpacing:"0.15em",
              cursor:"pointer", fontFamily:"'Courier New',monospace" }}>
            &#9654; DEEP ANALYZE ({selected.size})
          </button>
        )}
      </div>

      {/* Legend */}
      <div style={{ display:"flex", gap:"20px", marginBottom:"16px", flexWrap:"wrap" }}>
        {[[T.red,"HIGH ALERT","8+"],[T.orange,"ELEVATED","6-8"],[T.gold,"MODERATE","4-6"],[T.text2,"LOW","0-4"]].map(([c,l,r]) => (
          <div key={l} style={{ display:"flex", alignItems:"center", gap:"7px", fontSize:"12px" }}>
            <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:c }}/>
            <span style={{ color:c }}>{l}</span>
            <span style={{ color:T.text3 }}>({r})</span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ border:`1px solid ${T.border}` }}>
        {/* Header */}
        <div style={{ display:"grid",
          gridTemplateColumns: isMobile ? "1fr auto" : "28px 190px 1fr 80px 120px 120px 90px",
          padding:"10px 14px", borderBottom:`1px solid ${T.borderBright}`,
          background:T.surface2, fontSize:"11px", color:T.text2, letterSpacing:"0.15em" }}>
          {!isMobile && <span/>}
          <span>MEMBER</span>
          {!isMobile && <span>TICKER · COMPANY</span>}
          {!isMobile && <span>TYPE</span>}
          {!isMobile && <span>AMOUNT</span>}
          {!isMobile && <span>DISCLOSED</span>}
          <span style={{ textAlign:"right" }}>SCORE</span>
        </div>

        {sorted.map((t, idx) => {
          const isSel = selected.has(t.id);
          const sc = scoreColor(t.score);
          return (
            <div key={t.id} onClick={() => toggle(t.id)}
              style={{ display:"grid",
                gridTemplateColumns: isMobile ? "1fr auto" : "28px 190px 1fr 80px 120px 120px 90px",
                padding: isMobile ? "14px" : "12px 14px",
                borderBottom: idx < sorted.length-1 ? `1px solid ${T.border}` : "none",
                background: isSel ? "rgba(240,192,64,0.07)" : idx%2===0 ? T.surface : T.bg,
                cursor: isMobile ? "default" : "pointer",
                alignItems: "center" }}>

              {!isMobile && (
                <div style={{ width:"16px", height:"16px",
                  border:`1px solid ${isSel?T.gold:T.borderBright}`,
                  background: isSel ? T.goldDim : "transparent",
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {isSel && <span style={{ fontSize:"11px", color:T.gold }}>{"\u2713"}</span>}
                </div>
              )}

              <div>
                <div style={{ fontSize:"14px", color:T.text, fontFamily:"Georgia,serif" }}>
                  {t.member}
                </div>
                <div style={{ fontSize:"12px", marginTop:"4px", display:"flex", gap:"10px" }}>
                  <span style={{ color:partyColor(t.party) }}>{t.party}-{t.state}</span>
                  <span style={{ color:T.text2 }}>{t.chamber}</span>
                  {isMobile && <span style={{ color:t.type==="Buy"?T.green:T.red }}>{t.type}</span>}
                  {isMobile && <span style={{ color:T.text }}>{t.ticker}</span>}
                </div>
                {isMobile && (
                  <div style={{ fontSize:"11px", color:T.text2, marginTop:"4px" }}>{t.committee}</div>
                )}
              </div>

              {!isMobile && (
                <div>
                  <span style={{ fontSize:"15px", color:T.text, fontFamily:"'Courier New',monospace" }}>{t.ticker}</span>
                  <span style={{ fontSize:"13px", color:T.text2, marginLeft:"12px" }}>{t.company}</span>
                  <div style={{ fontSize:"11px", color:T.text3, marginTop:"3px" }}>{t.committee}</div>
                </div>
              )}

              {!isMobile && (
                <div style={{ fontSize:"13px", color:t.type==="Buy"?T.green:T.red,
                  fontFamily:"'Courier New',monospace" }}>
                  {t.type==="Buy" ? "\u25B2 BUY" : "\u25BC SELL"}
                </div>
              )}

              {!isMobile && (
                <div style={{ fontSize:"13px", color:T.text2 }}>{t.amount}</div>
              )}

              {!isMobile && (
                <div>
                  <div style={{ fontSize:"13px", color:T.text2 }}>{t.disclosedDate}</div>
                  {t.daysLate > 20 && (
                    <div style={{ fontSize:"11px", color:T.orange, marginTop:"3px" }}>+{t.daysLate}d late</div>
                  )}
                </div>
              )}

              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize: isMobile?"20px":"22px", color:sc,
                  fontFamily:"'Courier New',monospace", fontWeight:"bold" }}>
                  {t.score.toFixed(1)}
                </div>
                <div style={{ fontSize:"10px", color:sc, letterSpacing:"0.1em", marginTop:"2px" }}>
                  {scoreLabel(t.score)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Top risk note */}
      {sorted[0] && !isMobile && selected.size===0 && (
        <div style={{ marginTop:"16px", padding:"13px 16px", background:T.surface,
          border:`1px solid ${T.border}`, fontSize:"13px", color:T.text2 }}>
          <span style={{ color:T.gold }}>{"\u25B8"} HIGHEST RISK: {sorted[0].ticker} ({sorted[0].member})</span>
          {" \u2014 "}{sorted[0].scoreReason}
        </div>
      )}

      {!isMobile && selected.size > 0 && (
        <div style={{ marginTop:"22px", textAlign:"right" }}>
          <button onClick={onAnalyze}
            style={{ background:T.goldFaint, border:`1px solid ${T.gold}`, color:T.gold,
              padding:"14px 40px", fontSize:"14px", letterSpacing:"0.18em",
              cursor:"pointer", fontFamily:"'Courier New',monospace" }}>
            &#9654; RUN DEEP ANALYSIS ({selected.size} selected)
          </button>
        </div>
      )}
    </div>
  );
}

/* -- ANALYZING ------------------------------------------- */
function AnalyzingScreen({ trade, step, results }) {
  if (!trade) return null;
  return (
    <div>
      <div style={{ marginBottom:"28px" }}>
        <div style={{ fontFamily:"Georgia,serif", color:T.gold, fontSize:"24px", letterSpacing:"0.08em" }}>
          DEEP ANALYSIS PIPELINE
        </div>
        <div style={{ fontSize:"14px", color:T.text2, marginTop:"8px" }}>
          {trade.member} · {trade.type==="Buy"?"\u25B2":"\u25BC"} {trade.type} {trade.ticker} · {trade.amount}
        </div>
      </div>
      {STEPS.map((s) => {
        const done = step > s.id, active = step === s.id;
        return (
          <div key={s.id} style={{ display:"flex", gap:"16px", marginBottom:"8px" }}>
            <div style={{ flexShrink:0, width:"28px", height:"28px",
              border:`1px solid ${done?T.green:active?T.gold:T.border}`,
              background: done?"rgba(39,201,110,0.1)":active?T.goldFaint:"transparent",
              display:"flex", alignItems:"center", justifyContent:"center", marginTop:"2px" }}>
              <span style={{ fontSize:"12px", color:done?T.green:active?T.gold:T.text3 }}>
                {done?"\u2713":active?"\u25B6":s.id}
              </span>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:"12px", letterSpacing:"0.15em",
                color:done?T.green:active?T.gold:T.text3, paddingTop:"6px" }}>
                {s.label}
              </div>
              {done && results[s.key] && (
                <div style={{ marginTop:"10px", padding:"16px 18px", background:T.surface,
                  border:`1px solid ${T.border}`, fontSize:"14px", color:T.text2,
                  lineHeight:"1.85", whiteSpace:"pre-wrap" }}>
                  {results[s.key]}
                </div>
              )}
              {active && (
                <div style={{ marginTop:"10px", padding:"11px 14px", background:T.goldFaint,
                  border:`1px solid ${T.goldDim}`, fontSize:"13px", color:T.goldMid,
                  letterSpacing:"0.1em" }}>
                  &#9632; PROCESSING...
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -- RESULTS --------------------------------------------- */
function ResultsScreen({ results, isMobile, onBack }) {
  const [activeIdx, setActiveIdx] = useState(0);
  if (!results.length) return null;
  const { trade, analysis } = results[activeIdx];
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        marginBottom:"28px", flexWrap:"wrap", gap:"14px" }}>
        <div>
          <div style={{ fontFamily:"Georgia,serif", color:T.gold,
            fontSize:isMobile?"20px":"26px", letterSpacing:"0.08em" }}>
            INTELLIGENCE REPORT
          </div>
          <div style={{ fontSize:"13px", color:T.text2, marginTop:"5px" }}>
            {results.length} trade{results.length!==1?"s":""} analyzed
          </div>
        </div>
        <button onClick={onBack}
          style={{ background:"transparent", border:`1px solid ${T.borderBright}`,
            color:T.text2, padding:"9px 20px", cursor:"pointer",
            fontSize:"13px", letterSpacing:"0.1em", fontFamily:"'Courier New',monospace" }}>
          &larr; BACK TO SCAN
        </button>
      </div>

      {/* Tab selector for multiple trades */}
      {results.length > 1 && (
        <div style={{ display:"flex", gap:"4px", marginBottom:"22px", flexWrap:"wrap" }}>
          {results.map((r, i) => (
            <button key={i} onClick={() => setActiveIdx(i)}
              style={{ background:i===activeIdx?T.goldFaint:"transparent",
                border:`1px solid ${i===activeIdx?T.goldMid:T.border}`,
                color:i===activeIdx?T.gold:T.text2, padding:"8px 18px",
                cursor:"pointer", fontSize:"13px",
                fontFamily:"'Courier New',monospace", letterSpacing:"0.08em" }}>
              {r.trade.ticker}
            </button>
          ))}
        </div>
      )}

      {/* Trade summary card */}
      <div style={{ background:T.surface, border:`1px solid ${T.borderBright}`,
        padding:isMobile?"18px":"24px 28px", marginBottom:"24px" }}>
        <div style={{ display:"flex", justifyContent:"space-between",
          alignItems:"flex-start", flexWrap:"wrap", gap:"18px" }}>
          <div>
            <div style={{ fontFamily:"'Courier New',monospace",
              fontSize:isMobile?"26px":"34px", color:T.text, fontWeight:"bold" }}>
              {trade.ticker}
            </div>
            <div style={{ fontSize:"15px", color:T.text2, marginTop:"4px" }}>{trade.company}</div>
            <div style={{ marginTop:"14px", display:"flex", flexWrap:"wrap", gap:"20px" }}>
              {[
                ["MEMBER",  trade.member,  T.text,  "Georgia,serif"],
                ["PARTY",   `${trade.party}-${trade.state}`, partyColor(trade.party), null],
                ["CHAMBER", trade.chamber, T.text,  null],
                ["TYPE",    trade.type==="Buy"?"\u25B2 BUY":"\u25BC SELL",
                            trade.type==="Buy"?T.green:T.red, "'Courier New',monospace"],
                ["AMOUNT",  trade.amount,  T.text,  null],
              ].map(([label, val, color, font]) => (
                <span key={label} style={{ fontSize:"14px" }}>
                  <span style={{ color:T.text2 }}>{label} </span>
                  <span style={{ color, fontFamily:font||"inherit" }}>{val}</span>
                </span>
              ))}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:"58px", fontFamily:"'Courier New',monospace",
              color:scoreColor(trade.score), fontWeight:"bold", lineHeight:1 }}>
              {trade.score.toFixed(1)}
            </div>
            <div style={{ fontSize:"12px", color:scoreColor(trade.score),
              letterSpacing:"0.15em", marginTop:"5px" }}>
              {scoreLabel(trade.score)}
            </div>
            <div style={{ fontSize:"11px", color:T.text3, marginTop:"5px" }}>INSIDER RISK SCORE</div>
          </div>
        </div>
      </div>

      {/* Pipeline outputs */}
      {STEPS.map((s) => (
        <div key={s.key} style={{ marginBottom:"20px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"10px" }}>
            <div style={{ width:"22px", height:"22px",
              border:`1px solid ${T.green}`, background:"rgba(39,201,110,0.1)",
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ fontSize:"11px", color:T.green }}>{"\u2713"}</span>
            </div>
            <div style={{ fontSize:"12px", letterSpacing:"0.18em", color:T.green }}>{s.label}</div>
          </div>
          <div style={{ padding:isMobile?"16px":"20px 22px", background:T.surface,
            border:`1px solid ${s.key==="verdict"?T.goldDim:T.border}`,
            borderLeft:s.key==="verdict"?`3px solid ${T.gold}`:`1px solid ${T.border}`,
            fontSize:"14px", color:T.text2, lineHeight:"1.9", whiteSpace:"pre-wrap" }}>
            {analysis[s.key] || "\u2014"}
          </div>
        </div>
      ))}

      <div style={{ marginTop:"32px", padding:"14px 18px", background:T.goldFaint,
        border:`1px solid ${T.goldDim}`, fontSize:"12px", color:T.goldMid, lineHeight:"1.8" }}>
        &#9888; DISCLAIMER: Analysis generated by AI using public disclosure data for educational purposes only.
        Not financial advice. Not affiliated with any U.S. government body.
        Consult a licensed financial advisor before making investment decisions.
      </div>
    </div>
  );
}

/* -- ROOT ------------------------------------------------ */
export default function CongressIntel() {
  const [phase, setPhase] = useState("idle");
  const [trades, setTrades] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [currentTrade, setCurrentTrade] = useState(null);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [pipelineResults, setPipelineResults] = useState({});
  const [allResults, setAllResults] = useState([]);
  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 600);
    check();
    window.addEventListener("resize", check);
    try {
      const s = localStorage.getItem("ci_v3");
      if (s) {
        const p = JSON.parse(s);
        if (p.phase==="quickscan" && p.trades?.length) { setTrades(p.trades); setPhase("quickscan"); }
        else if (p.phase==="results" && p.allResults?.length) { setTrades(p.trades||[]); setAllResults(p.allResults); setPhase("results"); }
      }
    } catch {}
    return () => window.removeEventListener("resize", check);
  }, []);

  const save = (d) => { try { localStorage.setItem("ci_v3", JSON.stringify(d)); } catch {} };

  const runQuickScan = async () => {
    setPhase("scanning"); setError("");
    try {
      // Fetch real trades from Quiver Quant via worker
      const rawTrades = await fetchTrades(30);
      if (!rawTrades.length) throw new Error("No recent trades found in disclosure feeds.");

      // Score trades with AI — enrich with committee, sector, state, and risk score
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
    } catch (e) { setError("Scan failed: " + e.message); setPhase("idle"); }
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
      for (let i = 0; i < prompts.length; i++) {
        setPipelineStep(i+1);
        try { sr[STEPS[i].key] = await callAnalyze(prompts[i][0], prompts[i][1], "gpt-4o"); }
        catch { sr[STEPS[i].key] = "Analysis unavailable for this step."; }
        setPipelineResults({...sr});
      }
      results.push({ trade, analysis:{...sr} });
    }
    setAllResults(results); setPhase("results");
    save({ phase:"results", trades, allResults:results });
  };

  const reset = () => {
    setPhase("idle"); setTrades([]); setSelected(new Set());
    setAllResults([]); setError(""); setPipelineResults({});
    try { localStorage.removeItem("ci_v3"); } catch {}
  };

  return (
    <div style={{ background:T.bg, minHeight:"100vh",
      fontFamily:"'Courier New',Courier,monospace", color:T.text, position:"relative" }}>
      {/* Scanlines */}
      <div style={{ position:"fixed", inset:0,
        background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.06) 2px,rgba(0,0,0,0.06) 4px)",
        pointerEvents:"none", zIndex:1 }}/>

      <div style={{ position:"relative", zIndex:2, maxWidth:"1100px", margin:"0 auto",
        padding:isMobile?"16px 14px":"32px 28px" }}>

        {/* Header */}
        <div style={{ borderBottom:`1px solid ${T.goldDim}`, paddingBottom:"20px", marginBottom:"32px" }}>
          <div style={{ display:"flex", justifyContent:"space-between",
            alignItems:"flex-start", flexWrap:"wrap", gap:"14px" }}>
            <div>
              <h1 style={{ fontFamily:"Georgia,serif",
                fontSize:isMobile?"24px":"40px", fontWeight:"bold", color:T.gold,
                letterSpacing:"0.12em", margin:0,
                textShadow:"0 0 40px rgba(240,192,64,0.25)" }}>
                CONGRESSINTEL
              </h1>
              <div style={{ fontSize:"12px", color:T.text2, letterSpacing:"0.2em", marginTop:"6px" }}>
                U.S. CONGRESSIONAL TRADING INTELLIGENCE SYSTEM
              </div>
              <div style={{ display:"flex", gap:"8px", marginTop:"10px", flexWrap:"wrap" }}>
                <span style={{ fontSize:"11px", padding:"3px 10px",
                  border:`1px solid ${T.goldDim}`, color:T.goldMid, letterSpacing:"0.1em" }}>
                  LIVE DATA
                </span>
                <span style={{ fontSize:"11px", padding:"3px 10px",
                  border:`1px solid ${T.border}`, color:T.text3, letterSpacing:"0.1em" }}>
                  NOT FINANCIAL ADVICE
                </span>
              </div>
            </div>
            {phase !== "idle" && (
              <button onClick={reset}
                style={{ background:"transparent", border:`1px solid ${T.border}`,
                  color:T.text2, padding:"8px 18px", cursor:"pointer",
                  fontSize:"12px", letterSpacing:"0.12em", fontFamily:"'Courier New',monospace" }}>
                &#8634; RESET
              </button>
            )}
          </div>
        </div>

        {/* Mobile banner */}
        {isMobile && ["idle","quickscan"].includes(phase) && (
          <div style={{ background:"rgba(90,69,18,0.18)", border:`1px solid ${T.goldDim}`,
            padding:"12px 16px", marginBottom:"22px", fontSize:"13px", color:T.goldMid }}>
            &#9888; MOBILE — Read-only display mode. Desktop required to run analysis.
          </div>
        )}

        {phase==="idle"      && <IdleScreen onScan={runQuickScan} error={error} isMobile={isMobile}/>}
        {phase==="scanning"  && <ScanningScreen/>}
        {phase==="quickscan" && <QuickScanScreen trades={trades} selected={selected} setSelected={setSelected} onAnalyze={runDeepAnalysis} isMobile={isMobile}/>}
        {phase==="analyzing" && <AnalyzingScreen trade={currentTrade} step={pipelineStep} results={pipelineResults}/>}
        {phase==="results"   && <ResultsScreen results={allResults} isMobile={isMobile} onBack={()=>setPhase("quickscan")}/>}
      </div>
    </div>
  );
}
