/** Phase 3 (2026-11-28): the weekly report text each cleaning team receives by SMS. Pure and offline: built only from
 * the leaderboard's existing calculated standings and saved quality records. No AI. No customer names, phone numbers,
 * addresses or quotes: a cleaning complaint is shown only as its day and the areas it mentions. */
import { z } from "zod";

export type ReportLanguage = "en" | "es";
export type ReportMetric = { successful: number; eligible: number };
export type TeamReportFacts = {
  teamName: string; weekStart: string; weekEnd: string;
  rank: number | null; rankedTeams: number; unranked: boolean; score: number | null;
  completedJobs: number; ratings: ReportMetric; eta: ReportMetric; photos: ReportMetric;
  /** The leaderboard's own count (the number shown in the standings). */
  complaintCount: number;
  /** The counted complaints, for the short breakdown (day and areas only). */
  complaints: Array<{ date: string | null; areas: string[] }>;
  provisional: boolean;
};

/** Areas of the home a cleaning complaint mentions (English and Spanish words). The first match per area wins. */
const AREAS: Array<{ en: string; es: string; pattern: RegExp }> = [
  { en: "kitchen", es: "cocina", pattern: /\b(kitchen|cocina|oven|horno|stove|estufa|fridge|refrigerator|nevera|microwave|microondas|cabinet|counter(top)?s?)\b/i },
  { en: "bathroom", es: "baño", pattern: /\b(bath(room)?s?|baños?|toilets?|inodoro|shower|ducha|tub|bañera|sinks?|lavabo|mirrors?|espejo)\b/i },
  { en: "floors", es: "pisos", pattern: /\b(floors?|pisos?|suelos?|mop(ped|ping)?|carpets?|alfombra|rugs?|vacuum(ed|ing)?|aspirad)/i },
  { en: "dusting", es: "polvo", pattern: /\b(dust(y|ing)?|polvo|baseboards?|z[oó]calos?|blinds|persianas|ceiling fan|ventilador)\b/i },
  { en: "bedrooms", es: "habitaciones", pattern: /\b(bed(room)?s?|habitaci[oó]n(es)?|dormitorios?|sheets|s[aá]banas)\b/i },
  { en: "windows", es: "ventanas", pattern: /\b(windows?|ventanas?|glass|vidrios?|window ?sills?)\b/i },
  { en: "missed areas", es: "áreas olvidadas", pattern: /\b(missed|skipped|forgot|left (out|undone)|not done|incomplete|unfinished|olvidaron|no limpiaron)\b/i },
  { en: "damage", es: "daños", pattern: /\b(damag(e|ed)|broke(n)?|scratch(ed)?|crack(ed)?|roto|rompieron|rayado|da[ñn]o)\b/i },
];
/** Area labels for one complaint, from its saved text. Never returns the text itself. */
export function complaintAreas(text: string | null | undefined): string[] {
  const value = text ?? "";
  return AREAS.filter(area => area.pattern.test(value)).map(area => area.en).slice(0, 3);
}
const areaLabel = (area: string, language: ReportLanguage) => language === "es" ? AREAS.find(a => a.en === area)?.es ?? area : area;

const MONTHS = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] };
const DAYS = { en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], es: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] };
const dayParts = (date: string) => { const d = new Date(`${date}T12:00:00Z`); return { wd: d.getUTCDay(), m: d.getUTCMonth(), day: d.getUTCDate() }; };
const shortDay = (date: string, language: ReportLanguage) => {
  const { wd, m, day } = dayParts(date);
  return language === "es" ? `${DAYS.es[wd]} ${day} ${MONTHS.es[m]}` : `${DAYS.en[wd]} ${MONTHS.en[m]} ${day}`;
};
const range = (start: string, end: string, language: ReportLanguage) => {
  const a = dayParts(start), b = dayParts(end);
  if (language === "es") return a.m === b.m ? `${a.day}–${b.day} ${MONTHS.es[b.m]}` : `${a.day} ${MONTHS.es[a.m]}–${b.day} ${MONTHS.es[b.m]}`;
  return a.m === b.m ? `${MONTHS.en[a.m]} ${a.day}–${b.day}` : `${MONTHS.en[a.m]} ${a.day}–${MONTHS.en[b.m]} ${b.day}`;
};
const ofText = (metric: ReportMetric, language: ReportLanguage) => metric.eligible > 0
  ? `${metric.successful} ${language === "es" ? "de" : "of"} ${metric.eligible} (${Math.round(metric.successful / metric.eligible * 100)}%)`
  : language === "es" ? "sin datos" : "none this week";

/** Rule-based "areas to improve" (no AI). */
export function improvementAreas(facts: TeamReportFacts, language: ReportLanguage): string[] {
  const es = language === "es", out: string[] = [];
  if (facts.complaintCount > 0) {
    const areas = Array.from(new Set(facts.complaints.flatMap(c => c.areas))).slice(0, 3).map(a => areaLabel(a, language));
    out.push(es ? `Calidad de la limpieza${areas.length ? ` (${areas.join(", ")})` : ""}: revisen cada área antes de salir.`
      : `Cleaning quality${areas.length ? ` (${areas.join(", ")})` : ""}: do a final walk-through before leaving.`);
  }
  if (facts.eta.eligible > 0 && facts.eta.successful < facts.eta.eligible)
    out.push(es ? "Envíen el mensaje de llegada (ETA) antes de cada trabajo." : "Send the ETA text before every job.");
  if (facts.photos.eligible > 0 && facts.photos.successful < facts.photos.eligible)
    out.push(es ? "Suban las fotos de cada trabajo." : "Upload photos for every job.");
  if (facts.ratings.eligible > 0 && facts.ratings.successful / facts.ratings.eligible < 0.9)
    out.push(es ? "Busquen más calificaciones de 5 estrellas." : "Aim for more five-star ratings.");
  return out;
}

/** The SMS text. Kept short (well under the 1,600-character SMS limit). */
export function buildTeamReportMessage(facts: TeamReportFacts, language: ReportLanguage): string {
  const es = language === "es";
  const lines: string[] = [];
  if (facts.provisional) lines.push(es
    ? "PRELIMINAR: la revisión de esta semana no ha terminado; los números pueden cambiar."
    : "PRELIMINARY: this week's review isn't finished yet, so these numbers may change.");
  lines.push(es ? `Maids in Black: informe semanal de ${facts.teamName} (${range(facts.weekStart, facts.weekEnd, "es")})`
    : `Maids in Black weekly report for ${facts.teamName} (${range(facts.weekStart, facts.weekEnd, "en")})`);
  lines.push(facts.rank !== null
    ? es ? `Posición: #${facts.rank} de ${facts.rankedTeams}` : `Ranking: #${facts.rank} of ${facts.rankedTeams}`
    : es ? "Posición: sin clasificar (menos de 3 trabajos)" : "Ranking: not ranked (fewer than 3 jobs)");
  lines.push(es ? `Puntuación: ${facts.score === null ? "—" : `${facts.score.toFixed(1)} / 100`}` : `Overall score: ${facts.score === null ? "—" : `${facts.score.toFixed(1)} / 100`}`);
  lines.push(es ? `Trabajos completados: ${facts.completedJobs}` : `Completed jobs: ${facts.completedJobs}`);
  lines.push(es ? `Calificaciones de 5 estrellas: ${ofText(facts.ratings, language)}` : `Five-star ratings: ${ofText(facts.ratings, language)}`);
  const shown = facts.complaints.slice(0, 3).map(c => {
    const areas = c.areas.length ? c.areas.map(a => areaLabel(a, language)).join(", ") : es ? "calidad de limpieza" : "cleaning quality";
    return c.date ? `${shortDay(c.date, language)}: ${areas}` : areas;
  });
  const more = facts.complaintCount - shown.length;
  lines.push(es ? `Quejas de limpieza: ${facts.complaintCount}${shown.length ? ` (${shown.join("; ")}${more > 0 ? `; ${more} más` : ""})` : ""}`
    : `Cleaning complaints: ${facts.complaintCount}${shown.length ? ` (${shown.join("; ")}${more > 0 ? `; ${more} more` : ""})` : ""}`);
  lines.push(es ? `ETA enviado: ${ofText(facts.eta, language)}` : `ETA texts sent: ${ofText(facts.eta, language)}`);
  lines.push(es ? `Fotos: ${ofText(facts.photos, language)}` : `Photos: ${ofText(facts.photos, language)}`);
  const improve = improvementAreas(facts, language);
  lines.push(improve.length ? `${es ? "Para mejorar" : "To improve"}: ${improve.join(" ")}` : es ? "¡Excelente semana, sigan así!" : "Great week, keep it up!");
  lines.push(es ? "¡Gracias por su trabajo!" : "Thank you for your hard work!");
  return lines.join("\n");
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
