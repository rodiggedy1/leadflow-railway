import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routerSource = readFileSync(resolve(process.cwd(), "server/opsChatRouter.ts"), "utf8");
const listEmailInboxThreadsBlock = routerSource.slice(
  routerSource.indexOf("listEmailInboxThreads: opsChatProcedure"),
  routerSource.indexOf("getUnresolvedMadisonCount: opsChatProcedure"),
);

describe("opsChat.listEmailInboxThreads resolution filter", () => {
  it("includes only unresolved thread metadata even when a Madison email draft exists", () => {
    expect(listEmailInboxThreadsBlock).toContain("isNull(gmailThreadMeta.aiResolvedAt)");
    expect(listEmailInboxThreadsBlock).toContain("FROM madison_email_drafts med");
  });

  it("keeps the Madison-draft existence requirement instead of admitting draftless threads", () => {
    expect(listEmailInboxThreadsBlock).toMatch(
      /and\(\s*isNull\(gmailThreadMeta\.aiResolvedAt\),\s*sql`EXISTS \(/s,
    );
  });
});
