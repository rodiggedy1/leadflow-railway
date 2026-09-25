import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/EmailsExactLive.tsx"), "utf8");

describe("EmailsExactLive embedded detail", () => {
  it("uses its existing detail workspace when Command Chat supplies a selected thread", () => {
    expect(source).toContain('type EmailsExactLiveProps = {');
    expect(source).toContain('initialThreadId?: string | null;');
    expect(source).toContain('onCloseDetail?: () => void;');
    expect(source).toContain('export default function EmailsExactLive({ initialThreadId = null, onCloseDetail }: EmailsExactLiveProps = {})');
    expect(source).toContain('const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId);');
    expect(source).toContain('if (onCloseDetail) onCloseDetail();');
    expect(source).toContain('<EmailDetailWorkspace groups={groups} selectedId={selectedThreadId}');
    expect(source).toContain('DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } })');
  });
});
