import React, { useState, useMemo, useRef, useEffect } from "react";
import CsRightPanelClient from "@/components/CsRightPanelClient";
import CsRightPanelTeam from "@/components/CsRightPanelTeam";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";

/* ─────────────────────────────────────────────────────────────────────────
   CsInbox2
   • Board view: sidebar (260px) + 4-column Kanban
   • Card selected: full detail view from user HTML/CSS
   SMS send/receive: exact copy from CsInbox.tsx — no reinvention
───────────────────────────────────────────────────────────────────────── */

const COLORS = ["#6d4aff","#10b981","#f97316","#3478f6","#ef4444","#a855f7"];
const HEAD_COLORS: Record<string,string> = {
  "New":"#3478f6","Needs Response":"#13b77a","On Customer":"#8b5cf6","At Risk":"#ff9f1a"
};

type MsgSender = "client" | "agent" | "system" | "cleaner" | "note";
type RawMsg = { role: string; content: string; ts?: number; senderName?: string; media?: string[] };

type LiveConv = {
  id: number;
  name: string;
  initials: string;
  phone: string;
  queue: string | null;
  lastMessage: string;
  wait: string;
  lastMsgTs?: number;
  hasUnanswered: boolean;
  csResolvedAt?: string | null;
  csStatusTier?: string | null;
  lastSenderRole?: string | null;
  lastCustomerMessageTs?: number | null;
  messageCount?: number | null;
  createdAt?: string | Date | null;
  messages: { sender: MsgSender; text: string; time: string; ts?: number; senderName?: string; media?: string[] }[];
  chips: string[];
  priority: string;
  amount: string;
  ago: string;
};

function linkify(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    urlRegex.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{color:'#6b4eff',textDecoration:'underline',wordBreak:'break-all'}}>{part}</a>
      : part
  );
}

function chipClass(c: string) {
  if (/Hot|Urgent|High Value/.test(c)) return "chip hot";
  if (/Confirmed/.test(c)) return "chip ok";
  if (/No Reply|Overdue/.test(c)) return "chip warn";
  return "chip";
}

const STYLES = `
*{box-sizing:border-box}
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
/* DETAIL VIEW */
:root{--bg:#f4f5f7;--paper:#fff;--ink:#101116;--muted:#858b98;--line:#e7e9ee;--purple:#6b4eff;--soft:#f5f2ff;--red:#e44c42;--green:#138a64;--amber:#c98019}
.cs2-shell{position:fixed;inset:0;display:grid;grid-template-columns:72px 310px minmax(580px,1fr) 370px;background:#fff;max-width:1800px;margin:auto;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;color:var(--ink)}
.cs2-rail{background:#111219;color:#fff;padding:18px 13px;display:flex;flex-direction:column;align-items:center;gap:12px}
.cs2-rail .logo{width:42px;height:42px;border-radius:13px;background:#fff;color:#111;display:grid;place-items:center;font-weight:950;font-size:20px;margin-bottom:14px}
.cs2-rbtn{width:42px;height:42px;border:0;border-radius:12px;background:transparent;color:#9da2ae;font-size:18px;cursor:pointer}
.cs2-rbtn:hover,.cs2-rbtn.on{background:#272832;color:#fff}
.cs2-rail .bottom{margin-top:auto}
.cs2-list{background:#fafbfc;border-right:1px solid var(--line);min-height:0;display:flex;flex-direction:column;overflow:hidden}
.cs2-listhead{padding:21px 18px 13px;border-bottom:1px solid var(--line);flex-shrink:0}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-weight:800;font-size:9px;color:#9ca1ad}
.cs2-listhead h1{font-size:19px;margin:5px 0 14px;font-weight:900}
.cs2-listsearch{height:36px;border:1px solid #e2e4e9;background:#fff;border-radius:10px;padding:0 11px;display:flex;align-items:center;color:#a0a5af;font-size:12px}
.cs2-listsearch input{border:0;outline:0;width:100%;margin-left:7px;font-size:12px;font-family:inherit}
.cs2-dtabs{display:flex;gap:6px;margin-top:12px}
.cs2-dtab{border:0;background:transparent;border-radius:8px;padding:7px 9px;font-size:10px;color:#777d89;cursor:pointer}
.cs2-dtab.on{background:#eeeaff;color:#5e43e8;font-weight:800}
.cs2-tickets{overflow:auto;padding:8px;flex:1;scrollbar-width:none}
.cs2-tickets::-webkit-scrollbar{display:none}
.ticket{position:relative;padding:13px 12px;margin:4px 0;border-radius:13px;cursor:pointer;border:1px solid transparent}
.ticket:hover{background:#fff;border-color:#e7e8ed}
.ticket.on{background:#fff;border-color:#ded8ff;box-shadow:0 8px 28px rgba(56,42,127,.08)}
.ticket.on:before{content:"";position:absolute;left:-1px;top:12px;bottom:12px;width:3px;border-radius:4px;background:var(--purple)}
.trow{display:flex;align-items:center;gap:8px}
.mini{width:30px;height:30px;border-radius:9px;background:#eae6ff;color:#6249e9;display:grid;place-items:center;font-weight:800;font-size:11px;flex-shrink:0}
.tname{font-weight:780}
.age{margin-left:auto;color:#9da2ad;font-size:10px}
.age.risk{color:#d34e42}
.preview2{margin:8px 0 9px 38px;color:#626875;font-size:11px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tags2{margin-left:38px}
.tag2{display:inline-block;font-size:9px;padding:4px 6px;border-radius:6px;background:#f0f1f4;color:#6d7380;margin-right:3px}
.tag2.hot{background:#fff0ed;color:#d14a3f}
.cs2-dmain{min-width:0;display:flex;flex-direction:column;background:#fff;overflow:hidden}
.cs2-dtop{height:72px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 24px;gap:12px;flex-shrink:0}
.cs2-davatar{width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,#7a60ff,#5b3ee7);color:#fff;display:grid;place-items:center;font-weight:900;font-size:14px;box-shadow:0 6px 16px rgba(91,62,231,.18);flex-shrink:0}
.identity h2{font-size:16px;margin:0 0 3px;font-weight:800}
.identity span{font-size:10px;color:#9298a3}
.topActions{margin-left:auto;display:flex;gap:7px}
.iconBtn{height:34px;border:1px solid #e2e4e9;background:#fff;border-radius:9px;padding:0 10px;cursor:pointer;font-size:12px}
.resolve{color:#167a5c;background:#effaf6;border-color:#d8f0e7}
.cs2-context{padding:15px 24px 4px;flex-shrink:0}
.ai{background:linear-gradient(110deg,#f7f5ff,#fbfaff);border:1px solid #ebe7ff;border-radius:14px;padding:12px 14px;line-height:1.5;color:#555b68;font-size:12px}
.ai strong{color:#5d43df}
.chips2{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}
.chip2{font-size:9px;border:1px solid #e5e7eb;border-radius:999px;padding:5px 8px;color:#707683}
.chip2.green{background:#effaf6;border-color:#d8f0e7;color:#17765a}
.cs2-thread{flex:1;overflow:auto;padding:17px 30px 12px;scrollbar-width:none}
.cs2-thread::-webkit-scrollbar{display:none}
.day{text-align:center;color:#aaaeb7;font-size:9px;margin:7px;text-transform:uppercase;letter-spacing:.08em}
.msg{max-width:68%;margin:14px 0;display:flex;flex-direction:column;align-items:flex-start}
.msg.out{margin-left:auto;align-items:flex-end}
.mmeta{font-size:9px;color:#9ba0aa;margin:0 4px 4px}
.msg.out .mmeta{text-align:right}
.bubble2{padding:11px 13px;border-radius:16px;background:#f0ecff;line-height:1.48;font-size:12px}
.msg.out .bubble2{background:#f1f2f4}
.msg.latest .bubble2{box-shadow:0 0 0 2px rgba(107,78,255,.08)}
.cs2-composer{padding:10px 24px 20px;border-top:1px solid #f0f1f3;flex-shrink:0}
.composeBox{border:1px solid #dfe1e6;border-radius:14px;padding:10px 11px;box-shadow:0 8px 30px rgba(30,31,45,.05)}
.composeBox:focus-within{border-color:#bdb2ff;box-shadow:0 8px 30px rgba(70,53,159,.08),0 0 0 3px #f2efff}
.composeBox textarea{width:100%;height:55px;border:0;outline:0;resize:none;font-size:13px;font-family:inherit}
.composeRow{display:flex;align-items:center;gap:6px;margin-top:8px}
.quick{border:0;background:#f4f4f6;border-radius:8px;padding:7px 9px;font-size:9px;cursor:pointer}
.send2{margin-left:auto;border:0;background:#684bfa;color:#fff;border-radius:9px;padding:8px 17px;font-weight:750;cursor:pointer;box-shadow:0 5px 13px rgba(104,75,250,.2)}
.cs2-side{border-left:1px solid var(--line);background:#f8f9fb;overflow:auto;padding:17px 15px;scrollbar-width:none}
.cs2-side::-webkit-scrollbar{display:none}
.sideTitle{display:flex;align-items:end;justify-content:space-between;margin:2px 3px 12px}
.sideTitle b{font-size:14px;font-weight:800}.sideTitle span{font-size:9px;color:#9da2ad}
.scard{background:#fff;border:1px solid #e6e8ed;border-radius:15px;margin-bottom:11px;overflow:hidden;box-shadow:0 3px 12px rgba(20,21,35,.02)}
.cardHead{padding:12px 13px;border-bottom:1px solid #eef0f2;display:flex;align-items:center;font-weight:800;font-size:11px}
.cardHead .link{margin-left:auto;color:#674cf1;font-size:9px;cursor:pointer}
.rows2{padding:6px 13px}
.row2{display:grid;grid-template-columns:105px 1fr;padding:6px 0;font-size:10px}
.row2 span:first-child{color:#9aa0ab}.row2 strong{font-weight:750}
.job{margin:10px 12px;padding:11px;border-radius:11px;background:#f7f8fa;border:1px solid #eff0f3}
.live{float:right;background:#e9f8f2;color:#137a5b;padding:4px 7px;border-radius:20px;font-size:8px;font-weight:800}
.job h3{font-size:12px;margin:6px 0 3px;font-weight:800}.job p{font-size:9px;color:#7d838e;margin:3px 0}
.actions2{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 12px 12px}
.act{border:1px solid #e0e2e7;background:#fff;border-radius:8px;padding:8px;font-size:9px;cursor:pointer;font-weight:600}
.act.primary{background:#684bfa;color:#fff;border-color:#684bfa}
.teamHero{padding:11px 13px;display:flex;align-items:center;gap:9px}
.teamAv{width:34px;height:34px;border-radius:10px;background:#151621;color:#fff;display:grid;place-items:center;font-size:10px;font-weight:800;flex-shrink:0}
.teamHero b{font-size:11px}.teamHero small{display:block;color:#969ca7;margin-top:2px;font-size:9px}
.mission{padding:10px 12px;border-bottom:1px solid #eff0f2;cursor:pointer;transition:.15s;display:flex;align-items:flex-start;gap:9px}
.mission:last-child{border:0}.mission:hover{background:#faf9ff}
.mico{width:27px;height:27px;border-radius:8px;background:#f0edff;display:grid;place-items:center;flex-shrink:0;font-size:13px}
.mission b{font-size:10px;font-weight:800}.mission p{margin:3px 0 0;color:#9298a4;font-size:9px}
.cs2-toast{position:fixed;bottom:22px;left:50%;transform:translate(-50%,6px);background:#151821;color:#fff;border-radius:9px;padding:9px 14px;font-size:11px;opacity:0;transition:.2s;z-index:999;pointer-events:none}
.cs2-toast.show{opacity:1;transform:translate(-50%,0)}
`;

export default function CsInbox2() {
  const utils = trpc.useUtils();

  // ── Real inbox data (exact copy from CsInbox.tsx) ──────────────────────
  const { data: csData, refetch: refetchInbox } = trpc.leads.listCsInbox.useQuery(
    { showResolved: true },
    { staleTime: 30_000, refetchOnWindowFocus: false, refetchInterval: 60_000 }
  );

  const allPhones = useMemo(() => {
    if (!csData) return [];
    return [...new Set(csData.map(r => (r.leadPhone ?? "").replace(/[^\d]/g, "").slice(-10)).filter(Boolean))];
  }, [csData]);

  const { data: nameMap } = trpc.leads.batchResolveNames.useQuery(
    { phones: allPhones },
    { enabled: allPhones.length > 0, staleTime: 60_000 }
  );

  // ── SSE: invalidate on new inbound (exact copy from CsInbox.tsx) ───────
  const selectedIdRef = useRef<number | null>(null);
  useOpsStream({
    onLeadUpdate: () => {
      utils.leads.listCsInbox.invalidate();
      if (selectedIdRef.current != null) {
        utils.leads.getCsConversation.invalidate({ sessionId: selectedIdRef.current });
      }
    },
  }, { label: "CsInbox2" });

  // ── Transform server rows → LiveConv (exact copy from CsInbox.tsx) ─────
  const liveConvs: LiveConv[] = useMemo(() => {
    if (!csData) return [];
    return csData.map(row => {
      let msgs: RawMsg[] = [];
      try { msgs = JSON.parse(row.messageHistory ?? "[]"); } catch { msgs = []; }
      const lastMsg = msgs.slice(-1)[0];
      // Use server-computed lastMsgTs (same as CsInbox.tsx) — more reliable than parsing ts from messageHistory
      const serverLastMsgTs = (row as any).lastMsgTs as number | undefined;
      const lastTs = serverLastMsgTs ?? lastMsg?.ts;
      const waitMs = lastTs ? Date.now() - lastTs : 0;
      const waitMin = Math.round(waitMs / 60000);
      const waitDays = Math.floor(waitMs / 86_400_000);
      const waitHours = Math.floor(waitMs / 3_600_000);
      const waitStr = waitMin < 1 ? 'just now' : waitMin < 60 ? `${waitMin} min` : waitDays >= 1 ? `${waitDays}d ago` : `${waitHours}h ${waitMin % 60}m ago`;
      const phone10 = (row.leadPhone ?? "").replace(/[^\d]/g, "").slice(-10);
      const name = (nameMap && phone10 && nameMap[phone10]) || row.leadName || row.leadPhone || "Unknown";
      const initials = name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
      const hasUnanswered = (row as any).hasUnanswered ?? (msgs.length > 0 && msgs[msgs.length - 1].role === "user");
      return {
        id: row.id,
        name,
        initials,
        phone: row.leadPhone || "",
        queue: ((row as any).csQueue ?? null) as string | null,
        lastMessage: lastMsg?.content || (row as any).lastMessageText || "",
        wait: waitStr,
        lastMsgTs: (row as any).lastMsgTs,
        hasUnanswered,
        csResolvedAt: (row as any).csResolvedAt ?? null,
        csStatusTier: (row as any).csStatusTier ?? null,
        lastSenderRole: (row as any).lastSenderRole ?? null,
        lastCustomerMessageTs: (row as any).lastCustomerMessageTs ?? null,
        messageCount: (row as any).messageCount ?? null,
        createdAt: (row as any).createdAt ?? null,
        messages: msgs.map(m => ({
          sender: (m.role === "user" ? "client" : m.role === "assistant" ? "agent" : m.role === "note" ? "note" : "system") as MsgSender,
          text: m.content,
          time: m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
          ts: m.ts,
          media: (m.media ?? []) as string[],
          senderName: m.senderName,
        })),
        chips: [(row as any).csStatusTier ?? null, hasUnanswered ? "Needs Reply" : null].filter(Boolean) as string[],
        priority: hasUnanswered ? "P1" : "P2",
        amount: "",
        ago: waitStr,
      };
    });
  }, [csData, nameMap]);

  // ── Kanban column assignment ────────────────────────────────────────────
  const now = Date.now();
  const THIRTY_MIN = 30 * 60 * 1000;
  const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;

  function getKanbanColumn(conv: LiveConv): "At Risk" | "New" | "Needs Response" | "On Customer" {
    // Filter out resolved conversations — they don't belong on the active board
    if (conv.csResolvedAt) return "On Customer"; // won't show — filtered before columns

    const needsReply = conv.lastSenderRole === "user";

    const isAtRisk =
      needsReply &&
      conv.lastCustomerMessageTs != null &&
      conv.lastCustomerMessageTs <= now - THIRTY_MIN;

    const createdAtMs = conv.createdAt
      ? (typeof conv.createdAt === "number" ? conv.createdAt : new Date(conv.createdAt).getTime())
      : 0;
    const isNew =
      needsReply &&
      !isAtRisk &&
      createdAtMs >= now - TWENTY_FOUR_H &&
      (conv.messageCount ?? 999) <= 2;

    if (isAtRisk)    return "At Risk";
    if (isNew)       return "New";
    if (needsReply)  return "Needs Response";
    return "On Customer";
  }

  // ── Board state ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [filter, setFilter] = useState("all");
  const [selectedConv, setSelectedConv] = useState<LiveConv | null>(null);
  const [compose, setCompose] = useState("");
  const [toast, setToast] = useState("");
  const [missionDone, setMissionDone] = useState<Set<number>>(new Set());
  const threadRef = useRef<HTMLDivElement>(null);

  // Keep selectedIdRef in sync for SSE
  useEffect(() => { selectedIdRef.current = selectedConv?.id ?? null; }, [selectedConv]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 1200); }

  // ── Send mutation (exact copy from CsInbox.tsx) ─────────────────────────
  const sendMessage = trpc.leads.sendMessage.useMutation({
    onSuccess: (_data, variables) => {
      setCompose("");
      const nowTs = Date.now();
      utils.leads.listCsInbox.setData({ showResolved: true }, (old) => {
        if (!old) return old;
        return old.map(s => {
          if (s.id !== variables.sessionId) return s;
          let history: RawMsg[] = [];
          try { history = JSON.parse(s.messageHistory ?? "[]"); } catch { history = []; }
          history = [...history, { role: "assistant", content: variables.message, ts: nowTs }];
          return { ...s, messageHistory: JSON.stringify(history), hasUnanswered: false, lastSenderRole: "assistant" as const, lastMsgTs: nowTs };
        });
      });
      utils.leads.getCsConversation.setData({ sessionId: variables.sessionId }, (old) => {
        if (!old) return old;
        let history: RawMsg[] = [];
        try { history = JSON.parse(old.messageHistory ?? "[]"); } catch { history = []; }
        history = [...history, { role: "assistant", content: variables.message, ts: nowTs }];
        return { ...old, messageHistory: JSON.stringify(history) };
      });
    },
  });

  // ── resolveSession (exact copy from CsInbox.tsx) ────────────────────────
  const resolveSession = trpc.leads.resolveSession.useMutation({
    onSuccess: (_data, variables) => {
      utils.leads.getUnansweredCsCount.invalidate();
      setResolvingId(variables.sessionId);
      window.setTimeout(() => {
        setResolvingId(null);
        setSelectedConv(null);
        const resolvedAt = new Date();
        utils.leads.listCsInbox.setData({ showResolved: true }, (old) => {
          if (!old) return old;
          return old.map((s) =>
            s.id === variables.sessionId ? { ...s, csResolvedAt: resolvedAt } : s
          );
        });
        utils.opsChat.getCsResolvedCount.invalidate();
      }, 900);
    },
  });

  function doSend(afterSend?: () => void) {
    if (!selectedConv || !compose.trim()) return;
    sendMessage.mutate({ sessionId: selectedConv.id, message: compose.trim(), fromNumberId: "PN0wVLcpCq" }, {
      onSuccess: () => { if (afterSend) afterSend(); }
    });
  }

  // ── Detail query: real thread messages (exact copy from CsInbox.tsx) ────
  const { data: conversationDetail } = trpc.leads.getCsConversation.useQuery(
    { sessionId: selectedConv?.id ?? 0 },
    { enabled: !!selectedConv, staleTime: 0, refetchOnWindowFocus: false, refetchInterval: 30_000 }
  );

  const detailMessages = useMemo(() => {
    if (!conversationDetail?.messageHistory) return selectedConv?.messages ?? [];
    let raw: RawMsg[] = [];
    try { raw = JSON.parse(conversationDetail.messageHistory); } catch { raw = []; }
    return raw.map(m => ({
      sender: (m.role === "user" ? "client" : m.role === "assistant" ? "agent" : m.role === "note" ? "note" : "system") as MsgSender,
      text: m.content,
      time: m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
      ts: m.ts,
      media: (m.media ?? []) as string[],
      senderName: m.senderName,
    }));
  }, [conversationDetail?.messageHistory, selectedConv?.messages]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [detailMessages, selectedConv]);

  // ── Filtered columns ────────────────────────────────────────────────────
  const clientConvs = useMemo(() => liveConvs, [liveConvs]);
  const teamConvs   = useMemo(() => liveConvs.filter(c => c.queue === "Teams"),  [liveConvs]);

  // Active (non-resolved) client conversations only
  const activeClientConvs = useMemo(() => clientConvs.filter(c => !c.csResolvedAt), [clientConvs]);

  // Sidebar counts — aligned with column logic
  const needsResponseCount = activeClientConvs.filter(c => c.lastSenderRole === "user" && !c.csResolvedAt).length;
  const unansweredCount    = activeClientConvs.filter(c => {
    const needsReply = c.lastSenderRole === "user";
    return needsReply && c.lastCustomerMessageTs != null && c.lastCustomerMessageTs <= now - THIRTY_MIN;
  }).length;
  const hotLeadsCount = clientConvs.filter(c => c.csStatusTier === "hot_lead").length;

  const columns = useMemo(() => {
    const q = query.trim().toLowerCase();
      const colNames = ["New", "Needs Response", "On Customer", "At Risk"] as const;
    return colNames.map(label => {
      // Only active (non-resolved) conversations on the board
      let convs = activeClientConvs.filter(c => {
        if (!( (c.name + " " + c.lastMessage).toLowerCase().includes(q) )) return false;
        if (filter === "needs-response") return c.lastSenderRole === "user";
        if (filter === "unanswered") {
          return c.lastSenderRole === "user" && c.lastCustomerMessageTs != null && c.lastCustomerMessageTs <= now - THIRTY_MIN;
        }
        if (filter === "hot") return c.csStatusTier === "hot_lead";
        return true;
      }).filter(c => getKanbanColumn(c) === label);
      return { label, convs };
    });
  }, [activeClientConvs, query, filter, now]);

  // ── DETAIL VIEW ─────────────────────────────────────────────────────────
  if (selectedConv) {
    const allConvs = [...clientConvs, ...teamConvs];
    return (
      <>
        <style>{STYLES}</style>
        <div className="cs2-shell">
          <nav className="cs2-rail">
            <div className="logo">M</div>
            <button className="cs2-rbtn">⌂</button>
            <button className="cs2-rbtn on">✉</button>
            <button className="cs2-rbtn">✓</button>
            <button className="cs2-rbtn">⌁</button>
            <button className="cs2-rbtn">✦</button>
            <button className="cs2-rbtn bottom" onClick={() => setSelectedConv(null)}>←</button>
          </nav>
          <aside className="cs2-list">
            <div className="cs2-listhead">
              <div className="eyebrow">Customer inbox</div>
              <h1>Needs Response <span style={{color:"#a0a5af",fontWeight:500}}>{needsResponseCount}</span></h1>
              <div className="cs2-listsearch">⌕ <input placeholder="Search conversations" /></div>
              <div className="cs2-dtabs">
                <button className="cs2-dtab on">All</button>
                <button className="cs2-dtab">🔥 Leads</button>
                <button className="cs2-dtab">👷 Teams</button>
              </div>
            </div>
            <div className="cs2-tickets">
              {allConvs.map(conv => (
                <div key={conv.id} className={`ticket${selectedConv.id === conv.id ? " on" : ""}`} onClick={() => { setSelectedConv(conv); setCompose(""); }}>
                  <div className="trow">
                    <div className="mini">{conv.initials}</div>
                    <span className="tname">{conv.name}</span>
                    <span className={`age${conv.hasUnanswered && conv.priority === "P1" ? " risk" : ""}`}>{conv.ago}</span>
                  </div>
                  <div className="preview2">{conv.lastMessage}</div>
                  <div className="tags2">
                    {conv.chips.slice(0,2).map(c => <span key={c} className={`tag2${/Hot|Urgent|At Risk|No Reply/.test(c) ? " hot" : ""}`}>{c}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </aside>
          <main className="cs2-dmain">
            <header className="cs2-dtop">
              <div className="cs2-davatar">{selectedConv.initials}</div>
              <div className="identity">
                <h2>{selectedConv.name}</h2>
                <span>{selectedConv.phone} · Customer</span>
              </div>
              <div className="topActions">
                <button className="iconBtn">•••</button>
                <button className="iconBtn resolve" onClick={() => resolveSession.mutate({ sessionId: selectedConv.id })} disabled={resolveSession.isPending}>{resolveSession.isPending ? "Resolving…" : "✓ Resolve"}</button>
              </div>
            </header>
            <div className="cs2-context">
              <div className="ai">
                <strong>✦ Madison</strong>&nbsp; {selectedConv.lastMessage || "No recent messages."}
              </div>
              <div className="chips2">
                {selectedConv.hasUnanswered && <span className="chip2 green">● Needs response</span>}
                {selectedConv.chips.map(c => <span key={c} className="chip2">{c}</span>)}
              </div>
            </div>
            <section className="cs2-thread" ref={threadRef}>
              <div className="day">Conversation</div>
              {detailMessages.map((m, i) => (
                <div key={i} className={`msg${m.sender === "agent" ? " out" : ""}${i === detailMessages.length - 1 ? " latest" : ""}`}>
                  <div className="mmeta">{m.sender === "agent" ? (m.senderName || "Agent") : selectedConv.name} · {m.time}</div>
                  <div className="bubble2">{linkify(m.text)}</div>
                </div>
              ))}
              {detailMessages.length === 0 && <div style={{textAlign:"center",color:"#9aa0aa",padding:"28px",fontSize:"12px"}}>No messages yet</div>}
            </section>
            <footer className="cs2-composer">
              <div className="composeBox">
                <textarea
                  placeholder={`Reply to ${selectedConv.name.split(" ")[0]}…`}
                  value={compose}
                  onChange={e => setCompose(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doSend(); }}
                />
                <div className="composeRow">
                  <button className="quick" onClick={() => setCompose("Yes! We have a morning opening 😊")}>Morning opening</button>
                  <button className="quick" onClick={() => setCompose("Let me check with the team and get right back to you.")}>Check team</button>
                  <button className="quick">+ More</button>
                  <div style={{display:'flex',marginLeft:'auto',borderRadius:'9px',overflow:'hidden',boxShadow:'0 5px 13px rgba(104,75,250,.2)'}}>
                    <button className="send2" onClick={() => doSend()} disabled={sendMessage.isPending} style={{borderRadius:0,boxShadow:'none',paddingRight:'12px',margin:0}}>
                      {sendMessage.isPending ? "Sending…" : "Send ↗"}
                    </button>
                    <button
                      className="send2"
                      style={{borderRadius:0,boxShadow:'none',borderLeft:'1px solid rgba(255,255,255,.25)',padding:'8px 10px',fontSize:'12px',margin:0}}
                      onClick={() => doSend(() => resolveSession.mutate({ sessionId: selectedConv.id }))}
                      disabled={sendMessage.isPending || resolveSession.isPending}
                      title="Send and resolve"
                    >✓</button>
                  </div>
                </div>
              </div>
            </footer>
          </main>
          <aside className="cs2-side" style={{overflow:'hidden',display:'flex',flexDirection:'column',gap:0,padding:0}}>
            {/* Client/Team profile panel */}
            <div style={{flex:1,minHeight:0,overflow:'hidden'}}>
              {selectedConv.queue === "Teams" ? (
                <CsRightPanelTeam
                  selected={{
                    id: selectedConv.id,
                    name: selectedConv.name,
                    initials: selectedConv.initials,
                    phone: selectedConv.phone,
                    queue: selectedConv.queue,
                    wait: selectedConv.wait,
                    status: selectedConv.csStatusTier ?? undefined,
                  }}
                />
              ) : (
                <CsRightPanelClient
                  selected={{
                    id: selectedConv.id,
                    name: selectedConv.name,
                    initials: selectedConv.initials,
                    phone: selectedConv.phone,
                    queue: selectedConv.queue,
                    wait: selectedConv.wait,
                    status: selectedConv.csStatusTier ?? undefined,
                    stats: { bookings: 0, complaints: 0 },
                  }}
                  setCompose={setCompose}
                  messages={detailMessages}
                />
              )}
            </div>
          </aside>
        </div>
        <div className={`cs2-toast${toast ? " show" : ""}`}>{toast}</div>
      </>
    );
  }

  // ── BOARD VIEW ──────────────────────────────────────────────────────────
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
              ▣ <span>All Conversations</span><span className="cs2-badge">{clientConvs.length}</span>
            </button>
          </div>
          <div className="cs2-section">Views</div>
          <div className="cs2-nav">
            <button className={filter==="needs-response"?"active":""} onClick={()=>setFilter("needs-response")}>
              <span className="cs2-dot" style={{background:"#13b77a"}}/><span>Needs Response</span><span className="cs2-badge">{needsResponseCount}</span>
            </button>
            <button className={filter==="unanswered"?"active":""} onClick={()=>setFilter("unanswered")}>
              <span className="cs2-dot" style={{background:"#ff9f1a"}}/><span>Unanswered</span><span className="cs2-badge">{unansweredCount}</span>
            </button>
            <button className={filter==="hot"?"active":""} onClick={()=>setFilter("hot")}>
              <span className="cs2-dot" style={{background:"#ff5f8f"}}/><span>Hot Leads</span><span className="cs2-badge">{hotLeadsCount}</span>
            </button>
          </div>
          <div className="cs2-section">Teams</div>
          <div className="cs2-nav">
            <button>▦ <span>Dispatch</span><span className="cs2-badge">{teamConvs.length}</span></button>
          </div>
          <div className="cs2-user">
            <div className="cs2-avatar" style={{background:"#222"}}>M</div>
            <div><b>Madison</b><div style={{color:"#8b91a0",fontSize:"11px"}}>Support Agent</div></div>
          </div>
        </aside>
        <main className="cs2-main">
          <header className="cs2-topbar">
            <h2>All Conversations</h2>
            <button className="cs2-btn" onClick={() => refetchInbox()}>↻</button>
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
                    <small>{col.convs.length}</small>
                    <span className="chevron">⌄</span>
                  </div>
                  <div className="cs2-colCards">
                   {col.convs.map((conv,i) => (
                      resolvingId === conv.id ? (
                        <div key={conv.id} className="cs2-card" style={{background:'linear-gradient(135deg,#d1fae5,#a7f3d0)',border:'1px solid #6ee7b7',display:'flex',alignItems:'center',justifyContent:'center',minHeight:'80px',pointerEvents:'none'}}>
                          <span style={{fontSize:'22px',marginRight:'8px'}}>🎉</span>
                          <span style={{fontWeight:800,color:'#065f46',fontSize:'13px'}}>Resolved!</span>
                        </div>
                      ) : (
                      <button key={conv.id} className="cs2-card" onClick={()=>{ setSelectedConv(conv); setCompose(""); }}>
                        <div className="cs2-cardTop">
                          <div className="cs2-avatar" style={{background:COLORS[i%COLORS.length]}}>{conv.initials}</div>
                          <strong>{conv.name}</strong>
                          <span className="cs2-ago">{conv.ago}</span>
                        </div>
                        <div className="cs2-preview">{conv.lastMessage}</div>
                        <div className="cs2-chips">
                          {conv.chips.map(c=><span key={c} className={chipClass(c)}>{c}</span>)}
                        </div>
                        <div className="cs2-meta">
                          <span className={conv.priority==="P1"?"cs2-p1":"cs2-p2"}>{conv.priority}</span>
                          &nbsp;·&nbsp;{conv.wait}
                          <span className="cs2-mini">M</span>
                        </div>
                      </button>
                      )
                    ))}
                    {col.convs.length === 0 && <div style={{textAlign:"center",color:"#9aa0aa",padding:"28px 8px",fontSize:"12px"}}>No conversations</div>}
                    <div className="cs2-addConv">＋ Add Conversation</div>
                  </div>
                </section>
              ))}
            </div>
          </div>
          <footer className="cs2-stats">
            <div className="cs2-stat"><small>Total Conversations</small><b>{activeClientConvs.length}</b></div>
            <div className="cs2-stat"><small>Needs Response</small><b>{needsResponseCount}</b></div>
            <div className="cs2-stat"><small>Unanswered</small><b>{unansweredCount}</b></div>
            <div className="cs2-stat"><small>Hot Leads</small><b>{hotLeadsCount}</b></div>
            <div className="cs2-stat"><small>Teams</small><b>{teamConvs.length}</b></div>
          </footer>
        </main>
      </div>
      <div className={`cs2-toast${toast ? " show" : ""}`}>{toast}</div>
    </>
  );
}
