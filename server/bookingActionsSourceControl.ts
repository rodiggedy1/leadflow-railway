/** Test-only: remove exactly the approved Phase 1 booking-change hunks (2026-11-26) from protected task files.
 * Behavioral tests always execute the actual source; any other edit to these files still fails its guard. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Approved 320px task-card redesign (2026-11-27): the exact redesigned file is pinned by its hash and read as the
// released booking-change version (ac36ea3). Any further edit changes the hash, so every guard fails again.
const RELEASED = "ac36ea3dad109368be9d4ac5166c7d461ae60db0";
const approvedRedesign: Record<string, string> = {
  "client/src/components/ClaudeCustomerTasks.tsx": "67c688d5f399b6cb20140e9cf219e856b02fc0ab97f56ee9b8ea5914fc497cb2",
};
const approved: Record<string, Array<[string, string]>> = {
 "client/src/components/ClaudeCustomerTasks.tsx": [
  [
   "import \"./claude-customer-tasks.css\";\nimport { ClaudeBookingChangePanel } from \"./ClaudeBookingChangePanel\";\n",
   "import \"./claude-customer-tasks.css\";\n"
  ],
  [
   "    {!(\"call\" in task) && !(\"email\" in task) && <ClaudeBookingChangePanel task={task} />}\n",
   ""
  ]
 ],
 "server/claudeCustomerTasksRouter.ts": [
  [
   "import { bookingsAgentProcedure, opsChatProcedure, router } from \"./_core/trpc\";\nimport { bookingActionRecordSchema, bookingActionRequestSchema, bookingActionViewSchema, bookingActionVisitSchema } from \"../shared/claudeBookingActions\";\n",
   "import { opsChatProcedure, router } from \"./_core/trpc\";\n"
  ],
  [
   "  /** Booking changes (Phase 1). Injectable for offline tests. */\n  getDatabase?: () => Promise<import(\"./instinct/claudeBookingActions\").BookingActionDb>;\n",
   ""
  ],
  [
   "  async function bookingActions<T>(operation: (actions: typeof import(\"./instinct/claudeBookingActions\"), db: import(\"./instinct/claudeBookingActions\").BookingActionDb) => Promise<T>, broadcast = true): Promise<T> {\n    const actions = await import(\"./instinct/claudeBookingActions\");\n    try {\n      const db = options.getDatabase ? await options.getDatabase() : await (async () => {\n        const { getDb } = await import(\"./db\");\n        const database = await getDb();\n        if (!database) throw new TRPCError({ code: \"INTERNAL_SERVER_ERROR\", message: \"Database unavailable.\" });\n        return database;\n      })();\n      const result = await operation(actions, db);\n      if (broadcast) { try { await options.broadcast(); } catch { /* the write is already committed */ } }\n      return result;\n    } catch (error) {\n      if (error instanceof TRPCError) throw error;\n      if (error instanceof actions.BookingActionError || error instanceof CustomerTaskStoreError) throw new TRPCError({ code: error.code, message: error.message });\n      throw new TRPCError({ code: \"INTERNAL_SERVER_ERROR\", message: \"The booking change could not be saved or loaded.\", cause: error });\n    }\n  }\n  // Executing staff: the existing \"bookings\" page permission, the same as rescheduling or cancelling by hand.\n  const bookingsActor = (agent: { agentId: number; agentName: string }): TaskActor => ({ id: String(agent.agentId), name: agent.agentName });\n  const bookingRequestInput = z.object({ id, request: bookingActionRequestSchema }).strict();\n  return router({\n    bookingAction: opsChatProcedure.input(idInput).output(bookingActionViewSchema.nullable())\n      .query(({ input }) => bookingActions((actions, db) => actions.getBookingActionView(db, input.id), false)),\n    /** Shared by every task card: one request and one indexed query, however many cards are on screen. */\n    bookingActionVersions: opsChatProcedure.output(z.record(z.string().regex(/^[1-9]\\d*$/), z.string()))\n      .query(() => bookingActions((actions, db) => actions.bookingActionVersions(db), false)),\n    bookingActionVisits: opsChatProcedure.input(idInput).output(z.array(bookingActionVisitSchema))\n      .query(({ input }) => bookingActions((actions, db) => actions.taskUpcomingVisits(db, input.id), false)),\n    setupBookingAction: bookingsAgentProcedure.input(bookingRequestInput.extend({ itemId: z.string().min(1).nullable() }).strict())\n      .output(bookingActionRecordSchema)\n      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.setupBookingAction(db, input.id, { request: input.request, itemId: input.itemId }, bookingsActor(ctx.agent)))),\n    editBookingAction: bookingsAgentProcedure.input(bookingRequestInput.extend({ revision: z.number().int().positive() }).strict())\n      .output(bookingActionRecordSchema)\n      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.editBookingAction(db, input.id, { revision: input.revision, request: input.request }, bookingsActor(ctx.agent)))),\n    /** Dismiss a booking change that has not been executed; the task stays open for manual handling. */\n    dismissBookingAction: bookingsAgentProcedure.input(z.object({ id, revision: z.number().int().positive() }).strict())\n      .output(z.object({ dismissed: z.literal(true) }).strict())\n      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.dismissBookingAction(db, input.id, { revision: input.revision }, bookingsActor(ctx.agent)))),\n    executeBookingAction: bookingsAgentProcedure.input(z.object({ id, revision: z.number().int().positive(), jobId: z.number().int().positive(),\n      availabilityConfirmed: z.boolean() }).strict()).output(bookingActionRecordSchema)\n      .mutation(({ input, ctx }) => bookingActions(async (actions, db) => {\n        const actor = bookingsActor(ctx.agent);\n        const { record } = await actions.executeBookingAction(db, input.id, { revision: input.revision, jobId: input.jobId, availabilityConfirmed: input.availabilityConfirmed }, actor);\n        // Verification is a separate step: its failure never re-executes and can be retried on its own.\n        if (record.status !== \"executed\") return record;\n        try { return await actions.verifyBookingAction(db, input.id, actor); } catch { return record; }\n      })),\n    verifyBookingAction: bookingsAgentProcedure.input(idInput).output(bookingActionRecordSchema)\n      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.verifyBookingAction(db, input.id, bookingsActor(ctx.agent)))),\n    beginBookingConfirmation: bookingsAgentProcedure.input(z.object({ id, text: z.string().min(1).max(1600) }).strict())\n      .output(z.object({ text: z.string(), sessionId: z.number().int().positive() }).strict())\n      .mutation(({ input, ctx }) => bookingActions(async (actions, db) => {\n        const begun = await actions.beginBookingConfirmation(db, input.id, input.text, bookingsActor(ctx.agent));\n        return { text: begun.text, sessionId: begun.sessionId };\n      })), // other open screens must see \"Sending\" (and later \"may have been sent\") instead of a Send button\n    finishBookingConfirmation: bookingsAgentProcedure.input(z.object({ id, outcome: z.enum([\"sent\", \"failed\", \"skipped\", \"mark_sent\", \"mark_not_sent\"]) }).strict())\n      .output(bookingActionRecordSchema)\n      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.finishBookingConfirmation(db, input.id, input.outcome, bookingsActor(ctx.agent)))),\n",
   "  return router({\n"
  ]
 ],
 "server/instinct/claudeCustomerTasksStore.ts": [
  [
   "import { attachProposedBookingAction } from \"./claudeBookingActions\";\n",
   ""
  ],
  [
   "      // Optional booking-change proposal in its own private record; an unusable one is ignored (task stays manual).\n      if (id !== null && plan.task) await attachProposedBookingAction(tx, { id, items: plan.task.items.map((item, index) => ({ id: `item-${index + 1}`,\n        evidenceQuote: item.evidenceQuote })) }, plan.task.bookingAction, claim.binding.inboundText);\n",
   ""
  ]
 ]
};
export function withoutApprovedBookingActions(path: string, source: string): string {
  if (approvedRedesign[path] && createHash("sha256").update(source).digest("hex") === approvedRedesign[path])
    source = execFileSync("git", ["show", `${RELEASED}:${path}`], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", maxBuffer: 5_000_000 });
  for (const [current, original] of approved[path] ?? []) {
    const count = source.split(current).length - 1;
    if (count !== 0 && count !== 1) throw new Error(`Unexpected booking-action preservation hunk: ${path}`);
    if (count === 1) source = source.replace(current, original);
  }
  return source;
}
