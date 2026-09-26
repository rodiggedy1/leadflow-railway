import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/EmailsExactLive.tsx"), "utf8");

describe("EmailsExactLive embedded detail", () => {
  it("uses its existing detail workspace when Command Chat supplies a selected thread", () => {
    expect(source).toContain('type EmailsExactLiveProps = {');
    expect(source).toContain('initialThreadId?: string | null;');
    expect(source).toContain('onCloseDetail?: () => void;');
    expect(source).toContain('detailOnly?: boolean;');
    expect(source).toContain('export default function EmailsExactLive({ initialThreadId = null, onCloseDetail, detailOnly = false }: EmailsExactLiveProps = {})');
    expect(source).toContain('const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId);');
    expect(source).toContain('if (onCloseDetail) onCloseDetail();');
    expect(source).toContain('if (detailOnly) return <section className="email-detail-main-only"');
    expect(source).toContain('<DetailMain detail={detail} detailUnavailable={detailUnavailable}');
    expect(source).toContain('import { getEmailBodyContent } from "@/lib/emailBodyContent";');
    expect(source).toContain('const body = getEmailBodyContent(message);');
    expect(source).toContain('dangerouslySetInnerHTML={{ __html: body.html }}');
  });
});
