import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const pagePath = path.resolve(import.meta.dirname, "../client/src/pages/CommandChatCRMReview.tsx");
const stylePath = path.resolve(import.meta.dirname, "../client/src/pages/command-chat-crm-review.css");
const leftCohesionStylePath = path.resolve(import.meta.dirname, "../client/src/pages/command-chat-left-cohesion.css");
const leadQueueStylePath = path.resolve(import.meta.dirname, "../client/src/pages/command-chat-lead-queue.css");
const leadPortraitStylePath = path.resolve(import.meta.dirname, "../client/src/pages/command-chat-lead-portraits.css");
const conversationListStylePath = path.resolve(import.meta.dirname, "../client/src/pages/command-chat-conversation-list.css");
const paletteBalanceStylePath = path.resolve(import.meta.dirname, "../client/src/pages/command-chat-palette-balance.css");
const groupConversationStylePath = path.resolve(import.meta.dirname, "../client/src/pages/command-chat-group-conversation.css");
const bubbleCompositionStylePath = path.resolve(import.meta.dirname, "../client/src/pages/command-chat-bubble-composition.css");
const referenceCompositionStylePath = path.resolve(import.meta.dirname, "../client/src/pages/command-chat-reference-composition.css");
const reviewNavStylePath = path.resolve(import.meta.dirname, "../client/src/components/review-workspace-nav.css");
const appPath = path.resolve(import.meta.dirname, "../client/src/App.tsx");

describe("Command Chat CRM review page", () => {
  const page = fs.readFileSync(pagePath, "utf8");
  const css = fs.readFileSync(stylePath, "utf8");
  const leftCohesionCss = fs.readFileSync(leftCohesionStylePath, "utf8");
  const leadQueueCss = fs.readFileSync(leadQueueStylePath, "utf8");
  const leadPortraitCss = fs.readFileSync(leadPortraitStylePath, "utf8");
  const conversationListCss = fs.readFileSync(conversationListStylePath, "utf8");
  const paletteBalanceCss = fs.readFileSync(paletteBalanceStylePath, "utf8");
  const groupConversationCss = fs.readFileSync(groupConversationStylePath, "utf8");
  const bubbleCompositionCss = fs.readFileSync(bubbleCompositionStylePath, "utf8");
  const referenceCompositionCss = fs.readFileSync(referenceCompositionStylePath, "utf8");
  const reviewNavCss = fs.readFileSync(reviewNavStylePath, "utf8");
  const app = fs.readFileSync(appPath, "utf8");

  it("is mounted only on its dedicated review route", () => {
    expect(app).toContain('const CommandChatCRMReview = lazy(() => import("./pages/CommandChatCRMReview"));');
    expect(app).toContain('<Route path={"/review/command-chat-crm"} component={CommandChatCRMReviewRoute} />');
    expect(app).toContain('ReviewWorkspaceFrame');
    expect(app).toContain('hideNavigation = false');
    expect(app).toContain('<ReviewWorkspaceFrame hideNavigation><CommandChatCRMReview /></ReviewWorkspaceFrame>');
  });

  it("mirrors the supplied MIB Command reference surfaces with matching static review destinations", () => {
    for (const label of ["MIB Command", "Operate. Serve. Grow.", "SMS", "Bookings CRM", "Leads CRM", "Schedule", "AI Calls", "Payroll Summary", "Settings", "CONVERSATIONS", "Search teammates...", "Team Harper", "# ops-updates", "Sophia Bell", "Amelia Ross", "New bookings", "Madison’s Moves", "Confirm Jordan’s arrival window", "Sophia Bell was ready to book", "Three quotes needed a human touch", "Related items", "Today’s service pulse"]) {
      expect(page).toContain(label);
    }
    expect(page).not.toContain("Auto-raised issues");
    const leadQueue = page.slice(page.indexOf("const leads = ["), page.indexOf("];", page.indexOf("const leads = [")));
    expect(leadQueue).not.toContain('stage: "Team"');
    expect(leadQueue).not.toContain("Team Harper");
    expect(leadQueue).not.toContain("Team Maya");
  });

  it("keeps every sample control local and excludes live data hooks", () => {
    for (const forbidden of ["trpc.", "useQuery", "useMutation", "fetch(", "axios", "WebSocket", "EventSource"]) {
      expect(page).not.toContain(forbidden);
    }
    expect(page).toContain("Static preview");
    expect(page).toContain("review-only");
  });

  it("uses the restored neutral dark palette and a rail-free three-column MIB Command composition", () => {
    expect(page).toContain('import "./command-chat-reference-composition.css"');
    for (const token of ["#151515", "#805dff", ".ccc-command-grid", ".ccc-message-stream", ".ccc-move", ".ccc-widget-app .ccc-nav,.ccc-widget-app .ccc-page-header{display:none}"]) {
      expect(css).toContain(token);
    }
    for (const token of ["--ccc-bg:#151515", "--ccc-panel:#1b1b1d", "--ccc-raised:#222224", "--ccc-input:#252527", "--ccc-line:#2b2b2e", ".review-nav-host.review-nav-host-without-nav", ".ccc-command-navigation", ".ccc-reference-chat-header", ".ccc-lead-context-topline", ".ccc-context-lead-mini", ".ccc-context-moves", ".ccc-context-related"]) expect(referenceCompositionCss).toContain(token);
    expect(reviewNavCss).toContain("--review-nav-width");
  });

  it("uses compact matching review destinations above the supplied dense Conversations treatment in the left column", () => {
    expect(page).toContain('import "./command-chat-conversation-list.css"');
    for (const token of [".ccc-conversation-list", ".ccc-conversation.active", "inset 2px 0 0 #777780"]) expect(leftCohesionCss).toContain(token);
    for (const token of ["ccc-command-navigation", "ccc-conversations-section", ".ccc-conversation-filters", ".ccc-inbox-list", ".ccc-inbox-meta", ".ccc-team-thread", ".ccc-channel-thread", "box-shadow:inset 2px 0 0 #777780"]) expect(`${page}\n${conversationListCss}\n${referenceCompositionCss}`).toContain(token);
    for (const destination of [["SMS", "/review/sms"], ["Bookings CRM", "/review/bookings-crm"], ["Leads CRM", "/review/leads-crm"], ["Schedule", "/review/schedule-crm"], ["AI Calls", "/review/ai-calls"], ["Payroll Summary", "/review/payroll-summary"], ["Settings", "/review/settings"]]) expect(page).toContain(`href="${destination[1]}"`);
    for (const removed of ["Team Chat", "Mentions", "AI Actions", "Operations", "Calendar", "Reports"]) expect(page).not.toContain(`>${removed}</button>`);
    expect(referenceCompositionCss).toContain(".ccc-command-navigation nav a");
    expect(page.indexOf('className="ccc-command-navigation"')).toBeLessThan(page.indexOf('className="ccc-left-section ccc-conversations-section"'));
    expect(page).not.toContain('className="ccc-leads-section"');
    expect(leftCohesionCss).not.toContain("ccc-active-chat");
    expect(leftCohesionCss).not.toContain("ccc-move");
  });

  it("uses static lead records and local filters for the conversation list", () => {
    expect(page).toContain("const leads = [");
    expect(page).toContain("const CHANNELS = [");
    expect(page).toContain("const INBOX_THREADS = [");
    expect(page).toContain('useState<"all" | "unread">("all")');
    expect(page).toContain("conversationFilter === \"unread\"");
    expect(page).toContain("const visibleThreads");
    expect(page).toContain("item.preview");
    expect(page).toContain("item.at");
    expect(page).toContain("setSmsRecipient(item.leadId ?? 1)");
    expect(page).toContain("const LEAD_MESSAGES");
    expect(page).toContain("activeMessages.map");
    expect(page).toContain("const activeMessages = LEAD_MESSAGES[active.id]");
    expect(page).not.toContain("const conversations = [");
    expect(page).not.toContain("setSelectedConversation");
    for (const token of [".ccc-conv-copy em", ".ccc-lead-meta", ".ccc-lead-meta b"]) {
      expect(leadQueueCss).toContain(token);
    }
  });

  it("opens a selected-conversation SMS composer locally without introducing real messaging hooks", () => {
    for (const marker of ["smsRecipient", "setSmsRecipient(item.leadId ?? 1)", 'setSmsRecipient("team")', "ccc-sms-modal-backdrop", "STATIC SMS COMPOSER", "Context ready", "Draft with AI", "Send SMS", "Text to ${smsTarget.name} is review-only and was not sent."]) expect(page).toContain(marker);
    for (const marker of [".ccc-sms-modal-backdrop", ".ccc-sms-modal", ".ccc-sms-modal-context", ".ccc-sms-message-field", ".ccc-sms-send"]) expect(referenceCompositionCss).toContain(marker);
    expect(`${page}\n${referenceCompositionCss}`).not.toMatch(/trpc\.|useQuery|useMutation|fetch\(|axios|WebSocket|EventSource|cleanerJobs|cleaner_jobs/);
  });

  it("uses regular original portraits in static conversation rows and the selected Lead Context", () => {
    expect(page).toContain('import "./command-chat-lead-portraits.css"');
    expect(page).toContain("const LEAD_PORTRAITS");
    for (const lead of ["Jordan Reeves", "Morgan Bell", "Amelia Ross", "Devon Turner", "Sophia Bell"]) expect(page).toContain(`"${lead}"`);
    expect(page).toContain("function LeadPortrait");
    expect(page).toContain('<LeadPortrait name={item.name} initials={leads.find((lead) => lead.id === item.leadId)?.initials ?? ""}');
    expect(page).toContain('<LeadPortrait name={active.name} initials={active.initials} tone={active.tone} />');
    for (const token of [".ccc-left-panel .ccc-lead-portrait", "width: 20px", "height: 20px", "border-radius: 50%", "object-fit: cover"]) expect(leadPortraitCss).toContain(token);
    for (const token of [".ccc-conversations-section .ccc-lead-portrait", "width:28px", "height:28px", "aspect-ratio:1/1", "border-radius:50%", "object-fit:cover"]) expect(conversationListCss).toContain(token);
    expect(`${page}\n${leadPortraitCss}\n${conversationListCss}`).not.toMatch(/trpc\.|useQuery|useMutation|fetch\(|cleanerJobs|cleaner_jobs/);
  });

  it("reserves violet for selection while assigning neutral, mint, amber, coral, and blue highlight roles", () => {
    expect(page).toContain('import "./command-chat-palette-balance.css"');
    for (const token of [".ccc-panel-tabs .active", "#b9abff", ".ccc-command-name svg", "#67ca9a", ".ccc-message-out p", "#223b49", ".ccc-thread-bar b", ".ccc-thread-bar b.attention", "#f1ce7e", ".ccc-thread-bar b.red", "#f0a1ab", ".ccc-move-violet", "#ddb96e", ".ccc-move-coral", "#c9616d", ".ccc-move-mint", "#55b983", "inset 2px 0 0", ".ccc-send", "#1b8d63", ".ccc-rule-card > svg", "#d3ad67"]) expect(paletteBalanceCss).toContain(token);
    expect(`${page}\n${paletteBalanceCss}`).not.toMatch(/trpc\.|useQuery|useMutation|fetch\(|cleanerJobs|cleaner_jobs/);
  });

  it("uses the one-row command header, pulse, bubbles, and system-event cues without a generic activity bar", () => {
    for (const token of ["ccc-command-navigation", "ccc-reference-chat-header", "ccc-reference-chat-top", "ccc-reference-header-metrics", "14</b> Leads", "6</b> Bookings", "$1,840", "3</b> Mentions", "ccc-service-pulse", "ccc-day-divider", "ccc-message-reaction", "ccc-message-system"]) expect(page).toContain(token);
    for (const token of [".ccc-reference-chat-header", ".ccc-reference-chat-tabs", ".ccc-reference-chat-actions", ".ccc-reference-header-metrics", ".ccc-header-metric-money", ".ccc-header-metric-mentions", ".ccc-command-navigation"]) expect(referenceCompositionCss).toContain(token);
    const headerCompositionCss = fs.readFileSync(path.resolve(import.meta.dirname, "../client/src/pages/command-chat-header-composition.css"), "utf8");
    for (const token of [".ccc-reference-command-info", ".ccc-reference-action-divider", "CircleDollarSign", "width:48px", "height:42px"]) expect(`${page}\n${headerCompositionCss}`).toContain(token);
    for (const removed of ["ccc-reference-chat-bottom", "ccc-command-search", "Search in MIB Command...", "CheckCircle2"]) expect(`${page}\n${headerCompositionCss}`).not.toContain(removed);
    expect(page).not.toContain("ccc-conversation-utils");
    expect(page).not.toContain('className="ccc-thread-bar"');
    expect(paletteBalanceCss).not.toContain("#236c54");
  });

  it("keeps the reference header presence group compact, portrait-led, and static", () => {
    for (const token of ["ccc-reference-chat-actions", "ccc-presence", "ccc-presence-portrait", "Madison static review portrait", "Jordan static review portrait", "Sophia static review portrait", "+3", "Call static MIB Command", "More static MIB Command options"]) expect(page).toContain(token);
    for (const token of [".ccc-reference-chat-actions .ccc-presence", "width:28px", "height:28px"]) expect(referenceCompositionCss).toContain(token);
    const headerCompositionCss = fs.readFileSync(path.resolve(import.meta.dirname, "../client/src/pages/command-chat-header-composition.css"), "utf8");
    for (const token of [".ccc-presence-portrait", "object-fit:cover", "border-radius:50%", "width:42px", "height:42px"]) expect(headerCompositionCss).toContain(token);
  });

  it("uses a bubble-led internal group-chat composition in the middle conversation column", () => {
    expect(page).toContain('import "./command-chat-group-conversation.css"');
    expect(page).toContain('import "./command-chat-bubble-composition.css"');
    expect(page).toContain("function GroupMessageAvatar");
    expect(page).toContain("Today’s service pulse");
    expect(page).toContain("ccc-service-pulse");
    expect(page).toContain("ccc-day-divider");
    expect(page).toContain('placeholder="Message today’s service desk..."');
    expect(page).toContain("ccc-group-message");
    expect(page).toContain("ccc-message-reaction");
    expect(page).not.toContain("Delivered</em>");
    for (const token of [".ccc-service-pulse", ".ccc-day-divider", "grid-template-columns:40px minmax(0,1fr)", "background:#151D24", ".ccc-group-message-right p", "background:linear-gradient(135deg,#24516d,#1b4057)", ".ccc-message-system span", ".ccc-message-reaction", ".ccc-composer>div"]) expect(bubbleCompositionCss).toContain(token);
    expect(`${page}\n${groupConversationCss}\n${bubbleCompositionCss}`).not.toMatch(/trpc\.|useQuery|useMutation|fetch\(|cleanerJobs|cleaner_jobs/);
  });

  it("shows a clearly identified static participant on the right side of the group feed", () => {
    expect(page).toContain('side: "right"');
    expect(page).toContain('ccc-group-message-${message.side ?? "left"}');
    for (const token of [".ccc-group-message-right", "grid-template-columns:minmax(0,1fr) 40px", "max-width:79%", ".ccc-group-message-right .ccc-message-meta", "justify-content:flex-end"]) expect(bubbleCompositionCss).toContain(token);
  });

  it("uses only static customer, Madison, Team Harper, and amber system roles in the final reference message stream", () => {
    const messageDataset = page.slice(page.indexOf("const LEAD_MESSAGES"), page.indexOf("const COMMAND_SCENARIOS"));
    expect(page).toContain('type GroupMessageKind = "customer" | "dispatch" | "team" | "system";');
    for (const marker of ['from: "Jordan Reeves", at: "9:41 AM", body: "Hi — can the team still make the 10:00 AM window today?", kind: "customer"', 'from: "Team Harper", at: "9:48 AM", body: "On the way. We should arrive between 10:05–10:15 AM.", kind: "team", reaction: "3"', 'from: "Jordan Reeves", at: "9:50 AM", body: "Perfect, thank you!", kind: "customer"']) expect(messageDataset).toContain(marker);
    expect(messageDataset).not.toContain("Route status updated · Team Harper on the way");
    expect(page).toContain("Scheduling update ·");
    for (const token of ["ccc-group-message-team", "ccc-team-message-reactions", "ccc-team-reaction-members", ".ccc-group-message-team p", "#16332D", "#24584B", "#D9F4E9", ".ccc-message-system span", "#d3ad67"]) expect(`${page}\n${groupConversationCss}\n${bubbleCompositionCss}\n${paletteBalanceCss}`).toContain(token);
  });

  it("uses a static Lead Context right rail and compact contextual notices in the center conversation stream", () => {
    expect(page).toContain("const COMMAND_NOTICES");
    expect(page).toContain("const activeNotice = COMMAND_NOTICES[active.id]");
    for (const marker of ["Arrival update ready", "Service brief grouped", "Quote momentum", "Scheduling choice ready", "Booking handoff ready", "ccc-command-notice", "Static contextual operational notice"]) expect(page).toContain(marker);
    for (const removedMarker of ["command-chat-command-card-variants.css", "const COMMAND_SCENARIOS", "function CommandCard", "ccc-inline-command-card", "ccc-command-card-rapid", "ccc-command-card-brief", "ccc-command-card-timeline", "ccc-command-card-slots", "ccc-command-card-checklist"]) expect(page).not.toContain(removedMarker);
    const centerStart = page.indexOf('<section className="ccc-command-panel ccc-center-panel">');
    const rightStart = page.indexOf('<aside className="ccc-command-panel ccc-right-panel">');
    const center = page.slice(centerStart, rightStart);
    const right = page.slice(rightStart);
    expect(center).toContain('className="ccc-message ccc-message-system ccc-command-notice"');
    expect(center).toContain("activeNotice.body");
    for (const marker of ["Lead context", "ccc-context-lead", "ccc-context-lead-mini", "Sophia Bell", "Amelia Ross", "New bookings", "Madison’s Moves", "Priority", "Confirm Jordan’s arrival window", "Review reply", "Opportunity", "Open lead", "Follow-up", "Review queue", "Related items", "View bookings"]) expect(right).toContain(marker);
    expect(right).toContain("active.name");
    expect(right).not.toContain("MADISON’S MOVES");
    expect(right).not.toContain("moves.map((move)");
    expect(right).not.toContain("CommandCard scenario");
    expect(`${page}\n${bubbleCompositionCss}\n${referenceCompositionCss}`).not.toMatch(/trpc\.|useQuery|useMutation|fetch\(|cleanerJobs|cleaner_jobs/);
  });

  it("shows one compact static AI call handoff in the initial Jordan group-chat stream", () => {
    for (const marker of ["const VOICE_HANDOFF_BARS", "function StaticVoiceHandoff", "Static AI call handoff for Jordan Reeves", "AI-handled inbound call", "Callback requested", "Static recording visualization", "Playback is unavailable in this static review.", "active.id === 1 && <StaticVoiceHandoff"]) expect(page).toContain(marker);
    for (const token of [".ccc-voice-handoff", ".ccc-voice-handoff-player", ".ccc-voice-handoff-waveform", "is-blue", "is-olive", "is-amber", "is-silver", "object-fit:cover"]) expect(bubbleCompositionCss).toContain(token);
    const centerStart = page.indexOf('<section className="ccc-command-panel ccc-center-panel">');
    const rightStart = page.indexOf('<aside className="ccc-command-panel ccc-right-panel">');
    const center = page.slice(centerStart, rightStart);
    expect(center.indexOf("StaticVoiceHandoff")).toBeLessThan(center.indexOf("ccc-command-notice"));
  });

});
