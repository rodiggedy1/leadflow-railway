import { createHash, randomBytes } from "crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { applicantPortalHandoffTokens, candidates } from "../drizzle/schema";
import { getDb } from "./db";
import { ONE_YEAR_MS } from "../shared/const";

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const APPLICANT_PORTAL_BASE_URL = "https://quote.maidinblack.com";

export async function getOrCreateApplicantPortalMagicLink(db: DbClient, candidateId: number) {
  const candidateRows = await db.select({ id: candidates.id }).from(candidates).where(eq(candidates.id, candidateId)).limit(1);
  if (!candidateRows[0]) throw new Error("Applicant was not found.");
  const now = Date.now();
  const existing = await db.select({ token: applicantPortalHandoffTokens.reusableToken }).from(applicantPortalHandoffTokens).where(and(
    eq(applicantPortalHandoffTokens.candidateId, candidateId),
    eq(applicantPortalHandoffTokens.reusable, 1),
  )).orderBy(desc(applicantPortalHandoffTokens.createdAt)).limit(1);
  const reusableToken = existing[0]?.token;
  const code = reusableToken ?? randomBytes(32).toString("base64url");
  if (!reusableToken) {
    await db.insert(applicantPortalHandoffTokens).values({
      candidateId,
      tokenHash: createHash("sha256").update(code).digest("hex"),
      expiresAt: now + ONE_YEAR_MS,
      reusable: 1,
      reusableToken: code,
      createdAt: new Date(now),
    });
  }
  return `${APPLICANT_PORTAL_BASE_URL}/applicant-portal/handoff?access=${encodeURIComponent(code)}`;
}

export async function redeemApplicantPortalHandoff(db: DbClient, code: string) {
  const tokenHash = createHash("sha256").update(code).digest("hex");
  const tokenRows = await db.select().from(applicantPortalHandoffTokens).where(and(
    eq(applicantPortalHandoffTokens.tokenHash, tokenHash),
    or(eq(applicantPortalHandoffTokens.reusable, 1), isNull(applicantPortalHandoffTokens.usedAt)),
  )).limit(1);
  const token = tokenRows[0];
  if (!token || token.expiresAt < Date.now()) return null;
  if (!token.reusable) {
    const now = new Date();
    const result = await db.update(applicantPortalHandoffTokens).set({ usedAt: now }).where(and(eq(applicantPortalHandoffTokens.id, token.id), isNull(applicantPortalHandoffTokens.usedAt)));
    if (Number((result as { affectedRows?: number }).affectedRows ?? 0) !== 1) return null;
  }
  const candidateRows = await db.select({ id: candidates.id, firstName: candidates.firstName, lastName: candidates.lastName }).from(candidates).where(eq(candidates.id, token.candidateId)).limit(1);
  return candidateRows[0] ?? null;
}

export async function getApplicantPortalMagicLinkFromLegacyStatusToken(db: DbClient, statusToken: string) {
  const candidateRows = await db.select({ id: candidates.id }).from(candidates).where(eq(candidates.statusToken, statusToken)).limit(1);
  const candidate = candidateRows[0];
  if (!candidate) return null;
  return getOrCreateApplicantPortalMagicLink(db, candidate.id);
}
