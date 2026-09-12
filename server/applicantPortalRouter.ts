import { eq } from "drizzle-orm";
import { candidates } from "../drizzle/schema";
import { getDb } from "./db";
import { getApplicantPortalSessionFromRequest } from "./_core/applicantPortalAuth";
import { publicProcedure, router } from "./_core/trpc";

export const applicantPortalRouter = router({
  me: publicProcedure.query(async ({ ctx }) => {
    const session = await getApplicantPortalSessionFromRequest(ctx.req);
    if (!session) return null;
    const db = await getDb();
    if (!db) throw new Error("Applicant portal is unavailable.");
    const rows = await db.select({
      id: candidates.id,
      firstName: candidates.firstName,
      lastName: candidates.lastName,
      bioPhotoUrl: candidates.bioPhotoUrl,
      city: candidates.city,
      state: candidates.state,
      stage: candidates.stage,
      specialties: candidates.specialties,
      createdAt: candidates.createdAt,
      interviewCallId: candidates.interviewCallId,
    }).from(candidates).where(eq(candidates.id, session.candidateId)).limit(1);
    const candidate = rows[0];
    if (!candidate) return null;
    return {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      bioPhotoUrl: candidate.bioPhotoUrl ?? null,
      city: candidate.city ?? null,
      state: candidate.state ?? null,
      stage: candidate.stage,
      specialties: candidate.specialties ? JSON.parse(candidate.specialties) as string[] : [],
      appliedAt: candidate.createdAt,
      hasCompletedInterview: Boolean(candidate.interviewCallId),
      interviewPath: `/interview/${candidate.id}`,
    };
  }),
});
