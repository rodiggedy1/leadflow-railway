import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { signApplicantPortalSession } from "./_core/applicantPortalAuth";
import { APPLICANT_PORTAL_COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";
import { getApplicantPortalMagicLinkFromLegacyStatusToken, redeemApplicantPortalHandoff } from "./applicantPortalService";

const HANDOFF_CODE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function createApplicantPortalHandoffHandler() {
  return async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
    const code = typeof req.query.access === "string" ? req.query.access : "";
    if (!HANDOFF_CODE_PATTERN.test(code)) return res.redirect(303, "/apply");
    try {
      const db = await getDb();
      if (!db) return res.redirect(303, "/apply");
      const candidate = await redeemApplicantPortalHandoff(db, code);
      if (!candidate) return res.redirect(303, "/apply");
      const session = await signApplicantPortalSession({ candidateId: candidate.id, firstName: candidate.firstName, lastName: candidate.lastName });
      res.cookie(APPLICANT_PORTAL_COOKIE_NAME, session, { ...getSessionCookieOptions(req), sameSite: "lax", maxAge: ONE_YEAR_MS });
      return res.redirect(303, "/applicant-portal");
    } catch (error) {
      console.error("[ApplicantPortalHandoff] Redemption failed:", error);
      return res.redirect(303, "/apply");
    }
  };
}

export function createLegacyHiringStatusRedirectHandler() {
  return async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
    const legacyToken = typeof req.params.token === "string" ? req.params.token : "";
    if (!HANDOFF_CODE_PATTERN.test(legacyToken)) return res.redirect(303, "/apply");
    try {
      const db = await getDb();
      if (!db) return res.redirect(303, "/apply");
      const magicLink = await getApplicantPortalMagicLinkFromLegacyStatusToken(db, legacyToken);
      return res.redirect(303, magicLink ?? "/apply");
    } catch (error) {
      console.error("[ApplicantPortalHandoff] Legacy status redirect failed:", error);
      return res.redirect(303, "/apply");
    }
  };
}

export function registerApplicantPortalHandoffRoutes(app: Express) {
  app.get("/applicant-portal/handoff", createApplicantPortalHandoffHandler());
  app.get("/hiring-status/:token", createLegacyHiringStatusRedirectHandler());
}
