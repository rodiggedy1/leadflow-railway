import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { cleanerMagicLinkTokens, cleanerProfiles } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { agentPageProcedure, cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { findCleanerPortalTeam } from "./cleanerPortalOwnership";
import { restrictTeamLeaderboardAdminPublication, restrictTeamLeaderboardPublication } from "./teamLeaderboardPublication";
import { readTeamLeaderboardAdminAccounts } from "./teamLeaderboardAdminAccounts";
import { historySelectionSchema, reviewPublishSchema, reviewStartSchema } from "../shared/teamLeaderboardHistory";
import { teamEvidenceWeekInputSchema } from "../shared/teamLeaderboardEvidence";
import { qualityIncidentActionSchema } from "../shared/teamQualityIncidents";
import { sendTeamReportsInputSchema } from "../shared/teamWeeklyReport";
import { teamLeaderboardHistoryService, teamWeekAnalysisService } from "./teamLeaderboardHistoryRuntime";
import type { TeamWeekAnalysis } from "./teamWeekAnalysis";
import type { TeamLeaderboardHistoryService } from "./teamLeaderboardHistoryService";
import type { TrpcContext } from "./_core/context";

const admin = agentPageProcedure("quality").use(async ({ ctx, next }) => {
  if (!ctx.agent.isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  return next({ ctx });
});
async function cleanerIdentity(ctx: TrpcContext & { cleaner: { cleanerId: number } }) {
  const id = ctx.cleaner.cleanerId;
  if (!Number.isSafeInteger(id) || id <= 0) throw new TRPCError({ code: "UNAUTHORIZED", message: "Cleaner login required" });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Team results are temporarily unavailable." });
  const profiles = await db.select({ id: cleanerProfiles.id, isActive: cleanerProfiles.isActive }).from(cleanerProfiles)
    .where(and(eq(cleanerProfiles.id, id), eq(cleanerProfiles.isActive, 1))).limit(1);
  if (profiles[0]?.id !== id || profiles[0]?.isActive !== 1) throw new TRPCError({ code: "UNAUTHORIZED", message: "Active cleaner login required" });
  const team = await findCleanerPortalTeam(db, id);
  if (!team || team.cleanerProfileId !== id || !Number.isSafeInteger(team.schedulingTeamId) || (team.schedulingTeamId ?? 0) <= 0)
    throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no mapped scheduling team." });
  return { team, id };
}
const safe = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); }
  catch (error) {
    if (error instanceof TRPCError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/CONFLICT|STALE|CHANGED/.test(message)) throw new TRPCError({ code: "CONFLICT", message: "Published results changed. Reload the draft before publishing." });
    if (message === "WEEK_NOT_PUBLISHED") throw new TRPCError({ code: "NOT_FOUND", message: "No published results for this week. Choose a saved week or run a review." });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The weekly review could not be completed. Previous published results are unchanged." });
  }
};
/** Quality-record actions: a clear message for each fixed code, never a database message. */
const QUALITY_MESSAGES: Record<string, string> = {
  QUALITY_INCIDENT_NOT_FOUND: "That quality record no longer exists. Refresh the list.",
  QUALITY_INCIDENT_NOT_PRIMARY: "This message is part of another incident. Change the incident instead, or separate this message first.",
  QUALITY_INCIDENT_ALREADY_SEPARATE: "This message is already its own incident.",
  QUALITY_JOB_NOT_FOUND: "That job no longer exists.",
  QUALITY_JOB_TEAM_UNMAPPED: "That job is not assigned to exactly one team, so it cannot be attributed. Fix the job's team first.",
  QUALITY_MERGE_TARGET_INVALID: "Choose a different incident to merge into.",
};
async function quality<T>(work: (pool: import("mysql2/promise").Pool) => Promise<T>): Promise<T> {
  try {
    const { getPool } = await import("./db");
    if (!await getDb()) throw new Error("QUALITY_DB_UNAVAILABLE");
    const pool = getPool();
    if (!pool) throw new Error("QUALITY_DB_UNAVAILABLE");
    return await work(pool);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const code = error instanceof Error ? error.message : "";
    throw new TRPCError({ code: QUALITY_MESSAGES[code] ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
      message: QUALITY_MESSAGES[code] ?? "Quality records are temporarily unavailable. Nothing was changed; try again." });
  }
}
const ANALYSIS_MESSAGES: Record<string, string> = {
  ANALYSIS_ALREADY_COMPLETE: "This week has already been fully analyzed. New messages are added automatically; no new analysis is needed.",
  ANALYSIS_FUTURE_WEEK: "That week has not started yet.",
  ANALYSIS_INVALID_DAY: "Choose a day from this week, up to today.",
  ANALYSIS_INVALID_WEEK: "Choose a week starting on a Sunday.",
  ANALYSIS_CHANGED: "Someone else just started or changed this analysis. The status has been refreshed.",
};
const analysisCall = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    throw new TRPCError({ code: ANALYSIS_MESSAGES[code] ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
      message: ANALYSIS_MESSAGES[code] ?? "The analysis status could not be loaded. Nothing was started; try again." });
  }
};
const reportCall = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); }
  catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof Error && error.message === "REPORTS_PUBLISH_FAILED")
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Publishing this week's results failed, so no reports were sent. Check the week's job counts, then try again." });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Team reports could not be loaded or sent. Check each team's status before trying again." });
  }
};
/** Where the team links point: this app's own public address (the staging/preview domain there, production otherwise). */
function teamReportOrigin(): string {
  const domain = ENV.isPreviewMode ? process.env.RAILWAY_PUBLIC_DOMAIN : undefined;
  return domain ? `https://${domain}` : "https://quote.maidinblack.com";
}
export function createTeamLeaderboardHistoryRouter(options: { resolveService?: () => TeamLeaderboardHistoryService; resolveAnalysis?: () => TeamWeekAnalysis;
  resolveReportDeps?: (weekStart: string) => import("./teamWeeklyReports").ReportDeps } = {}) {
  const service = () => options.resolveService?.() ?? teamLeaderboardHistoryService();
  const weekAnalysis = () => options.resolveAnalysis?.() ?? teamWeekAnalysisService();
  const reportDeps = async (weekStart: string): Promise<import("./teamWeeklyReports").ReportDeps> => {
    if (options.resolveReportDeps) return options.resolveReportDeps(weekStart);
    const db = await getDb();
    const { getPool } = await import("./db");
    const pool = db ? getPool() : null;
    if (!db || !pool) throw new Error("REPORTS_DB_UNAVAILABLE");
    const reports = await import("./teamWeeklyReports");
    const [{ sendSms }, { normalizePhone }] = await Promise.all([import("./openphone"), import("./utils/phone")]);
    return {
      async readWeek(week) {
        const live = await service().live(week);
        const restricted = restrictTeamLeaderboardAdminPublication(live.snapshot);
        const teamAccounts = await readTeamLeaderboardAdminAccounts(db, restricted.publication.teams.map(team => team.id));
        return reports.readReportWeek(live, restricted as never, teamAccounts, await weekAnalysis().status(week), week);
      },
      // The existing 30-day cleaner magic links: an unused token with at least 7 days left is reused, otherwise a new
      // 30-day one is created (same table and login as "Copy portal link"). The link opens the team's leaderboard.
      async links(profileIds) {
        const { randomBytes } = await import("node:crypto");
        const { withTeamLeaderboardDestination } = await import("../shared/teamLeaderboardAccess");
        const origin = teamReportOrigin(), result = new Map<number, string | null>();
        for (const id of profileIds) {
          const now = Date.now();
          const [existing] = await db.select({ token: cleanerMagicLinkTokens.token }).from(cleanerMagicLinkTokens)
            .where(and(eq(cleanerMagicLinkTokens.cleanerProfileId, id), eq(cleanerMagicLinkTokens.used, 0), gte(cleanerMagicLinkTokens.expiresAt, new Date(now + 7 * 86_400_000))))
            .orderBy(desc(cleanerMagicLinkTokens.expiresAt)).limit(1);
          let token = existing?.token;
          if (!token) {
            token = randomBytes(32).toString("hex");
            await db.insert(cleanerMagicLinkTokens).values({ cleanerProfileId: id, token, expiresAt: new Date(now + 30 * 86_400_000), used: 0 });
          }
          result.set(id, withTeamLeaderboardDestination(`${origin}/auth/cleaner-callback?token=${token}`, origin));
        }
        return result;
      },
      async publish(week, expectedPublicationId, agentId) {
        const { randomUUID } = await import("node:crypto");
        await service().publishFromRecords(agentId, { requestId: randomUUID(), weekStart: week, expectedPublicationId });
      },
      async readPublished(week) {
        const snapshot = await service().published({ weekStart: week });
        if (snapshot.period?.weekStart !== week) throw new Error("REPORTS_PUBLISHED_WEEK_MISMATCH");
        const restricted = restrictTeamLeaderboardAdminPublication(snapshot);
        return { weekEnd: snapshot.period.weekEnd, teams: restricted.publication.teams, details: restricted.details as never };
      },
      readProfiles: ids => db.select({ id: cleanerProfiles.id, phone: cleanerProfiles.phone, language: cleanerProfiles.language, isActive: cleanerProfiles.isActive })
        .from(cleanerProfiles).where(inArray(cleanerProfiles.id, ids)),
      store: reports.createReportStore(pool),
      sendSms: ({ to, content }) => sendSms({ to, content }), // the existing team SMS path and default line, like the portal login text
      normalizePhone, now: () => Date.now(),
    };
  };
  return router({
    weeksForAdmin: admin.query(({ ctx }) => safe(async () => ({ agentId: ctx.agent.agentId, weeks: await service().weeks() }))),
    forAdmin: admin.input(historySelectionSchema).query(({ ctx, input }) => safe(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Team results are temporarily unavailable." });
      const snapshot = await service().published(input);
      const result = restrictTeamLeaderboardAdminPublication(snapshot);
      const teamAccounts = await readTeamLeaderboardAdminAccounts(db, result.publication.teams.map(team => team.id));
      return { ...result, agentId: ctx.agent.agentId, teamAccounts, selectionKey: input.summary ? "summary" : snapshot.period?.weekStart ?? "latest" };
    })),
    weeksForMe: cleanerProcedure.query(({ ctx }) => safe(async () => {
      const identity = await cleanerIdentity(ctx);
      return { cleanerProfileId: identity.id, weeks: await service().weeks() };
    })),
    forMe: cleanerProcedure.input(historySelectionSchema).query(({ ctx, input }) => safe(async () => {
      const identity = await cleanerIdentity(ctx);
      const snapshot = await service().published(input);
      return { ...restrictTeamLeaderboardPublication(snapshot, identity.team, identity.id), selectionKey: input.summary ? "summary" : snapshot.period?.weekStart ?? "latest" };
    })),
    startReview: admin.input(reviewStartSchema).mutation(({ ctx, input }) => safe(async () => ({ agentId: ctx.agent.agentId, ...await service().start(ctx.agent.agentId, input) }))),
    reviewRuns: admin.input(teamEvidenceWeekInputSchema).query(({ ctx, input }) => safe(async () => ({ agentId: ctx.agent.agentId, runs: await service().runs(input.weekStart) }))),
    reviewDraft: admin.input(z.object({ reviewId: z.string().uuid() }).strict()).query(({ ctx, input }) => safe(async () => ({ agentId: ctx.agent.agentId, ...await service().draft(input.reviewId) }))),
    publishReview: admin.input(reviewPublishSchema).mutation(({ ctx, input }) => safe(async () => ({ agentId: ctx.agent.agentId, ...await service().publish(ctx.agent.agentId, input) }))),
    // Phase 2: saved quality records (admin only). Customer evidence is visible to admins, never to team endpoints.
    qualityRecords: admin.input(teamEvidenceWeekInputSchema).query(({ ctx, input }) => quality(async pool => {
      const { listQualityIncidents } = await import("./teamQualityIncidents");
      const listed = await listQualityIncidents(pool, input.weekStart);
      const [teams] = await pool.query("SELECT id, name FROM scheduling_teams") as unknown as [Array<{ id: number; name: string }>];
      return { agentId: ctx.agent.agentId, ...listed, teamNames: Object.fromEntries(teams.map(team => [String(team.id), team.name])) };
    })),
    qualityChoices: admin.input(z.object({ id: z.number().int().positive() }).strict()).query(({ ctx, input }) => quality(async pool => {
      const { attributionChoices } = await import("./teamQualityIncidents");
      return { agentId: ctx.agent.agentId, choices: await attributionChoices(pool, input.id) };
    })),
    qualityAction: admin.input(qualityIncidentActionSchema).mutation(({ ctx, input }) => quality(async pool => {
      const { applyQualityIncidentAction } = await import("./teamQualityIncidents");
      return { agentId: ctx.agent.agentId, incident: await applyQualityIncidentAction(pool, input, ctx.agent.agentId) };
    })),
    qualityRetry: admin.input(z.object({ id: z.number().int().positive() }).strict()).mutation(({ ctx, input }) => quality(async pool => {
      const { processQualityIncident } = await import("./teamQualityIncidents");
      return { agentId: ctx.agent.agentId, incident: await processQualityIncident(pool, input.id) };
    })),
    liveFromRecords: admin.input(teamEvidenceWeekInputSchema).query(({ ctx, input }) => safe(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Team results are temporarily unavailable." });
      const live = await service().live(input.weekStart);
      const result = restrictTeamLeaderboardAdminPublication(live.snapshot);
      const teamAccounts = await readTeamLeaderboardAdminAccounts(db, result.publication.teams.map(team => team.id));
      const notes = ((live.snapshot as { reviewMetadata?: { warnings?: string[] } }).reviewMetadata?.warnings ?? []).slice(0, 200);
      return { agentId: ctx.agent.agentId, ...result, teamAccounts, countsComplete: live.countsComplete, expectedPublicationId: live.expectedPublicationId, notes };
    })),
    // Read-only: do the team pages (published results, each team's own login) and the last texts agree with this page?
    teamPortalCheck: admin.input(teamEvidenceWeekInputSchema).query(({ ctx, input }) => reportCall(async () => {
      const db = await getDb();
      const { getPool } = await import("./db");
      const pool = db ? getPool() : null;
      if (!db || !pool) throw new Error("REPORTS_DB_UNAVAILABLE");
      const { checkTeamPortals } = await import("./teamPortalCheck");
      const check = await checkTeamPortals({
        live: week => service().live(week) as never,
        async published(week) {
          const entry = (await service().weeks()).find(item => item.weekStart === week);
          return entry ? { snapshot: await service().published({ weekStart: week }) as never, publishedAtMs: entry.publishedAtMs } : null;
        },
        teamAccounts: ids => readTeamLeaderboardAdminAccounts(db, ids),
        portalTeam: id => findCleanerPortalTeam(db, id),
        async lastSentReports(week) {
          const [rows] = await pool.query(`SELECT r.teamId, r.messageText, r.sentAtMs FROM team_weekly_reports r INNER JOIN (SELECT teamId, MAX(attempt) AS attempt
            FROM team_weekly_reports WHERE weekStart = ? AND status = 'sent' GROUP BY teamId) l ON l.teamId = r.teamId AND l.attempt = r.attempt WHERE r.weekStart = ?`, [week, week]);
          return (rows as Array<Record<string, unknown>>).map(row => ({ teamId: Number(row.teamId), messageText: String(row.messageText), sentAtMs: Number(row.sentAtMs) }));
        },
      }, input.weekStart);
      return { agentId: ctx.agent.agentId, ...check };
    })),
    publishFromRecords: admin.input(z.object({ requestId: z.string().uuid(), weekStart: z.string(), expectedPublicationId: z.string().min(1).nullable() }).strict())
      .mutation(({ ctx, input }) => safe(async () => ({ agentId: ctx.agent.agentId, ...await service().publishFromRecords(ctx.agent.agentId, input) }))),
    // The week's day-by-day complaint analysis: one status, one start (never a duplicate run).
    analysisStatus: admin.input(teamEvidenceWeekInputSchema).query(({ ctx, input }) => analysisCall(async () => ({ agentId: ctx.agent.agentId, ...await weekAnalysis().status(input.weekStart) }))),
    estimateAnalysis: admin.input(teamEvidenceWeekInputSchema).query(({ ctx, input }) => analysisCall(async () => ({ agentId: ctx.agent.agentId, days: await weekAnalysis().estimate(input.weekStart) }))),
    startAnalysis: admin.input(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).strict())
      .mutation(({ ctx, input }) => analysisCall(async () => ({ agentId: ctx.agent.agentId, ...await weekAnalysis().start(ctx.agent.agentId, input) }))),
    // Phase 3 weekly team reports: preview (read-only) and a manual send. Built from the same live standings and
    // saved quality records as this page; no AI. Sends only when an admin presses Send.
    teamReports: admin.input(teamEvidenceWeekInputSchema).query(({ ctx, input }) => reportCall(async () =>
      ({ agentId: ctx.agent.agentId, ...await (await import("./teamWeeklyReports")).previewTeamReports(await reportDeps(input.weekStart), input.weekStart) }))),
    sendTeamReports: admin.input(sendTeamReportsInputSchema).mutation(({ ctx, input }) => reportCall(async () =>
      ({ agentId: ctx.agent.agentId, outcomes: await (await import("./teamWeeklyReports")).sendTeamReports(await reportDeps(input.weekStart), input, ctx.agent.agentId) }))),
    importReviewToRecords: admin.input(z.object({ reviewId: z.string().uuid() }).strict())
      .mutation(({ ctx, input }) => safe(async () => ({ agentId: ctx.agent.agentId, ...await service().importReview(input.reviewId) }))),
  });
}
export const teamLeaderboardHistoryRouter = createTeamLeaderboardHistoryRouter();
