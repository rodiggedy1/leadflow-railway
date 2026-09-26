import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/components/CsInbox2EmailWorkspace.tsx"), "utf8");

describe("literal CsInbox2 Email copy embed", () => {
  it("supports a detailOnly presentation without a separate Email query or renderer", () => {
    expect(source).toContain('type CsInbox2EmailWorkspaceProps = {');
    expect(source).toContain('initialThreadId?: string | null;');
    expect(source).toContain('onCloseDetail?: () => void;');
    expect(source).toContain('detailOnly?: boolean;');
    expect(source).toContain('export default function CsInbox2EmailWorkspace({');
    expect(source).toContain('className={detailOnly ? "em2-app em2-copy-detail-only" : "em2-app"}');
    expect(source).toContain('DOMPurify.sanitize(msg.bodyHtml, { USE_PROFILES: { html: true } })');
    expect(source).toContain('msg.bodyText || msg.snippet || "(no content)"');
    expect(source).not.toContain("trpc.gmail.getStoredThread.useQuery");
  });
});
