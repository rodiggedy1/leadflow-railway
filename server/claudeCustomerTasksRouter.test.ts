import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_CUSTOMER_TASK_ACTION as kind, type CustomerTask } from "../shared/claudeCustomerTasks";
import type { TrpcContext } from "./_core/context";
import { CustomerTaskStoreError, type ClaudeCustomerTasksStore } from "./instinct/claudeCustomerTasksStore";

vi.mock("./db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn().mockResolvedValue(null) }));
vi.mock("./_core/cleanerAuth", () => ({ getCleanerFromRequest: vi.fn().mockResolvedValue(null) }));
import { getAgentFromRequest } from "./_core/agentAuth";
import { getDb } from "./db";
import { claudeCustomerTasksRouter, createClaudeCustomerTasksRouter } from "./claudeCustomerTasksRouter";

const task: CustomerTask = { id: 77, version: 1, kind, sessionId: 7, customerName: "Jane", customerPhone: "+17035551234",
  sourceMessageId: "inbound-1", sourceText: "Move my visit", receivedAt: 100, receivingPhoneNumberId: "PN-cs", receivingPhoneNumber: "+12028885362",
  title: "Move the visit", items: [{ id: "item-1", title: "Move the visit", evidenceQuote: "Move my visit", completedBy: null, completedAt: null }],
  status: "unclaimed", owner: null, claimedAt: null, completedAt: null, completedBy: null, completionNote: null,
  reply: { text: "We'll take care of this and confirm once changed.", status: "prepared", providerMessageId: null },
  activity: [{ action: "created", actor: null, at: 100, note: null }] };
function context(owner = true): TrpcContext {
  return { user: owner ? { openId: "owner-verified", name: "Verified Owner" } as TrpcContext["user"] : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
function harness() {
  const store = { list: vi.fn().mockResolvedValue([task]), get: vi.fn().mockResolvedValue(task),
    claimTask: vi.fn().mockResolvedValue(task), completeItem: vi.fn().mockResolvedValue(task), completeTask: vi.fn().mockResolvedValue(task),
  } as unknown as ClaudeCustomerTasksStore;
  const getStore = vi.fn().mockResolvedValue(store), broadcast = vi.fn();
  const router = createClaudeCustomerTasksRouter({ getStore, broadcast });
  return { store, getStore, broadcast, router, caller: router.createCaller(context()) };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getAgentFromRequest).mockResolvedValue(null); vi.mocked(getDb).mockResolvedValue(null); });

describe("customer task authenticated router — offline", () => {
  it("list/get expose shared canonical tasks without inventing actor or writing task state", async () => {
    const h = harness(); expect(await h.caller.list({})).toEqual([task]); expect(await h.caller.get({ id: 77 })).toEqual(task);
    expect(h.store.get).toHaveBeenCalledWith(77); expect(h.broadcast).not.toHaveBeenCalled();
  });
  it("claim, checklist confirmation and final confirmation derive actor only from authenticated owner", async () => {
    const h = harness(), actor = { id: "owner-verified", name: "Verified Owner" };
    await h.caller.claim({ id: 77 }); expect(h.store.claimTask).toHaveBeenCalledWith(77, actor);
    await h.caller.completeItem({ id: 77, itemId: "item-1" }); expect(h.store.completeItem).toHaveBeenCalledWith(77, "item-1", actor);
    await h.caller.complete({ id: 77, note: "Handled manually" }); expect(h.store.completeTask).toHaveBeenCalledWith(77, "Handled manually", actor);
    expect(h.broadcast).toHaveBeenCalledTimes(3);
  });
  it("authenticated agent id is authoritative even when display names collide", async () => {
    const h = harness(); vi.mocked(getAgentFromRequest).mockResolvedValue({ agentId: 42, agentName: "Verified Owner", agentEmail: "staff@example.test", isAdmin: false } as any);
    await h.router.createCaller(context(false)).claim({ id: 77 });
    expect(h.store.claimTask).toHaveBeenCalledWith(77, { id: "42", name: "Verified Owner" });
  });
  it.each([{ agentId: 42, agentName: "Staff One", agentEmail: "staff-one@example.test" },
    { agentId: 83, agentName: "Staff Two", agentEmail: "staff-two@example.test" }])("regular agent $agentId has full identity/read/claim/checklist/completion access without an admin flag", async staff => {
    const h = harness(); vi.mocked(getAgentFromRequest).mockResolvedValue({ ...staff, isAdmin: false } as any);
    const caller = h.router.createCaller(context(false));
    const actor = { id: String(staff.agentId), name: staff.agentName };
    expect(await caller.identity()).toEqual(actor);
    expect(await caller.list({})).toEqual([task]); expect(await caller.get({ id: 77 })).toEqual(task);
    expect(await caller.claim({ id: 77 })).toEqual(task);
    expect(await caller.completeItem({ id: 77, itemId: "item-1" })).toEqual(task);
    expect(await caller.complete({ id: 77, note: "Handled by staff" })).toEqual(task);
    expect(h.store.claimTask).toHaveBeenCalledWith(77, actor);
    expect(h.store.completeItem).toHaveBeenCalledWith(77, "item-1", actor);
    expect(h.store.completeTask).toHaveBeenCalledWith(77, "Handled by staff", actor);
    expect(h.broadcast).toHaveBeenCalledTimes(3);
  });
  it.each(["identity", "list", "get", "claim", "completeItem", "complete"] as const)("anonymous %s access remains rejected before task-store access", async route => {
    const h = harness(), guest = h.router.createCaller(context(false));
    const input = route === "identity" ? undefined : route === "list" ? {} : route === "completeItem" ? { id: 77, itemId: "item-1" } : { id: 77 };
    await expect((guest[route] as any)(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(h.getStore).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled();
  });
  it("unauthenticated reads and writes never acquire store or execute task mutations", async () => {
    const h = harness(), guest = h.router.createCaller(context(false));
    await expect(guest.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(guest.claim({ id: 77 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(h.getStore).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled();
  });
  it.each(["claim", "complete", "completeItem"])("%s rejects any client-supplied actor identity", async route => {
    const h = harness(), input = { id: 77, actor: { id: "attacker", name: "Other" }, ...(route === "completeItem" ? { itemId: "item-1" } : {}) };
    await expect((h.caller as any)[route](input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.getStore).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled();
  });
  it.each([undefined, "", " \t\n "])("rejects a missing or blank completion note before any task write: %s", async note => {
    const h = harness();
    await expect((h.caller.complete as any)({ id: 77, ...(note === undefined ? {} : { note }) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.getStore).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled();
  });
  it("trims and persists the required completion note without inventing staff identity", async () => {
    const h = harness(); await h.caller.complete({ id: 77, note: "  Added the requested access instructions.  " });
    expect(h.store.completeTask).toHaveBeenCalledWith(77, "Added the requested access instructions.", { id: "owner-verified", name: "Verified Owner" });
  });
  it.each(["CONFLICT", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED"] as const)("maps %s task errors without broadcasting a failed write", async code => {
    const h = harness(); vi.mocked(h.store.claimTask).mockRejectedValue(new CustomerTaskStoreError(code, "Precise task error"));
    await expect(h.caller.claim({ id: 77 })).rejects.toMatchObject({ code, message: "Precise task error" });
    expect(h.broadcast).not.toHaveBeenCalled();
  });
  it("broadcast failure cannot make a committed task action look failed", async () => {
    const h = harness(); h.broadcast.mockImplementation(() => { throw new Error("listener unavailable"); });
    expect(await h.caller.complete({ id: 77, note: "Requested work completed." })).toEqual(task); expect(h.store.completeTask).toHaveBeenCalledTimes(1);
  });
  it("unknown store failure is safely mapped and never broadcasts", async () => {
    const h = harness(); vi.mocked(h.store.completeTask).mockRejectedValue(new Error("secret database detail"));
    await expect(h.caller.complete({ id: 77, note: "Requested work completed." })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Customer task could not be saved or loaded." });
    expect(h.broadcast).not.toHaveBeenCalled();
  });
  it("lazy application adapter reports unavailable DB on call only", async () => {
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    await expect(claudeCustomerTasksRouter.createCaller(context()).list({})).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  });
});
