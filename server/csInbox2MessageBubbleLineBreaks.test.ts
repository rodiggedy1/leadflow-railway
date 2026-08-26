import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../client/src/components/CsInbox2.tsx", import.meta.url), "utf8");

describe("CsInbox2 message-bubble line breaks", () => {
  it("preserves stored SMS paragraph breaks while retaining linkified message rendering", () => {
    const bubbleStyles = source.slice(
      source.indexOf(".bubble2{"),
      source.indexOf(".msg.out .bubble2{"),
    );

    expect(bubbleStyles).toContain("white-space:pre-wrap");
    expect(bubbleStyles).toContain("overflow-wrap:anywhere");
    expect(source).toContain("{m.text && linkify(m.text)}");
  });
});
