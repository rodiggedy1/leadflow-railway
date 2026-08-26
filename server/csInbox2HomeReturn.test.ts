import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/src/components/CsInbox2.tsx", import.meta.url), "utf8");

describe("CsInbox2 detail Home action", () => {
  it("uses the same return-to-list action as the bottom Back button", () => {
    expect(source).toContain('<button className="cs2-rbtn" onClick={() => setSelectedConvWithReset(null)} title="Back to inbox">⌂</button>');
    expect((source.match(/setSelectedConvWithReset\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
