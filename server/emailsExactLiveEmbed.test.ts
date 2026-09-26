import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/CommandChatExactLive.tsx"), "utf8");

describe("Command Chat embedded Email detail", () => {
  it("uses the separate copied Email implementation in a sidebar-free modal", () => {
    expect(source).toContain('import CsInbox2Email from "@/components/CsInbox2Email";');
    expect(source).toContain('<CsInbox2Email initialThreadId={threadId} onCloseDetail={onClose} detailOnly />');
    expect(source).not.toContain('import EmailsExactLive from "./EmailsExactLive";');
  });
});
