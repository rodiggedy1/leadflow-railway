import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/EmailsExactLive.tsx"), "utf8");

describe("EmailsExactLive embedded detail", () => {
  it("uses the CsInbox2 central email treatment when Command Chat supplies a selected thread", () => {
    expect(source).toContain('type EmailsExactLiveProps = {');
    expect(source).toContain('initialThreadId?: string | null;');
    expect(source).toContain('onCloseDetail?: () => void;');
    expect(source).toContain('detailOnly?: boolean;');
    expect(source).toContain('export default function EmailsExactLive({ initialThreadId = null, onCloseDetail, detailOnly = false }: EmailsExactLiveProps = {})');
    expect(source).toContain('if (detailOnly) return <section className="email-detail-main-only"');
    expect(source).toContain('className="email-detail-main em2-main emails-csinbox2-detail-main"');
    expect(source).toContain('DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } })');
    expect(source).toContain('message.bodyText || message.snippet || "(no content)"');
  });
});
