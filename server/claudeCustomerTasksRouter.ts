import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { customerTaskSchema, taskActorSchema, type CustomerTask, type TaskActor } from "../shared/claudeCustomerTasks";
import { bookingsAgentProcedure, opsChatProcedure, router } from "./_core/trpc";
import { bookingActionRecordSchema, bookingActionRequestSchema, bookingActionViewSchema, bookingActionVisitSchema } from "../shared/claudeBookingActions";
import {
  createClaudeCustomerTasksStore, CustomerTaskStoreError, type ClaudeCustomerTasksStore,
} from "./instinct/claudeCustomerTasksStore";

const id = z.number().int().positive().refine(Number.isSafeInteger);
const idInput = z.object({ id }).strict();
export interface CustomerTasksRouterOptions {
  getStore(): Promise<ClaudeCustomerTasksStore>;
  broadcast(): void | Promise<void>;
  readCallRecordingUrl?: (providerCallId: string) => Promise<string | null>;
  readStaffCallRecordingUrl?: (providerCallId: string) => Promise<string | null>;
  /** Booking changes (Phase 1). Injectable for offline tests. */
  getDatabase?: () => Promise<import("./instinct/claudeBookingActions").BookingActionDb>;
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
  async function bookingActions<T>(operation: (actions: typeof import("./instinct/claudeBookingActions"), db: import("./instinct/claudeBookingActions").BookingActionDb) => Promise<T>, broadcast = true): Promise<T> {
    const actions = await import("./instinct/claudeBookingActions");
    try {
      const db = options.getDatabase ? await options.getDatabase() : await (async () => {
        const { getDb } = await import("./db");
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
        return database;
      })();
      const result = await operation(actions, db);
      if (broadcast) { try { await options.broadcast(); } catch { /* the write is already committed */ } }
      return result;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      if (error instanceof actions.BookingActionError || error instanceof CustomerTaskStoreError) throw new TRPCError({ code: error.code, message: error.message });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The booking change could not be saved or loaded.", cause: error });
    }
  }
  // Executing staff: the existing "bookings" page permission, the same as rescheduling or cancelling by hand.
  const bookingsActor = (agent: { agentId: number; agentName: string }): TaskActor => ({ id: String(agent.agentId), name: agent.agentName });
  const bookingRequestInput = z.object({ id, request: bookingActionRequestSchema }).strict();
  return router({
    bookingAction: opsChatProcedure.input(idInput).output(bookingActionViewSchema.nullable())
      .query(({ input }) => bookingActions((actions, db) => actions.getBookingActionView(db, input.id), false)),
    /** Shared by every task card: one request and one indexed query, however many cards are on screen. */
    bookingActionVersions: opsChatProcedure.output(z.record(z.string().regex(/^[1-9]\d*$/), z.string()))
      .query(() => bookingActions((actions, db) => actions.bookingActionVersions(db), false)),
    bookingActionVisits: opsChatProcedure.input(idInput).output(z.array(bookingActionVisitSchema))
      .query(({ input }) => bookingActions((actions, db) => actions.taskUpcomingVisits(db, input.id), false)),
    setupBookingAction: bookingsAgentProcedure.input(bookingRequestInput.extend({ itemId: z.string().min(1).nullable() }).strict())
      .output(bookingActionRecordSchema)
      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.setupBookingAction(db, input.id, { request: input.request, itemId: input.itemId }, bookingsActor(ctx.agent)))),
    editBookingAction: bookingsAgentProcedure.input(bookingRequestInput.extend({ revision: z.number().int().positive() }).strict())
      .output(bookingActionRecordSchema)
      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.editBookingAction(db, input.id, { revision: input.revision, request: input.request }, bookingsActor(ctx.agent)))),
    executeBookingAction: bookingsAgentProcedure.input(z.object({ id, revision: z.number().int().positive(), jobId: z.number().int().positive(),
      availabilityConfirmed: z.boolean() }).strict()).output(bookingActionRecordSchema)
      .mutation(({ input, ctx }) => bookingActions(async (actions, db) => {
        const actor = bookingsActor(ctx.agent);
        const { record } = await actions.executeBookingAction(db, input.id, { revision: input.revision, jobId: input.jobId, availabilityConfirmed: input.availabilityConfirmed }, actor);
        // Verification is a separate step: its failure never re-executes and can be retried on its own.
        if (record.status !== "executed") return record;
        try { return await actions.verifyBookingAction(db, input.id, actor); } catch { return record; }
      })),
    verifyBookingAction: bookingsAgentProcedure.input(idInput).output(bookingActionRecordSchema)
      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.verifyBookingAction(db, input.id, bookingsActor(ctx.agent)))),
    beginBookingConfirmation: bookingsAgentProcedure.input(z.object({ id, text: z.string().min(1).max(1600) }).strict())
      .output(z.object({ text: z.string(), sessionId: z.number().int().positive() }).strict())
      .mutation(({ input, ctx }) => bookingActions(async (actions, db) => {
        const begun = await actions.beginBookingConfirmation(db, input.id, input.text, bookingsActor(ctx.agent));
        return { text: begun.text, sessionId: begun.sessionId };
      }, false)), // reserving the send changes nothing others need to see now; finishing it broadcasts once
    finishBookingConfirmation: bookingsAgentProcedure.input(z.object({ id, outcome: z.enum(["sent", "failed", "skipped", "mark_sent", "mark_not_sent"]) }).strict())
      .output(bookingActionRecordSchema)
      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.finishBookingConfirmation(db, input.id, input.outcome, bookingsActor(ctx.agent)))),
    identity: opsChatProcedure.output(taskActorSchema).query(({ ctx }) => actor(ctx.opsCaller)),
    list: opsChatProcedure.input(z.object({}).strict()).output(z.array(customerTaskSchema))
      .query(() => run(store => store.list())),
    get: opsChatProcedure.input(idInput).output(customerTaskSchema.nullable())
      .query(({ input }) => run(store => store.get(input.id))),
    recording: opsChatProcedure.input(idInput).output(z.object({ url: z.string().url().nullable() }).strict())
      .query(({ input }) => run(async store => {
        const task = await store.get(input.id);
        if (!task || !("call" in task)) throw new TRPCError({ code: "NOT_FOUND", message: "Call task not found." });
        if (task.call.provider === "openphone") {
          const read = options.readStaffCallRecordingUrl ?? (await import("./instinct/claudeStaffCallRecording")).readStaffCallRecordingUrl;
          return { url: await read(task.call.providerCallId) };
        }
        const read = options.readCallRecordingUrl ?? (await import("./instinct/claudeCustomerCallRecording")).readCustomerCallRecordingUrl;
        return { url: await read(task.call.providerCallId) };
      })),
    claim: opsChatProcedure.input(idInput.extend({ expectedOwnerId: z.string().min(1).optional() })).output(customerTaskSchema)
      .mutation(({ input, ctx }) => write(store => input.expectedOwnerId === undefined
        ? store.claimTask(input.id, actor(ctx.opsCaller))
        : store.claimTask(input.id, actor(ctx.opsCaller), input.expectedOwnerId))),
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
