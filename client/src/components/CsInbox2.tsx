import React, { useState, useMemo, useRef, useEffect } from "react";

/* ─────────────────────────────────────────────────────────────────────────
   CsInbox2
   • Default view: sidebar (260px) + kanban board (4 columns)
   • Card selected: full 4-col shell — rail (72px) + list (310px) + thread + right panel
   All CSS inline — no Tailwind dependency.
───────────────────────────────────────────────────────────────────────── */

const COLORS = ["#6d4aff","#10b981","#f97316","#3478f6","#ef4444","#a855f7"];
const HEAD_COLORS: Record<string,string> = {
  "At Risk":"#ff9f1a","New":"#3478f6","Needs Response":"#13b77a","On Customer":"#8b5cf6"
};

type KanbanCard = {
  id: number; name: string; initials: string; preview: string;
  ago: string; chips: string[]; priority: string; amount: string;
};

function chipClass(c: string) {
  if (/Hot|Urgent|High Value/.test(c)) return "chip hot";
  if (/Confirmed/.test(c)) return "chip ok";
  if (/No Reply|Overdue/.test(c)) return "chip warn";
  return "chip";
}

const STYLES = `
*{box-sizing:border-box}
/* ── BOARD VIEW ── */
.cs2-app{position:fixed;inset:0;display:grid;grid-template-columns:260px minmax(0,1fr);background:#f6f7fb;color:#181a24;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px}
.cs2-sidebar{background:#fff;border-right:1px solid #e5e7ee;padding:18px 14px;display:flex;flex-direction:column;overflow-y:auto;height:100%}
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
.cs2-main{min-width:0;display:flex;flex-direction:column;overflow:hidden;height:100%}
.cs2-topbar{height:70px;background:#fff;border-bottom:1px solid #e5e7ee;padding:0 22px;display:flex;align-items:center;gap:10px;flex-shrink:0}
.cs2-topbar h2{margin:0;font-size:23px;font-weight:900;margin-right:auto;letter-spacing:-0.03em}
.cs2-btn{height:38px;border:1px solid #e1e4ea;background:#fff;border-radius:9px;padding:0 13px;cursor:pointer;font-size:13px;font-weight:500}
.cs2-btn.primary{background:#6c4cff;color:#fff;border-color:#6c4cff;font-weight:700}
.cs2-toolbar{display:flex;gap:9px;padding:16px 22px 14px;flex-wrap:wrap;flex-shrink:0;background:#f6f7fb}
.cs2-search{width:260px;height:40px;border:1px solid #e1e4ea;border-radius:10px;padding:0 13px;background:#fff;font-size:13px;outline:none}
.cs2-search:focus{border-color:#a78bfa}
.cs2-boardWrap{padding:0 22px 16px;overflow-x:auto;overflow-y:hidden;flex:1;min-height:0;display:flex;flex-direction:column}
.cs2-board{min-width:1160px;display:grid;grid-template-columns:repeat(4,minmax(270px,1fr));gap:12px;flex:1;min-height:0;align-items:stretch}
.cs2-column{background:#f1f2f5;border:1px solid #e0e3e8;border-radius:14px;padding:10px;display:flex;flex-direction:column;overflow:hidden;min-height:0}
.cs2-colCards{flex:1;overflow-y:auto;overflow-x:hidden;padding-right:2px;scrollbar-width:none;-ms-overflow-style:none}
.cs2-colCards::-webkit-scrollbar{display:none}
.cs2-colHead{display:flex;align-items:center;gap:8px;padding:8px 4px 12px;font-weight:800;font-size:14px;flex-shrink:0}
.cs2-colHead small{color:#8e94a2;font-weight:600;margin-left:4px}.cs2-colHead .chevron{margin-left:auto;color:#9aa0ab;font-weight:400}
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
.cs2-addConv{text-align:center;color:#9aa0aa;padding:14px;font-size:13px}

/* ── DETAIL VIEW (card selected) ── */
.cs2-shell{position:fixed;inset:0;display:grid;grid-template-columns:72px 310px minmax(580px,1fr) 370px;background:#fff;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;color:#101116}
.cs2-rail{background:#111219;color:#fff;padding:18px 13px;display:flex;flex-direction:column;align-items:center;gap:12px}
.cs2-rail-logo{width:42px;height:42px;border-radius:13px;background:#fff;color:#111;display:grid;place-items:center;font-weight:950;font-size:20px;margin-bottom:14px}
.cs2-rbtn{width:42px;height:42px;border:0;border-radius:12px;background:transparent;color:#9da2ae;font-size:18px;cursor:pointer}
.cs2-rbtn:hover,.cs2-rbtn.on{background:#272832;color:#fff}
.cs2-list{background:#fafbfc;border-right:1px solid #e7e9ee;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.cs2-listhead{padding:21px 18px 13px;border-bottom:1px solid #e7e9ee;flex-shrink:0}
.cs2-eyebrow{text-transform:uppercase;letter-spacing:.12em;font-weight:800;font-size:9px;color:#9ca1ad}
.cs2-listhead h1{font-size:19px;margin:5px 0 14px;font-weight:900}
.cs2-listsearch{height:36px;border:1px solid #e2e4e9;background:#fff;border-radius:10px;padding:0 11px;display:flex;align-items:center;color:#a0a5af;font-size:12px}
.cs2-listsearch input{border:0;outline:0;width:100%;margin-left:7px;font-size:12px}
.cs2-tabs{display:flex;gap:6px;margin-top:12px}
.cs2-tab{border:0;background:transparent;border-radius:8px;padding:7px 9px;font-size:10px;color:#777d89;cursor:pointer}
.cs2-tab.on{background:#eeeaff;color:#5e43e8;font-weight:800}
.cs2-tickets{overflow:auto;padding:8px;flex:1;scrollbar-width:none}
.cs2-tickets::-webkit-scrollbar{display:none}
.cs2-ticket{position:relative;padding:13px 12px;margin:4px 0;border-radius:13px;cursor:pointer;border:1px solid transparent}
.cs2-ticket:hover{background:#fff;border-color:#e7e8ed}
.cs2-ticket.on{background:#fff;border-color:#ded8ff;box-shadow:0 8px 28px rgba(56,42,127,.08)}
.cs2-ticket.on:before{content:"";position:absolute;left:-1px;top:12px;bottom:12px;width:3px;border-radius:4px;background:#6b4eff}
.cs2-trow{display:flex;align-items:center;gap:8px}
.cs2-mini2{width:30px;height:30px;border-radius:9px;background:#eae6ff;color:#6249e9;display:grid;place-items:center;font-weight:800;font-size:11px;flex-shrink:0}
.cs2-tname{font-weight:780}
.cs2-tage{margin-left:auto;color:#9da2ad;font-size:10px}
.cs2-tage.risk{color:#d34e42}
.cs2-tpreview{margin:8px 0 9px 38px;color:#626875;font-size:11px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cs2-ttags{margin-left:38px}
.cs2-ttag{display:inline-block;font-size:9px;padding:4px 6px;border-radius:6px;background:#f0f1f4;color:#6d7380;margin-right:3px}
.cs2-ttag.hot{background:#fff0ed;color:#d14a3f}
.cs2-dmain{min-width:0;display:flex;flex-direction:column;background:#fff;overflow:hidden}
.cs2-dtop{height:72px;border-bottom:1px solid #e7e9ee;display:flex;align-items:center;padding:0 24px;gap:12px;flex-shrink:0}
.cs2-davatar{width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,#7a60ff,#5b3ee7);color:#fff;display:grid;place-items:center;font-weight:900;font-size:14px;box-shadow:0 6px 16px rgba(91,62,231,.18);flex-shrink:0}
.cs2-didentity h2{font-size:16px;margin:0 0 3px;font-weight:800}
.cs2-didentity span{font-size:10px;color:#9298a3}
.cs2-dtopActions{margin-left:auto;display:flex;gap:7px}
.cs2-iconBtn{height:34px;border:1px solid #e2e4e9;background:#fff;border-radius:9px;padding:0 10px;cursor:pointer;font-size:12px}
.cs2-resolve{color:#167a5c;background:#effaf6;border-color:#d8f0e7}
.cs2-context{padding:15px 24px 4px;flex-shrink:0}
.cs2-ai{background:linear-gradient(110deg,#f7f5ff,#fbfaff);border:1px solid #ebe7ff;border-radius:14px;padding:12px 14px;line-height:1.5;color:#555b68;font-size:12px}
.cs2-ai strong{color:#5d43df}
.cs2-aichips{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}
.cs2-aichip{font-size:9px;border:1px solid #e5e7eb;border-radius:999px;padding:5px 8px;color:#707683}
.cs2-aichip.green{background:#effaf6;border-color:#d8f0e7;color:#17765a}
.cs2-thread{flex:1;overflow:auto;padding:17px 30px 12px;scrollbar-width:none}
.cs2-thread::-webkit-scrollbar{display:none}
.cs2-day{text-align:center;color:#aaaeb7;font-size:9px;margin:7px;text-transform:uppercase;letter-spacing:.08em}
.cs2-msg{max-width:68%;margin:14px 0}
.cs2-msg.out{margin-left:auto}
.cs2-mmeta{font-size:9px;color:#9ba0aa;margin:0 4px 4px}
.cs2-msg.out .cs2-mmeta{text-align:right}
.cs2-bubble{padding:11px 13px;border-radius:16px;background:#f0ecff;line-height:1.48;font-size:12px}
.cs2-msg.out .cs2-bubble{background:#f1f2f4}
.cs2-msg.latest .cs2-bubble{box-shadow:0 0 0 2px rgba(107,78,255,.08)}
.cs2-composer{padding:10px 24px 20px;border-top:1px solid #f0f1f3;flex-shrink:0}
.cs2-composeBox{border:1px solid #dfe1e6;border-radius:14px;padding:10px 11px;box-shadow:0 8px 30px rgba(30,31,45,.05)}
.cs2-composeBox:focus-within{border-color:#bdb2ff;box-shadow:0 8px 30px rgba(70,53,159,.08),0 0 0 3px #f2efff}
.cs2-composeBox textarea{width:100%;height:55px;border:0;outline:0;resize:none;font-size:13px;font-family:inherit}
.cs2-composeRow{display:flex;align-items:center;gap:6px;margin-top:8px}
.cs2-quick{border:0;background:#f4f4f6;border-radius:8px;padding:7px 9px;font-size:9px;cursor:pointer}
.cs2-send{margin-left:auto;border:0;background:#684bfa;color:#fff;border-radius:9px;padding:8px 17px;font-weight:750;cursor:pointer;box-shadow:0 5px 13px rgba(104,75,250,.2)}
.cs2-side{border-left:1px solid #e7e9ee;background:#f8f9fb;overflow:auto;padding:17px 15px;scrollbar-width:none}
.cs2-side::-webkit-scrollbar{display:none}
.cs2-sideTitle{display:flex;align-items:end;justify-content:space-between;margin:2px 3px 12px}
.cs2-sideTitle b{font-size:14px;font-weight:800}.cs2-sideTitle span{font-size:9px;color:#9da2ad}
.cs2-scard{background:#fff;border:1px solid #e6e8ed;border-radius:15px;margin-bottom:11px;overflow:hidden;box-shadow:0 3px 12px rgba(20,21,35,.02)}
.cs2-scardHead{padding:12px 13px;border-bottom:1px solid #eef0f2;display:flex;align-items:center;font-weight:800;font-size:11px}
.cs2-scardHead .link{margin-left:auto;color:#674cf1;font-size:9px;cursor:pointer}
.cs2-rows{padding:6px 13px}
.cs2-row{display:grid;grid-template-columns:105px 1fr;padding:6px 0;font-size:10px}
.cs2-row span:first-child{color:#9aa0ab}.cs2-row strong{font-weight:750}
.cs2-job{margin:10px 12px;padding:11px;border-radius:11px;background:#f7f8fa;border:1px solid #eff0f3}
.cs2-live{float:right;background:#e9f8f2;color:#137a5b;padding:4px 7px;border-radius:20px;font-size:8px;font-weight:800}
.cs2-job h3{font-size:12px;margin:6px 0 3px;font-weight:800}.cs2-job p{font-size:9px;color:#7d838e;margin:3px 0}
.cs2-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 12px 12px}
.cs2-act{border:1px solid #e0e2e7;background:#fff;border-radius:8px;padding:8px;font-size:9px;cursor:pointer;font-weight:600}
.cs2-act.primary{background:#684bfa;color:#fff;border-color:#684bfa}
.cs2-teamHero{padding:11px 13px;display:flex;align-items:center;gap:9px}
.cs2-teamAv{width:34px;height:34px;border-radius:10px;background:#151621;color:#fff;display:grid;place-items:center;font-size:10px;font-weight:800;flex-shrink:0}
.cs2-teamHero b{font-size:11px}.cs2-teamHero small{display:block;color:#969ca7;margin-top:2px;font-size:9px}
.cs2-mission{padding:10px 12px;border-bottom:1px solid #eff0f2;cursor:pointer;transition:.15s;display:flex;align-items:flex-start;gap:9px}
.cs2-mission:last-child{border:0}.cs2-mission:hover{background:#faf9ff}
.cs2-mico{width:27px;height:27px;border-radius:8px;background:#f0edff;display:grid;place-items:center;flex-shrink:0;font-size:13px}
.cs2-mission b{font-size:10px;font-weight:800}.cs2-mission p{margin:3px 0 0;color:#9298a4;font-size:9px}
.cs2-back{border:0;background:transparent;color:#6b4eff;font-size:12px;cursor:pointer;padding:0;font-weight:700;display:flex;align-items:center;gap:4px}
/* ── TOAST ── */
.cs2-toast{position:fixed;bottom:22px;left:50%;transform:translate(-50%,6px);background:#151821;color:#fff;border-radius:9px;padding:9px 14px;font-size:11px;opacity:0;transition:.2s;z-index:999;pointer-events:none}
.cs2-toast.show{opacity:1;transform:translate(-50%,0)}
`;

const DEMO_CARDS: KanbanCard[] = [
  { id:1, name:"Ashley Moore",   initials:"AM", preview:"Can you come tomorrow morning? I need the whole house cleaned.", ago:"15m", chips:["4bd / 3ba","Deep Clean","🔥 Hot"], priority:"P1", amount:"$25" },
  { id:2, name:"Robert Lee",     initials:"RL", preview:"What time can your team arrive on Saturday?",                    ago:"32m", chips:["3bd / 2ba","Standard"],              priority:"P2", amount:"$20" },
  { id:3, name:"Maria Garcia",   initials:"MG", preview:"This is urgent! Need someone today if possible.",                ago:"41m", chips:["2bd / 1ba","Deep Clean","Urgent"],   priority:"P1", amount:"$25" },
  { id:4, name:"Tom Wilson",     initials:"TW", preview:"Do you bring your own supplies and equipment?",                  ago:"1h",  chips:["General"],                           priority:"P3", amount:"$15" },
  { id:5, name:"Diana Clark",    initials:"DC", preview:"No response yet — move-out request waiting.",                    ago:"1h",  chips:["Move-Out","4bd / 3ba","No Reply"],   priority:"P1", amount:"$30" },
  { id:6, name:"John Green",     initials:"JG", preview:"Customer has been waiting for a response.",                      ago:"2h",  chips:["Deep Clean","3bd / 2ba","Overdue"],  priority:"P1", amount:"$25" },
  { id:7, name:"Sarah Johnson",  initials:"SJ", preview:"Hi! I need a deep clean for my 3bd/2ba this weekend.",           ago:"2m",  chips:["3bd / 2ba","Deep Clean","One-time"], priority:"P1", amount:"$25" },
  { id:8, name:"David Martinez", initials:"DM", preview:"Move-out cleaning needed for my apartment. Need it by Friday.",  ago:"5m",  chips:["Move-Out","1bd / 1ba"],              priority:"P1", amount:"$22" },
  { id:9, name:"Brian Cooper",   initials:"BC", preview:"Thanks! That works for me. See you then.",                       ago:"1h",  chips:["Confirmed","Sat 10AM"],              priority:"P2", amount:"$20" },
  { id:10,name:"Emily Chen",     initials:"EC", preview:"Perfect! Looking forward to it.",                                ago:"4h",  chips:["Confirmed","Sun 2PM"],               priority:"P2", amount:"$20" },
];

const BOARD_DATA: Record<string,KanbanCard[]> = {
  "At Risk":        [DEMO_CARDS[4], DEMO_CARDS[5]],
  "New":            [DEMO_CARDS[6], DEMO_CARDS[7]],
  "Needs Response": [DEMO_CARDS[0], DEMO_CARDS[1], DEMO_CARDS[2], DEMO_CARDS[3]],
  "On Customer":    [DEMO_CARDS[8], DEMO_CARDS[9]],
};

export default function CsInbox2() {
  const [query, setQuery]           = useState("");
  const [filter, setFilter]         = useState("all");
  const [selected, setSelected]     = useState<KanbanCard | null>(null);
  const [messages, setMessages]     = useState<{out:boolean;who:string;time:string;text:string}[]>([
    { out:true,  who:"Madison", time:"9:12 AM", text:"Hi! 😊 Madison from Maids in Black. What day were you thinking for the cleaning?" },
    { out:false, who:"Customer",time:"9:15 AM", text:"Tomorrow if possible. It's 4 bedrooms and 3 bathrooms." },
    { out:true,  who:"Madison", time:"9:17 AM", text:"Absolutely. For a deep clean, most homes that size land around $329–$369 depending on condition. Would morning or afternoon work better?" },
  ]);
  const [reply, setReply]           = useState("");
  const [toast, setToast]           = useState("");
  const [missionDone, setMissionDone] = useState<Set<number>>(new Set());
  const threadRef = useRef<HTMLDivElement>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 1200);
  }

  function sendReply() {
    if (!reply.trim()) return;
    setMessages(prev => [...prev, { out:true, who:"Madison", time: new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}), text:reply.trim() }]);
    setReply("");
    showToast("Reply sent ✓");
  }

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, selected]);

  const columns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(BOARD_DATA).map(([label, cards]) => {
      let filtered = cards.filter(c => (c.name+" "+c.preview).toLowerCase().includes(q));
      if (filter !== "all" && filter !== "hot" && label !== filter) filtered = [];
      if (filter === "hot") filtered = filtered.filter(c => c.chips.join(" ").includes("Hot"));
      return { label, cards: filtered };
    });
  }, [query, filter]);

  const totalCards = Object.values(BOARD_DATA).flat().length;

  // ── DETAIL VIEW ──
  if (selected) {
    const listCards = DEMO_CARDS;
    const lastMsg = messages[messages.length - 1];
    return (
      <>
        <style>{STYLES}</style>
        <div className="cs2-shell">
          {/* Rail */}
          <nav className="cs2-rail">
            <div className="cs2-rail-logo">M</div>
            <button className="cs2-rbtn" title="Home">⌂</button>
            <button className="cs2-rbtn on" title="Inbox">✉</button>
            <button className="cs2-rbtn" title="Tasks">✓</button>
            <button className="cs2-rbtn" title="Analytics">⌁</button>
            <button className="cs2-rbtn" title="AI">✦</button>
            <button className="cs2-rbtn" style={{marginTop:"auto"}} onClick={() => setSelected(null)} title="Back to board">←</button>
          </nav>

          {/* Conversation list */}
          <aside className="cs2-list">
            <div className="cs2-listhead">
              <div className="cs2-eyebrow">Customer inbox</div>
              <h1>Needs Response <span style={{color:"#a0a5af",fontWeight:500}}>{listCards.length}</span></h1>
              <div className="cs2-listsearch">⌕ <input placeholder="Search conversations" /></div>
              <div className="cs2-tabs">
                <button className="cs2-tab on">All</button>
                <button className="cs2-tab">🔥 Leads</button>
                <button className="cs2-tab">👷 Teams</button>
              </div>
            </div>
            <div className="cs2-tickets">
              {listCards.map((card, i) => (
                <div
                  key={card.id}
                  className={`cs2-ticket${selected.id === card.id ? " on" : ""}`}
                  onClick={() => setSelected(card)}
                >
                  <div className="cs2-trow">
                    <div className="cs2-mini2">{card.initials}</div>
                    <span className="cs2-tname">{card.name}</span>
                    <span className={`cs2-tage${card.priority === "P1" && card.chips.some(c => /No Reply|Overdue|Urgent/.test(c)) ? " risk" : ""}`}>{card.ago}</span>
                  </div>
                  <div className="cs2-tpreview">{card.preview}</div>
                  <div className="cs2-ttags">
                    {card.chips.slice(0,2).map(c => (
                      <span key={c} className={`cs2-ttag${/Hot|Urgent|At Risk|No Reply/.test(c) ? " hot" : ""}`}>{c}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* Thread */}
          <main className="cs2-dmain">
            <header className="cs2-dtop">
              <div className="cs2-davatar">{selected.initials}</div>
              <div className="cs2-didentity">
                <h2>{selected.name}</h2>
                <span>+1 (202) 555-0148 · Washington, DC · New customer</span>
              </div>
              <div className="cs2-dtopActions">
                <button className="cs2-iconBtn">•••</button>
                <button className="cs2-iconBtn cs2-resolve">✓ Resolve</button>
              </div>
            </header>

            <div className="cs2-context">
              <div className="cs2-ai">
                <strong>✦ Madison</strong>&nbsp; {selected.name} wants a deep clean for a 4 bed / 3 bath home tomorrow morning. She has been quoted $329–$369 and is ready to choose a slot.
              </div>
              <div className="cs2-aichips">
                <span className="cs2-aichip green">● Needs response</span>
                {selected.chips.map(c => <span key={c} className="cs2-aichip">{c}</span>)}
              </div>
            </div>

            <section className="cs2-thread" ref={threadRef}>
              <div className="cs2-day">Today</div>
              {messages.map((m, i) => (
                <div key={i} className={`cs2-msg${m.out ? " out" : ""}${i === messages.length-1 ? " latest" : ""}`}>
                  <div className="cs2-mmeta">{m.who} · {m.time}</div>
                  <div className="cs2-bubble">{m.text}</div>
                </div>
              ))}
              {lastMsg && !lastMsg.out && (
                <div className="cs2-msg latest">
                  <div className="cs2-mmeta">{selected.name} · just now</div>
                  <div className="cs2-bubble">{selected.preview}</div>
                </div>
              )}
            </section>

            <footer className="cs2-composer">
              <div className="cs2-composeBox">
                <textarea
                  placeholder={`Reply to ${selected.name.split(" ")[0]}…`}
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendReply(); }}
                />
                <div className="cs2-composeRow">
                  <button className="cs2-quick" onClick={() => setReply("Yes! We have a morning opening 😊")}>Morning opening</button>
                  <button className="cs2-quick" onClick={() => setReply("Let me check with the team and get right back to you.")}>Check team</button>
                  <button className="cs2-quick">+ More</button>
                  <button className="cs2-send" onClick={sendReply}>Send ↗</button>
                </div>
              </div>
            </footer>
          </main>

          {/* Right panel */}
          <aside className="cs2-side">
            <div className="cs2-sideTitle"><b>Customer command center</b><span>LIVE CONTEXT</span></div>

            <section className="cs2-scard">
              <div className="cs2-scardHead">Customer <span className="link">Edit</span></div>
              <div className="cs2-rows">
                {[["Name",selected.name],["Phone","(202) 555-0148"],["Address","Washington, DC"],["Customer","New"],["Past jobs","0"],["Lead source","Thumbtack"]].map(([k,v]) => (
                  <div key={k} className="cs2-row"><span>{k}</span><strong>{v}</strong></div>
                ))}
              </div>
            </section>

            <section className="cs2-scard">
              <div className="cs2-scardHead">Today's / Next Job <span className="link">Open ↗</span></div>
              <div className="cs2-job">
                <span className="cs2-live">SCHEDULED</span>
                <b>Deep Clean</b>
                <h3>Tomorrow · 9:00 AM</h3>
                <p>4 bedrooms · 3 bathrooms</p>
                <p>Washington, DC · $349</p>
              </div>
              <div className="cs2-actions">
                <button className="cs2-act primary" onClick={() => showToast("ETA request started")}>Send ETA</button>
                <button className="cs2-act">View booking</button>
              </div>
            </section>

            <section className="cs2-scard">
              <div className="cs2-scardHead">Team <span className="link">Change</span></div>
              <div className="cs2-teamHero">
                <div className="cs2-teamAv">TP</div>
                <div><b>Team Pilar</b><small>Last assigned team · 4.9 ★</small></div>
              </div>
              <div className="cs2-rows">
                {[["Current ETA","Not requested"],["Last service","—"]].map(([k,v]) => (
                  <div key={k} className="cs2-row"><span>{k}</span><strong>{v}</strong></div>
                ))}
              </div>
              <div className="cs2-actions">
                <button className="cs2-act" onClick={() => showToast("Team conversation opened")}>Text team</button>
                <button className="cs2-act">Assign team</button>
              </div>
            </section>

            <section className="cs2-scard">
              <div className="cs2-scardHead">Missions <span className="link">+ Add</span></div>
              {[
                { id:1, icon:"✦", title:"Confirm tomorrow's slot",  desc:"Lock in the 9 AM opening." },
                { id:2, icon:"💳", title:"Get card on file",         desc:"Required before appointment." },
                { id:3, icon:"📍", title:"Confirm full address",     desc:"Street address still missing." },
              ].map(m => (
                <div
                  key={m.id}
                  className="cs2-mission"
                  style={{opacity: missionDone.has(m.id) ? 0.42 : 1}}
                  onClick={() => { setMissionDone(prev => new Set([...prev, m.id])); showToast("Mission completed ✓"); }}
                >
                  <div className="cs2-mico">{m.icon}</div>
                  <div><b>{m.title}</b><p>{m.desc}</p></div>
                </div>
              ))}
            </section>

            <section className="cs2-scard">
              <div className="cs2-scardHead">Conversation</div>
              <div className="cs2-rows">
                {[["Status","Needs Response"],["Queue","Sales"],["Priority","🔥 Hot Lead"],["Waiting","15 minutes"]].map(([k,v]) => (
                  <div key={k} className="cs2-row"><span>{k}</span><strong>{v}</strong></div>
                ))}
              </div>
            </section>
          </aside>
        </div>
        <div className={`cs2-toast${toast ? " show" : ""}`}>{toast}</div>
      </>
    );
  }

  // ── BOARD VIEW ──
  return (
    <>
      <style>{STYLES}</style>
      <div className="cs2-app">
        <aside className="cs2-sidebar">
          <div className="cs2-brand">
            <div className="cs2-logo">M</div>
            <div><h1>Maids in Black</h1><p>Customer Inbox</p></div>
          </div>
          <div className="cs2-section">Inbox</div>
          <div className="cs2-nav">
            <button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>
              ▣ <span>All Conversations</span><span className="cs2-badge">{totalCards}</span>
            </button>
          </div>
          <div className="cs2-section">Views</div>
          <div className="cs2-nav">
            <button className={filter==="Needs Response"?"active":""} onClick={()=>setFilter("Needs Response")}>
              <span className="cs2-dot" style={{background:"#13b77a"}}/><span>Needs Response</span><span className="cs2-badge">{BOARD_DATA["Needs Response"].length}</span>
            </button>
            <button className={filter==="At Risk"?"active":""} onClick={()=>setFilter("At Risk")}>
              <span className="cs2-dot" style={{background:"#ff9f1a"}}/><span>Unanswered</span><span className="cs2-badge">{BOARD_DATA["At Risk"].length}</span>
            </button>
            <button className={filter==="hot"?"active":""} onClick={()=>setFilter("hot")}>
              <span className="cs2-dot" style={{background:"#ff5f8f"}}/><span>Hot Leads</span><span className="cs2-badge">6</span>
            </button>
            <button><span className="cs2-dot" style={{background:"#5fa7ff"}}/><span>Returning Customers</span><span className="cs2-badge">11</span></button>
            <button><span className="cs2-dot" style={{background:"#9a7cff"}}/><span>Move-Outs</span><span className="cs2-badge">5</span></button>
          </div>
          <div className="cs2-section">Teams</div>
          <div className="cs2-nav">
            <button>▦ <span>Dispatch</span><span className="cs2-badge">6</span></button>
            <button>▦ <span>Sales</span><span className="cs2-badge">8</span></button>
          </div>
          <div className="cs2-user">
            <div className="cs2-avatar" style={{background:"#222"}}>M</div>
            <div><b>Madison</b><div style={{color:"#8b91a0",fontSize:"11px"}}>Support Agent</div></div>
          </div>
        </aside>

        <main className="cs2-main">
          <header className="cs2-topbar">
            <h2>All Conversations</h2>
            <button className="cs2-btn">▦</button>
            <button className="cs2-btn" onClick={()=>setQuery("")}>↻</button>
            <button className="cs2-btn primary">✎ New Message</button>
          </header>
          <div className="cs2-toolbar">
            <input className="cs2-search" placeholder="⌕  Search conversations..." value={query} onChange={e=>setQuery(e.target.value)}/>
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
                    <span className="cs2-dot" style={{background:HEAD_COLORS[col.label]??"#888"}}/>
                    {col.label}
                    <small>{col.cards.length}</small>
                    <span className="chevron">⌄</span>
                  </div>
                  <div className="cs2-colCards">
                    {col.cards.map((card,i) => (
                      <button key={card.id} className="cs2-card" onClick={()=>setSelected(card)}>
                        <div className="cs2-cardTop">
                          <div className="cs2-avatar" style={{background:COLORS[i%COLORS.length]}}>{card.initials}</div>
                          <strong>{card.name}</strong>
                          <span className="cs2-ago">{card.ago}</span>
                        </div>
                        <div className="cs2-preview">{card.preview}</div>
                        <div className="cs2-chips">
                          {card.chips.map(c=><span key={c} className={chipClass(c)}>{c}</span>)}
                        </div>
                        <div className="cs2-meta">
                          <span className={card.priority==="P1"?"cs2-p1":card.priority==="P2"?"cs2-p2":""}>{card.priority}</span>
                          &nbsp;·&nbsp;{card.amount}
                          <span className="cs2-mini">M</span>
                        </div>
                      </button>
                    ))}
                    <div className="cs2-addConv">＋ Add Conversation</div>
                  </div>
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
      <div className={`cs2-toast${toast?" show":""}`}>{toast}</div>
    </>
  );
}
