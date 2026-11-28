/** Test-only: remove exactly the approved Phase 1 booking-change hunks (2026-11-26) from protected task files.
 * Behavioral tests always execute the actual source; any other edit to these files still fails its guard. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Approved 320px task-card redesign (2026-11-27): the exact redesigned file is pinned by its hash and read as the
// released booking-change version (ac36ea3). Any further edit changes the hash, so every guard fails again.
const RELEASED = "ac36ea3dad109368be9d4ac5166c7d461ae60db0";
const approvedRedesign: Record<string, string> = {
  "client/src/components/ClaudeCustomerTasks.tsx": "fc10798716aac72ce8713537fa3a88bb17c55fef341bd2ca31bf9232031ba958",
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
   "  async function bookingActions<T>(operation: (actions: typeof import(\"./instinct/claudeBookingActions\"), db: import(\"./instinct/claudeBookingActions\").BookingActionDb) => Promise<T>, broadcast = true): Promise<T> {\n    const actions = await import(\"./instinct/claudeBookingActions\");\n    try {\n      const db = options.getDatabase ? await options.getDatabase() : await (async () => {\n        const { getDb } = await import(\"./db\");\n        const database = await getDb();\n        if (!database) throw new TRPCError({ code: \"INTERNAL_SERVER_ERROR\", message: \"Database unavailable.\" });\n        return database;\n      })();\n      const result = await operation(actions, db);\n      if (broadcast) { try { await options.broadcast(); } catch { /* the write is already committed */ } }\n      return result;\n    } catch (error) {\n      if (error instanceof TRPCError) throw error;\n      if (error instanceof actions.BookingActionError || error instanceof CustomerTaskStoreError) throw new TRPCError({ code: error.code, message: error.message });\n      throw new TRPCError({ code: \"INTERNAL_SERVER_ERROR\", message: \"The booking change could not be saved or loaded.\", cause: error });\n    }\n  }\n  // Executing staff: the existing \"bookings\" page permission, the same as rescheduling or cancelling by hand.\n  const bookingsActor = (agent: { agentId: number; agentName: string }): TaskActor => ({ id: String(agent.agentId), name: agent.agentName });\n  const bookingRequestInput = z.object({ id, request: bookingActionRequestSchema }).strict();\n  return router({\n    bookingAction: opsChatProcedure.input(idInput).output(bookingActionViewSchema.nullable())\n      .query(({ input }) => bookingActions((actions, db) => actions.getBookingActionView(db, input.id), false)),\n    /** Dismissed booking changes of one task, for its Activity history (loaded only while the card is open). */\n    dismissedBookingActions: opsChatProcedure.input(idInput).output(z.array(bookingActionRecordSchema))\n      .query(({ input }) => bookingActions((actions, db) => actions.dismissedBookingActions(db, input.id), false)),\n    /** Shared by every task card: one request and one indexed query, however many cards are on screen. */\n    bookingActionVersions: opsChatProcedure.output(z.record(z.string().regex(/^[1-9]\\d*$/), z.string()))\n      .query(() => bookingActions((actions, db) => actions.bookingActionVersions(db), false)),\n    bookingActionVisits: opsChatProcedure.input(idInput).output(z.array(bookingActionVisitSchema))\n      .query(({ input }) => bookingActions((actions, db) => actions.taskUpcomingVisits(db, input.id), false)),\n    setupBookingAction: bookingsAgentProcedure.input(bookingRequestInput.extend({ itemId: z.string().min(1).nullable() }).strict())\n      .output(bookingActionRecordSchema)\n      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.setupBookingAction(db, input.id, { request: input.request, itemId: input.itemId }, bookingsActor(ctx.agent)))),\n    editBookingAction: bookingsAgentProcedure.input(bookingRequestInput.extend({ revision: z.number().int().positive() }).strict())\n      .output(bookingActionRecordSchema)\n      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.editBookingAction(db, input.id, { revision: input.revision, request: input.request }, bookingsActor(ctx.agent)))),\n    /** Dismiss a booking change that has not been executed; the task stays open for manual handling. */\n    dismissBookingAction: bookingsAgentProcedure.input(z.object({ id, revision: z.number().int().positive() }).strict())\n      .output(z.object({ dismissed: z.literal(true) }).strict())\n      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.dismissBookingAction(db, input.id, { revision: input.revision }, bookingsActor(ctx.agent)))),\n    executeBookingAction: bookingsAgentProcedure.input(z.object({ id, revision: z.number().int().positive(), jobId: z.number().int().positive(),\n      availabilityConfirmed: z.boolean() }).strict()).output(bookingActionRecordSchema)\n      .mutation(({ input, ctx }) => bookingActions(async (actions, db) => {\n        const actor = bookingsActor(ctx.agent);\n        const { record } = await actions.executeBookingAction(db, input.id, { revision: input.revision, jobId: input.jobId, availabilityConfirmed: input.availabilityConfirmed }, actor);\n        // Verification is a separate step: its failure never re-executes and can be retried on its own.\n        if (record.status !== \"executed\") return record;\n        try { return await actions.verifyBookingAction(db, input.id, actor); } catch { return record; }\n      })),\n    verifyBookingAction: bookingsAgentProcedure.input(idInput).output(bookingActionRecordSchema)\n      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.verifyBookingAction(db, input.id, bookingsActor(ctx.agent)))),\n    beginBookingConfirmation: bookingsAgentProcedure.input(z.object({ id, text: z.string().min(1).max(1600) }).strict())\n      .output(z.object({ text: z.string(), sessionId: z.number().int().positive() }).strict())\n      .mutation(({ input, ctx }) => bookingActions(async (actions, db) => {\n        const begun = await actions.beginBookingConfirmation(db, input.id, input.text, bookingsActor(ctx.agent));\n        return { text: begun.text, sessionId: begun.sessionId };\n      })), // other open screens must see \"Sending\" (and later \"may have been sent\") instead of a Send button\n    finishBookingConfirmation: bookingsAgentProcedure.input(z.object({ id, outcome: z.enum([\"sent\", \"failed\", \"skipped\", \"mark_sent\", \"mark_not_sent\"]) }).strict())\n      .output(bookingActionRecordSchema)\n      .mutation(({ input, ctx }) => bookingActions((actions, db) => actions.finishBookingConfirmation(db, input.id, input.outcome, bookingsActor(ctx.agent)))),\n",
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
// Approved Launch27 manual-action notice (2026-11-28): exact hunks, removed first so every earlier guard still applies.
const approvedL27Manual: Record<string, Array<[string, string]>> = {
  "client/src/components/ClaudeCustomerTasks.tsx": [
    ["import { ClaudeBookingChangePanel, ManualBookingNotice, bookingChangeHistory, bookingChangeStatus, manualBookingStatus, useBookingChange, useManualBookingChange } from \"./ClaudeBookingChangePanel\";\n",
      "import { ClaudeBookingChangePanel, bookingChangeHistory, bookingChangeStatus, useBookingChange } from \"./ClaudeBookingChangePanel\";\n"],
    ["  // Launch27 or unclear booking: always \"Manual action required\", never an automated or verified status.\n  const manual = useManualBookingChange(task, booking.data);\n  const status = manual ? manualBookingStatus(manual) : bookingChangeStatus(booking.data);\n",
      "  const status = bookingChangeStatus(booking.data);\n"],
    ["      {manual && <ManualBookingNotice task={task} manual={manual} />}\n      {!call && !(\"email\" in task) && <ClaudeBookingChangePanel task={task} manual={manual} />}\n",
      "      {!call && !(\"email\" in task) && <ClaudeBookingChangePanel task={task} />}\n"],
  ],
  "server/claudeCustomerTasksRouter.ts": [
    ["    /** Native LeadFlow or Launch27: a Launch27 (or unclear) booking change is always manual. Read-only. One shared request\n     * for every task card (open booking-change tasks only), looked up one step at a time, never one request per card. */\n    bookingSources: opsChatProcedure.output(z.record(z.string().regex(/^[1-9]\\d*$/), z.object({ source: z.enum([\"native\", \"launch27\", \"both\", \"unknown\"]),\n      launch27BookingIds: z.array(z.number().int().positive()) }).strict()))\n      .query(() => bookingActions((actions, db) => actions.taskBookingSources(db), false)),\n", ""],
  ],
};
// Approved Mark done confirmation popup (2026-11-28): exact hunks, removed first so every earlier guard still applies.
const approvedCompletionConfirm: Record<string, Array<[string, string]>> = {
 "client/src/components/ClaudeCustomerTasks.tsx": [
  [
   "export function TaskCompletionConfirm({ task, note, pending, error, allowed, onNote, onCancel, onConfirm, initiallyConfirmed = false }: {\n  task: CustomerTask; note: string; pending: boolean; error: string; allowed: boolean;\n  onNote: (note: string) => void; onCancel: () => void; onConfirm: () => void; initiallyConfirmed?: boolean;\n}) {\n  // The Mark done popup body, the same for SMS, email and call tasks (owner, 2026-11-28). Closing needs the confirmation\n  // box ticked; the note is optional. Closing still performs no booking change, customer message or conversation closure.\n  // The box lives here, so it starts unticked every time the popup opens (the popup's content is removed when it closes).\n  const [confirmed, onConfirmed] = useState(initiallyConfirmed);\n  return <div className=\"cct-confirm-body\">\n    <p className=\"cct-confirm-task\">{task.title}<small>{task.customerName || (\"email\" in task ? task.email.fromEmail : task.customerPhone)}</small></p>\n    <p>Closing this task means the entire issue has been resolved, all necessary actions have been completed, and the customer has been responded to where applicable.</p>\n    <div className=\"cct-confirm-warning\" role=\"note\"><strong>Closing a task while an issue remains unresolved is strictly prohibited.</strong>\n      <span>If further action is required, leave the task open until the issue is fully resolved.</span></div>\n    <label className=\"cct-confirm-check\"><input type=\"checkbox\" checked={confirmed} disabled={pending} onChange={(event) => onConfirmed(event.target.checked)} />\n      <span>{TASK_COMPLETION_CONFIRMATION}</span></label>\n    <label>Completion note <span>(optional)</span><textarea value={note} onChange={(event) => onNote(event.target.value)} placeholder=\"Add any relevant details about how this issue was resolved...\" rows={3} maxLength={2000} /></label>\n    {!allowed && <p className=\"cct-feedback\" role=\"alert\">Only the current task owner can mark this done.</p>}\n    {error && <p className=\"cct-feedback\" role=\"alert\">{error}</p>}\n    <footer><button type=\"button\" disabled={pending} onClick={onCancel}>Keep task open</button><button type=\"button\" className=\"cct-primary\"\n      disabled={pending || !allowed || !confirmed} onClick={() => { if (confirmed) onConfirm(); }}>{pending ? <Loader2 /> : <Check />}{pending ? \"Saving…\" : \"Confirm & close task\"}</button></footer>\n  </div>;\n}\n\nexport const TASK_COMPLETION_CONFIRMATION = \"I confirm that this issue is fully resolved, all required actions are complete, and the customer has been responded to where applicable.\";\n\n",
   "export function TaskCompletionConfirm({ task, note, pending, error, allowed, onNote, onCancel, onConfirm }: {\n  task: CustomerTask; note: string; pending: boolean; error: string; allowed: boolean;\n  onNote: (note: string) => void; onCancel: () => void; onConfirm: () => void;\n}) {\n  return <div className=\"cct-confirm-body\">\n    <p className=\"cct-confirm-task\">{task.title}<small>{task.customerName || (\"email\" in task ? task.email.fromEmail : task.customerPhone)}</small></p>\n    <p>I completed all the actions in this task.</p>\n    <p>This records your human confirmation of the entire request and checklist, not system verification.</p>\n    <p className=\"cct-confirm-boundary\">{\"call\" in task ? \"No booking change, customer call, customer text, or conversation closure is performed.\" : \"email\" in task ? \"No booking change, customer email, or conversation closure is performed.\" : \"No booking change, customer text, or conversation closure is performed.\"}</p>\n    <label>Completion note <span>(required)</span><textarea value={note} onChange={(event) => onNote(event.target.value)} placeholder=\"What did you complete?\" rows={2} required /></label>\n    {!allowed && <p className=\"cct-feedback\" role=\"alert\">Only the current task owner can mark this done.</p>}\n    {error && <p className=\"cct-feedback\" role=\"alert\">{error}</p>}\n    <footer><button type=\"button\" disabled={pending} onClick={onCancel}>Cancel</button><button type=\"button\" className=\"cct-primary\"\n      disabled={pending || !allowed || !note.trim()} onClick={onConfirm}>{pending ? <Loader2 /> : <Check />}{pending ? \"Saving…\" : \"Confirm done\"}</button></footer>\n  </div>;\n}\n\n"
  ],
  [
   "      <DialogContent className=\"cct-confirm-dialog\"><DialogTitle><AlertTriangle aria-hidden=\"true\" className=\"cct-confirm-icon\" />Confirm task completion</DialogTitle>\n        <DialogDescription className=\"sr-only\">Staff confirmation only</DialogDescription>\n        <TaskCompletionConfirm task={task} note={note} pending={busy} error={error} allowed={canComplete}\n          onNote={setNote} onCancel={() => setConfirmOpen(false)} onConfirm={() => {\n            if (!canComplete || busy) return; // the popup only calls this once its confirmation box is ticked\n",
   "      <DialogContent className=\"cct-confirm-dialog\"><DialogTitle>Mark task done?</DialogTitle>\n        <DialogDescription>Staff confirmation only</DialogDescription>\n        <TaskCompletionConfirm task={task} note={note} pending={busy} error={error} allowed={canComplete}\n          onNote={setNote} onCancel={() => setConfirmOpen(false)} onConfirm={() => {\n            if (!canComplete || busy || !note.trim()) return;\n"
  ]
 ],
 "server/claudeCustomerTasksRouter.ts": [
  [
   "    // The completion note is optional (owner, 2026-11-28); the popup requires the confirmation box.\n    complete: opsChatProcedure.input(z.object({ id, note: z.string().trim().max(2000).optional() }).strict()).output(customerTaskSchema)\n",
   "    complete: opsChatProcedure.input(z.object({ id, note: z.string().trim().min(1, \"Add a completion note before marking this task done.\") }).strict()).output(customerTaskSchema)\n"
  ]
 ]
};
export function withoutApprovedBookingActions(path: string, source: string): string {
  for (const [current, original] of approvedCompletionConfirm[path] ?? []) {
    const count = source.split(current).length - 1;
    if (count !== 0 && count !== 1) throw new Error(`Unexpected completion-popup hunk: ${path}`);
    if (count === 1) source = source.replace(current, original);
  }
  for (const [current, original] of approvedL27Manual[path] ?? []) {
    const count = source.split(current).length - 1;
    if (count !== 0 && count !== 1) throw new Error(`Unexpected L27 manual-action hunk: ${path}`);
    if (count === 1) source = source.replace(current, original);
  }
  if (approvedRedesign[path] && createHash("sha256").update(source).digest("hex") === approvedRedesign[path])
    source = execFileSync("git", ["show", `${RELEASED}:${path}`], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", maxBuffer: 5_000_000 });
  for (const [current, original] of approved[path] ?? []) {
    const count = source.split(current).length - 1;
    if (count !== 0 && count !== 1) throw new Error(`Unexpected booking-action preservation hunk: ${path}`);
    if (count === 1) source = source.replace(current, original);
  }
  return source;
}
