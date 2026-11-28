/** Phase 3: the weekly report text each cleaning team receives by SMS. Owner-approved templates (2026-11-28), kept
 * word for word, with their emojis, capitalization and line breaks; only the bracketed values are filled in. Pure and
 * offline: built from the published standings (the same numbers the team sees through its link). No AI. */
import { z } from "zod";
import { scoreLabel } from "./teamLeaderboard";

export type ReportLanguage = "en" | "es";
export type ReportMetric = { successful: number; eligible: number };
export type TeamReportFacts = {
  teamName: string; weekStart: string; weekEnd: string;
  /** null = not ranked (fewer than the minimum jobs or no score): shown as "Not ranked", never an invented position. */
  rank: number | null; rankedTeams: number; score: number | null;
  completedJobs: number; ratings: ReportMetric; eta: ReportMetric; photos: ReportMetric;
  /** The leaderboard's own cleaning-complaint count. */
  complaintCount: number;
  /** The team's personal magic link (existing 30-day cleaner login, opening its team leaderboard). */
  link: string;
  provisional: boolean;
};

const MONTHS = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] };
const parts = (date: string) => { const d = new Date(`${date}T12:00:00Z`); return { m: d.getUTCMonth(), day: d.getUTCDate(), y: d.getUTCFullYear() }; };
/** "Nov 22–28, 2026" / "22–28 nov 2026" (and across months or years). */
export function reportWeekRange(start: string, end: string, language: ReportLanguage): string {
  const a = parts(start), b = parts(end), M = MONTHS[language];
  if (language === "es") return a.y !== b.y ? `${a.day} ${M[a.m]} ${a.y}–${b.day} ${M[b.m]} ${b.y}` : a.m === b.m ? `${a.day}–${b.day} ${M[b.m]} ${b.y}` : `${a.day} ${M[a.m]}–${b.day} ${M[b.m]} ${b.y}`;
  return a.y !== b.y ? `${M[a.m]} ${a.day}, ${a.y}–${M[b.m]} ${b.day}, ${b.y}` : a.m === b.m ? `${M[a.m]} ${a.day}–${b.day}, ${b.y}` : `${M[a.m]} ${a.day}–${M[b.m]} ${b.day}, ${b.y}`;
}
/** Whole-number percentage, or "N/A" when there was nothing to measure (never an invented 0% or 100%). */
const percent = (metric: ReportMetric) => metric.eligible > 0 ? `${Math.round(metric.successful / metric.eligible * 100)}%` : "N/A";
/** Team names are shown as plain text: Markdown formatting characters are removed. */
export const plainText = (value: string) => value.replace(/[*_`~#>|\\[\]]/g, "").replace(/\s+/g, " ").trim();

/** Preliminary notice (only while the week's analysis is incomplete), placed above the approved template. */
export const PRELIMINARY_NOTICE: Record<ReportLanguage, string> = {
  en: "PRELIMINARY RESULTS: This week's review is not finished yet, so these numbers may change. Final rankings determine job assignment priority.",
  es: "RESULTADOS PRELIMINARES: La revisión de esta semana aún no ha terminado, por lo que estos números pueden cambiar. La clasificación final determina la prioridad en la asignación de trabajos.",
};

/** The SMS text: the approved template with its values filled in. */
export function buildTeamReportMessage(facts: TeamReportFacts, language: ReportLanguage): string {
  const team = plainText(facts.teamName), week = reportWeekRange(facts.weekStart, facts.weekEnd, language);
  const score = facts.score === null ? "N/A" : `${scoreLabel(facts.score)}/100`;
  const lines = language === "es" ? [
    "🏆 MAIDS IN BLACK — REPORTE SEMANAL DE DESEMPEÑO",
    `Equipo: ${team}`,
    `Semana: ${week}`,
    facts.rank === null ? "Tu posición: Sin clasificar" : `Tu posición: #${facts.rank} de ${facts.rankedTeams} equipos`,
    `Puntuación general: ${score}`,
    `🏠 Limpiezas completadas: ${facts.completedJobs}`,
    `⭐ Reseñas de cinco estrellas: ${facts.ratings.successful}`,
    `🧹 Quejas sobre la limpieza: ${facts.complaintCount}`,
    `📍 Cumplimiento de envío de ETA: ${percent(facts.eta)}`,
    `📸 Cumplimiento de envío de fotos: ${percent(facts.photos)}`,
    "IMPORTANTE — ASIGNACIÓN DE TRABAJOS PARA LA PRÓXIMA SEMANA",
    "Estas clasificaciones determinan el orden en que se asignarán los trabajos durante la próxima semana. Los equipos mejor clasificados tendrán prioridad, comenzando con el equipo número uno y siguiendo el orden de la clasificación.",
    "Un mejor desempeño significa mayor prioridad en la asignación de trabajos y más oportunidades de generar ingresos.",
    "Consulta tu reporte completo, las quejas de clientes, las áreas que debes mejorar y el perfil de tu equipo utilizando tu enlace personal:",
    facts.link,
    "¡Gracias por tu esfuerzo! Trabajemos juntos para tener una semana aún mejor.",
    "— Maids in Black",
  ] : [
    "🏆 MAIDS IN BLACK — WEEKLY PERFORMANCE REPORT",
    `Team: ${team}`,
    `Week: ${week}`,
    facts.rank === null ? "Your ranking: Not ranked" : `Your ranking: #${facts.rank} of ${facts.rankedTeams} teams`,
    `Overall score: ${score}`,
    `🏠 Completed cleanings: ${facts.completedJobs}`,
    `⭐ Five-star reviews: ${facts.ratings.successful}`,
    `🧹 Cleaning complaints: ${facts.complaintCount}`,
    `📍 ETA compliance: ${percent(facts.eta)}`,
    `📸 Photo compliance: ${percent(facts.photos)}`,
    "IMPORTANT — NEXT WEEK'S JOB ASSIGNMENTS",
    "These rankings determine the order in which jobs are assigned for the upcoming week. The highest-ranked teams will receive priority, starting with the #1 ranked team and working down the list.",
    "Better performance means higher priority for job assignments and more earning opportunities.",
    "View your full performance report, customer complaints, areas for improvement and team profile using your personal link below:",
    facts.link,
    "Thank you for your hard work. Let's make next week even better!",
    "— Maids in Black",
  ];
  return (facts.provisional ? [PRELIMINARY_NOTICE[language], ...lines] : lines).join("\n");
}

/** A team's preferred language: Spanish only when the team account says so; everything else is English. */
export const reportLanguage = (value: string | null | undefined): ReportLanguage => String(value ?? "").trim().toLowerCase().startsWith("es") ? "es" : "en";

export const TEAM_REPORT_STATUSES = ["pending", "sent", "failed"] as const;
export type TeamReportStatus = typeof TEAM_REPORT_STATUSES[number];
export const sendTeamReportsInputSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  teamIds: z.array(z.string().regex(/^[1-9]\d*$/)).min(1).max(100),
  /** Intentional resend of a report that was already sent (or may have been sent). Never set by "Send all". */
  resend: z.boolean(),
  /** With resend: how many attempts the person saw for that one team. If someone else resent it meanwhile, nothing is sent. */
  seenAttempts: z.number().int().min(0).max(1000).optional(),
}).strict().refine(input => !input.resend || (input.teamIds.length === 1 && input.seenAttempts !== undefined),
  { message: "A resend is for one team and must say which attempt was seen." });
