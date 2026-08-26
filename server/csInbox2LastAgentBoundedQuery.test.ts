import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("CsInbox2 bounded last-agent card lookup", () => {
  const router = read("server/routers.ts");
  const client = read("client/src/components/CsInbox2.tsx");

  it("uses one bounded batch of final active card IDs rather than per-card history requests", () => {
    expect(router).toContain("getCsInboxLastAgents: opsChatProcedure");
    expect(router).toContain("sessionIds: z.array(z.number().int().positive()).max(800)");
    expect(router).toContain("[sessions, activeAgents] = await Promise.all");
    expect(router).toContain("where(inArray(conversationSessions.id, sessionIds))");
    expect(router).not.toContain("for (const sessionId of input.sessionIds)");
    expect(client).toContain("columns.flatMap(column => column.convs.map(conv => conv.id))");
    expect(client).toContain("trpc.leads.getCsInboxLastAgents.useQuery");
  });

  it("returns only nullable names and keeps history out of the browser response", () => {
    expect(router).toContain("select({ id: conversationSessions.id, messageHistory: conversationSessions.messageHistory })");
    expect(router).toContain("findLastExactActiveAgentName(session.messageHistory, activeAgentNames)");
    expect(router).not.toContain("return { messageHistory");
    expect(client).toContain("function LastAgentAvatar");
    expect(client.match(/<LastAgentAvatar /g)?.length).toBe(2);
  });
});
