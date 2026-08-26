import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(new URL("./opsChatRouter.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../client/src/components/CsInbox2.tsx", import.meta.url), "utf8");

describe("CsInbox2 shared timeline notes", () => {
  const procedureStart = routerSource.indexOf("addCsInbox2Note: opsChatProcedure");
  const procedureEnd = routerSource.indexOf("getCsResolvedCount", procedureStart);
  const procedure = routerSource.slice(procedureStart, procedureEnd);

  it("persists an authenticated, attributed note without changing inbox summary fields", () => {
    expect(procedureStart).toBeGreaterThan(-1);
    expect(procedure).toContain('role: "note"');
    expect(procedure).toContain('senderName: ctx.user?.name ?? "Agent"');
    expect(procedure).toContain("updatedAt: session.updatedAt");
    expect(procedure).not.toContain("computeSessionSummary");
    expect(procedure).not.toContain("lastMessageRole");
    expect(procedure).not.toContain("lastMessageTs");
  });

  it("renders note mode in the shared timeline and never routes a note through the SMS sender", () => {
    const mutationStart = clientSource.indexOf("const addCsInbox2Note =");
    const mutationEnd = clientSource.indexOf("// ── resolveSession", mutationStart);
    const mutation = clientSource.slice(mutationStart, mutationEnd);

    expect(clientSource).toContain('m.sender === "note"');
    expect(clientSource).toContain("Internal note");
    expect(clientSource).toContain("trpc.opsChat.addCsInbox2Note.useMutation");
    expect(clientSource).toContain("const [composeMode, setComposeMode] = useState<\"reply\" | \"note\">(\"reply\")");
    expect(clientSource).toContain("disabled={addCsInbox2Note.isPending || !selectedConv || !compose.trim()}");
    expect(mutation).toContain("utils.leads.getCsConversation.setData");
    expect(mutation).not.toContain("utils.leads.listCsInbox.setData");
    expect(mutation).not.toContain("sendMessage.mutate");
  });
});
