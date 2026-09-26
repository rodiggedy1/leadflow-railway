import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/CommandChatEmailDetail.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "client/src/pages/command-chat-email-detail.css"), "utf8");

describe("Command Chat Email popup detail", () => {
  it("uses the CsInbox2 direct-detail treatment when Command Chat supplies a selected thread", () => {
    expect(source).toContain('type EmailsExactLiveProps = {');
    expect(source).toContain('initialThreadId?: string | null;');
    expect(source).toContain('onCloseDetail?: () => void;');
    expect(source).toContain('detailOnly?: boolean;');
    expect(source).toContain('export default function EmailsExactLive({ initialThreadId = null, onCloseDetail, detailOnly = false }: EmailsExactLiveProps = {})');
    expect(source).toContain('if (detailOnly) return <section className="email-detail-main-only"');
    expect(source).toContain('className="email-detail-main em2-main emails-csinbox2-detail-main"');
    expect(source).toContain('DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true }, ...(showClose ? { FORBID_ATTR: ["style", "color", "bgcolor"] } : {}) })');
    expect(source).toContain('message.bodyText || message.snippet || "(no content)"');
    expect(source).toContain('replyToEmail?: string | null;');
    expect(source).toContain('function PopupDetailContext({ identity, bookingContext, isBookingContextLoading, close, onResolve, isResolving }');
    expect(source).toContain('trpc.gmail.getBookingContext.useQuery');
    expect(source).toContain('replyToEmail: validEmailOrNull(latestInbound?.replyToEmail)');
    expect(source).toContain('No active LeadFlow booking is linked to this email address.');
    expect(source).toContain('showClose={detailOnly}');
    expect(source).toContain('const latestInboundMessageIndex = messages.reduce');
    expect(source).toContain('const popupMessages = showClose');
    expect(source).toContain('popupMessages.map((message, index) => {');
    expect(source).not.toContain('{messages.map((message, index) => {');
    expect(source).toContain('showClose ? { FORBID_ATTR: ["style", "color", "bgcolor"] } : {}');
    expect(source).toContain('{!showClose && <div className="em2-main-tabs">');
    expect(source).toContain('em2-msg-body-scroll-owner');
    expect(source).not.toContain("trpc.gmail.getStoredThread.useQuery");
  });

  it("gives scroll ownership only to the received email body inside the popup", () => {
    expect(styles).toContain("grid-template-rows:minmax(0,1fr)");
    expect(styles).toContain("/* The thread viewport is intentionally not a scroll owner. */");
    expect(styles).toMatch(/\.ccc-live-email-workspace-modal \.em2-thread\s*\{[\s\S]*?overflow:\s*hidden;/);
    expect(styles).toContain("/* The received email body is the only vertical scroll owner in the left pane. */");
    expect(styles).toMatch(/\.ccc-live-email-workspace-modal \.em2-msg-body\s*\{[\s\S]*?overflow-y:\s*auto;/);
    expect(styles).toContain('.em2-msg-body-scroll-owner{overflow-y:auto}');
    expect(styles).toMatch(/\.ccc-live-email-workspace-modal \.em2-composer\s*\{[\s\S]*?flex:\s*0 0 auto;/);
    expect(styles).toContain("/* Madison remains in the fixed composer; its preview is compact but the draft remains insertable in full. */");
  });

  it("keeps Gmail inline body text readable only inside the dark Command Chat popup", () => {
    expect(styles).toContain("/* Gmail HTML can carry inline black text; keep that trusted, sanitized body legible on the dark popup only. */");
    expect(styles).toContain(".ccc-live-email-workspace-modal .em2-html-email-body,.ccc-live-email-workspace-modal .em2-html-email-body *{color:#dbe6ef!important}");
    expect(styles).toContain(".ccc-live-email-workspace-modal .em2-html-email-body hr");
  });
});
