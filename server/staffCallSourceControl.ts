/** Test-only: remove only the fixed approved staff-call feature hunks.
 * All unrelated bytes remain subject to the original historical comparisons. */
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
  for (const [current, original, occurrences] of hunks[path] ?? []) {
    const count = source.split(current).length - 1;
    if (count !== 0 && count !== occurrences) throw new Error(`Unexpected staff-call preservation hunk: ${path}`);
    source = source.split(current).join(original);
  }
  return source;
}
