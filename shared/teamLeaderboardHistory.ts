import { z } from "zod";
import type { TeamLeaderboardPublication } from "./teamLeaderboard";
import type { TeamLeaderboardDetails, TeamLeaderboardPeriod } from "./teamLeaderboardPublication";
import { teamEvidenceWeekInputSchema } from "./teamLeaderboardEvidence";

export type HistorySnapshot = { publication: TeamLeaderboardPublication; details: TeamLeaderboardDetails; period?: TeamLeaderboardPeriod };
export type PublishedWeek = { id: string; weekStart: string; weekEnd: string; coverageEnd: string; publishedAtMs: number; snapshot: HistorySnapshot };
export type WeekOption = Omit<PublishedWeek, "snapshot">;
export const historySelectionSchema = z.object({ weekStart: teamEvidenceWeekInputSchema.shape.weekStart.optional(), summary: z.boolean().optional() }).strict()
  .refine(value => !value.summary || !value.weekStart, "Choose a week or Summary, not both");
export const reviewStartSchema = teamEvidenceWeekInputSchema.extend({ requestId: z.string().uuid() }).strict();
export const complaintDecisionSchema = z.object({
  visitId: z.number().int().positive().safe(), teamId: z.number().int().positive().safe(),
  includeComplaint: z.boolean(), completedRecovery: z.boolean(), outcomeNote: z.string().trim().max(2000),
}).strict().refine(value => !value.completedRecovery || value.outcomeNote.length > 0, "A completed reclean/refund requires a reviewed outcome note");
export const reviewPublishSchema = z.object({
  reviewId: z.string().uuid(), expectedPublicationId: z.string().nullable(),
  decisions: z.array(complaintDecisionSchema), acknowledgeLimitations: z.literal(true),
}).strict();
export type HistorySelection = z.infer<typeof historySelectionSchema>;
export type ReviewPublish = z.infer<typeof reviewPublishSchema>;
