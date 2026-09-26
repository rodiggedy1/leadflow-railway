import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const source = readFileSync(resolve(process.cwd(), "client/src/pages/EmailsExactLive.tsx"), "utf8");
describe("EmailsExactLive embedded detail", () => {
  it("keeps the page sidebars but allows the existing detail-only mode to render just the shared thread detail", () => {
    expect(source).toContain('type EmailsExactLiveProps = {');
    expect(source).toContain('detailOnly?: boolean;');
    expect(source).toContain('if (detailOnly) return <section className="email-detail-main-only" aria-label="Live email detail page">{directDetail}</section>;');
    expect(source).toContain('<DetailSidebar groups={groups}');
    expect(source).toContain('<DetailContext threadId={selectedId}');
  });
});
