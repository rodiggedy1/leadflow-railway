import { z } from "zod";

export const leadCallNotesInputSchema = z.object({
  sessionId: z.number().int().positive().refine(Number.isSafeInteger).nullable().default(null),
  phone: z.string().nullable().default(null),
}).strict();
export type LeadCallNotesInput = z.infer<typeof leadCallNotesInputSchema>;

export interface LeadCallNote {
  id: string;
  provider: "vapi" | "openphone";
  providerCallId: string | null;
  source: "madison" | "staff" | "outbound_ai";
  direction: "incoming" | "outgoing";
  startedAt: number;
  durationSeconds: number | null;
  outcome: string | null;
  summary: string | null;
  transcript: string | null;
  details: Array<{ label: string; value: string }>;
  followUps: Array<{ taskId: number; title: string; evidenceQuote: string; status: "open" | "done" }>;
}
export interface LeadCallNotesResult {
  phone: string | null;
  calls: LeadCallNote[];
}
