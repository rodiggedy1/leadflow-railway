import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("CsInbox2 last-human-agent avatar contract", () => {
  const client = read("client/src/components/CsInbox2.tsx");
  const listRouter = read("server/routers.ts");
  const startup = read("server/_core/index.ts");
  const appendHelper = read("server/sms/appendCsOutboundMessage.ts");

  it("propagates the server field to both card branches through one shared renderer", () => {
    expect(listRouter).toContain("lastHumanAssistantSenderName: conversationSessions.lastHumanAssistantSenderName");
    expect(client).toContain("lastHumanAssistantSenderName: (row as any).lastHumanAssistantSenderName ?? null");
    expect(client).toContain("function LastHumanAgentAvatar");
    expect(client.match(/<LastHumanAgentAvatar /g)?.length).toBe(2);
    expect(client).toContain("trpc.opsChat.getAllAgentPhotoMap.useQuery");
    expect(client).toContain("aria-label=\"No identified human responder\"");
  });

  it("makes the historical write conditional so delayed backfill cannot overwrite live attribution", () => {
    expect(startup).toContain("AND lastHumanAssistantSummaryVersion < ${HUMAN_ASSISTANT_SUMMARY_VERSION}");
    expect(startup).toContain("superseded_by_live");
  });

  it("only stamps attribution when included callers provide the optional verified value", () => {
    expect(appendHelper).toContain("lastHumanAssistantSenderName?: string");
    expect(appendHelper).toContain("...(lastHumanAssistantSenderName ? {");
    expect(read("server/opsChatRouter.ts")).toContain("lastHumanAssistantSenderName: ctx.opsCaller.name");
    expect(read("server/aiConciergeRouter.ts")).toContain("lastHumanAssistantSenderName: ctx.agent.agentName");
    expect(read("server/commandCenterRouter.ts")).toContain("lastHumanAssistantSenderName: ctx.agent.agentName");
  });
});
