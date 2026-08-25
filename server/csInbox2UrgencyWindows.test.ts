import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../client/src/components/CsInbox2.tsx", import.meta.url), "utf8");

describe("CsInbox2 active Kanban urgency windows", () => {
  it("keeps expired unanswered cards out of all four active columns instead of falling back to Needs Response", () => {
    expect(source).toContain('if (urgencyWindow === "expired") return "Expired";');
    expect(source).toContain('const colNames = ["New", "Needs Response", "Waiting on Customer", "At Risk"] as const;');
    expect(source).not.toContain('if (needsReply)  return "Needs Response";');
  });

  it("derives the Needs Response and At Risk counts from the same explicit urgency windows", () => {
    expect(source).toContain('}) === "needs_response").length;');
    expect(source).toContain('qualifiesForAtRisk({');
  });

  it("uses the shared At Risk window for the Unanswered board filter", () => {
    const columnsBlock = source.slice(source.indexOf("const columns = useMemo"), source.indexOf("// ── DETAIL VIEW"));
    expect(columnsBlock).toContain('if (filter === "unanswered") {');
    expect(columnsBlock).toContain("return qualifiesForAtRisk({");
    expect(columnsBlock).not.toContain("THIRTY_MIN");
  });
});
