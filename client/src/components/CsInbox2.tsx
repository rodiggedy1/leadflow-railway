import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Play, Pause, ChevronUp, ChevronDown } from "lucide-react";
import { proxyRecordingUrl } from "@/lib/utils";
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
  "New":"#3478f6","Needs Response":"#13b77a","Waiting on Customer":"#8b5cf6","At Risk":"#ff9f1a"
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
  // AI call fields
  latestInteractionType?: "call" | "sms";
  latestCallId?: number | null;
  latestCallOutcome?: string | null;
  latestCallSummary?: string | null;
  latestCallDuration?: number | null;
  latestCallRecordingUrl?: string | null;
  latestCallCreatedAt?: number | null;
  latestCallStructuredData?: string | null;
  latestCallCallerPhone?: string | null;
};

// ── AI call action state helper ──────────────────────────────────────────────
function deriveCallActionState(outcome: string): "needs_response" | "on_customer" | "handled" {
  switch (outcome) {
    case "booked":         return "handled";
    case "faq_answered":   return "handled";
    case "transferred":    return "needs_response";
    case "callback_requested": return "needs_response";
    case "no_answer":      return "needs_response";
    case "missed":         return "needs_response";
    case "quote_given":    return "on_customer";
    case "answered":       return "needs_response";
    case "no_action":
    default:               return "needs_response";
  }
}

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
@keyframes cs2spin{to{transform:rotate(360deg)}}
.cs2-toast{position:fixed;bottom:22px;left:50%;transform:translate(-50%,6px);background:#151821;color:#fff;border-radius:9px;padding:9px 14px;font-size:11px;opacity:0;transition:.2s;z-index:999;pointer-events:none}
.cs2-toast.show{opacity:1;transform:translate(-50%,0)}
`;


// ── New Message Modal ─────────────────────────────────────────────────────────
function NewMessageModal({ onClose, onConvOpened }: { onClose: () => void; onConvOpened: (phone: string) => void }) {
  const [tab, setTab] = React.useState<"customer" | "lead">("customer");
  const [custPhone, setCustPhone] = React.useState("");
  const [custName, setCustName] = React.useState("");
  const [custMsg, setCustMsg] = React.useState("");
  const sendWorkspaceMsg = trpc.leads.sendWorkspaceMessage.useMutation();
  const [rawText, setRawText] = React.useState("");
  const [step, setStep] = React.useState<"paste" | "loading" | "review">("paste");
  const [extracted, setExtracted] = React.useState<any>(null);
  const [leadPhone, setLeadPhone] = React.useState("");
  const [leadNameInput, setLeadNameInput] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const analyzeMut = trpc.tools.generateFirstMessage.useMutation();

  function handleSendCustomer() {
    const phone = custPhone.trim();
    const msg = custMsg.trim();
    if (!phone || !msg) return;
    sendWorkspaceMsg.mutate({ phone, message: msg, name: custName.trim() || undefined }, {
      onSuccess: () => { onConvOpened(phone); onClose(); },
    });
  }

  function handleAnalyze() {
    if (!rawText.trim()) return;
    setStep("loading");
    analyzeMut.mutate({ bookingDetails: rawText }, {
      onSuccess: (res) => {
        setDraft(res.message ?? "");
        setStep("review");
      },
      onError: () => setStep("paste"),
    });
  }

  function handleSendLead() {
    const phone = leadPhone.trim() || extracted?.phone;
    if (!phone || !draft.trim()) return;
    sendWorkspaceMsg.mutate({ phone, message: draft.trim(), name: leadNameInput.trim() || undefined }, {
      onSuccess: () => { onConvOpened(phone); onClose(); },
    });
  }

  const ext = extracted ?? {};
  const chips = [
    ext.bedrooms, ext.bathrooms, ext.serviceType, ext.frequency,
    ext.pets ? "Pets" : null,
    ...(Array.isArray(ext.extras) ? ext.extras : []),
  ].filter(Boolean);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(19,20,25,.42)",display:"grid",placeItems:"center",padding:"20px",zIndex:9999}} onClick={onClose}>
      <div style={{width:"min(650px,100%)",background:"white",borderRadius:"20px",boxShadow:"0 28px 90px rgba(0,0,0,.22)",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"20px 22px 16px",borderBottom:"1px solid #ececf0",display:"flex",justifyContent:"space-between",alignItems:"start"}}>
          <div>
            <h2 style={{fontSize:"19px",margin:"0 0 4px",fontFamily:"Inter,sans-serif"}}>New Message</h2>
            <p style={{fontSize:"12px",color:"#858892",margin:0}}>Start a new customer conversation or create a lead.</p>
          </div>
          <button onClick={onClose} style={{border:0,background:"#f4f4f6",width:"32px",height:"32px",borderRadius:"9px",cursor:"pointer",fontSize:"14px"}}>✕</button>
        </div>
        <div style={{padding:"20px 22px"}}>
          <div style={{display:"flex",background:"#f3f3f6",padding:"4px",borderRadius:"11px",width:"max-content",marginBottom:"19px"}}>
            <button onClick={()=>setTab("customer")} style={{border:0,background:tab==="customer"?"white":"transparent",borderRadius:"8px",padding:"8px 13px",fontWeight:700,color:tab==="customer"?"#17181c":"#777b84",cursor:"pointer",boxShadow:tab==="customer"?"0 2px 7px rgba(0,0,0,.07)":"none",fontFamily:"inherit"}}>Customer</button>
            <button onClick={()=>setTab("lead")} style={{border:0,background:tab==="lead"?"white":"transparent",borderRadius:"8px",padding:"8px 13px",fontWeight:700,color:tab==="lead"?"#17181c":"#777b84",cursor:"pointer",boxShadow:tab==="lead"?"0 2px 7px rgba(0,0,0,.07)":"none",fontFamily:"inherit"}}>🔥 New Lead</button>
          </div>

          {tab === "customer" && (
            <div>
              <div style={{display:"flex",gap:"10px",marginBottom:"12px"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:"11px",fontWeight:800,color:"#777b84",marginBottom:"7px",letterSpacing:".04em"}}>PHONE NUMBER</div>
                  <input value={custPhone} onChange={e=>setCustPhone(e.target.value)} placeholder="+1 (555) 000-0000" style={{width:"100%",border:"1.5px solid #dedfe5",background:"#fbfbfc",borderRadius:"13px",padding:"10px 12px",fontSize:"13px",outline:"none",fontFamily:"inherit"}} />
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:"11px",fontWeight:800,color:"#777b84",marginBottom:"7px",letterSpacing:".04em"}}>NAME (OPTIONAL)</div>
                  <input value={custName} onChange={e=>setCustName(e.target.value)} placeholder="Customer name" style={{width:"100%",border:"1.5px solid #dedfe5",background:"#fbfbfc",borderRadius:"13px",padding:"10px 12px",fontSize:"13px",outline:"none",fontFamily:"inherit"}} />
                </div>
              </div>
              <div style={{fontSize:"11px",fontWeight:800,color:"#777b84",marginBottom:"7px",letterSpacing:".04em"}}>MESSAGE</div>
              <div style={{border:"1.5px solid #dedfe5",background:"#fbfbfc",borderRadius:"13px",padding:"12px"}}>
                <textarea value={custMsg} onChange={e=>setCustMsg(e.target.value)} placeholder="Type your message…" rows={5} style={{width:"100%",border:0,outline:"none",resize:"none",background:"transparent",lineHeight:1.5,fontSize:"13px",fontFamily:"inherit"}} />
              </div>
            </div>
          )}

          {tab === "lead" && step === "paste" && (
            <div>
              <div style={{fontSize:"11px",fontWeight:800,color:"#777b84",marginBottom:"7px",letterSpacing:".04em"}}>PASTE LEAD DETAILS</div>
              <div style={{border:"1.5px solid #dedfe5",background:"#fbfbfc",borderRadius:"13px",padding:"12px"}}>
                <textarea value={rawText} onChange={e=>setRawText(e.target.value)} placeholder={"Paste the lead exactly as received (Thumbtack, Bark, Yelp, email, etc.)\nMadison will extract the details and write the first message."} rows={9} style={{width:"100%",border:0,outline:"none",resize:"none",background:"transparent",lineHeight:1.5,fontSize:"13px",fontFamily:"inherit"}} />
                <div style={{fontSize:"11px",color:"#999ca4",borderTop:"1px solid #ebebee",paddingTop:"9px"}}>Paste it exactly as you received it. Missing information stays blank.</div>
              </div>
            </div>
          )}

          {tab === "lead" && step === "loading" && (
            <div style={{textAlign:"center",padding:"42px 10px"}}>
              <div style={{width:"28px",height:"28px",border:"3px solid #eee",borderTopColor:"#6d4aff",borderRadius:"50%",margin:"auto",animation:"cs2spin .7s linear infinite"}} />
              <p style={{fontSize:"12px",color:"#858892",marginTop:"12px"}}>Madison is reading the lead and writing the first message…</p>
            </div>
          )}

          {tab === "lead" && step === "review" && (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",border:"1px solid #e7e7eb",borderRadius:"13px",padding:"14px",marginBottom:"12px"}}>
                <div>
                  <h3 style={{margin:"0 0 4px",fontSize:"16px",fontFamily:"inherit"}}>{ext.name ?? "Unknown"}</h3>
                  <p style={{margin:0,color:"#858892",fontSize:"12px"}}>{ext.location ?? ""}</p>
                  <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginTop:"11px"}}>
                    {chips.map((c: any,i: number)=><span key={i} style={{background:"#f4f4f7",borderRadius:"7px",padding:"6px 8px",fontSize:"11px",fontWeight:700}}>{c}</span>)}
                  </div>
                </div>
                <span style={{background:"#fff0e9",color:"#d6531c",borderRadius:"99px",padding:"5px 8px",fontSize:"10px",fontWeight:850,flexShrink:0}}>🔥 NEW LEAD</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",margin:"0 2px 7px",fontSize:"11px",fontWeight:800,color:"#777b84"}}>
                <span>MADISON'S FIRST MESSAGE</span>
                <span style={{color:"#6d4aff",cursor:"pointer"}} onClick={handleAnalyze}>✦ Regenerate</span>
              </div>
              <div style={{border:"1.5px solid #dedfe5",borderRadius:"12px",padding:"11px"}}>
                <textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={8} style={{width:"100%",border:0,outline:"none",resize:"none",lineHeight:1.45,fontSize:"13px",fontFamily:"inherit"}} />
              </div>
              <div style={{marginTop:"10px",display:"flex",gap:"10px"}}>
                <div style={{flex:1}}>
                  <label style={{fontSize:"11px",fontWeight:800,color:"#777b84",display:"block",marginBottom:"5px"}}>CUSTOMER NAME</label>
                  <input value={leadNameInput} onChange={e=>setLeadNameInput(e.target.value)} placeholder="First Last" style={{width:"100%",border:"1.5px solid #dedfe5",background:"#fbfbfc",borderRadius:"10px",padding:"9px 12px",fontSize:"13px",outline:"none",fontFamily:"inherit",boxSizing:"border-box"}} />
                </div>
                <div style={{flex:1}}>
                  <label style={{fontSize:"11px",fontWeight:800,color:"#777b84",display:"block",marginBottom:"5px"}}>PHONE NUMBER</label>
                  <input value={leadPhone} onChange={e=>setLeadPhone(e.target.value)} placeholder="+1 (555) 000-0000" style={{width:"100%",border:"1.5px solid #dedfe5",background:"#fbfbfc",borderRadius:"10px",padding:"9px 12px",fontSize:"13px",outline:"none",fontFamily:"inherit",boxSizing:"border-box"}} />
                </div>
              </div>
            </div>
          )}
        </div>

        {tab === "customer" && (
          <div style={{display:"flex",justifyContent:"flex-end",gap:"9px",padding:"15px 22px",borderTop:"1px solid #ececf0"}}>
            <button onClick={onClose} style={{border:"1px solid #dedfe4",background:"white",borderRadius:"10px",padding:"10px 14px",fontWeight:750,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            <button onClick={handleSendCustomer} disabled={!custPhone.trim()||!custMsg.trim()||sendWorkspaceMsg.isPending} style={{background:"#6d4aff",color:"white",border:"1px solid #6d4aff",borderRadius:"10px",padding:"10px 14px",fontWeight:750,cursor:"pointer",fontFamily:"inherit",opacity:(!custPhone.trim()||!custMsg.trim()||sendWorkspaceMsg.isPending)?0.5:1}}>
              {sendWorkspaceMsg.isPending ? "Sending…" : "Send Message"}
            </button>
          </div>
        )}
        {tab === "lead" && step === "paste" && (
          <div style={{display:"flex",justifyContent:"flex-end",gap:"9px",padding:"15px 22px",borderTop:"1px solid #ececf0"}}>
            <button onClick={onClose} style={{border:"1px solid #dedfe4",background:"white",borderRadius:"10px",padding:"10px 14px",fontWeight:750,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            <button onClick={handleAnalyze} disabled={!rawText.trim()||analyzeMut.isPending} style={{background:"#6d4aff",color:"white",border:"1px solid #6d4aff",borderRadius:"10px",padding:"10px 14px",fontWeight:750,cursor:"pointer",fontFamily:"inherit",opacity:(!rawText.trim()||analyzeMut.isPending)?0.5:1}}>Analyze Lead ✦</button>
          </div>
        )}
        {tab === "lead" && step === "review" && (
          <div style={{display:"flex",justifyContent:"space-between",gap:"9px",padding:"15px 22px",borderTop:"1px solid #ececf0"}}>
            <button onClick={()=>setStep("paste")} style={{border:"1px solid #dedfe4",background:"white",borderRadius:"10px",padding:"10px 14px",fontWeight:750,cursor:"pointer",fontFamily:"inherit"}}>← Edit Paste</button>
            <button onClick={handleSendLead} disabled={!leadPhone.trim()||!draft.trim()||sendWorkspaceMsg.isPending} style={{background:"#6d4aff",color:"white",border:"1px solid #6d4aff",borderRadius:"10px",padding:"10px 14px",fontWeight:750,cursor:"pointer",fontFamily:"inherit",opacity:(!ext.phone||!draft.trim()||sendWorkspaceMsg.isPending)?0.5:1}}>
              {sendWorkspaceMsg.isPending ? "Sending…" : "Send & Create Lead"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

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
  // ── Auto-draft refs (exact copy from CsInbox.tsx) ──────────────────────
  const autoDraftedForId = useRef<number | null>(null);
  const autoDraftAbortRef = useRef<AbortController | null>(null);
  const autoDraftInflightSessionIdRef = useRef<number | null>(null);
  const selectedConvRef = useRef<number | null>(null);
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
      const effectiveTs = ((row as any).latestInteractionType === "call" && (row as any).latestCallCreatedAt)
        ? (row as any).latestCallCreatedAt as number
        : serverLastMsgTs ?? lastMsg?.ts;
      const lastTs = effectiveTs;
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
        latestInteractionType: ((row as any).latestInteractionType ?? "sms") as "call" | "sms",
        latestCallId: (row as any).latestCallId ?? null,
        latestCallOutcome: (row as any).latestCallOutcome ?? null,
        latestCallSummary: (row as any).latestCallSummary ?? null,
        latestCallDuration: (row as any).latestCallDuration ?? null,
        latestCallRecordingUrl: (row as any).latestCallRecordingUrl ?? null,
        latestCallCreatedAt: (row as any).latestCallCreatedAt ?? null,
        latestCallStructuredData: (row as any).latestCallStructuredData ?? null,
        latestCallCallerPhone: (row as any).latestCallCallerPhone ?? null,
      };
    });
  }, [csData, nameMap]);

  // ── Kanban column assignment ────────────────────────────────────────────
  const now = Date.now();
  const THIRTY_MIN = 30 * 60 * 1000;
  const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;

  // Single canonical timestamp for both display and sorting
  function getEffectiveInteractionTs(c: LiveConv): number {
    if (c.latestInteractionType === "call" && c.latestCallCreatedAt) {
      return c.latestCallCreatedAt;
    }
    return (c as any).lastMsgTs ?? 0;
  }

  function getKanbanColumn(conv: LiveConv): "At Risk" | "New" | "Needs Response" | "Waiting on Customer" {
    // ── Call-aware column assignment (MUST come before csResolvedAt guard) ─
    // A new inbound call reactivates the customer even if the old SMS session was resolved.
    if (conv.latestInteractionType === "call" && conv.latestCallCreatedAt) {
      const callAgeMs = Date.now() - conv.latestCallCreatedAt;
      const actionState = deriveCallActionState(conv.latestCallOutcome ?? "no_action");
      const createdAtMs = conv.createdAt
        ? (typeof conv.createdAt === "number" ? conv.createdAt : new Date(conv.createdAt as string).getTime())
        : 0;
      const isNewCallSession = callAgeMs < TWENTY_FOUR_H && createdAtMs >= Date.now() - TWENTY_FOUR_H && (conv.messageCount ?? 999) <= 2;
      if (actionState === "needs_response" && callAgeMs > THIRTY_MIN) return "At Risk";
      if (actionState === "needs_response" && isNewCallSession) return "New";
      if (actionState === "needs_response") return "Needs Response";
      return "Waiting on Customer";
    }
    // ── Resolved SMS sessions don't belong on the active board ───────────
    if (conv.csResolvedAt) return "Waiting on Customer";
    // ── SMS column assignment (unchanged) ────────────────────────────────

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
    return "Waiting on Customer";
  }

  // ── Board state ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [filter, setFilter] = useState("all");
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [channel, setChannel] = useState<"inbox" | "email">("inbox");
  const [selectedEmailThreadId, setSelectedEmailThreadId] = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<LiveConv | null>(null);
  // AI call audio state (exact copy from CsInbox.tsx)
  const [expandedAiCallId, setExpandedAiCallId] = useState<string | null>(null);
  const [playingAiCallId, setPlayingAiCallId] = useState<string | null>(null);
  const aiCallAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [showOriginalTranscript, setShowOriginalTranscript] = useState<Record<number, boolean>>({});
  // Email inbox threads query (4-column Kanban)
  const emailInbox = trpc.opsChat.listEmailInboxThreads.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: channel === "email",
  });
  const emailUtils = trpc.useUtils();
  // Email thread detail query
  const emailThread = trpc.gmail.getThread.useQuery(
    { threadId: selectedEmailThreadId! },
    { enabled: !!selectedEmailThreadId, staleTime: 60_000, refetchOnWindowFocus: false }
  );
  const [emailReply, setEmailReply] = useState("");
  const sendEmailReply = trpc.gmail.sendReply.useMutation({
    onSuccess: () => {
      setEmailReply("");
      emailUtils.opsChat.listEmailInboxThreads.invalidate();
      emailUtils.gmail.getThread.invalidate({ threadId: selectedEmailThreadId! });
    },
  });

  // Reset auto-draft tracking when conversation changes
  const setSelectedConvWithReset = (conv: LiveConv | null) => {
    if (conv?.id !== selectedConv?.id) {
      autoDraftedForId.current = null;
      selectedConvRef.current = conv?.id ?? null;
    }
    setSelectedConv(conv);
  };
  const [compose, setCompose] = useState("");
  const [toast, setToast] = useState("");
  const [autoDraftLoading, setAutoDraftLoading] = useState(false);
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
        setSelectedConvWithReset(null);
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

  // ── Client profile query for jobContext (same as CsInbox.tsx, cached by tRPC) ──
  const { data: clientProfile } = trpc.leads.getClientProfile.useQuery(
    { phone: selectedConv?.phone ?? "" },
    { enabled: !!selectedConv && !selectedConv.queue, staleTime: 60_000, refetchOnWindowFocus: false }
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

  // ── Call entries from getCsConversation ──────────────────────────────────
  type CallEntry = {
    id: number; outcome: string; summary: string | null; durationSeconds: number;
    recordingUrl: string | null; transcript: string | null; createdAt: number;
    structuredData: string | null;
  };
  const detailCalls = useMemo((): CallEntry[] => {
    if (!conversationDetail) return [];
    return ((conversationDetail as any).calls ?? []) as CallEntry[];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(conversationDetail as any)?.calls]);

  // ── Merged timeline: SMS messages + call entries sorted by timestamp ──────
  type TimelineEntry =
    | { type: "sms"; msg: typeof detailMessages[number]; ts: number }
    | { type: "call"; call: CallEntry; ts: number };
  const timeline = useMemo((): TimelineEntry[] => {
    const smsEntries: TimelineEntry[] = detailMessages.map(m => ({ type: "sms" as const, msg: m, ts: m.ts ?? 0 }));
    const callEntries: TimelineEntry[] = detailCalls.map(c => ({ type: "call" as const, call: c, ts: c.createdAt }));
    return [...smsEntries, ...callEntries].sort((a, b) => a.ts - b.ts);
  }, [detailMessages, detailCalls]);

  const jobContext = useMemo(() => {
    if (!clientProfile) return "";
    const tj = clientProfile.todayJob;
    if (tj) {
      const parts: string[] = [];
      if (tj.serviceType) parts.push(`Service: ${tj.serviceType}`);
      if (tj.serviceDateTime) {
        try {
          const d = new Date(tj.serviceDateTime);
          parts.push(`Date/Time: ${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`);
        } catch { /* ignore */ }
      }
      const teamOrCleaner = (tj as any).teamName || (tj as any).cleanerName;
      if (teamOrCleaner) parts.push(`Cleaner/Team: ${teamOrCleaner}`);
      if (tj.jobAddress) parts.push(`Address: ${tj.jobAddress}`);
      if (tj.jobStatus) parts.push(`Status: ${tj.jobStatus}`);
      return parts.join("\n");
    }
    return "";
  }, [clientProfile]);
  // ── csAutoDraft fallback mutation (exact copy from CsInbox.tsx) ─────────
  const csAutoDraft = trpc.opsChat.csReply.useMutation({
    onSuccess: (data) => {
      if (autoDraftInflightSessionIdRef.current !== selectedConvRef.current) {
        setAutoDraftLoading(false);
        return;
      }
      const replyText = typeof data.reply === "string" ? data.reply : "";
      if (replyText) setCompose(replyText);
      setAutoDraftLoading(false);
    },
    onError: () => { setAutoDraftLoading(false); },
  });
  // ── streamAutoDraft (exact copy from CsInbox.tsx, last 20 messages) ─────
  async function streamAutoDraft(params: {
    conversationContext: string;
    classifyContext: string;
    customerName: string;
    jobContext: string;
    sessionId?: number;
  }) {
    const { sessionId, ...fetchParams } = params;
    if (autoDraftAbortRef.current) autoDraftAbortRef.current.abort();
    const controller = new AbortController();
    autoDraftAbortRef.current = controller;
    setCompose("");
    setAutoDraftLoading(true);
    try {
      const res = await fetch("/api/cs-reply-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...fetchParams, sessionId }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (sessionId != null && sessionId !== selectedConvRef.current) {
          reader.cancel();
          setAutoDraftLoading(false);
          autoDraftAbortRef.current = null;
          return;
        }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") { setAutoDraftLoading(false); autoDraftAbortRef.current = null; continue; }
          let parsed: { token?: string; error?: string };
          try { parsed = JSON.parse(dataStr); } catch { continue; }
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.token) { accumulated += parsed.token; setCompose(accumulated); }
        }
      }
      setAutoDraftLoading(false);
      autoDraftAbortRef.current = null;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.warn("[auto-draft stream] falling back to tRPC:", err);
      setCompose("");
      setAutoDraftLoading(false);
      csAutoDraft.mutate(fetchParams);
      setAutoDraftLoading(true);
    }
  }
  // ── triggerAutoDraft (exact copy from CsInbox.tsx, last 20 messages) ────
  function triggerAutoDraft(conv: typeof selectedConv) {
    if (!conv) return;
    if (autoDraftedForId.current === conv.id) return;
    autoDraftedForId.current = conv.id;
    autoDraftInflightSessionIdRef.current = conv.id;
    if (autoDraftAbortRef.current) { autoDraftAbortRef.current.abort(); autoDraftAbortRef.current = null; }
    const recentMsgs = detailMessages.slice(-20);
    const conversationContext = recentMsgs
      .map(m => `${m.sender === "client" ? "Customer" : "Agent"}: ${m.text}`)
      .join("\n");
    // classifyContext uses last 5 messages for the classification LLM call
    const classifyContext = detailMessages.slice(-5)
      .map(m => `${m.sender === "client" ? "Customer" : "Agent"}: ${m.text}`)
      .join("\n");
    streamAutoDraft({ conversationContext, classifyContext, customerName: conv.name ?? "", jobContext: jobContext ?? "", sessionId: conv.id });
  }
  // detailReady: true only when the loaded detail belongs to the currently selected session.
  // Prevents drafting Customer B using Customer A's stale detail during a switch.
  const detailReady =
    !!conversationDetail &&
    conversationDetail.sessionId === selectedConv?.id;

  // Auto-draft when full conversation detail for the correct session is loaded
  useEffect(() => {
    if (!selectedConv || !detailReady) return;
    selectedConvRef.current = selectedConv.id;
    triggerAutoDraft(selectedConv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConv?.id, detailReady]);


  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [detailMessages, selectedConv]);

  // ── Filtered columns ────────────────────────────────────────────────────
  const clientConvs = useMemo(() => liveConvs, [liveConvs]);
  const teamConvs   = useMemo(() => liveConvs.filter(c => c.queue === "Teams"),  [liveConvs]);

  // Active (non-resolved) client conversations only
  const activeClientConvs = useMemo(() => clientConvs.filter(c => {
    if (!c.csResolvedAt) return true;
    // Exception: resolved session with a NEW inbound call after it was resolved is active again
    const latestCallTs = c.latestCallCreatedAt ?? 0;
    return c.latestInteractionType === "call" && latestCallTs > (c.csResolvedAt as unknown as number);
  }), [clientConvs]);

  // Sidebar counts — aligned with column logic
  const needsResponseCount = activeClientConvs.filter(c => c.lastSenderRole === "user" && !c.csResolvedAt).length;
  const unansweredCount    = activeClientConvs.filter(c => {
    const needsReply = c.lastSenderRole === "user";
    return needsReply && c.lastCustomerMessageTs != null && c.lastCustomerMessageTs <= now - THIRTY_MIN;
  }).length;
  const hotLeadsCount = clientConvs.filter(c => c.csStatusTier === "hot_lead").length;

  const columns = useMemo(() => {
    const q = query.trim().toLowerCase();
      const colNames = ["New", "Needs Response", "Waiting on Customer", "At Risk"] as const;
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
      // At Risk: longest wait first (oldest effective ts at top)
      // All other columns: newest activity first
      if (label === "At Risk") {
        convs = convs.sort((a, b) => getEffectiveInteractionTs(b) - getEffectiveInteractionTs(a));
      } else {
        convs = convs.sort((a, b) => getEffectiveInteractionTs(b) - getEffectiveInteractionTs(a));
      }
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
            <button className="cs2-rbtn bottom" onClick={() => setSelectedConvWithReset(null)}>←</button>
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
                <div key={conv.id} className={`ticket${selectedConv.id === conv.id ? " on" : ""}`} onClick={() => { setSelectedConvWithReset(conv); setCompose(""); }}>
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
              {timeline.map((entry, i) => {
                if (entry.type === "call") {
                  const aiRec = entry.call;
                  const aiHasRecording = !!aiRec.recordingUrl;
                  const aiDuration = aiRec.durationSeconds ?? 0;
                  const aiDurStr = aiDuration > 0 ? `${Math.floor(aiDuration / 60)}:${String(aiDuration % 60).padStart(2, "0")}` : "0:00";
                  const aiTime = aiRec.createdAt ? new Date(aiRec.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
                  const aiIsExpanded = expandedAiCallId === `ai-${aiRec.id}`;
                  const aiIsPlaying = playingAiCallId === `ai-${aiRec.id}`;
                  const aiWaveHeights = [3, 5, 8, 6, 10, 7, 4, 9, 6, 5, 8, 4, 7, 6, 9, 5, 8, 4, 6, 7];
                  const showingOriginal = showOriginalTranscript[aiRec.id] ?? false;
                  const displayTranscript: string | null = aiRec.transcript as string | null;
                  let aiTranscriptTurns: { identifier: string; content: string }[] = [];
                  let aiTranscriptRaw: string | null = null;
                  try {
                    if (displayTranscript) {
                      const parsed = JSON.parse(displayTranscript);
                      if (Array.isArray(parsed)) aiTranscriptTurns = parsed;
                      else aiTranscriptRaw = displayTranscript;
                    }
                  } catch { aiTranscriptRaw = displayTranscript ?? null; }
                  return (
                    <motion.div
                      key={`aicall-${aiRec.id}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.3) }}
                      className="flex justify-end"
                    >
                      <div style={{ maxWidth: "72%" }}>
                        <div
                          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 cursor-pointer select-none shadow-sm"
                          onClick={() => setExpandedAiCallId(aiIsExpanded ? null : `ai-${aiRec.id}`)}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="h-3 w-3 text-emerald-500 shrink-0" />
                              <span className="text-[11px] font-semibold text-emerald-700">AI Call</span>
                            </div>
                            {aiRec.outcome === "no_answer" && <span className="text-[10px] text-red-500 font-medium">No answer</span>}
                            {aiRec.outcome === "callback_requested" && <span className="text-[10px] text-amber-500 font-medium">Callback requested</span>}
                            {aiRec.outcome === "booked" && <span className="text-[10px] text-emerald-600 font-medium">Booked ✓</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!aiHasRecording) return;
                                const audio = aiCallAudioRefs.current[`ai-${aiRec.id}`];
                                if (!audio) return;
                                if (aiIsPlaying) { audio.pause(); setPlayingAiCallId(null); }
                                else { audio.play(); setPlayingAiCallId(`ai-${aiRec.id}`); }
                              }}
                              className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                                aiHasRecording ? "bg-emerald-500 hover:bg-emerald-600" : "bg-slate-200 cursor-not-allowed"
                              }`}
                            >
                              {aiIsPlaying
                                ? <Pause className="h-3 w-3 text-white" />
                                : <Play className="h-3 w-3 text-white ml-0.5" />}
                            </button>
                            <div className="flex items-end gap-[2px] h-[18px]">
                              {aiWaveHeights.map((h, wi) => (
                                <div key={wi} className="rounded-full w-[3px] bg-emerald-400" style={{ height: `${h}px` }} />
                              ))}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] font-medium tabular-nums text-emerald-600">{aiDurStr}</span>
                              {aiIsExpanded ? <ChevronUp className="h-3.5 w-3.5 text-emerald-400" /> : <ChevronDown className="h-3.5 w-3.5 text-emerald-400" />}
                            </div>
                          </div>
                          {aiHasRecording && (
                            <audio
                              ref={(el) => { aiCallAudioRefs.current[`ai-${aiRec.id}`] = el; }}
                              src={proxyRecordingUrl(aiRec.recordingUrl)!}
                              onEnded={() => setPlayingAiCallId(null)}
                              onPause={() => { if (playingAiCallId === `ai-${aiRec.id}`) setPlayingAiCallId(null); }}
                            />
                          )}
                        </div>
                        <AnimatePresence>
                          {aiIsExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="rounded-b-2xl border border-t-0 border-emerald-200 bg-emerald-50 px-3 pb-3 pt-2">
                                {aiRec.summary && (
                                  <p className="text-[12px] text-slate-700 leading-relaxed mb-2">{aiRec.summary}</p>
                                )}
                                {aiTranscriptTurns.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-widest select-none text-emerald-600 hover:text-emerald-800">
                                      ▶ Transcript ({aiTranscriptTurns.length} turns)
                                    </summary>
                                    <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                      {aiTranscriptTurns.map((turn, ti) => (
                                        <div key={ti} className="text-xs">
                                          <span className="font-semibold mr-1 text-emerald-600">{turn.identifier}:</span>
                                          <span className="text-slate-600">{turn.content}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                                {aiTranscriptTurns.length === 0 && aiTranscriptRaw && (
                                  <pre className="text-[11px] text-slate-600 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed mt-1">{aiTranscriptRaw}</pre>
                                )}
                                {aiTranscriptTurns.length === 0 && !aiTranscriptRaw && (
                                  <p className="text-xs text-slate-400 italic">No transcript available yet</p>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <p className="text-[10px] text-slate-400 mt-1 mr-1 text-right">{aiTime}</p>
                      </div>
                    </motion.div>
                  );
                }
                const m = entry.msg;
                return (
                  <div key={i} className={`msg${m.sender === "agent" ? " out" : ""}${i === timeline.length - 1 ? " latest" : ""}`}>
                    <div className="mmeta">{m.sender === "agent" ? (m.senderName || "Agent") : selectedConv.name} · {m.time}</div>
                    <div className="bubble2">{linkify(m.text)}</div>
                  </div>
                );
              })}
              {timeline.length === 0 && <div style={{textAlign:"center",color:"#9aa0aa",padding:"28px",fontSize:"12px"}}>No messages yet</div>}
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
            <div style={{display:"flex",gap:"4px",background:"#f1f3f6",borderRadius:"8px",padding:"3px"}}>
              <button onClick={()=>{setChannel("inbox");setSelectedEmailThreadId(null);}} style={{padding:"4px 14px",borderRadius:"6px",border:"none",cursor:"pointer",fontSize:"12px",fontWeight:700,background:channel==="inbox"?"#fff":"transparent",color:channel==="inbox"?"#1a1a2e":"#6b7280",boxShadow:channel==="inbox"?"0 1px 3px rgba(0,0,0,.1)":"none",transition:"all .15s"}}>Inbox</button>
              <button onClick={()=>{setChannel("email");setSelectedConv(null);setSelectedEmailThreadId(null);}} style={{padding:"4px 14px",borderRadius:"6px",border:"none",cursor:"pointer",fontSize:"12px",fontWeight:700,background:channel==="email"?"#fff":"transparent",color:channel==="email"?"#1a1a2e":"#6b7280",boxShadow:channel==="email"?"0 1px 3px rgba(0,0,0,.1)":"none",transition:"all .15s",display:"flex",alignItems:"center",gap:"5px"}}>
                ✉ Email{(emailInbox.data?.threads.length ?? 0) > 0 && <span style={{background:"#3478f6",color:"#fff",borderRadius:"10px",padding:"1px 6px",fontSize:"10px",fontWeight:800}}>{emailInbox.data?.threads.length}</span>}
              </button>
            </div>
            <button className="cs2-btn" onClick={() => refetchInbox()}>↻</button>
            <button className="cs2-btn primary" onClick={()=>setShowNewMsg(true)}>✎ New Message</button>
          </header>
          <div className="cs2-toolbar">
            <input className="cs2-search" placeholder="⌕  Search conversations..." value={query} onChange={e=>setQuery(e.target.value)}/>
            <button className="cs2-btn">Last 90 days⌄</button>
            <button className="cs2-btn">Assignee: All⌄</button>
            <button className="cs2-btn">Team: All⌄</button>
            <button className="cs2-btn">☰ Filters</button>
          </div>
          {channel === "email" ? (
            <div style={{flex:1,minHeight:0,overflow:"hidden",display:"flex",gap:0}}>
              {/* Email 4-column Kanban */}
              <div style={{flex:1,minWidth:0,overflow:"auto",padding:"0 12px"}}>
                {(() => {
                  const threads = emailInbox.data?.threads ?? [];
                  const inboxEmail = emailInbox.data?.inboxEmail?.toLowerCase() ?? "";
                  const now = Date.now();
                  const THIRTY_MIN = 30 * 60 * 1000;
                  const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;
                  const getEmailColumn = (t: typeof threads[0]) => {
                    const isOutbound = inboxEmail && t.senderEmail?.toLowerCase() === inboxEmail;
                    if (isOutbound) return "Waiting on Customer";
                    const waitMs = now - (t.lastMessageAt ?? 0);
                    const isAtRisk = waitMs >= THIRTY_MIN;
                    const isNew = !isAtRisk && (now - (t.lastMessageAt ?? 0)) < TWENTY_FOUR_H && (t.messageCount ?? 999) <= 2;
                    if (isAtRisk) return "At Risk";
                    if (isNew) return "New";
                    return "Needs Response";
                  };
                  const emailCols = ["New","Needs Response","Waiting on Customer","At Risk"].map(label => ({
                    label,
                    threads: threads.filter(t => getEmailColumn(t) === label).sort((a,b) => {
                      if (label === "At Risk") return (a.lastMessageAt ?? 0) - (b.lastMessageAt ?? 0);
                      return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
                    }),
                  }));
                  if (emailInbox.isLoading) return <div style={{padding:"40px",color:"#9aa0aa",textAlign:"center"}}>Loading emails…</div>;
                  if (threads.length === 0) return <div style={{padding:"40px",color:"#9aa0aa",textAlign:"center"}}>No email conversations yet</div>;
                  return (
                    <div className="cs2-board">
                      {emailCols.map(col => (
                        <section key={col.label} className="cs2-column">
                          <div className="cs2-colHead">
                            <span className="cs2-dot" style={{background:HEAD_COLORS[col.label]??"#888"}}/>
                            {col.label}
                            <small>{col.threads.length}</small>
                            <span className="chevron">⌄</span>
                          </div>
                          <div className="cs2-colCards">
                            {col.threads.map(t => {
                              const ago = (() => {
                                const ms = now - (t.lastMessageAt ?? 0);
                                if (ms < 60000) return "<1m ago";
                                if (ms < 3600000) return `${Math.floor(ms/60000)}m ago`;
                                if (ms < 86400000) return `${Math.floor(ms/3600000)}h ago`;
                                return `${Math.floor(ms/86400000)}d ago`;
                              })();
                              const initials = (t.senderName ?? t.senderEmail ?? "?").slice(0,2).toUpperCase();
                              return (
                                <button key={t.threadId} className="cs2-card" onClick={()=>setSelectedEmailThreadId(t.threadId)}
                                  style={{background:selectedEmailThreadId===t.threadId?"#f0edff":"",border:selectedEmailThreadId===t.threadId?"1.5px solid #6b4eff":""}}>
                                  <div className="cs2-cardTop">
                                    <div className="cs2-avatar" style={{background:"#3478f6",fontSize:"11px"}}>{initials}</div>
                                    <strong style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.senderName ?? t.senderEmail}</strong>
                                    <span className="cs2-ago">{ago}</span>
                                  </div>
                                  <div style={{fontSize:"11px",fontWeight:600,color:"#374151",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",margin:"3px 0 2px"}}>
                                    ✉ {t.subject}
                                  </div>
                                  <div className="cs2-preview">{t.snippet}</div>
                                  <div className="cs2-meta">
                                    {t.isUnread && <span style={{fontSize:"9px",fontWeight:800,color:"#3478f6",background:"#eff6ff",padding:"2px 6px",borderRadius:"5px",marginRight:"4px"}}>UNREAD</span>}
                                    <span style={{fontSize:"9px",color:"#9aa0aa"}}>{t.messageCount} msg{(t.messageCount??0)!==1?"s":""}</span>
                                    <span className="cs2-mini">M</span>
                                  </div>
                                </button>
                              );
                            })}
                            {col.threads.length === 0 && <div style={{textAlign:"center",color:"#9aa0aa",padding:"28px 8px",fontSize:"12px"}}>No conversations</div>}
                          </div>
                        </section>
                      ))}
                    </div>
                  );
                })()}
              </div>
              {/* Email thread detail panel */}
              {selectedEmailThreadId && (
                <div style={{width:"420px",flexShrink:0,borderLeft:"1px solid #e8eaf0",display:"flex",flexDirection:"column",background:"#fff",overflow:"hidden"}}>
                  <div style={{padding:"12px 16px",borderBottom:"1px solid #e8eaf0",display:"flex",alignItems:"center",gap:"8px"}}>
                    <button onClick={()=>setSelectedEmailThreadId(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:"16px",color:"#6b7280",padding:"0 4px"}}>←</button>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:"13px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{emailThread.data?.subject ?? "Loading…"}</div>
                    </div>
                  </div>
                  <div style={{flex:1,minHeight:0,overflow:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:"10px"}}>
                    {emailThread.isLoading && <div style={{color:"#9aa0aa",textAlign:"center",padding:"20px"}}>Loading thread…</div>}
                    {emailThread.data?.messages?.map((msg: any, i: number) => {
                      const isOutbound = emailInbox.data?.inboxEmail && msg.fromEmail?.toLowerCase() === emailInbox.data.inboxEmail.toLowerCase();
                      return (
                        <div key={i} style={{display:"flex",flexDirection:"column",alignItems:isOutbound?"flex-end":"flex-start"}}>
                          <div style={{maxWidth:"85%",background:isOutbound?"#eff6ff":"#f9fafb",border:`1px solid ${isOutbound?"#bfdbfe":"#e5e7eb"}`,borderRadius:"12px",padding:"8px 12px"}}>
                            <div style={{fontSize:"10px",color:"#9aa0aa",marginBottom:"4px",fontWeight:600}}>{msg.from ?? msg.fromEmail} · {msg.date ? new Date(msg.date).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : ""}</div>
                            <div style={{fontSize:"12px",color:"#1a1a2e",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{msg.body ?? msg.snippet}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{borderTop:"1px solid #e8eaf0",padding:"10px 12px",display:"flex",gap:"8px",alignItems:"flex-end"}}>
                    <textarea value={emailReply} onChange={e=>setEmailReply(e.target.value)} placeholder="Write a reply…"
                      style={{flex:1,border:"1px solid #e8eaf0",borderRadius:"8px",padding:"8px 10px",fontSize:"12px",resize:"none",minHeight:"60px",fontFamily:"inherit"}}
                      onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)&&emailReply.trim()){
                        const t = emailThread.data;
                        if(t) sendEmailReply.mutate({ threadId: selectedEmailThreadId, to: t.fromEmail ?? "", subject: t.subject ?? "", bodyHtml: emailReply.replace(/\n/g,"<br>") });
                      }}}
                    />
                    <button onClick={()=>{
                      const t = emailThread.data;
                      if(t && emailReply.trim()) sendEmailReply.mutate({ threadId: selectedEmailThreadId, to: t.fromEmail ?? "", subject: t.subject ?? "", bodyHtml: emailReply.replace(/\n/g,"<br>") });
                    }} disabled={!emailReply.trim() || sendEmailReply.isPending}
                      style={{background:"#3478f6",color:"#fff",border:"none",borderRadius:"8px",padding:"8px 14px",fontSize:"12px",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                      {sendEmailReply.isPending ? "Sending…" : "Send ↵"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
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
                      <button key={conv.id} className="cs2-card" onClick={()=>{ setSelectedConvWithReset(conv); setCompose(""); }}>
                        {conv.latestInteractionType === "call" ? (
                          <>
                            <div className="cs2-cardTop">
                              <div className="cs2-avatar" style={{background:"#6b4eff",fontSize:"14px"}}>☎</div>
                              <strong>{conv.name}</strong>
                              <span className="cs2-ago">{conv.ago}</span>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:"6px",margin:"6px 0 4px"}}>
                              <span style={{fontSize:"9px",fontWeight:800,color:"#6b4eff",textTransform:"uppercase",letterSpacing:".06em",background:"#f0edff",padding:"3px 7px",borderRadius:"6px"}}>AI Call</span>
                              {conv.latestCallDuration != null && conv.latestCallDuration > 0 && <span style={{fontSize:"10px",color:"#9aa0aa"}}>{Math.floor(conv.latestCallDuration/60)}m {conv.latestCallDuration%60}s</span>}
                            </div>
                            <div className="cs2-preview">{conv.latestCallSummary || "AI call — tap to view"}</div>
                            <div className="cs2-meta">
                              <span style={{fontSize:"9px",fontWeight:700,color:"#6b4eff"}}>☎ AI CALL</span>
                              &nbsp;·&nbsp;{conv.wait}
                              <span className="cs2-mini">M</span>
                            </div>
                          </>
                        ) : (
                          <>
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
                          </>
                        )}
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
          )}
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
      {showNewMsg && <NewMessageModal onClose={()=>setShowNewMsg(false)} onConvOpened={(phone)=>{ setTimeout(()=>refetchInbox(), 600); }} />}
    </>
  );
}
