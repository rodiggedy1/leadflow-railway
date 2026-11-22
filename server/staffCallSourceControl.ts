import { withoutApprovedTaskCallPlayback } from "./taskCallPlaybackSourceControl";
/** Test-only: remove only the fixed approved staff-call feature hunks.
 * All unrelated bytes remain subject to the original historical comparisons. */
const takeoverHunks: Record<string, Array<[string, string, number]>> = {
  "client/src/components/ClaudeCustomerTasks.tsx": [
    ['  claim: (id: number, expectedOwnerId?: string) => Promise<void>;', '  claim: (id: number) => Promise<void>;', 1],
    ['    claim: (id, expectedOwnerId) => run(id, () => expectedOwnerId === undefined\n      ? claim.mutateAsync({ id })\n      : claim.mutateAsync({ id, expectedOwnerId })),', '    claim: (id) => run(id, () => claim.mutateAsync({ id })),', 1],
    ['      {task.status === "claimed" && !mine && task.owner && <button type="button" className="cct-primary" disabled={busy || !callerId}\n        title={`Take over from ${task.owner.name}`} onClick={() => void update(() => actions.claim(task.id, task.owner!.id))}>\n        {busy ? <><Loader2 aria-hidden="true" />Taking over…</> : "Take over"}</button>}\n', '', 1],
  ],
  "server/claudeCustomerTasksRouter.ts": [
    ['    claim: opsChatProcedure.input(idInput.extend({ expectedOwnerId: z.string().min(1).optional() })).output(customerTaskSchema)\n      .mutation(({ input, ctx }) => write(store => input.expectedOwnerId === undefined\n        ? store.claimTask(input.id, actor(ctx.opsCaller))\n        : store.claimTask(input.id, actor(ctx.opsCaller), input.expectedOwnerId))),', '    claim: opsChatProcedure.input(idInput).output(customerTaskSchema)\n      .mutation(({ input, ctx }) => write(store => store.claimTask(input.id, actor(ctx.opsCaller)))),', 1],
  ],
  "server/instinct/claudeCustomerTasksStore.ts": [
    ['  claimTask(id: number, actor: TaskActor, expectedOwnerId?: string): Promise<CustomerTask>;', '  claimTask(id: number, actor: TaskActor): Promise<CustomerTask>;', 1],
    ['    claimTask: (id, actor, expectedOwnerId) => mutateTask(id, actor, (task, staff) => {\n      // Only an explicit takeover may replace an owner; compare the rendered owner\n      // while holding the existing task row lock so stale clicks cannot steal it.\n      if (expectedOwnerId !== undefined) {\n        if (task.status !== "claimed" || !task.owner || task.owner.id !== expectedOwnerId)\n          return fail("CONFLICT", "This task\'s owner or status changed. Refresh it before taking over.");\n        if (task.owner.id === staff.id) return false;\n        const previous = task.owner, now = Date.now();\n        task.owner = staff; task.claimedAt = now;\n        task.activity.push({ action: "claimed", actor: staff, at: now, note: `Took over from ${previous.name} (${previous.id}).` });\n        return true;\n      }', '    claimTask: (id, actor) => mutateTask(id, actor, (task, staff) => {', 1],
  ],
};
/** Strip only the fixed takeover additions, never arbitrary ownership or UI code. */
export function withoutApprovedTaskTakeover(path: string, source: string): string {
  source = withoutApprovedTaskCallPlayback(path, source);
  for (const [current, original, occurrences] of takeoverHunks[path] ?? []) {
    const count = source.split(current).length - 1;
    if (count !== 0 && count !== occurrences) throw new Error(`Unexpected task takeover preservation hunk: ${path}`);
    source = source.split(current).join(original);
  }
  return source;
}
const repairHunks: Record<string, Array<[string, string, number]>> = {
  "server/webhooks.ts": [
    ['import { dispatchClaudeStaffCallEvent, dispatchClaudeStaffCallTranscriptReady } from "./instinct/claudeStaffCallsApplication";\n', 'import { dispatchClaudeStaffCallEvent } from "./instinct/claudeStaffCallsApplication";\n', 1],
    ['    dispatchClaudeStaffCallTranscriptReady(callId);\n', "", 1],
    ['  dispatchClaudeStaffCallTranscriptReady(callId);\n', "", 1],
  ],
  "shared/claudeCustomerTasks.ts": [
    ['staffUserId: z.string().regex(/^US.+$/).nullable(), direction:', 'staffUserId: z.string().regex(/^US.+$/), direction:', 1],
    ['    transcriptSource: z.enum(["quo", "saved"]).optional(), evidenceScope: z.literal("call_transcript").optional(),\n', "", 1],
  ],
  "client/src/components/ClaudeCustomerTasks.tsx": [
    ['task.customerName || (task.call.provider === "openphone" ? "Caller" : "Customer")', 'task.customerName || "Customer"', 1],
    ['task.customerName || ("call" in task && task.call.provider === "openphone" ? "Caller" : "Customer")', 'task.customerName || "Customer"', 1],
    ['{"call" in task && task.call.provider === "openphone" ? "Staff task" : "Customer task"} · ', 'Customer task · ', 1],
    ['"call" in task ? task.call.provider === "openphone" ? "Call evidence" : "Caller evidence" : ', '"call" in task ? "Caller evidence" : ', 2],
  ],
};
export function withoutApprovedStaffCallRepair(path: string, source: string): string {
  source = withoutApprovedTaskTakeover(path, source);
  for (const [current, original, occurrences] of repairHunks[path] ?? []) {
    const count = source.split(current).length - 1;
    if (count !== 0 && count !== occurrences) throw new Error(`Unexpected staff-call repair hunk: ${path}`);
    source = source.split(current).join(original);
  }
  return source;
}
const schema = `export const customerStaffCallTaskSchema = customerCallTaskSchema.extend({
  call: z.object({
    provider: z.literal("openphone"), providerCallId: z.string().regex(/^AC.+$/), recordingId: z.number().int().positive(),
    transcript: z.string().min(1), recordingUrl: z.string().url().nullable(),
    businessPhoneNumberId: z.string().regex(/^PN.+$/), businessPhoneNumber: z.string().min(1),
    staffUserId: z.string().regex(/^US.+$/), direction: z.enum(["incoming", "outgoing"]),
  }).strict(),
}).strict();
`;
const hunks: Record<string, Array<[string, string, number]>> = {
  "server/webhooks.ts": [
    ['import { dispatchClaudeStaffCallEvent } from "./instinct/claudeStaffCallsApplication";\n', "", 1],
    ['        dispatchClaudeStaffCallEvent(event);\n', "", 2],
  ],
  "client/src/components/ClaudeCustomerTasks.tsx": [
    ['<DialogTitle>{task.call.provider === "openphone" ? "Full staff call" : "Full AI call"}</DialogTitle>', '<DialogTitle>Full AI call</DialogTitle>', 1],
    ['"call" in task ? task.call.provider === "openphone" ? "PHONE CALL" : "AI CALL" : ', '"call" in task ? "AI CALL" : ', 1],
  ],
  "shared/claudeCustomerTasks.ts": [
    [schema, "", 1],
    ["customerCallTaskSchema, customerStaffCallTaskSchema]);", "customerCallTaskSchema]);", 1],
  ],
  "server/claudeCustomerTasksRouter.ts": [
    ['  readStaffCallRecordingUrl?: (providerCallId: string) => Promise<string | null>;\n', "", 1],
    ['        if (task.call.provider === "openphone") {\n          const read = options.readStaffCallRecordingUrl ?? (await import("./instinct/claudeStaffCallRecording")).readStaffCallRecordingUrl;\n          return { url: await read(task.call.providerCallId) };\n        }\n', "", 1],
  ],
};
export function withoutApprovedStaffCallFeature(path: string, source: string): string {
  source = withoutApprovedStaffCallRepair(path, source);
  for (const [current, original, occurrences] of hunks[path] ?? []) {
    const count = source.split(current).length - 1;
    if (count !== 0 && count !== occurrences) throw new Error(`Unexpected staff-call preservation hunk: ${path}`);
    source = source.split(current).join(original);
  }
  return source;
}
