import { z } from "zod";
import { leadCallNotesInputSchema } from "./leadCallNotes";

export const leadCallNotesAvailabilityInputSchema = z.object({
  leads: z.array(leadCallNotesInputSchema.extend({ key: z.string().min(1) }).strict()),
}).strict();
export type LeadCallNotesAvailabilityInput = z.infer<typeof leadCallNotesAvailabilityInputSchema>;

export interface LeadCallNotesAvailabilityResult {
  leads: Array<{ key: string; hasCalls: boolean | null }>;
}
