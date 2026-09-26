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
    expect(source).toContain('DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } })');
    expect(source).toContain('message.bodyText || message.snippet || "(no content)"');
    expect(source).toContain('function PopupDetailContext({ identity, close, onResolve, isResolving }');
    expect(source).toContain('Booking context is not loaded in this email view.');
    expect(source).toContain('showClose={detailOnly}');
    expect(source).toContain('const latestInboundMessageIndex = messages.reduce');
    expect(source).toContain('em2-msg-body-scroll-owner');
    expect(source).not.toContain("trpc.gmail.getStoredThread.useQuery");
  });

  it("gives scroll ownership only to the received email body inside the popup", () => {
    expect(styles).toContain("/* The thread viewport is intentionally not a scroll owner. */");
    expect(styles).toMatch(/\.ccc-live-email-workspace-modal \.em2-thread\s*\{[\s\S]*?overflow:\s*hidden;/);
    expect(styles).toContain("/* The received email body is the only vertical scroll owner in the left pane. */");
    expect(styles).toMatch(/\.ccc-live-email-workspace-modal \.em2-msg-body\s*\{[\s\S]*?overflow-y:\s*auto;/);
    expect(styles).toContain('.em2-msg-body-scroll-owner{overflow-y:auto}');
    expect(styles).toMatch(/\.ccc-live-email-workspace-modal \.em2-composer\s*\{[\s\S]*?flex:\s*0 0 auto;/);
    expect(styles).toContain("/* Madison remains in the fixed composer; its preview is compact but the draft remains insertable in full. */");
  });
});
