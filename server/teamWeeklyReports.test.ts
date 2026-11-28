// Phase 3 team weekly reports: offline, fictional teams, simulated SMS. No AI, no network.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildTeamReportMessage, plainText, reportLanguage, reportWeekRange, PRELIMINARY_NOTICE, type TeamReportFacts } from "../shared/teamWeeklyReport";
import { previewTeamReports, sendTeamReports, PENDING_UNCERTAIN_MS, ReportPublishError, type ReportDeps, type ReportRow, type ReportStandings, type ReportWeek } from "./teamWeeklyReports";
import { TEAM_SCORE_METRICS } from "../shared/teamLeaderboard";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";
import { normalizePhone } from "./utils/phone";

// The owner-approved templates (2026-11-28), exactly as approved, with the placeholders filled in by the test.
const ENGLISH = `🏆 MAIDS IN BLACK — WEEKLY PERFORMANCE REPORT
Team: [Team Name]
Week: [Date Range]
Your ranking: #[Rank] of [Total Ranked Teams] teams
Overall score: [Score]/100
🏠 Completed cleanings: [Count]
⭐ Five-star reviews: [Count]
🧹 Cleaning complaints: [Count]
📍 ETA compliance: [Percentage]%
📸 Photo compliance: [Percentage]%
IMPORTANT — NEXT WEEK'S JOB ASSIGNMENTS
These rankings determine the order in which jobs are assigned for the upcoming week. The highest-ranked teams will receive priority, starting with the #1 ranked team and working down the list.
Better performance means higher priority for job assignments and more earning opportunities.
View your full performance report, customer complaints, areas for improvement and team profile using your personal link below:
[Team Magic Link]
Thank you for your hard work. Let's make next week even better!
— Maids in Black`;
const SPANISH = `🏆 MAIDS IN BLACK — REPORTE SEMANAL DE DESEMPEÑO
Equipo: [Nombre del equipo]
Semana: [Fechas]
Tu posición: #[Posición] de [Total] equipos
Puntuación general: [Puntuación]/100
🏠 Limpiezas completadas: [Cantidad]
⭐ Reseñas de cinco estrellas: [Cantidad]
🧹 Quejas sobre la limpieza: [Cantidad]
📍 Cumplimiento de envío de ETA: [Porcentaje]%
📸 Cumplimiento de envío de fotos: [Porcentaje]%
IMPORTANTE — ASIGNACIÓN DE TRABAJOS PARA LA PRÓXIMA SEMANA
Estas clasificaciones determinan el orden en que se asignarán los trabajos durante la próxima semana. Los equipos mejor clasificados tendrán prioridad, comenzando con el equipo número uno y siguiendo el orden de la clasificación.
Un mejor desempeño significa mayor prioridad en la asignación de trabajos y más oportunidades de generar ingresos.
Consulta tu reporte completo, las quejas de clientes, las áreas que debes mejorar y el perfil de tu equipo utilizando tu enlace personal:
[Enlace personal del equipo]
¡Gracias por tu esfuerzo! Trabajemos juntos para tener una semana aún mejor.
— Maids in Black`;
const fill = (template: string, values: string[]) => { let i = 0; return template.replace(/\[[^\]]+\]/g, () => values[i++]); };
const LINK = "https://quote.maidinblack.com/auth/cleaner-callback?token=" + "a".repeat(64) + "&view=team-leaderboard";

const m = (successful: number, eligible: number) => ({ successful, eligible, complete: true });
const row = (id: string, name: string, jobs: number, over: Partial<Record<string, ReturnType<typeof m>>> = {}) => ({ id, name, eligibleJobs: jobs,
  metrics: { ...Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, m(jobs, jobs)])), ...over } as never });
function week(change: Partial<ReportWeek> = {}): ReportWeek {
  return {
    weekEnd: "2026-11-28",
    teams: [row("1", "Team Alba", 10, { ratings: m(8, 9), eta: m(9, 10) }), row("2", "Team Brisa", 8), row("3", "Team Cielo", 5), row("4", "Team Duna", 2), row("5", "Team Eco", 0),
      row("6", "Team Faro", 4)],
    details: { "1": { complaintCases: 2 }, "2": { complaintCases: 0 }, "3": { complaintCases: 0 }, "4": { complaintCases: 0 }, "6": { complaintCases: 1 } },
    teamAccounts: { "1": { cleanerProfileId: 11 }, "2": { cleanerProfileId: 12 }, "3": { cleanerProfileId: 13 }, "4": { cleanerProfileId: 14 }, "5": { cleanerProfileId: 15 },
      "6": { cleanerProfileId: null, reason: "missing_cleaner_account" } },
    provisionalReason: null, expectedPublicationId: "pub-1",
    ...change,
  };
}
function deps(change: Partial<ReportDeps> = {}, w = week()) {
  const rows: ReportRow[] = [], calls: string[] = [];
  let clock = Date.parse("2026-11-29T14:00:00Z"), published: ReportStandings | null = null;
  const sent: Array<{ to: string; content: string }> = [];
  const d: ReportDeps = {
    readWeek: vi.fn(async () => w),
    readProfiles: vi.fn(async () => [
      { id: 11, phone: "(302) 555-0111", language: "en", isActive: 1 }, { id: 12, phone: "+13025550112", language: "es", isActive: 1 },
      { id: 13, phone: "555", language: "en", isActive: 1 }, { id: 14, phone: "+13025550114", language: "en", isActive: 1 }, { id: 15, phone: "+13025550115", language: "en", isActive: 1 }]),
    links: vi.fn(async (ids: number[]) => new Map(ids.map(id => [id, LINK.replace("a".repeat(64), String(id).repeat(32).slice(0, 64).padEnd(64, "0"))]))),
    publish: vi.fn(async () => { calls.push("publish"); published = structuredClone({ weekEnd: w.weekEnd, teams: w.teams, details: w.details }); }),
    readPublished: vi.fn(async () => { if (!published) throw new Error("nothing published"); return published; }),
    store: {
      list: async () => rows.map(r => ({ ...r })),
      reserve: async r => { if (rows.some(x => x.weekStart === r.weekStart && x.teamId === r.teamId && x.attempt === r.attempt)) return "duplicate"; rows.push({ ...r, id: rows.length + 1 }); return rows.length; },
      finish: async (id, o) => { const x = rows.find(r => r.id === id)!; if (x.status !== "pending") return; Object.assign(x, { status: o.status, error: o.error, providerMessageId: o.providerMessageId, updatedAtMs: o.atMs, sentAtMs: o.status === "sent" ? o.atMs : null }); },
    },
    sendSms: vi.fn(async (input: { to: string; content: string }) => { calls.push("send"); sent.push(input); return { success: true, messageId: `SIM-${sent.length}` }; }),
    normalizePhone, now: () => (clock += 1000),
    ...change,
  };
  return { d, rows, sent, calls, advance: (ms: number) => { clock += ms; } };
}

const facts = (change: Partial<TeamReportFacts> = {}): TeamReportFacts => ({ teamName: "Team Alba", weekStart: "2026-11-22", weekEnd: "2026-11-28", rank: 2, rankedTeams: 3,
  score: 87.456, completedJobs: 10, ratings: { successful: 8, eligible: 9 }, eta: { successful: 9, eligible: 10 }, photos: { successful: 10, eligible: 10 },
  complaintCount: 2, link: LINK, provisional: false, ...change });

describe("approved templates, word for word", () => {
  it("English: exactly the approved template with the values filled in", () => {
    expect(buildTeamReportMessage(facts(), "en")).toBe(fill(ENGLISH, ["Team Alba", "Nov 22–28, 2026", "2", "3", "87.46", "10", "8", "2", "90", "100", LINK]));
  });
  it("Spanish: exactly the approved template with the values filled in", () => {
    expect(buildTeamReportMessage(facts({ teamName: "Equipo Brisa" }), "es")).toBe(fill(SPANISH, ["Equipo Brisa", "22–28 nov 2026", "2", "3", "87.46", "10", "8", "2", "90", "100", LINK]));
  });
  it("all six emojis, no Markdown formatting characters, plain-text team names", () => {
    for (const language of ["en", "es"] as const) {
      const text = buildTeamReportMessage(facts({ teamName: "**Team Alba** `x` [y]" }), language);
      for (const emoji of ["🏆", "🏠", "⭐", "🧹", "📍", "📸"]) expect(text.split(emoji)).toHaveLength(2);
      expect(text.split(LINK).join("")).not.toMatch(/[*_`~>|[\]]/);
      expect(text).toContain(language === "es" ? "Equipo: Team Alba x y\n" : "Team: Team Alba x y\n");
    }
    expect(plainText("  Team # Coral  ")).toBe("Team Coral");
  });
  it("unranked teams show 'Not ranked' (Spanish: 'Sin clasificar'), never an invented position", () => {
    expect(buildTeamReportMessage(facts({ rank: null }), "en")).toContain("\nYour ranking: Not ranked\n");
    expect(buildTeamReportMessage(facts({ rank: null }), "es")).toContain("\nTu posición: Sin clasificar\n");
  });
  it("nothing measured: N/A, never an invented 0% or score", () => {
    const text = buildTeamReportMessage(facts({ score: null, eta: { successful: 0, eligible: 0 }, photos: { successful: 0, eligible: 0 } }), "en");
    expect(text).toContain("\nOverall score: N/A\n"); expect(text).toContain("\n📍 ETA compliance: N/A\n"); expect(text).toContain("\n📸 Photo compliance: N/A\n");
  });
  it("preliminary weeks: the notice comes first and says final rankings decide assignment priority; the template follows unchanged", () => {
    const en = buildTeamReportMessage(facts({ provisional: true }), "en"), es = buildTeamReportMessage(facts({ provisional: true }), "es");
    expect(en).toBe(`${PRELIMINARY_NOTICE.en}\n${buildTeamReportMessage(facts(), "en")}`);
    expect(es).toBe(`${PRELIMINARY_NOTICE.es}\n${buildTeamReportMessage(facts(), "es")}`);
    expect(PRELIMINARY_NOTICE.en).toContain("Final rankings determine job assignment priority.");
    expect(PRELIMINARY_NOTICE.es).toContain("La clasificación final determina la prioridad en la asignación de trabajos.");
  });
  it("week ranges across months and years", () => {
    expect(reportWeekRange("2026-11-29", "2026-12-05", "en")).toBe("Nov 29–Dec 5, 2026");
    expect(reportWeekRange("2026-12-27", "2027-01-02", "es")).toBe("27 dic 2026–2 ene 2027");
    expect(reportLanguage("es")).toBe("es"); expect(reportLanguage("pt")).toBe("en"); expect(reportLanguage(null)).toBe("en");
  });
});

describe("preview", () => {
  it("each team's text exactly as it would be sent, with its own link; skipped teams say why; no customer data", async () => {
    const { d } = deps();
    const view = await previewTeamReports(d, "2026-11-22");
    const alba = view.teams.find(t => t.teamId === "1")!, brisa = view.teams.find(t => t.teamId === "2")!, duna = view.teams.find(t => t.teamId === "4")!;
    const ranked = rankAssessedScores(week().teams, week().details as never);
    const albaRow = ranked.find(t => t.id === "1")!;
    expect(alba.message).toContain(`Your ranking: #${albaRow.rank} of ${ranked.filter(t => t.rank !== null).length} teams`);
    expect(alba.message).toContain("⭐ Five-star reviews: 8\n🧹 Cleaning complaints: 2\n📍 ETA compliance: 90%");
    expect(alba.message).toContain("\nhttps://quote.maidinblack.com/auth/cleaner-callback?token=");
    expect(alba.message).not.toBe(duna.message.replace("Team Duna", "Team Alba")); // personal links differ per team
    expect(brisa.language).toBe("es"); expect(brisa.message.startsWith("🏆 MAIDS IN BLACK — REPORTE SEMANAL DE DESEMPEÑO")).toBe(true);
    expect(duna.message).toContain("\nYour ranking: Not ranked\n");
    expect(view.teams.find(t => t.teamId === "3")!.issue).toBe("The team account's phone number is not a valid US mobile number.");
    expect(view.teams.find(t => t.teamId === "6")!.issue).toBe("No team account is linked to this team.");
    expect(view.teams.map(t => t.teamId)).not.toContain("5"); // no jobs this week
    expect(d.publish).not.toHaveBeenCalled(); expect(d.sendSms).not.toHaveBeenCalled();
  });
  it("a team whose personal link cannot be prepared is skipped with that reason", async () => {
    const { d } = deps({ links: vi.fn(async (ids: number[]) => new Map(ids.map(id => [id, id === 11 ? null : LINK]))) });
    expect((await previewTeamReports(d, "2026-11-22")).teams.find(t => t.teamId === "1")!.issue).toBe("The team's personal link could not be prepared.");
  });
});

describe("publish, then send", () => {
  it("publishes the week's latest standings once, then texts each team the report built from the published results", async () => {
    const { d, rows, sent, calls } = deps();
    const preview = await previewTeamReports(d, "2026-11-22");
    const outcomes = await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["3", "1", "6", "2"], resend: false }, 7);
    expect(outcomes.map(o => [o.teamName, o.result])).toEqual([["Team Cielo", "skipped_no_phone"], ["Team Alba", "sent"], ["Team Faro", "skipped_no_phone"], ["Team Brisa", "sent"]]);
    expect(calls).toEqual(["publish", "send", "send"]);
    expect(d.publish).toHaveBeenCalledWith("2026-11-22", "pub-1", 7);
    expect(sent.map(s => s.to)).toEqual(["+13025550111", "+13025550112"]);
    expect(sent[0].content).toBe(preview.teams.find(t => t.teamId === "1")!.message); // preview identical to the text
    expect(sent[1].content).toBe(preview.teams.find(t => t.teamId === "2")!.message);
    expect(rows.map(r => [r.teamId, r.attempt, r.status, r.language])).toEqual([[1, 1, "sent", "en"], [2, 1, "sent", "es"]]);
    expect(rows[0].messageText).toBe(sent[0].content);
  });
  it("the texts use the PUBLISHED numbers (what the team page shows), even if the live numbers moved since the preview", async () => {
    const w = week();
    const { d, sent } = deps({}, w);
    d.publish = vi.fn(async () => { /* someone recorded one more complaint for Alba just before Send */ });
    d.readPublished = vi.fn(async () => ({ weekEnd: w.weekEnd, teams: w.teams, details: { ...w.details, "1": { complaintCases: 3 } } }));
    await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7);
    expect(sent[0].content).toContain("🧹 Cleaning complaints: 3");
  });
  it("if publishing fails, nothing is sent and nothing is recorded", async () => {
    const { d, rows, sent } = deps({ publish: vi.fn(async () => { throw new Error("WEEK_REVIEW_NOT_READY"); }) });
    await expect(sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1", "2"], resend: false }, 7)).rejects.toBeInstanceOf(ReportPublishError);
    expect(sent).toEqual([]); expect(rows).toEqual([]);
  });
  it("nothing to send (already sent or no phone): nothing is published or sent", async () => {
    const { d, sent } = deps();
    await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7);
    vi.mocked(d.publish).mockClear();
    const again = await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1", "3"], resend: false }, 8);
    expect(again.map(o => o.result)).toEqual(["skipped_already_sent", "skipped_no_phone"]);
    expect(d.publish).not.toHaveBeenCalled(); expect(sent).toHaveLength(1);
  });
  it("preliminary week: published and sent texts carry the preliminary notice", async () => {
    const { d, sent, rows } = deps({}, week({ provisionalReason: "The week's complaint analysis is not complete." }));
    await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1", "2"], resend: false }, 7);
    expect(sent[0].content.startsWith(PRELIMINARY_NOTICE.en + "\n🏆")).toBe(true);
    expect(sent[1].content.startsWith(PRELIMINARY_NOTICE.es + "\n🏆")).toBe(true);
    expect(rows.every(r => r.provisional)).toBe(true);
  });
});

describe("duplicate prevention (unchanged)", () => {
  it("sending again (or two clicks) skips teams already sent", async () => {
    const { d, sent } = deps();
    await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7);
    expect(await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1", "1"], resend: false }, 8)).toEqual([{ teamId: "1", teamName: "Team Alba", result: "skipped_already_sent", detail: null }]);
    expect(sent).toHaveLength(1);
  });
  it("two staff members at the same moment: only one send happens", async () => {
    const { d, sent } = deps();
    const [a, b] = await Promise.all([1, 2].map(agent => sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, agent)));
    expect([a[0].result, b[0].result].sort()).toEqual(["sent", "skipped_in_progress"]);
    expect(sent).toHaveLength(1);
  });
  it("intentional resend is a new attempt; two simultaneous resends send one text", async () => {
    const { d, rows, sent } = deps();
    await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7);
    const [a, b] = await Promise.all([1, 2].map(agent => sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: true, seenAttempts: 1 }, agent)));
    expect([a[0].result, b[0].result].sort()).toEqual(["sent", "skipped_in_progress"]);
    expect(rows.map(r => r.attempt)).toEqual([1, 2]); expect(sent).toHaveLength(2);
  });
  it("a failed send is recorded with its reason, does not stop the next team, and can simply be sent again", async () => {
    const { d, rows } = deps({ sendSms: vi.fn(async ({ to }) => to.endsWith("0111") ? { success: false, error: "OpenPhone API returned 500" } : { success: true, messageId: "SIM" }) });
    expect((await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1", "2"], resend: false }, 7)).map(o => o.result)).toEqual(["failed", "sent"]);
    expect(rows[0]).toMatchObject({ status: "failed", error: "OpenPhone API returned 500", sentAtMs: null });
    d.sendSms = vi.fn(async () => ({ success: true, messageId: "SIM-2" }));
    expect((await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7))[0].result).toBe("sent");
  });
  it("an interrupted send stays pending, then 'may have been sent', and is never resent automatically", async () => {
    const { d, rows, advance } = deps();
    d.store.finish = async () => { throw new Error("database went away"); };
    await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7);
    expect(rows[0].status).toBe("pending");
    advance(PENDING_UNCERTAIN_MS + 1000);
    expect((await previewTeamReports(d, "2026-11-22")).teams.find(t => t.teamId === "1")!.latest!.status).toBe("uncertain");
    expect((await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7))[0].result).toBe("skipped_pending");
  });
  it("a resend must name one team and the attempt that was seen", async () => {
    const { sendTeamReportsInputSchema } = await import("../shared/teamWeeklyReport");
    expect(sendTeamReportsInputSchema.safeParse({ weekStart: "2026-11-22", teamIds: ["1"], resend: true }).success).toBe(false);
    expect(sendTeamReportsInputSchema.safeParse({ weekStart: "2026-11-22", teamIds: ["1"], resend: true, seenAttempts: 1 }).success).toBe(true);
  });
});

describe("scope", () => {
  const source = readFileSync("server/teamWeeklyReports.ts", "utf8") + readFileSync("shared/teamWeeklyReport.ts", "utf8");
  it("no AI, no schedule; sent only on request; links use the existing cleaner magic-link table and login", () => {
    expect(source).not.toMatch(/anthropic|claudeAgentClient|runInitialLeadDraft|invokeLLM|cron|setInterval|setTimeout/i);
    const router = readFileSync("server/teamLeaderboardHistoryRouter.ts", "utf8");
    expect(router).toContain("sendTeamReports: admin.input(sendTeamReportsInputSchema).mutation(");
    expect(router).toContain("db.insert(cleanerMagicLinkTokens).values({ cleanerProfileId: id, token, expiresAt: new Date(now + 30 * 86_400_000), used: 0 })");
    expect(router).toContain("withTeamLeaderboardDestination(");
    expect(router).toContain("await service().publishFromRecords(agentId, { requestId: randomUUID(), weekStart: week, expectedPublicationId });");
    expect(readFileSync("server/internalCron.ts", "utf8")).not.toMatch(/teamWeeklyReports|sendTeamReports/);
  });
  it("migration 0084 is unchanged and still the last one (no new migration)", async () => {
    const { createHash } = await import("node:crypto");
    const manifest = JSON.parse(readFileSync("server/versioned-migrations/manifest.json", "utf8"));
    const entry = manifest.migrations.at(-1);
    expect(entry.id).toBe("0084_create_team_weekly_reports");
    expect(entry.sha256).toBe(createHash("sha256").update(readFileSync(`server/versioned-migrations/${entry.sqlFile}`, "utf8")).digest("hex"));
  });
});
