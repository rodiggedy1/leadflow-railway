import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../client/src/components/CsInbox2.tsx", import.meta.url), "utf8");

describe("CsInbox2 Email sidebar badge", () => {
  it("loads the existing email-thread query before the Email tab is selected", () => {
    const emailQueryBlock = source.slice(
      source.indexOf("const emailInbox = trpc.opsChat.listEmailInboxThreads.useQuery"),
      source.indexOf("// Email thread detail query"),
    );

    expect(emailQueryBlock).not.toContain("enabled:");
    expect(source).toContain("{(emailInbox.data?.threads.length ?? 0) > 0 && <span className=\"cs2-badge\">{emailInbox.data?.threads.length}</span>}");
  });
});
