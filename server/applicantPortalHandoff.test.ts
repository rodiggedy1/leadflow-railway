import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const service = fs.readFileSync(path.join(root, "server/applicantPortalService.ts"), "utf8");
const handoff = fs.readFileSync(path.join(root, "server/applicantPortalHandoffRoute.ts"), "utf8");
const auth = fs.readFileSync(path.join(root, "server/_core/applicantPortalAuth.ts"), "utf8");
const hiring = fs.readFileSync(path.join(root, "server/hiringRouter.ts"), "utf8");
const apply = fs.readFileSync(path.join(root, "client/src/pages/Apply.tsx"), "utf8");
const portal = fs.readFileSync(path.join(root, "client/src/pages/ApplicantPortal.tsx"), "utf8");
const migration = fs.readFileSync(path.join(root, "drizzle/0104_create_applicant_portal_handoff_tokens.sql"), "utf8");
const managedMigration = fs.readFileSync(path.join(root, "server/versioned-migrations/0035_create_applicant_portal_handoff_tokens.sql"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "server/versioned-migrations/manifest.json"), "utf8")) as { migrations: Array<{ id: string; sqlFile: string; sha256: string; postconditionsFile: string }> };

describe("applicant portal magic-link handoff", () => {
  it("uses a candidate-bound reusable hashed magic token and a cookie-backed applicant session", () => {
    expect(service).toContain("applicantPortalHandoffTokens.candidateId");
    expect(service).toContain('createHash("sha256").update(code).digest("hex")');
    expect(service).toContain("reusable: 1");
    expect(service).toContain("/applicant-portal/handoff?access=");
    expect(auth).toContain("APPLICANT_PORTAL_COOKIE_NAME");
    expect(handoff).toContain("res.cookie(APPLICANT_PORTAL_COOKIE_NAME");
    expect(handoff).toContain('res.redirect(303, "/applicant-portal")');
  });

  it("redirects valid legacy hiring-status tokens into the same applicant portal handoff", () => {
    expect(handoff).toContain('app.get("/hiring-status/:token", createLegacyHiringStatusRedirectHandler())');
    expect(handoff).toContain("getApplicantPortalMagicLinkFromLegacyStatusToken");
    expect(service).toContain("eq(candidates.statusToken, statusToken)");
  });

  it("replaces the two-link application and reminder SMS path with the applicant portal link", () => {
    expect(hiring).toContain("getOrCreateApplicantPortalMagicLink(db, candidateId)");
    expect(hiring).toContain("Open your applicant portal to complete your next step");
    expect(hiring).toContain("Your applicant portal is still waiting");
    expect(hiring).toContain("Your applicant portal is ready");
    expect(hiring).not.toContain("Status page link sent");
    expect(apply).toContain("Open your applicant portal");
    expect(portal).toContain("trpc.applicantPortal.me.useQuery");
    expect(portal).toContain("Complete your short interview");
  });

  it("preserves the approved static portal composition around the live applicant state", () => {
    expect(portal).toContain("Service teams you can grow with");
    expect(portal).toContain("One applicant portal, with opportunities across the home services our customers rely on.");
    expect(portal).toContain("Home cleaning");
    expect(portal).toContain("Mounting & assembly");
    expect(portal).toContain("Handyman & repairs");
    expect(portal).toContain("Painting & trades");
    expect(portal).toContain("Outdoor services");
    expect(portal).toContain("Moving & removal");
    expect(portal).toContain("A transparent path forward");
    expect(portal).toContain("Offer & onboarding");
    expect(portal).toContain("Start planning");
    expect(portal).toContain("Frequently asked questions");
    expect(portal).toContain("How long does the hiring process take?");
    expect(portal).toContain("Built for people who take pride in great service.");
    expect(portal).toContain("Still have questions?");
    expect(portal).toContain("https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/BAPRHRuxYbGmIuLh.png");
  });

  it("uses direct CDN URLs for the exact approved service image files instead of the unconfigured production storage proxy", () => {
    const serviceCards = portal.slice(portal.indexOf("const serviceTeams = ["), portal.indexOf("];", portal.indexOf("const serviceTeams = [")));
    expect(serviceCards).toContain("https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/OMZeVeJTuXKHcklg.png");
    expect(serviceCards).toContain("https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/YbrwIIinneIBHZgg.png");
    expect(serviceCards).toContain("https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/oYjQJpyKIbXSpYen.png");
    expect(serviceCards).toContain("https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ZxpoieFGtNqtUWPJ.png");
    expect(serviceCards).toContain("https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/hbdXlmHSoMTgpjne.png");
    expect(serviceCards).not.toContain("/manus-storage/");
  });

  it("registers only the additive applicant-token table in matching migration contracts", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `applicant_portal_handoff_tokens`");
    expect(migration).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
    expect(managedMigration).toBe(migration);
    const entry = manifest.migrations.find(item => item.id === "0035_create_applicant_portal_handoff_tokens");
    expect(entry).toMatchObject({ sqlFile: "0035_create_applicant_portal_handoff_tokens.sql", postconditionsFile: "0035_create_applicant_portal_handoff_tokens.postconditions.json" });
    expect(entry?.sha256).toBe(createHash("sha256").update(managedMigration).digest("hex"));
  });
});
