import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "client/src/components/CsInbox2.tsx"),
  "utf8",
);

describe("CsInbox2 cross-service inbound refresh", () => {
  it("polls the card list every five seconds as a fallback when legacy inbound writes cannot emit Railway SSE", () => {
    expect(source).toContain("trpc.leads.listCsInbox.useQuery");
    expect(source).toContain("refetchInterval: 5_000");
    expect(source).not.toContain("refetchInterval: 60_000");
  });

  it("keeps the existing Railway SSE invalidation path for Railway-owned live updates", () => {
    expect(source).toContain("onLeadUpdate: () => {");
    expect(source).toContain("utils.leads.listCsInbox.invalidate()");
  });
});
