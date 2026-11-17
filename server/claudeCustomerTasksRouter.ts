import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { customerTaskSchema, taskActorSchema, type CustomerTask, type TaskActor } from "../shared/claudeCustomerTasks";
import { opsChatProcedure, router } from "./_core/trpc";
import {
  createClaudeCustomerTasksStore, CustomerTaskStoreError, type ClaudeCustomerTasksStore,
} from "./instinct/claudeCustomerTasksStore";

const id = z.number().int().positive().refine(Number.isSafeInteger);
const idInput = z.object({ id }).strict();
export interface CustomerTasksRouterOptions {
  getStore(): Promise<ClaudeCustomerTasksStore>;
  broadcast(): void | Promise<void>;
  readCallRecordingUrl?: (providerCallId: string) => Promise<string | null>;
}
/** Injectable offline seam. Staff identity comes exclusively from opsChatProcedure. */
export function createClaudeCustomerTasksRouter(options: CustomerTasksRouterOptions) {
  async function run<T>(operation: (store: ClaudeCustomerTasksStore) => Promise<T>): Promise<T> {
    try { return await operation(await options.getStore()); }
    catch (error) {
      if (error instanceof TRPCError) throw error;
      if (error instanceof CustomerTaskStoreError) throw new TRPCError({ code: error.code, message: error.message });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Customer task could not be saved or loaded.", cause: error });
    }
  }
  const actor = (caller: { id: string; name: string }): TaskActor => ({ id: caller.id, name: caller.name });
  async function write(operation: (store: ClaudeCustomerTasksStore) => Promise<CustomerTask>): Promise<CustomerTask> {
    const result = await run(operation);
    // An SSE refresh is not a staff notification or send. It must not turn a committed
    // human task action into an apparent failed mutation if a listener is unavailable.
    try { await options.broadcast(); } catch { /* the task write is already committed */ }
    return result;
  }
  return router({
    identity: opsChatProcedure.output(taskActorSchema).query(({ ctx }) => actor(ctx.opsCaller)),
    list: opsChatProcedure.input(z.object({}).strict()).output(z.array(customerTaskSchema))
      .query(() => run(store => store.list())),
    get: opsChatProcedure.input(idInput).output(customerTaskSchema.nullable())
      .query(({ input }) => run(store => store.get(input.id))),
    recording: opsChatProcedure.input(idInput).output(z.object({ url: z.string().url().nullable() }).strict())
      .query(({ input }) => run(async store => {
        const task = await store.get(input.id);
        if (!task || !("call" in task)) throw new TRPCError({ code: "NOT_FOUND", message: "Call task not found." });
        const read = options.readCallRecordingUrl ?? (await import("./instinct/claudeCustomerCallRecording")).readCustomerCallRecordingUrl;
        return { url: await read(task.call.providerCallId) };
      })),
    claim: opsChatProcedure.input(idInput).output(customerTaskSchema)
      .mutation(({ input, ctx }) => write(store => store.claimTask(input.id, actor(ctx.opsCaller)))),
    completeItem: opsChatProcedure.input(z.object({ id, itemId: z.string().min(1) }).strict()).output(customerTaskSchema)
      .mutation(({ input, ctx }) => write(store => store.completeItem(input.id, input.itemId, actor(ctx.opsCaller)))),
    complete: opsChatProcedure.input(z.object({ id, note: z.string().trim().min(1, "Add a completion note before marking this task done.") }).strict()).output(customerTaskSchema)
      .mutation(({ input, ctx }) => write(store => store.completeTask(input.id, input.note, actor(ctx.opsCaller)))),
  });
}
/** Merely importing this router does not obtain a DB connection or activate traffic. */
export const claudeCustomerTasksRouter = createClaudeCustomerTasksRouter({
  async getStore() {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
    return createClaudeCustomerTasksStore(db);
  },
  async broadcast() {
    const { broadcastOpsUpdate } = await import("./sseBroadcast");
    broadcastOpsUpdate("task_update", { channel: "command" });
  },
});
