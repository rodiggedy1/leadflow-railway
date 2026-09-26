import { useRef, useState } from "react";
import DOMPurify from "dompurify";
import { trpc } from "@/lib/trpc";

/**
 * One-way copy of the working Email-specific branch from CsInbox2.
 *
 * Source reference (intentionally not imported or modified):
 * client/src/components/CsInbox2.tsx
 * - Email state/API: lines 790–850
 * - Email detail: lines 1676–1946
 * - Email board: lines 2017–2095
 */

const HEAD_COLORS: Record<string, string> = {
  "New": "#3478f6",
  "Needs Response": "#13b77a",
  "Waiting on Customer": "#8b5cf6",
  "At Risk": "#ff9f1a",
};

const EMAIL_COPY_STYLES = `
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
.cs2-hsearch{flex:1;max-width:340px;height:40px;border:1.5px solid #a78bfa;border-radius:10px;padding:0 13px 0 36px;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a78bfa' stroke-width='2.5'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E") no-repeat 11px center;font-size:13px;outline:none}
.cs2-hsearch:focus{border-color:#6b4eff;box-shadow:0 0 0 3px rgba(107,78,255,.1)}
.cs2-hresults{padding:16px 22px;flex:1;overflow-y:auto}
.cs2-hresults h3{font-size:12px;font-weight:700;color:#8b91a0;text-transform:uppercase;letter-spacing:.08em;margin:0 0 12px}
.cs2-hcard{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1px solid #e5e7ee;background:#fff;cursor:pointer;margin-bottom:8px;transition:.12s;text-align:left;width:100%}
.cs2-hcard:hover{border-color:#cfc7ff;box-shadow:0 4px 16px rgba(30,32,60,.06);transform:translateY(-1px)}
.cs2-havatar{width:38px;height:38px;border-radius:10px;background:#eae6ff;color:#6249e9;display:grid;place-items:center;font-weight:800;font-size:13px;flex-shrink:0}
.cs2-hinfo{flex:1;min-width:0}
.cs2-hname{font-weight:700;font-size:13px;color:#101116}
.cs2-hphone{font-size:11px;color:#8b91a0;margin-top:1px}
.cs2-hpreview{font-size:12px;color:#555b6a;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs2-htime{font-size:11px;color:#9aa0aa;flex-shrink:0;margin-left:auto;padding-left:8px}
.cs2-hempty{text-align:center;color:#9aa0aa;padding:40px 0;font-size:13px}
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
.cs2-mini{margin-left:auto;width:21px;height:21px;border-radius:50%;background:#252a36;color:#fff;display:grid;place-items:center;font-size:9px;flex-shrink:0}.cs2-mini-img{display:block;object-fit:cover;background:#252a36}
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
.bubble2{padding:11px 13px;border-radius:16px;background:#f0ecff;line-height:1.48;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.out .bubble2{background:#f1f2f4}
.msg.latest .bubble2{box-shadow:0 0 0 2px rgba(107,78,255,.08)}
.cs2-note{max-width:80%;margin:14px auto;padding:11px 13px;border:1px solid #f3cf7b;border-radius:14px;background:#fffbeb;box-shadow:0 2px 8px rgba(146,90,10,.06)}
.cs2-noteHead{display:flex;align-items:center;gap:5px;margin-bottom:5px;font-size:9px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:#a86508}.cs2-noteAvatar{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;background:#b7791f;color:#fff;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0}.cs2-noteAvatarImg{display:block;object-fit:cover}.cs2-noteAuthor{color:#c38731;text-transform:none;letter-spacing:0;font-weight:600}.cs2-noteTime{margin-left:auto;text-transform:none;letter-spacing:0;color:#c99b55;font-weight:500}.cs2-noteBody{font-size:12px;line-height:1.48;color:#713f12;white-space:pre-wrap;overflow-wrap:anywhere}
.cs2-composer{padding:10px 24px 20px;border-top:1px solid #f0f1f3;flex-shrink:0}
.composeBox{border:1px solid #dfe1e6;border-radius:14px;padding:10px 11px;box-shadow:0 8px 30px rgba(30,31,45,.05)}.composeBox.composerExpanded{box-shadow:0 16px 38px rgba(70,53,159,.12),0 0 0 3px #f2efff}.composeBox.noteMode{border-color:#f3cf7b;background:#fffcf2}.composeBox.noteMode:focus-within{border-color:#e9b955;box-shadow:0 8px 30px rgba(146,90,10,.08),0 0 0 3px #fff3d6}
.composeBox:focus-within{border-color:#bdb2ff;box-shadow:0 8px 30px rgba(70,53,159,.08),0 0 0 3px #f2efff}
.composerMeta{display:flex;align-items:center;justify-content:space-between;min-height:19px;margin:0 0 4px 1px}.composerMeta span{font-size:10px;font-weight:800;color:#8b91a0;letter-spacing:.01em}.composerExpand{width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:#858b98;display:grid;place-items:center;cursor:pointer}.composerExpand:hover{background:#f1efff;color:#684bfa}.composeBox textarea{width:100%;height:72px;min-height:72px;max-height:220px;border:0;outline:0;resize:none;font-size:13px;font-family:inherit;line-height:1.5;overflow-y:hidden;transition:height .16s ease}.composeBox.composerExpanded textarea{max-height:min(42vh,420px)}
.composeRow{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}.replyAssist{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.assistBtn{height:28px;border:1px solid #e1e4ea;background:#fff;border-radius:999px;padding:0 9px;display:inline-flex;align-items:center;gap:4px;color:#525866;font-size:10px;font-weight:700;cursor:pointer}.assistBtn:hover{border-color:#b8a8ff;background:#f7f5ff;color:#6647ef}.assistBtn.faq{border-color:#a7ead1;color:#0e8a61}.assistBtn.objection{border-color:#fecdd3;color:#be123c}.assistBtn.emoji{width:28px;justify-content:center;padding:0}.emojiPopup{position:absolute;bottom:100%;left:0;margin-bottom:8px;z-index:60;box-shadow:0 16px 40px rgba(15,23,42,.18);border-radius:14px;overflow:hidden}
.noteToggle{border:1px solid #f3cf7b;background:#fff9e9;color:#a86508;border-radius:999px;padding:6px 9px;font-size:10px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px}.noteToggle.active{background:#f7d997}.noteSave{background:#c98019;box-shadow:0 5px 13px rgba(146,90,10,.2)}
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
/* Email detail — from user design */
.em-main{background:#fff;display:flex;flex-direction:column;overflow:hidden;flex:1;min-width:0}
.em-main-head{padding:18px 22px 10px;border-bottom:1px solid #e5e8ef}
.em-back{border:0;background:none;color:#555e6f;padding:0;margin-bottom:14px;font-size:13px;cursor:pointer}
.em-title-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
.em-title-wrap{display:flex;align-items:center;gap:10px;min-width:0}
.em-subject{font-size:21px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.em-badge{font-size:11px;padding:6px 9px;border-radius:999px;border:1px solid #f0c163;background:#fff8e7;color:#a76600;font-weight:800}
.em-head-actions{display:flex;gap:8px}
.em-sender-row{display:flex;align-items:center;justify-content:space-between;padding-top:16px}
.em-sender-left{display:flex;gap:12px;align-items:center}
.em-avatar{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#8e82ff,#6857ec);color:#fff;font-weight:800;flex-shrink:0}
.em-sender-name{font-size:14px;font-weight:800}
.em-sender-email{font-weight:500;color:#7b8291;margin-left:6px}
.em-to-line{font-size:12px;color:#8b92a0;margin-top:4px}
.em-message-age{font-size:12px;color:#7d8493}
.em-main-tabs{display:flex;gap:34px;padding:0 22px;border-bottom:1px solid #e5e8ef}
.em-main-tab{border:0;background:none;padding:14px 3px 12px;color:#626a79;font-size:13px;border-bottom:2px solid transparent;cursor:pointer}
.em-main-tab.active{color:#246bfe;border-bottom-color:#246bfe;font-weight:800}
.em-thread{flex:1;overflow:auto;padding:18px 22px 24px}
.em-message{border:1px solid #e3e6ec;border-radius:14px;padding:18px;margin-bottom:16px;background:#fff}
.em-message.outgoing{margin-left:22%;background:#f7faff;border-color:#cddcff}
.em-msg-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.em-msg-who{display:flex;align-items:center;gap:10px}
.em-small-avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:#8273f7;color:#fff;font-size:12px;font-weight:800;flex-shrink:0}
.em-small-avatar.out{background:#246bfe}
.em-msg-name{font-size:13px;font-weight:800}
.em-msg-email{font-size:11px;color:#7c8390;margin-left:5px}
.em-msg-time{font-size:11px;color:#8a91a0}
.em-msg-body{font-size:14px;line-height:1.7;color:#303641;padding-left:42px;white-space:pre-wrap;word-break:break-word}
.em-composer{border-top:1px solid #e5e8ef;background:#fff;padding:12px 14px 16px}
.em-compose-box{border:1px solid #dfe3e9;border-radius:14px;overflow:hidden}
.em-compose-tabs{display:flex;border-bottom:1px solid #e5e8ef}
.em-compose-tab{border:0;background:none;padding:11px 14px;color:#6d7481;font-size:12px;cursor:pointer}
.em-compose-tab.active{color:#246bfe;font-weight:800;border-bottom:2px solid #246bfe}
.em-compose-actions{display:flex;justify-content:space-between;align-items:center;padding:10px 12px 12px}
.em-tools{display:flex;gap:5px}
.em-icon-btn{border:0;background:transparent;width:31px;height:31px;border-radius:8px;cursor:pointer}
.em-icon-btn:hover{background:#f1f3f6}
.em-send-wrap{display:flex;gap:8px}
.em-send{border:0;background:#246bfe;color:#fff;border-radius:10px;padding:10px 15px;font-size:12px;font-weight:800;cursor:pointer}
.em-btn{border:1px solid #dfe3ea;background:#fff;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:700;color:#3d4451;cursor:pointer}
.em-right{width:320px;flex-shrink:0;border-left:1px solid #e5e8ef;background:#fbfbfd;overflow:auto}
.em-right-section{padding:18px;border-bottom:1px solid #e5e8ef}
.em-profile{display:flex;align-items:center;gap:12px}
.em-profile-avatar{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#8e82ff,#6857ec);color:#fff;font-weight:800;font-size:16px;flex-shrink:0}
.em-profile-name{font-weight:800}
.em-profile-email{font-size:12px;color:#707786;margin-top:5px}
.em-section-title{display:flex;justify-content:space-between;font-size:14px;font-weight:800;margin-bottom:14px}
.em-kv{margin-bottom:14px}
.em-k{font-size:11px;color:#8a91a0;margin-bottom:5px}
.em-v{font-size:13px;color:#303641}
.em-action-stack{display:grid;gap:8px}
.em-action-btn{border:1px solid #dfe3e8;background:#fff;border-radius:10px;padding:10px 12px;text-align:left;font-size:12px;font-weight:700;cursor:pointer}
.em2-app{height:100vh;display:grid;grid-template-columns:58px 335px minmax(560px,1fr) 320px;overflow:hidden}
.em2-rail{background:#fff;border-right:1px solid #e5e8ef;display:flex;flex-direction:column;align-items:center;padding:16px 8px;gap:16px}
.em2-logo{width:36px;height:36px;border-radius:12px;background:#246bfe;display:grid;place-items:center;color:white;font-size:18px}
.em2-rail-btn{width:40px;height:40px;border:0;background:transparent;border-radius:11px;color:#70798a;font-size:18px;cursor:pointer;font-family:inherit}
.em2-rail-btn.active,.em2-rail-btn:hover{background:#eef4ff;color:#246bfe}
.em2-spacer{flex:1}
.em2-sidebar{border-right:1px solid #e5e8ef;background:#fbfbfd;overflow:auto}
.em2-side-top{background:white;border-bottom:1px solid #e5e8ef;padding:18px 18px 0;position:sticky;top:0;z-index:2}
.em2-brand-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.em2-brand{font-size:20px;font-weight:800}
.em2-btn{border:1px solid #dfe3ea;background:#fff;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:700;color:#3d4451;cursor:pointer;font-family:inherit}
.em2-tabs{display:flex;gap:24px}
.em2-tab{padding:10px 2px 12px;border:0;background:none;color:#72798a;font-weight:700;border-bottom:2px solid transparent;cursor:pointer;font-family:inherit}
.em2-tab.active{color:#246bfe;border-bottom-color:#246bfe}
.em2-side-body{padding:16px}
.em2-kanban-title{font-size:18px;font-weight:800;margin-bottom:16px}
.em2-count{font-size:11px;background:#eef0f4;padding:3px 8px;border-radius:999px;color:#68707e}
.em2-column{background:#f5f6f8;border:1px solid #eef0f3;border-radius:14px;margin-bottom:12px;overflow:hidden}
.em2-column-head{display:flex;justify-content:space-between;align-items:center;padding:13px 14px;font-size:14px;font-weight:800}
.em2-col-left{display:flex;align-items:center;gap:9px}
.em2-dot{width:9px;height:9px;border-radius:50%}
.em2-dot-new{background:#2fb66d}
.em2-dot-needs{background:#f3a72f}
.em2-dot-wait{background:#246bfe}
.em2-dot-risk{background:#ef5a5a}
.em2-thread-list{padding:0 10px 10px;display:grid;gap:10px}
.em2-thread-card{background:#fff;border:1px solid #e2e5eb;border-radius:14px;padding:14px;transition:.15s;cursor:pointer;width:100%;max-width:100%;min-width:0;overflow:hidden;box-sizing:border-box}
.em2-thread-card:hover{transform:translateY(-1px);box-shadow:0 8px 24px #0000000d}
.em2-thread-card.active{border-color:#5b86ff;box-shadow:0 0 0 1px #5b86ff inset}
.em2-tc-top{display:flex;justify-content:space-between;gap:10px;margin-bottom:8px;min-width:0}
.em2-tc-name{font-size:14px;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.em2-tc-time{font-size:12px;color:#8a91a0;flex-shrink:0}
.em2-tc-subject{font-size:13px;font-weight:700;margin-bottom:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.em2-tc-snippet{font-size:12px;color:#69707f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.em2-unread{width:7px;height:7px;background:#246bfe;border-radius:50%;display:inline-block;margin-left:4px}
.em2-main{background:#fff;display:flex;flex-direction:column;overflow:hidden}
.em2-main-head{padding:12px 22px 8px;border-bottom:1px solid #e5e8ef}
.em2-back{border:0;background:none;color:#555e6f;padding:0;margin-bottom:14px;font-size:13px;cursor:pointer;font-family:inherit}
.em2-title-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
.em2-title-wrap{display:flex;align-items:center;gap:10px;min-width:0}
.em2-subject{font-size:21px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.em2-badge{font-size:11px;padding:6px 9px;border-radius:999px;border:1px solid #f0c163;background:#fff8e7;color:#a76600;font-weight:800}
.em2-head-actions{display:flex;gap:8px}
.em2-sender-row{display:flex;align-items:center;justify-content:space-between;padding-top:10px}
.em2-sender-left{display:flex;gap:12px;align-items:center}
.em2-avatar{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#8e82ff,#6857ec);color:#fff;font-weight:800}
.em2-profile-avatar{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#8e82ff,#6857ec);color:#fff;font-weight:800}
.em2-sender-name{font-size:14px;font-weight:800}
.em2-sender-email{font-weight:500;color:#7b8291;margin-left:6px}
.em2-to-line{font-size:12px;color:#8b92a0;margin-top:4px}
.em2-message-age{font-size:12px;color:#7d8493}
.em2-main-tabs{display:flex;gap:34px;padding:0 22px;border-bottom:1px solid #e5e8ef}
.em2-main-tab{border:0;background:none;padding:14px 3px 12px;color:#626a79;font-size:13px;border-bottom:2px solid transparent;cursor:pointer;font-family:inherit}
.em2-main-tab.active{color:#246bfe;border-bottom-color:#246bfe;font-weight:800}
.em2-thread{flex:1;overflow:auto;padding:18px 22px 24px}
.em2-email-message{border:1px solid #e3e6ec;border-radius:14px;padding:18px;margin-bottom:16px;background:#fff}
.em2-email-message.outgoing{margin-left:22%;background:#f7faff;border-color:#cddcff}
.em2-msg-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.em2-msg-who{display:flex;align-items:center;gap:10px}
.em2-small-avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:#8273f7;color:#fff;font-size:12px;font-weight:800}
.em2-small-avatar.out{background:#246bfe}
.em2-msg-name{font-size:13px;font-weight:800}
.em2-msg-email{font-size:11px;color:#7c8390;margin-left:5px}
.em2-msg-time{font-size:11px;color:#8a91a0}
.em2-msg-body{font-size:14px;line-height:1.7;color:#303641;padding-left:42px;overflow:visible;max-height:none;height:auto}
.em2-html-email-body{width:100%;max-width:100%;overflow-x:auto;font-size:14px;line-height:1.6;color:#303641}
.em2-html-email-body img{max-width:100%;height:auto}
.em2-html-email-body table{max-width:100%}
.em2-new-line{display:flex;align-items:center;gap:12px;margin:22px 0;color:#246bfe;font-size:11px}
.em2-composer{border-top:1px solid #e5e8ef;background:#fff;padding:12px 14px 16px}
.em2-ai-draft{border:1px solid #d4c8ff;background:linear-gradient(135deg,#f5f0ff 0%,#ede8ff 100%);border-radius:14px;padding:14px 16px;margin-bottom:12px;cursor:pointer;transition:.15s}
.em2-ai-draft:hover{border-color:#a78bfa;box-shadow:0 2px 12px #7c3aed18}
.em2-ai-draft-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.em2-ai-draft-label{font-size:11px;font-weight:800;color:#7c3aed;letter-spacing:.04em;text-transform:uppercase;display:flex;align-items:center;gap:5px}
.em2-ai-draft-actions{display:flex;gap:6px;align-items:center}
.em2-ai-draft-use{border:0;background:#7c3aed;color:#fff;border-radius:8px;padding:5px 12px;font-weight:800;cursor:pointer;font-size:12px;font-family:inherit;transition:.1s}
.em2-ai-draft-use:hover{background:#6d28d9}
.em2-ai-draft-dismiss{border:0;background:none;color:#9ca3af;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:13px;font-family:inherit;line-height:1}
.em2-ai-draft-dismiss:hover{color:#6b7280;background:#f3f4f6}
.em2-ai-draft-preview{font-size:13px;color:#4c3d8a;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.em2-ai-draft-intent{font-size:11px;color:#8b7ec8;margin-top:4px;font-style:italic}
.em2-compose-box{border:1px solid #dfe3e9;border-radius:14px;overflow:hidden}
.em2-compose-tabs{display:flex;border-bottom:1px solid #e5e8ef}
.em2-compose-tab{border:0;background:none;padding:11px 14px;color:#6d7481;font-size:12px;cursor:pointer;font-family:inherit}
.em2-compose-tab.active{color:#246bfe;font-weight:800;border-bottom:2px solid #246bfe}
.em2-compose-textarea{width:100%;min-height:92px;resize:none;border:0;outline:0;padding:14px;font-size:13px;font-family:inherit}
.em2-compose-actions{display:flex;justify-content:space-between;align-items:center;padding:10px 12px 12px}
.em2-tools{display:flex;gap:5px}
.em2-icon-btn{border:0;background:transparent;width:31px;height:31px;border-radius:8px;cursor:pointer;font-family:inherit}
.em2-icon-btn:hover{background:#f1f3f6}
.em2-send-wrap{display:flex;gap:8px}
.em2-send{border:0;background:#246bfe;color:#fff;border-radius:10px;padding:10px 15px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit}
.em2-right{border-left:1px solid #e5e8ef;background:#fbfbfd;overflow:auto}
.em2-right-section{padding:18px;border-bottom:1px solid #e5e8ef}
.em2-profile{display:flex;align-items:center;gap:12px}
.em2-profile-name{font-weight:800}
.em2-profile-email,.em2-profile-phone{font-size:12px;color:#707786;margin-top:5px}
.em2-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px}
.em2-chip{font-size:10px;font-weight:800;padding:5px 8px;border-radius:999px;border:1px solid}
.em2-chip-green{background:#ecf9f2;border-color:#b8e6c9;color:#2c7c4c}
.em2-chip-purple{background:#f3f0ff;border-color:#d5cdfd;color:#5a48ce}
.em2-section-title{display:flex;justify-content:space-between;font-size:14px;font-weight:800;margin-bottom:14px}
.em2-kv{margin-bottom:14px}
.em2-k{font-size:11px;color:#8a91a0;margin-bottom:5px}
.em2-v{font-size:13px;color:#303641}
.em2-action-stack{display:grid;gap:8px}
.em2-action-btn{border:1px solid #dfe3e8;background:#fff;border-radius:10px;padding:10px 12px;text-align:left;font-size:12px;font-weight:700;cursor:pointer;width:100%;font-family:inherit}
`;

const EMAIL_DETAIL_ONLY_STYLES = `
.em2-copy-detail-only{grid-template-columns:minmax(0,1fr);height:100%;min-height:0}
.em2-copy-detail-only>.em2-rail,.em2-copy-detail-only>.em2-sidebar,.em2-copy-detail-only>.em2-right{display:none}
.em2-copy-detail-only>.em2-main{grid-column:1;min-width:0;height:100%;min-height:0}
`;

type CsInbox2EmailWorkspaceProps = {
  initialThreadId?: string | null;
  detailOnly?: boolean;
  onCloseDetail?: () => void;
};

export default function CsInbox2EmailWorkspace({
  initialThreadId = null,
  detailOnly = false,
  onCloseDetail,
}: CsInbox2EmailWorkspaceProps = {}) {
  // Exact Email-specific state and query behavior copied from CsInbox2.
  const [channel, setChannel] = useState<"inbox" | "email" | "outreach">("email");
  const [selectedEmailThreadId, setSelectedEmailThreadId] = useState<string | null>(initialThreadId);
  const emailInbox = trpc.opsChat.listEmailInboxThreads.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const emailUtils = trpc.useUtils();
  const emailThread = trpc.gmail.getThread.useQuery(
    { threadId: selectedEmailThreadId! },
    { enabled: !!selectedEmailThreadId, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const [emailReply, setEmailReply] = useState("");
  const [dismissedEmailDrafts, setDismissedEmailDrafts] = useState<Set<string>>(new Set());
  const threadRef = useRef<HTMLDivElement>(null);
  const [toast] = useState("");

  const closeDetail = () => {
    setSelectedEmailThreadId(null);
    onCloseDetail?.();
  };

  const sendEmailReply = trpc.gmail.sendReply.useMutation({
    onSuccess: () => {
      setEmailReply("");
      emailUtils.opsChat.listEmailInboxThreads.invalidate();
      emailUtils.gmail.getThread.invalidate({ threadId: selectedEmailThreadId! });
    },
  });
  const dismissEmailDraftMut = trpc.opsChat.dismissEmailDraft.useMutation();
  const emailAiDraft = trpc.opsChat.getEmailDraftByThreadId.useQuery(
    { threadId: selectedEmailThreadId! },
    { enabled: !!selectedEmailThreadId, staleTime: 20_000, refetchInterval: 15_000, refetchOnWindowFocus: true },
  );
  const resolveEmailThread = trpc.gmail.completeThread.useMutation({
    onSuccess: () => {
      if (emailAiDraft.data?.id) {
        dismissEmailDraftMut.mutate({ draftId: emailAiDraft.data.id, dismissedBy: "agent" });
      }
      closeDetail();
      emailUtils.opsChat.listEmailInboxThreads.invalidate();
    },
  });

  // ── EMAIL DETAIL VIEW ─────────────────────────────────────────────────
  if (selectedEmailThreadId) {
    const t = emailThread.data;
    const inboxEmail = (emailInbox.data?.inboxEmail ?? t?.inboxEmail ?? "").toLowerCase();
    // Fix sender identity: t.from is display name (may be email addr), t.fromEmail is extracted <...> addr (may be relay)
    const RELAY_DOMAINS = ["launch27mail.com","maidsinblacksupport.com"];
    const rawFrom = t?.from ?? "";
    const rawFromEmail = t?.fromEmail ?? "";
    const isRelay = RELAY_DOMAINS.some(d => rawFromEmail.toLowerCase().includes(d));
    // If t.from looks like an email address, use it as the external email; otherwise use t.fromEmail if not a relay
    const fromLooksLikeEmail = /\S+@\S+/.test(rawFrom);
    const extEmail = fromLooksLikeEmail ? rawFrom : (isRelay ? rawFrom : rawFromEmail);
    const extName = fromLooksLikeEmail ? rawFrom.split("@")[0] : (rawFrom || rawFromEmail.split("@")[0] || "Unknown");
    const senderName = extName;
    const senderEmail = extEmail;
    const initials = extName.replace(/[^A-Za-z ]/g,"").split(" ").filter(Boolean).slice(0,2).map((w:string)=>w[0].toUpperCase()).join("") || "??";
    // Fix subject: strip [From: "..." <...>] prefix if present
    const rawSubject = t?.subject ?? "Email Thread";
    const subject = rawSubject.replace(/^\[From:[^\]]*\]\s*/i, "").trim() || rawSubject;
    const msgCount = t?.messages?.length ?? 0;
    const lastMsg = t?.messages?.[t.messages.length - 1];
    const ago = (ts: number) => { const d = Date.now()-ts; if(d<60000) return "just now"; if(d<3600000) return Math.floor(d/60000)+"m ago"; if(d<86400000) return Math.floor(d/3600000)+"h ago"; return Math.floor(d/86400000)+"d ago"; };
    const lastMsgAgo = lastMsg?.date ? ago(lastMsg.date) : "";
    const colLabel = (() => {
      if (!lastMsg) return "Needs Response";
      const isOut = inboxEmail && lastMsg.fromEmail?.toLowerCase() === inboxEmail;
      if (isOut) return "Waiting on Customer";
      const waitMs = Date.now() - (lastMsg.date ?? 0);
      if (waitMs >= 30*60*1000) return "At Risk";
      if (msgCount <= 2) return "New";
      return "Needs Response";
    })();
    const threads = emailInbox.data?.threads ?? [];
    const THIRTY_MIN2 = 30*60*1000;
    const TWENTY_FOUR_H2 = 24*60*60*1000;
    const now3 = Date.now();
    const getEmailCol2 = (th: typeof threads[0]) => {
      const isOut2 = inboxEmail && th.senderEmail?.toLowerCase() === inboxEmail;
      if (isOut2) return "Waiting on Customer";
      const w = now3 - (th.lastMessageAt ?? 0);
      if (w >= THIRTY_MIN2) return "At Risk";
      if (w < TWENTY_FOUR_H2 && (th.messageCount ?? 999) <= 2) return "New";
      return "Needs Response";
    };
    const emailCols2 = [
      { label: "New", dotClass: "em2-dot-new", items: threads.filter(th => getEmailCol2(th) === "New") },
      { label: "Needs Response", dotClass: "em2-dot-needs", items: threads.filter(th => getEmailCol2(th) === "Needs Response") },
      { label: "Waiting on Customer", dotClass: "em2-dot-wait", items: threads.filter(th => getEmailCol2(th) === "Waiting on Customer") },
      { label: "At Risk", dotClass: "em2-dot-risk", items: threads.filter(th => getEmailCol2(th) === "At Risk") },
    ];
    return (
      <>
        <style>{EMAIL_COPY_STYLES + EMAIL_DETAIL_ONLY_STYLES}</style>
        <div className={detailOnly ? "em2-app em2-copy-detail-only" : "em2-app"}>
          <aside className="em2-rail">
            <div className="em2-logo">M</div>
            <button className="em2-rail-btn">&#8962;</button>
            <button className="em2-rail-btn">&#128101;</button>
            <button className="em2-rail-btn">&#9711;</button>
            <button className="em2-rail-btn">&#9742;</button>
            <button className="em2-rail-btn active">&#9993;</button>
            <button className="em2-rail-btn">&#9635;</button>
            <div className="em2-spacer" />
            <button className="em2-rail-btn" onClick={() => closeDetail()}>&#8592;</button>
          </aside>
          <section className="em2-sidebar">
            <div className="em2-side-top">
              <div className="em2-brand-row">
                <div className="em2-brand">Inbox2</div>
                <button className="em2-btn">+ New</button>
              </div>
              <div className="em2-tabs">
                <button className="em2-tab" onClick={() => { setChannel("inbox"); closeDetail(); }}>Inbox</button>
                <button className="em2-tab active">Email</button>
              </div>
            </div>
            <div className="em2-side-body">
              <div className="em2-kanban-title">Email Kanban <span className="em2-count">{threads.length}</span></div>
              {emailCols2.map(col => (
                <div key={col.label} className="em2-column">
                  <div className="em2-column-head">
                    <div className="em2-col-left"><span className={"em2-dot " + col.dotClass} />{col.label}</div>
                    <div>{col.items.length}&#8964;</div>
                  </div>
                  {col.items.length > 0 && (
                    <div className="em2-thread-list">
                      {col.items.map(th => (
                        <div key={th.threadId} className={"em2-thread-card" + (selectedEmailThreadId === th.threadId ? " active" : "")} onClick={() => setSelectedEmailThreadId(th.threadId)}>
                          <div className="em2-tc-top">
                            <div className="em2-tc-name">{th.senderName ?? th.senderEmail ?? "Unknown"}{th.isUnread && <span className="em2-unread" />}</div>
                            <div className="em2-tc-time">{th.lastMessageAt ? ago(th.lastMessageAt) : ""}</div>
                          </div>
                          <div className="em2-tc-subject">{th.subject ?? "(no subject)"}</div>
                          <div className="em2-tc-snippet">{th.snippet ?? ""}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
          <main className="em2-main">
            <div className="em2-main-head">
              <button className="em2-back" onClick={() => closeDetail()}>&#8592; &nbsp; Back to list</button>
              <div className="em2-title-row">
                <div className="em2-title-wrap">
                  <div className="em2-subject">{subject}</div>
                  <span className="em2-badge">{colLabel}</span>
                </div>
                <div className="em2-head-actions">
                  <button className="em2-btn" onClick={() => resolveEmailThread.mutate({threadId: selectedEmailThreadId})} disabled={resolveEmailThread.isPending}>
                    {resolveEmailThread.isPending ? "Resolving..." : "\u2713 Resolve"}
                  </button>
                  <button className="em2-btn">&#8226;&#8226;&#8226;</button>
                </div>
              </div>
              <div className="em2-sender-row">
                <div className="em2-sender-left">
                  <div className="em2-avatar">{initials}</div>
                  <div>
                    <div className="em2-sender-name">{senderName} <span className="em2-sender-email">&lt;{senderEmail}&gt;</span></div>
                    <div className="em2-to-line">to: {inboxEmail || "inbox"}&#8964;</div>
                  </div>
                </div>
                <div className="em2-message-age">{lastMsgAgo}</div>
              </div>
            </div>
            <div className="em2-main-tabs">
              <button className="em2-main-tab active">Thread</button>
              <button className="em2-main-tab">Headers</button>
              <button className="em2-main-tab">Notes (0)</button>
              <button className="em2-main-tab">Activity</button>
            </div>
            <div className="em2-thread" ref={threadRef}>
              {!t && <div style={{padding:"40px",textAlign:"center",color:"#9ca3af"}}>Loading thread...</div>}
              {t?.messages?.map((msg) => {
                const isOut = inboxEmail && msg.fromEmail?.toLowerCase() === inboxEmail;
                const msgInitials = (msg.from ?? msg.fromEmail ?? "?").replace(/[^A-Za-z ]/g,"").split(" ").filter(Boolean).slice(0,2).map((w:string)=>w[0].toUpperCase()).join("") || "?";
                const sanitizedHtml = msg.bodyHtml ? DOMPurify.sanitize(msg.bodyHtml, { USE_PROFILES: { html: true } }) : null;
                return (
                  <div key={msg.id} className={"em2-email-message" + (isOut ? " outgoing" : "")}>
                    <div className="em2-msg-head">
                      <div className="em2-msg-who">
                        <div className={"em2-small-avatar" + (isOut ? " out" : "")}>{isOut ? "Y" : msgInitials}</div>
                        <div>
                          <span className="em2-msg-name">{isOut ? "You" : (msg.from || senderName)}</span>
                          <span className="em2-msg-email">&lt;{msg.fromEmail ?? ""}&gt;</span>
                        </div>
                      </div>
                      <div className="em2-msg-time">{msg.date ? ago(msg.date) : ""}</div>
                    </div>
                    <div className="em2-msg-body">
                      {sanitizedHtml ? (
                        <div className="em2-html-email-body" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
                      ) : (
                        <div style={{whiteSpace:"pre-wrap"}}>{msg.bodyText || msg.snippet || "(no content)"}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <section className="em2-composer">
              <div className="em2-compose-box">
                <div className="em2-compose-tabs">
                  <button className="em2-compose-tab active">Reply</button>
                  <button className="em2-compose-tab">Internal Note</button>
                </div>
                {/* AI Draft Banner */}
                {emailAiDraft.data && !dismissedEmailDrafts.has(selectedEmailThreadId ?? "") && (
                  <div className="em2-ai-draft" onClick={() => {
                    if (emailAiDraft.data?.generatedDraft) {
                      setEmailReply(emailAiDraft.data.generatedDraft);
                      setDismissedEmailDrafts(prev => new Set(Array.from(prev).concat(selectedEmailThreadId ?? "")));
                    }
                  }}>
                    <div className="em2-ai-draft-header">
                      <div className="em2-ai-draft-label">
                        <span>✦</span> Madison drafted a reply
                      </div>
                      <div className="em2-ai-draft-actions" onClick={e => e.stopPropagation()}>
                        <button className="em2-ai-draft-use" onClick={() => {
                          if (emailAiDraft.data?.generatedDraft) {
                            setEmailReply(emailAiDraft.data.generatedDraft);
                            setDismissedEmailDrafts(prev => new Set(Array.from(prev).concat(selectedEmailThreadId ?? "")));
                          }
                        }}>Insert Draft</button>
                        <button className="em2-ai-draft-dismiss" title="Dismiss" onClick={() => {
                          setDismissedEmailDrafts(prev => new Set(Array.from(prev).concat(selectedEmailThreadId ?? "")));
                        }}>✕</button>
                      </div>
                    </div>
                    {emailAiDraft.data.intentSummary && (
                      <div className="em2-ai-draft-intent">{emailAiDraft.data.intentSummary}</div>
                    )}
                    <div className="em2-ai-draft-preview">{emailAiDraft.data.generatedDraft ?? ""}</div>
                  </div>
                )}
                <textarea
                  className="em2-compose-textarea"
                  placeholder="Type your reply..."
                  value={emailReply}
                  onChange={e => setEmailReply(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && emailReply.trim()) {
                      sendEmailReply.mutate({threadId: selectedEmailThreadId, to: senderEmail, subject: subject, bodyHtml: emailReply.split("\n").join("<br>")});
                    }
                  }}
                />
                <div className="em2-compose-actions">
                  <div className="em2-tools">
                    <button className="em2-icon-btn"><b>B</b></button>
                    <button className="em2-icon-btn"><i>I</i></button>
                    <button className="em2-icon-btn">&#9783;</button>
                    <button className="em2-icon-btn">&#128279;</button>
                    <button className="em2-icon-btn">&#128444;</button>
                    <button className="em2-icon-btn">&#128206;</button>
                    <button className="em2-icon-btn">&#9786;</button>
                  </div>
                  <div className="em2-send-wrap">
                    <button className="em2-btn">Templates</button>
                    <button
                      className="em2-send"
                      disabled={!emailReply.trim() || sendEmailReply.isPending}
                      onClick={() => {
                        if (emailReply.trim()) sendEmailReply.mutate({threadId: selectedEmailThreadId, to: senderEmail, subject: subject, bodyHtml: emailReply.split("\n").join("<br>")});
                      }}
                    >
                      {sendEmailReply.isPending ? "Sending..." : "Send Reply \u25be"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </main>
          <aside className="em2-right">
            <div className="em2-right-section">
              <div className="em2-profile">
                <div className="em2-profile-avatar">{initials}</div>
                <div>
                  <div className="em2-profile-name">{senderName}</div>
                  <div className="em2-profile-email">{senderEmail}</div>
                </div>
              </div>
              <div className="em2-chips">
                <span className="em2-chip em2-chip-green">Customer</span>
                <span className="em2-chip em2-chip-purple">Email</span>
              </div>
            </div>
            <div className="em2-right-section">
              <div className="em2-section-title">Thread Details <span>&#8963;</span></div>
              <div className="em2-kv"><div className="em2-k">Thread ID</div><div className="em2-v" style={{fontFamily:"monospace",fontSize:"11px",wordBreak:"break-all"}}>{selectedEmailThreadId}</div></div>
              <div className="em2-kv"><div className="em2-k">Subject</div><div className="em2-v">{subject}</div></div>
              <div className="em2-kv"><div className="em2-k">Last Message</div><div className="em2-v">{lastMsgAgo}</div></div>
              <div className="em2-kv"><div className="em2-k">Messages</div><div className="em2-v">{msgCount}</div></div>
              <div className="em2-kv"><div className="em2-k">Status</div><div className="em2-v">{colLabel}</div></div>
            </div>
            <div className="em2-right-section">
              <div className="em2-section-title">Actions <span>&#8963;</span></div>
              <div className="em2-action-stack">
                <button className="em2-action-btn" onClick={() => resolveEmailThread.mutate({threadId: selectedEmailThreadId})} disabled={resolveEmailThread.isPending}>
                  &#10003; {resolveEmailThread.isPending ? "Resolving..." : "Resolve Thread"}
                </button>
                <button className="em2-action-btn" onClick={() => closeDetail()}>&#8592; Back to Inbox</button>
              </div>
            </div>
          </aside>
        </div>
        <div className={"cs2-toast" + (toast ? " show" : "")}>{toast}</div>
      </>
    );
  }



  // Exact Email board classification and card behavior copied from CsInbox2.
  const threads = emailInbox.data?.threads ?? [];
  const inboxEmail = emailInbox.data?.inboxEmail?.toLowerCase() ?? "";
  const now = Date.now();
  const THIRTY_MIN = 30 * 60 * 1000;
  const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;
  const getEmailColumn = (thread: typeof threads[0]) => {
    const isOutbound = inboxEmail && thread.senderEmail?.toLowerCase() === inboxEmail;
    if (isOutbound) return "Waiting on Customer";
    const waitMs = now - (thread.lastMessageAt ?? 0);
    const isAtRisk = waitMs >= THIRTY_MIN;
    const isNew = !isAtRisk && (now - (thread.lastMessageAt ?? 0)) < TWENTY_FOUR_H && (thread.messageCount ?? 999) <= 2;
    if (isAtRisk) return "At Risk";
    if (isNew) return "New";
    return "Needs Response";
  };
  const emailCols = ["New", "Needs Response", "Waiting on Customer", "At Risk"].map(label => ({
    label,
    threads: threads.filter(thread => getEmailColumn(thread) === label).sort((left, right) =>
      (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0),
    ),
  }));

  return <>
    <style>{EMAIL_COPY_STYLES + EMAIL_DETAIL_ONLY_STYLES}</style>
    <div className={detailOnly ? "em2-app em2-copy-detail-only" : "em2-app"}>
      {!detailOnly && <>
        <aside className="em2-rail">
          <div className="em2-logo">M</div>
          <button className="em2-rail-btn">⌂</button>
          <button className="em2-rail-btn">♙</button>
          <button className="em2-rail-btn active">✉</button>
          <div className="em2-spacer" />
        </aside>
        <section className="em2-sidebar">
          <div className="em2-side-top">
            <div className="em2-brand-row"><div className="em2-brand">Inbox2</div><button className="em2-btn">+ New</button></div>
            <div className="em2-tabs"><button className="em2-tab">Inbox</button><button className="em2-tab active" onClick={() => setChannel("email")}>Email</button></div>
          </div>
          <div className="em2-side-body"><div className="em2-kanban-title">Email Kanban <span className="em2-count">{threads.length}</span></div>
            {emailCols.map(column => <div key={column.label} className="em2-column"><div className="em2-column-head"><div className="em2-col-left"><span className="em2-dot" style={{ background: HEAD_COLORS[column.label] ?? "#888" }} />{column.label}</div><div>{column.threads.length}⌄</div></div>
              {column.threads.map(thread => <div key={thread.threadId} className="em2-thread-card" onClick={() => setSelectedEmailThreadId(thread.threadId)}><div className="em2-tc-top"><div className="em2-tc-name">{thread.senderName ?? thread.senderEmail ?? "Unknown"}{thread.isUnread && <span className="em2-unread" />}</div><div className="em2-tc-time">{thread.lastMessageAt ? `${Math.max(1, Math.floor((now - thread.lastMessageAt) / 60000))}m ago` : ""}</div></div><div className="em2-tc-subject">{thread.subject ?? "(no subject)"}</div><div className="em2-tc-snippet">{thread.snippet ?? ""}</div></div>)}
            </div>)}
          </div>
        </section>
      </>}
      <main className="em2-main">
        <div className="em2-main-head"><div className="em2-title-row"><div className="em2-title-wrap"><div className="em2-subject">Email Kanban</div></div></div></div>
        <div className="em2-thread">
          {emailInbox.isLoading && <div style={{ padding: "40px", color: "#9aa0aa", textAlign: "center" }}>Loading emails…</div>}
          {!emailInbox.isLoading && threads.length === 0 && <div style={{ padding: "40px", color: "#9aa0aa", textAlign: "center" }}>No email conversations yet</div>}
          {!emailInbox.isLoading && threads.length > 0 && <div className="cs2-board">{emailCols.map(column => <section key={column.label} className="cs2-column"><div className="cs2-colHead"><span className="cs2-dot" style={{ background: HEAD_COLORS[column.label] ?? "#888" }} />{column.label}<small>{column.threads.length}</small><span className="chevron">⌄</span></div><div className="cs2-colCards">{column.threads.map(thread => { const elapsed = now - (thread.lastMessageAt ?? 0); const ago = elapsed < 60_000 ? "<1m ago" : elapsed < 3_600_000 ? `${Math.floor(elapsed / 60_000)}m ago` : elapsed < 86_400_000 ? `${Math.floor(elapsed / 3_600_000)}h ago` : `${Math.floor(elapsed / 86_400_000)}d ago`; const initials = (thread.senderName ?? thread.senderEmail ?? "?").slice(0, 2).toUpperCase(); return <button key={thread.threadId} className="cs2-card" onClick={() => setSelectedEmailThreadId(thread.threadId)} style={{ background: selectedEmailThreadId === thread.threadId ? "#f0edff" : "", border: selectedEmailThreadId === thread.threadId ? "1.5px solid #6b4eff" : "" }}><div className="cs2-cardTop"><div className="cs2-avatar" style={{ background: "#3478f6", fontSize: "11px" }}>{initials}</div><strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thread.senderName ?? thread.senderEmail}</strong><span className="cs2-ago">{ago}</span></div><div style={{ fontSize: "11px", fontWeight: 600, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: "3px 0 2px" }}>✉ {thread.subject}</div><div className="cs2-preview">{thread.snippet}</div><div className="cs2-meta">{thread.isUnread && <span style={{ fontSize: "9px", fontWeight: 800, color: "#3478f6", background: "#eff6ff", padding: "2px 6px", borderRadius: "5px", marginRight: "4px" }}>UNREAD</span>}<span style={{ fontSize: "9px", color: "#9aa0aa" }}>{thread.messageCount} msg{(thread.messageCount ?? 0) !== 1 ? "s" : ""}</span><span className="cs2-mini">M</span></div></button>; })}{column.threads.length === 0 && <div style={{ textAlign: "center", color: "#9aa0aa", padding: "28px 8px", fontSize: "12px" }}>No conversations</div>}</div></section>)}</div>}
        </div>
      </main>
    </div>
  </>;
}
