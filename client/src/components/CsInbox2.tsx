import React, { useState, useMemo } from "react";

/* ─────────────────────────────────────────────────────────────────────────
   CsInbox2 — pixel-perfect port of the user-supplied HTML/CSS design.
   Layout: sidebar (260px) | main (topbar + toolbar + board + footer stats)
   Card click → drawer slides in from the right (position:fixed)
   All CSS is inline / <style> tag — zero Tailwind dependency for this file.
───────────────────────────────────────────────────────────────────────── */

const COLORS = ["#6d4aff","#10b981","#f97316","#3478f6","#ef4444","#a855f7"];
const HEAD_COLORS: Record<string, string> = {
  "At Risk":        "#ff9f1a",
  "New":            "#3478f6",
  "Needs Response": "#13b77a",
  "On Customer":    "#8b5cf6",
};

type KanbanCard = {
  id: number;
  name: string;
  initials: string;
  preview: string;
  ago: string;
  chips: string[];
  priority: string;
  amount: string;
};

type KanbanColumn = {
  label: string;
  cards: KanbanCard[];
};

function chipClass(c: string) {
  if (/Hot|Urgent|High Value/.test(c)) return "chip hot";
  if (/Confirmed/.test(c)) return "chip ok";
  if (/No Reply|Overdue/.test(c)) return "chip warn";
  return "chip";
}

const STYLES = `
*{box-sizing:border-box}
.cs2-app{height:100%;display:grid;grid-template-columns:260px minmax(0,1fr);background:#f6f7fb;color:#181a24;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif}
.cs2-sidebar{background:#fff;border-right:1px solid #e5e7ee;padding:18px 14px;display:flex;flex-direction:column;overflow-y:auto}
.cs2-brand{display:flex;align-items:center;gap:11px;padding:2px 8px 22px}
.cs2-logo{width:38px;height:38px;border-radius:11px;background:#11131a;color:#fff;display:grid;place-items:center;font-weight:900;font-size:15px;flex-shrink:0}
.cs2-brand h1{font-size:15px;margin:0;font-weight:800}.cs2-brand p{font-size:12px;color:#8b91a0;margin:2px 0 0}
.cs2-section{font-size:11px;color:#959baa;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:18px 10px 8px}
.cs2-nav{display:grid;gap:3px}
.cs2-nav button{border:0;background:transparent;text-align:left;padding:9px 10px;border-radius:9px;color:#424755;display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13px;font-weight:500;width:100%}
.cs2-nav button:hover,.cs2-nav button.active{background:#f2efff;color:#6345f5}
.cs2-badge{margin-left:auto;background:#f0f1f4;color:#757b88;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:700}
.cs2-nav button.active .cs2-badge{background:#ede9ff;color:#6345f5}
.cs2-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
.cs2-user{margin-top:auto;border:1px solid #e5e7ee;border-radius:13px;padding:10px;display:flex;gap:9px;align-items:center}
.cs2-avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:800;flex-shrink:0}
.cs2-main{min-width:0;display:flex;flex-direction:column;height:100%;overflow:hidden}
.cs2-topbar{height:70px;background:#fff;border-bottom:1px solid #e5e7ee;padding:0 22px;display:flex;align-items:center;gap:10px;flex-shrink:0}
.cs2-topbar h2{margin:0;font-size:23px;font-weight:900;margin-right:auto;letter-spacing:-0.03em}
.cs2-btn{height:38px;border:1px solid #e1e4ea;background:#fff;border-radius:9px;padding:0 13px;cursor:pointer;font-size:13px;font-weight:500}
.cs2-btn.primary{background:#6c4cff;color:#fff;border-color:#6c4cff;font-weight:700}
.cs2-toolbar{display:flex;gap:9px;padding:16px 22px 14px;flex-wrap:wrap;flex-shrink:0;background:#f6f7fb}
.cs2-search{width:260px;height:40px;border:1px solid #e1e4ea;border-radius:10px;padding:0 13px;background:#fff;font-size:13px;outline:none}
.cs2-search:focus{border-color:#a78bfa}
.cs2-boardWrap{padding:0 22px 16px;overflow:auto;flex:1}
.cs2-board{min-width:1160px;display:grid;grid-template-columns:repeat(4,minmax(270px,1fr));gap:12px}
.cs2-column{background:#f1f2f5;border:1px solid #e0e3e8;border-radius:14px;padding:10px;min-height:650px}
.cs2-colHead{display:flex;align-items:center;gap:8px;padding:8px 4px 12px;font-weight:800;font-size:14px}
.cs2-colHead small{color:#8e94a2;font-weight:600;margin-left:4px}.cs2-colHead span.chevron{margin-left:auto;color:#9aa0ab;font-weight:400}
.cs2-card{background:#fff;border:1px solid #dfe2e8;border-radius:12px;padding:13px;margin-bottom:9px;cursor:pointer;transition:.15s;text-align:left;width:100%}
.cs2-card:hover{transform:translateY(-1px);border-color:#cfc7ff;box-shadow:0 8px 24px rgba(30,32,60,.06)}
.cs2-card.selected{outline:2px solid #7356ff}
.cs2-cardTop{display:flex;align-items:center;gap:8px}.cs2-cardTop strong{font-size:13px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs2-ago{margin-left:auto;color:#9aa0aa;font-size:11px;flex-shrink:0}
.cs2-preview{font-size:13px;line-height:1.42;color:#3f4450;margin:10px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs2-chips{display:flex;gap:5px;flex-wrap:wrap}.chip{font-size:10px;padding:4px 7px;border-radius:7px;background:#f2f3f5;color:#424755}
.chip.hot{background:#ffefed;color:#dd4435}.chip.ok{background:#e9f8f2;color:#11815c}.chip.warn{background:#fff2dd;color:#bd7200}
.cs2-meta{margin-top:12px;color:#8c929f;font-size:11px;display:flex;align-items:center}
.cs2-p1{color:#ef4444;font-weight:800}.cs2-p2{color:#d78b00;font-weight:800}
.cs2-mini{margin-left:auto;width:21px;height:21px;border-radius:50%;background:#252a36;color:#fff;display:grid;place-items:center;font-size:9px;flex-shrink:0}
.cs2-stats{height:70px;background:#fff;border-top:1px solid #e5e7ee;display:grid;grid-template-columns:repeat(5,1fr);flex-shrink:0}
.cs2-stat{padding:11px 20px;border-right:1px solid #eceef2}.cs2-stat small{color:#818795;font-size:11px}.cs2-stat b{display:block;font-size:19px;margin-top:3px;font-weight:800}
.cs2-drawer{position:fixed;top:0;right:-430px;width:420px;height:100vh;background:#fff;border-left:1px solid #e3e5ea;box-shadow:-16px 0 40px rgba(20,24,40,.1);z-index:30;padding:22px;display:flex;flex-direction:column;transition:right .22s}
.cs2-drawer.open{right:0}
.cs2-drawerHead{display:flex;align-items:center;gap:10px;padding-bottom:16px;border-bottom:1px solid #e5e7ee}
.cs2-drawerHead h3{margin:0;font-size:18px;font-weight:800}.cs2-close{margin-left:auto;border:0;background:#f1f2f5;width:32px;height:32px;border-radius:9px;cursor:pointer;font-size:18px;display:grid;place-items:center}
.cs2-thread{flex:1;overflow:auto;padding:18px 0}
.bubble{max-width:82%;padding:10px 12px;border-radius:14px;margin:8px 0;line-height:1.4;font-size:13px}
.bubble.customer{background:#eee9ff}
.bubble.agent{background:#eff1f4;margin-left:auto}
.cs2-composer{border:1px solid #e1e4ea;border-radius:14px;padding:10px;flex-shrink:0}
.cs2-composer textarea{width:100%;height:72px;border:0;outline:0;resize:none;font-size:13px;font-family:inherit}
.cs2-sendRow{text-align:right;margin-top:8px}
.cs2-toast{position:fixed;left:50%;bottom:86px;transform:translate(-50%,18px);background:#151821;color:#fff;padding:10px 15px;border-radius:10px;opacity:0;transition:.2s;z-index:50;pointer-events:none}
.cs2-toast.show{opacity:1;transform:translate(-50%,0)}
.cs2-addConv{text-align:center;color:#9aa0aa;padding:14px;font-size:13px}
`;

export default function CsInbox2() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerName, setDrawerName] = useState("");
  const [drawerInitials, setDrawerInitials] = useState("");
  const [drawerMessages, setDrawerMessages] = useState<{ type: "customer" | "agent"; text: string }[]>([]);
  const [replyText, setReplyText] = useState("");
  const [toast, setToast] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Static demo data matching the HTML exactly
  const DATA: Record<string, KanbanCard[]> = useMemo(() => ({
    "At Risk": [
      { id: 1, name: "Diana Clark",  initials: "DC", preview: "No response yet — move-out request waiting.", ago: "1h",  chips: ["Move-Out","4bd / 3ba","No Reply"], priority: "P1", amount: "$30" },
      { id: 2, name: "John Green",   initials: "JG", preview: "Customer has been waiting for a response.",   ago: "2h",  chips: ["Deep Clean","3bd / 2ba","Overdue"], priority: "P1", amount: "$25" },
      { id: 3, name: "Lisa Miller",  initials: "LM", preview: "High-value recurring customer needs attention.", ago: "3h", chips: ["Recurring","2bd / 1ba","High Value"], priority: "P1", amount: "$15" },
      { id: 4, name: "Paul Smith",   initials: "PS", preview: "Standard cleaning inquiry still unanswered.", ago: "4h",  chips: ["Standard","No Reply"], priority: "P2", amount: "$18" },
    ],
    "New": [
      { id: 5, name: "Sarah Johnson",  initials: "SJ", preview: "Hi! I need a deep clean for my 3bd/2ba this weekend. Do you have availability?", ago: "2m ago", chips: ["3bd / 2ba","Deep Clean","One-time"], priority: "P1", amount: "$25" },
      { id: 6, name: "David Martinez", initials: "DM", preview: "Move-out cleaning needed for my apartment. Need it by Friday.", ago: "5m ago", chips: ["Move-Out","1bd / 1ba"], priority: "P1", amount: "$22" },
      { id: 7, name: "Karen Williams", initials: "KW", preview: "Regular cleaning for my 2 bed, 1 bath condo. Looking for weekly service.", ago: "12m ago", chips: ["2bd / 1ba","Recurring"], priority: "P2", amount: "$18" },
      { id: 8, name: "James Taylor",   initials: "JT", preview: "Need quotes for post-construction cleaning. 2000 sq ft.", ago: "18m ago", chips: ["Post-Construction","Commercial"], priority: "P1", amount: "$30" },
    ],
    "Needs Response": [
      { id: 9,  name: "Ashley Moore", initials: "AM", preview: "Can you come tomorrow morning? I need the whole house cleaned.", ago: "15m", chips: ["4bd / 3ba","Deep Clean","🔥 Hot"], priority: "P1", amount: "$25" },
      { id: 10, name: "Robert Lee",   initials: "RL", preview: "What time can your team arrive on Saturday?", ago: "32m", chips: ["3bd / 2ba","Standard"], priority: "P2", amount: "$20" },
      { id: 11, name: "Maria Garcia", initials: "MG", preview: "This is urgent! Need someone today if possible.", ago: "41m", chips: ["2bd / 1ba","Deep Clean","Urgent"], priority: "P1", amount: "$25" },
      { id: 12, name: "Tom Wilson",   initials: "TW", preview: "Do you bring your own supplies and equipment?", ago: "1h", chips: ["General"], priority: "P3", amount: "$15" },
    ],
    "On Customer": [
      { id: 13, name: "Brian Cooper",   initials: "BC", preview: "Thanks! That works for me. See you then.", ago: "1h", chips: ["Confirmed","Sat 10AM","3bd / 2ba"], priority: "P2", amount: "$20" },
      { id: 14, name: "Samantha Lee",   initials: "SL", preview: "What's included in the deep cleaning service?", ago: "2h", chips: ["Deep Clean"], priority: "P2", amount: "$25" },
      { id: 15, name: "Michael Patel",  initials: "MP", preview: "I'll send the access code for the lockbox.", ago: "3h", chips: ["Access Info"], priority: "P2", amount: "$18" },
      { id: 16, name: "Emily Chen",     initials: "EC", preview: "Perfect! Looking forward to it.", ago: "4h", chips: ["Confirmed","Sun 2PM"], priority: "P2", amount: "$20" },
    ],
  }), []);

  const columns: KanbanColumn[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(DATA).map(([label, cards]) => {
      let filtered = cards.filter(c =>
        (c.name + " " + c.preview).toLowerCase().includes(q)
      );
      if (filter !== "all" && filter !== "hot" && label !== filter) filtered = [];
      if (filter === "hot") filtered = filtered.filter(c => c.chips.join(" ").includes("Hot"));
      return { label, cards: filtered };
    });
  }, [DATA, query, filter]);

  function openCard(card: KanbanCard) {
    setSelectedCardId(String(card.id));
    setDrawerName(card.name);
    setDrawerInitials(card.initials);
    setDrawerMessages([
      { type: "agent", text: "Hi! This is Madison from Maids in Black. How can I help?" },
      { type: "customer", text: card.preview },
    ]);
    setDrawerOpen(true);
  }

  function sendReply() {
    if (!replyText.trim()) return;
    setDrawerMessages(prev => [...prev, { type: "agent", text: replyText.trim() }]);
    setReplyText("");
    setToast(true);
    setTimeout(() => setToast(false), 1300);
  }

  const totalCards = Object.values(DATA).flat().length;
  const needsResponseCount = DATA["Needs Response"].length;

  return (
    <>
      <style>{STYLES}</style>
      <div className="cs2-app">
        {/* ── SIDEBAR ── */}
        <aside className="cs2-sidebar">
          <div className="cs2-brand">
            <div className="cs2-logo">M</div>
            <div>
              <h1>Maids in Black</h1>
              <p>Customer Inbox</p>
            </div>
          </div>

          <div className="cs2-section">Inbox</div>
          <div className="cs2-nav">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
              ▣ <span>All Conversations</span><span className="cs2-badge">{totalCards}</span>
            </button>
          </div>

          <div className="cs2-section">Views</div>
          <div className="cs2-nav">
            <button className={filter === "Needs Response" ? "active" : ""} onClick={() => setFilter("Needs Response")}>
              <span className="cs2-dot" style={{background:"#13b77a"}} />
              <span>Needs Response</span>
              <span className="cs2-badge">{needsResponseCount}</span>
            </button>
            <button className={filter === "At Risk" ? "active" : ""} onClick={() => setFilter("At Risk")}>
              <span className="cs2-dot" style={{background:"#ff9f1a"}} />
              <span>Unanswered</span>
              <span className="cs2-badge">{DATA["At Risk"].length}</span>
            </button>
            <button className={filter === "hot" ? "active" : ""} onClick={() => setFilter("hot")}>
              <span className="cs2-dot" style={{background:"#ff5f8f"}} />
              <span>Hot Leads</span>
              <span className="cs2-badge">6</span>
            </button>
            <button>
              <span className="cs2-dot" style={{background:"#5fa7ff"}} />
              <span>Returning Customers</span>
              <span className="cs2-badge">11</span>
            </button>
            <button>
              <span className="cs2-dot" style={{background:"#9a7cff"}} />
              <span>Move-Outs</span>
              <span className="cs2-badge">5</span>
            </button>
          </div>

          <div className="cs2-section">Teams</div>
          <div className="cs2-nav">
            <button>▦ <span>Dispatch</span><span className="cs2-badge">6</span></button>
            <button>▦ <span>Sales</span><span className="cs2-badge">8</span></button>
          </div>

          <div className="cs2-user">
            <div className="cs2-avatar" style={{background:"#222"}}>M</div>
            <div>
              <b>Madison</b>
              <div style={{color:"#8b91a0",fontSize:"11px"}}>Support Agent</div>
            </div>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className="cs2-main">
          <header className="cs2-topbar">
            <h2>All Conversations</h2>
            <button className="cs2-btn">▦</button>
            <button className="cs2-btn" onClick={() => setQuery("")}>↻</button>
            <button className="cs2-btn primary">✎ New Message</button>
          </header>

          <div className="cs2-toolbar">
            <input
              className="cs2-search"
              placeholder="⌕  Search conversations..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <button className="cs2-btn">Last 90 days⌄</button>
            <button className="cs2-btn">Assignee: All⌄</button>
            <button className="cs2-btn">Team: All⌄</button>
            <button className="cs2-btn">☰ Filters</button>
          </div>

          <div className="cs2-boardWrap">
            <div className="cs2-board">
              {columns.map((col, ci) => (
                <section key={col.label} className="cs2-column">
                  <div className="cs2-colHead">
                    <span className="cs2-dot" style={{background: HEAD_COLORS[col.label] ?? "#888"}} />
                    {col.label}
                    <small>{col.cards.length}</small>
                    <span className="chevron">⌄</span>
                  </div>
                  {col.cards.map((card, i) => (
                    <button
                      key={card.id}
                      className={`cs2-card${selectedCardId === String(card.id) ? " selected" : ""}`}
                      onClick={() => openCard(card)}
                    >
                      <div className="cs2-cardTop">
                        <div className="cs2-avatar" style={{background: COLORS[i % COLORS.length]}}>{card.initials}</div>
                        <strong>{card.name}</strong>
                        <span className="cs2-ago">{card.ago}</span>
                      </div>
                      <div className="cs2-preview">{card.preview}</div>
                      <div className="cs2-chips">
                        {card.chips.map(c => (
                          <span key={c} className={chipClass(c)}>{c}</span>
                        ))}
                      </div>
                      <div className="cs2-meta">
                        <span className={card.priority === "P1" ? "cs2-p1" : card.priority === "P2" ? "cs2-p2" : ""}>{card.priority}</span>
                        &nbsp;·&nbsp;{card.amount}
                        <span className="cs2-mini">M</span>
                      </div>
                    </button>
                  ))}
                  <div className="cs2-addConv">＋ Add Conversation</div>
                </section>
              ))}
            </div>
          </div>

          <footer className="cs2-stats">
            <div className="cs2-stat"><small>Total Conversations</small><b>52</b></div>
            <div className="cs2-stat"><small>Needs Response</small><b>18</b></div>
            <div className="cs2-stat"><small>Avg Response Time</small><b>12m</b></div>
            <div className="cs2-stat"><small>Conversion Rate</small><b>24%</b></div>
            <div className="cs2-stat"><small>Revenue This Month</small><b>$28,450</b></div>
          </footer>
        </main>
      </div>

      {/* ── DRAWER ── */}
      <div className={`cs2-drawer${drawerOpen ? " open" : ""}`}>
        <div className="cs2-drawerHead">
          <div className="cs2-avatar" style={{background:"#6c4cff",width:"38px",height:"38px",fontSize:"13px"}}>{drawerInitials}</div>
          <div>
            <h3>{drawerName}</h3>
            <div style={{color:"#8b91a0",fontSize:"12px"}}>Customer conversation</div>
          </div>
          <button className="cs2-close" onClick={() => setDrawerOpen(false)}>×</button>
        </div>
        <div className="cs2-thread">
          {drawerMessages.map((m, i) => (
            <div key={i} className={`bubble ${m.type}`}>{m.text}</div>
          ))}
        </div>
        <div className="cs2-composer">
          <textarea
            placeholder="Reply to customer..."
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendReply(); }}
          />
          <div className="cs2-sendRow">
            <button className="cs2-btn primary" onClick={sendReply}>Send reply</button>
          </div>
        </div>
      </div>

      {/* ── TOAST ── */}
      <div className={`cs2-toast${toast ? " show" : ""}`}>Sent ✓</div>
    </>
  );
}
