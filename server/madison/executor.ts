/**
 * executor.ts
 *
 * Executes a ReadinessPlan against the canonical readiness service.
 * All filtering is deterministic — no LLM involvement.
 * Produces a ReadinessProjection ready for the response LLM.
 */

import { computeReadinessSummary, type JobRow } from "./readinessService";
import {
  type ReadinessProjection,
  type JobReadinessRow,
  MadisonError,
} from "./types";
import { type ReadinessQueryPlan } from "./schema/readinessPlanSchema";

const EXECUTION_TIMEOUT_MS = 15_000;
const MAX_JOBS_TO_LLM = 40; // hard cap on jobs sent to response LLM
const MAX_NOTE_LENGTH = 200; // truncate customerNotes deterministically

// ── Time filter helpers ───────────────────────────────────────────────────────

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

function jobMinutes(jobTime: string | null): number | null {
  if (!jobTime) return null;
  // jobTime is like "9:00 AM" or "2:30 PM"
  const m = jobTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function timeOfDayMinutes(tod: "morning" | "afternoon" | "evening"): {
  start: number;
  end: number;
} {
  if (tod === "morning") return { start: 0, end: 12 * 60 - 1 };
  if (tod === "afternoon") return { start: 12 * 60, end: 17 * 60 - 1 };
  return { start: 17 * 60, end: 24 * 60 - 1 };
}

// ── Flag calculation ──────────────────────────────────────────────────────────

function computeFlags(
  job: JobRow,
  confirmationStatus: "confirmed" | "pending",
  paymentRawStatus: string,
  isDoubleBooked: boolean
): JobReadinessRow["flags"] {
  const flags: JobReadinessRow["flags"] = [];
  if (!job.cleanerProfileId) flags.push("unassigned");
  if (confirmationStatus === "pending") flags.push("unconfirmed");
  if (paymentRawStatus === "no_card") flags.push("no_payment");
  if (isDoubleBooked) flags.push("double_booked");
  return flags;
}

// ── Payment status mapping ────────────────────────────────────────────────────

function mapPaymentStatus(rawStatus: string): {
  cardOnFile: boolean;
  authorizationStatus: JobReadinessRow["payment"]["authorizationStatus"];
} {
  switch (rawStatus) {
    case "on_hold":
    case "lf_on_hold":
      return { cardOnFile: true, authorizationStatus: "authorized" };
    case "no_preauth":
    case "lf_card":
      return { cardOnFile: true, authorizationStatus: "not_attempted" };
    case "no_card":
      return { cardOnFile: false, authorizationStatus: "not_attempted" };
    default:
      return { cardOnFile: false, authorizationStatus: "unknown" };
  }
}

// ── Main executor ─────────────────────────────────────────────────────────────

export async function executePlan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  plan: ReadinessQueryPlan
): Promise<ReadinessProjection> {
  // Enforce execution timeout
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new MadisonError(
            "EXECUTION_TIMEOUT",
            `Execution exceeded ${EXECUTION_TIMEOUT_MS}ms`
          )
        ),
      EXECUTION_TIMEOUT_MS
    )
  );

  return Promise.race([_execute(db, plan), timeoutPromise]);
}

async function _execute(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  plan: ReadinessQueryPlan
): Promise<ReadinessProjection> {
  // Use startDate only (single-day readiness)
  const targetDate = plan.dateScope.startDate;

  let summary;
  try {
    summary = await computeReadinessSummary(db, targetDate);
  } catch (err) {
    throw new MadisonError(
      "EXECUTION_ERROR",
      `readinessService failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { jobs, dimensions } = summary;

  // Build lookup maps from canonical dimension data
  const confirmationByKey = new Map<string, "confirmed" | "pending">();
  for (const row of dimensions.confirmations.rows) {
    confirmationByKey.set(
      `${row.customerName}|${row.jobTime}`,
      row.status
    );
  }

  const paymentByName = new Map<string, string>();
  for (const row of dimensions.payments.rows) {
    paymentByName.set(row.customerName, row.status);
  }

  const doubleBookedKeys = new Set<string>();
  for (const db_ of dimensions.jobs.doubleBooked) {
    doubleBookedKeys.add(`${db_.customerName}|${db_.jobTime}`);
  }

  // Build JobReadinessRow for every job
  let jobRows: JobReadinessRow[] = jobs.map((j) => {
    const confKey = `${j.customerName ?? "Unknown"}|${j.jobTime}`;
    const confirmationStatus = confirmationByKey.get(confKey) ?? "pending";
    const paymentRawStatus =
      paymentByName.get(j.customerName ?? "") ?? "no_card";
    const isDoubleBooked = doubleBookedKeys.has(confKey);

    const { cardOnFile, authorizationStatus } =
      mapPaymentStatus(paymentRawStatus);

    const rawNotes = j.customerNotes ?? null;
    const truncatedNotes =
      rawNotes && rawNotes.length > MAX_NOTE_LENGTH
        ? rawNotes.slice(0, MAX_NOTE_LENGTH) + "…"
        : rawNotes;

    return {
      jobId: j.id,
      customerName: j.customerName ?? "Unknown",
      jobTime: j.jobTime,
      serviceType: j.serviceType ?? null,
      teamName: j.teamName ?? null,
      assignment: {
        status: j.cleanerProfileId ? "assigned" : "unassigned",
        cleanerName: j.cleanerName ?? null,
      },
      confirmation: {
        status: confirmationStatus,
        outcomeLabel: null, // populated below if needed
      },
      payment: {
        cardOnFile,
        authorizationStatus,
        rawStatus: paymentRawStatus,
      },
      access: {
        status: rawNotes
          ? "notes_present"
          : rawNotes === null
          ? "unknown"
          : "no_notes",
        notes: truncatedNotes,
      },
      flags: computeFlags(
        j,
        confirmationStatus,
        paymentRawStatus,
        isDoubleBooked
      ),
      acknowledgedIssues: j.acknowledgedIssues,
    };
  });

  // Populate outcomeLabel from confirmation rows
  const outcomeLabelByKey = new Map<string, string | null>();
  for (const row of dimensions.confirmations.rows) {
    outcomeLabelByKey.set(`${row.customerName}|${row.jobTime}`, row.outcomeLabel);
  }
  for (const jr of jobRows) {
    const key = `${jr.customerName}|${jr.jobTime}`;
    jr.confirmation.outcomeLabel = outcomeLabelByKey.get(key) ?? null;
  }

  // ── Diagnostic logging ─────────────────────────────────────────────────
  console.log(`[Madison] executor: date=${targetDate} totalJobs=${jobs.length} unassigned=${jobs.filter(j => !j.cleanerProfileId).length} filters=${JSON.stringify(plan.filters)} sort=${plan.sort}`);

  // ── Apply filters deterministically ──────────────────────────────────
  const filters = plan.filters ?? {};
  let filterDescription: string | null = null;

  // Time of day filter
  if (filters.timeOfDay) {
    const { start, end } = timeOfDayMinutes(filters.timeOfDay);
    jobRows = jobRows.filter((j) => {
      const mins = jobMinutes(j.jobTime);
      if (mins === null) return false;
      return mins >= start && mins <= end;
    });
    filterDescription = `${filters.timeOfDay} jobs only`;
  }

  // Specific time window filter
  if (filters.startTime && filters.endTime) {
    const start = parseHHMM(filters.startTime);
    const end = parseHHMM(filters.endTime);
    jobRows = jobRows.filter((j) => {
      const mins = jobMinutes(j.jobTime);
      if (mins === null) return false;
      return mins >= start && mins <= end;
    });
    filterDescription = `${filters.startTime}–${filters.endTime} jobs only`;
  }

  // Exact time filter (e.g. "8:30 AM jobs" → exactTime: "08:30")
  if (filters.exactTime) {
    const exactMins = parseHHMM(filters.exactTime);
    jobRows = jobRows.filter((j) => {
      const mins = jobMinutes(j.jobTime);
      if (mins === null) return false;
      return mins === exactMins;
    });
    filterDescription = `${filters.exactTime} jobs only`;
  }

  // Dimension filter
  if (filters.dimension && filters.dimension !== "all") {
    switch (filters.dimension) {
      case "assignment":
        jobRows = jobRows.filter((j) => j.assignment.status === "unassigned");
        filterDescription = "unassigned jobs";
        break;
      case "confirmation":
        jobRows = jobRows.filter(
          (j) => j.confirmation.status === "pending"
        );
        filterDescription = "unconfirmed jobs";
        break;
      case "payment":
        jobRows = jobRows.filter((j) => !j.payment.cardOnFile);
        filterDescription = "jobs with payment issues";
        break;
      case "access":
        jobRows = jobRows.filter(
          (j) => j.access.status !== "notes_present"
        );
        filterDescription = "jobs with no access notes";
        break;
      case "schedule":
        jobRows = jobRows.filter((j) =>
          j.flags.includes("double_booked")
        );
        filterDescription = "schedule conflicts";
        break;
    }
  }

  // Only needs attention filter
  if (filters.onlyNeedsAttention) {
    jobRows = jobRows.filter((j) => j.flags.length > 0);
    filterDescription = filterDescription
      ? `${filterDescription} needing attention`
      : "jobs needing attention";
  }

  // Minimum flag count filter
  if (filters.minimumFlagCount) {
    const minFlags = filters.minimumFlagCount;
    jobRows = jobRows.filter((j) => j.flags.length >= minFlags);
    filterDescription = filterDescription
      ? `${filterDescription} (${minFlags}+ issues)`
      : `jobs with ${minFlags}+ issues`;
  }

  // Sort
  if (plan.sort === "risk") {
    jobRows.sort((a, b) => b.flags.length - a.flags.length);
  } else {
    // Default: service_time
    jobRows.sort((a, b) => {
      const am = jobMinutes(a.jobTime) ?? 9999;
      const bm = jobMinutes(b.jobTime) ?? 9999;
      return am - bm;
    });
  }

  // Hard cap for LLM
  const cappedJobs = jobRows.slice(0, MAX_JOBS_TO_LLM);

  // Compute projection summary from filtered jobs
  const projSummary = {
    unassigned: cappedJobs.filter((j) => j.flags.includes("unassigned"))
      .length,
    unconfirmed: cappedJobs.filter((j) => j.flags.includes("unconfirmed"))
      .length,
    noPayment: cappedJobs.filter((j) => j.flags.includes("no_payment"))
      .length,
    atRisk: cappedJobs.filter((j) => j.flags.length >= 2).length,
    acknowledged: cappedJobs.filter((j) => j.acknowledgedIssues.length > 0).length,
  };

  return {
    date: targetDate,
    totalJobs: summary.dimensions.jobs.total,
    filteredJobs: cappedJobs.length,
    appliedFilter: filterDescription,
    jobs: cappedJobs,
    summary: projSummary,
    overallPct: summary.overallPct,
    totalIssues: summary.totalIssues,
  };
}
