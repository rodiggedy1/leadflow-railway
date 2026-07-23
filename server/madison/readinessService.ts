/**
 * readinessService.ts
 *
 * Canonical readiness computation — extracted from getReadinessSummary in aiConciergeRouter.ts.
 *
 * This is the SINGLE source of truth for readiness data.
 * Both the tRPC getReadinessSummary procedure and the Madison planner call this function.
 * Madison and the UI will NEVER disagree about readiness state.
 *
 * Usage:
 *   import { computeReadinessSummary } from "./madison/readinessService";
 *   const summary = await computeReadinessSummary(db, "2026-07-24");
 */

import {
  cleanerJobs,
  confirmationCalls,
  scheduleAssignments,
  stripeCustomers,
  paymentAuthorizations,
  readinessAcknowledgements,
} from "../../drizzle/schema";
import { matchConfirmationCallsToJobs } from "../confirmationMatchHelper";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { formatTimeET } from "../fieldMgmtEngine";
import { normalizePhoneLegacy } from "../utils/phone";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PrepRowStatus =
  | "on_hold"
  | "no_preauth"
  | "no_card"
  | "lf_on_hold"
  | "lf_card";

export interface JobRow {
  id: number;
  customerName: string | null;
  customerPhone: string | null;
  serviceDateTime: string | null;
  serviceType: string | null;
  cleanerProfileId: number | null;
  cleanerName: string | null;
  teamName: string | null;
  teamId: number | null;
  scheduleConfirmed: number | null;
  hasStripeCard: number | null;
  chargesOnHoldCents: number | null;
  paymentBrand: string | null;
  paymentLast4: string | null;
  requestedTeam: string | null;
  bookingStatus: string | null;
  customerNotes: string | null;
  // Derived
  jobTime: string | null;
  /** Issue types that have been acknowledged (active, not reversed) */
  acknowledgedIssues: string[];
}

export interface ReadinessSummary {
  date: string;
  overallPct: number;
  totalIssues: number;
  jobs: JobRow[];
  dimensions: {
    jobs: {
      total: number;
      issueCount: number;
      unassigned: Array<{ customerName: string; jobTime: string | null }>;
      doubleBooked: Array<{
        customerName: string;
        jobTime: string | null;
        cleanerName: string;
      }>;
    };
    teams: {
      total: number;
      confirmed: number;
      issueCount: number;
      rows: Array<{ name: string; confirmed: boolean; jobCount: number }>;
    };
    payments: {
      total: number;
      onHold: number;
      issueCount: number;
      rows: Array<{
        customerName: string;
        jobTime: string | null;
        serviceType: string | null;
        cardBrand: string | null;
        last4: string | null;
        status: PrepRowStatus;
        amountCents: number;
        customerPhone: string | null;
      }>;
    };
    confirmations: {
      total: number;
      confirmed: number;
      issueCount: number;
      rows: Array<{
        customerName: string;
        jobTime: string | null;
        serviceType: string | null;
        status: "confirmed" | "pending";
        outcomeLabel: string | null;
      }>;
    };
    clientRequests: {
      total: number;
      honored: number;
      issueCount: number;
      rows: Array<{
        customerName: string;
        jobTime: string | null;
        requestedTeam: string;
        assignedTeam: string | null;
        status: "honored" | "violated" | "unassigned";
      }>;
    };
  };
}

// ── Main function ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeReadinessSummary(db: any, targetDate: string): Promise<ReadinessSummary> {
  // ── 1. Fetch all non-cancelled/rescheduled jobs for the date ─────────
  const rawJobs = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      customerPhone: cleanerJobs.customerPhone,
      serviceDateTime: cleanerJobs.serviceDateTime,
      serviceType: cleanerJobs.serviceType,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      teamName: cleanerJobs.teamName,
      teamId: cleanerJobs.teamId,
      scheduleConfirmed: cleanerJobs.scheduleConfirmed,
      hasStripeCard: cleanerJobs.hasStripeCard,
      chargesOnHoldCents: cleanerJobs.chargesOnHoldCents,
      paymentBrand: cleanerJobs.paymentBrand,
      paymentLast4: cleanerJobs.paymentLast4,
      requestedTeam: cleanerJobs.requestedTeam,
      bookingStatus: cleanerJobs.bookingStatus,
      customerNotes: cleanerJobs.customerNotes,
    })
    .from(cleanerJobs)
    .where(
      and(
        eq(cleanerJobs.jobDate, targetDate),
        sql`${cleanerJobs.bookingStatus} NOT IN ('cancelled', 'rescheduled')`
      )
    );

  // Attach derived jobTime (acknowledgedIssues populated below after ack query)
  const jobs: JobRow[] = rawJobs.map((j: typeof rawJobs[0]) => ({
    ...j,
    jobTime: j.serviceDateTime ? formatTimeET(new Date(j.serviceDateTime)) : null,
    acknowledgedIssues: [] as string[],
  }));

  const jobIds = jobs.map((j) => j.id);

  // ── 1b. Load active acknowledgements for these jobs ───────────────────
  if (jobIds.length > 0) {
    const activeAcks = await db
      .select({
        jobId: readinessAcknowledgements.jobId,
        issueType: readinessAcknowledgements.issueType,
      })
      .from(readinessAcknowledgements)
      .where(
        and(
          inArray(readinessAcknowledgements.jobId, jobIds.map(String)),
          isNull(readinessAcknowledgements.reversedAt)
        )
      );
    // Build a map: jobId (number) -> issueType[]
    const acksByJobId = new Map<number, string[]>();
    for (const ack of activeAcks) {
      const jid = Number(ack.jobId);
      if (!acksByJobId.has(jid)) acksByJobId.set(jid, []);
      acksByJobId.get(jid)!.push(ack.issueType);
    }
    for (const job of jobs) {
      job.acknowledgedIssues = acksByJobId.get(job.id) ?? [];
    }
  }

  // ── 2. Fetch schedule assignments for client request check ────────────
  const assignments =
    jobIds.length > 0
      ? await db
          .select({
            cleanerJobId: scheduleAssignments.cleanerJobId,
            teamName: scheduleAssignments.teamName,
            isManual: scheduleAssignments.isManual,
          })
          .from(scheduleAssignments)
          .where(inArray(scheduleAssignments.cleanerJobId, jobIds))
      : [];
  const assignmentByJobId = new Map(
    assignments.map((a: typeof assignments[0]) => [a.cleanerJobId, a])
  );

  // ── 3. Fetch confirmation calls by date ──────────────────────────────
  const confCalls = await db
    .select({
      cleanerJobId: confirmationCalls.cleanerJobId,
      calledPhone: confirmationCalls.calledPhone,
      clientName: confirmationCalls.clientName,
      aiOutcome: confirmationCalls.aiOutcome,
      manualOutcome: confirmationCalls.manualOutcome,
      smsConfirmedAt: confirmationCalls.smsConfirmedAt,
      aiOutcomeLabel: confirmationCalls.aiOutcomeLabel,
      manualOutcomeLabel: confirmationCalls.manualOutcomeLabel,
    })
    .from(confirmationCalls)
    .where(eq(confirmationCalls.jobDate, targetDate));

  const confCallByJobId = matchConfirmationCallsToJobs(jobs, confCalls);

  // ── DIMENSION 1: Jobs Scheduled ───────────────────────────────────────
  const totalJobs = jobs.length;
  // A job is unassigned when it has no cleaner name AND no team name.
  // cleanerProfileId alone is not reliable — jobs can have a stale profile ID
  // with null name fields after a cleaner is removed from the assignment.
  const unassignedJobs = jobs.filter((j) => !j.cleanerName && !j.teamName);

  // Double-booking: same cleaner at same time
  const timeKeyMap = new Map<string, JobRow[]>();
  for (const j of jobs) {
    if (!j.cleanerProfileId || !j.serviceDateTime) continue;
    const key = `${j.cleanerProfileId}::${j.serviceDateTime}`;
    if (!timeKeyMap.has(key)) timeKeyMap.set(key, []);
    timeKeyMap.get(key)!.push(j);
  }
  const doubleBookedJobs: Array<{
    customerName: string;
    jobTime: string | null;
    cleanerName: string;
  }> = [];
  for (const group of timeKeyMap.values()) {
    if (group.length >= 2) {
      for (const j of group) {
        doubleBookedJobs.push({
          customerName: j.customerName ?? "Unknown",
          jobTime: j.jobTime,
          cleanerName: j.cleanerName ?? `Cleaner #${j.cleanerProfileId}`,
        });
      }
    }
  }
  const jobsIssueCount = unassignedJobs.length + doubleBookedJobs.length;

  // ── DIMENSION 2: Team Confirmations ──────────────────────────────────
  const teamMap = new Map<
    number,
    { name: string; confirmed: boolean; jobCount: number }
  >();
  for (const j of jobs) {
    if (!j.cleanerProfileId) continue;
    const existing = teamMap.get(j.cleanerProfileId);
    if (existing) {
      existing.jobCount++;
      if (!j.scheduleConfirmed) existing.confirmed = false;
    } else {
      teamMap.set(j.cleanerProfileId, {
        name: j.cleanerName ?? `Cleaner #${j.cleanerProfileId}`,
        confirmed: j.scheduleConfirmed === 1,
        jobCount: 1,
      });
    }
  }
  const teamRows = Array.from(teamMap.values());
  const teamsConfirmed = teamRows.filter((t) => t.confirmed).length;
  const teamsTotal = teamRows.length;
  const teamsIssueCount = teamRows.filter((t) => !t.confirmed).length;

  // ── DIMENSION 3: Payment Methods ─────────────────────────────────────
  const seenCustomers = new Set<string>();
  const paymentRows: Array<{
    customerName: string;
    jobTime: string | null;
    serviceType: string | null;
    cardBrand: string | null;
    last4: string | null;
    status: PrepRowStatus;
    amountCents: number;
    customerPhone: string | null;
  }> = [];

  for (const j of jobs) {
    const key = `${j.customerName}|${j.serviceDateTime}`;
    if (seenCustomers.has(key)) continue;
    seenCustomers.add(key);

    let status: PrepRowStatus;
    if ((j.chargesOnHoldCents ?? 0) > 0) {
      status = "on_hold";
    } else if (j.hasStripeCard) {
      status = "no_preauth";
    } else {
      status = "no_card";
    }

    paymentRows.push({
      customerName: j.customerName ?? "Unknown",
      jobTime: j.jobTime,
      serviceType: j.serviceType ?? null,
      cardBrand: j.paymentBrand ?? null,
      last4: j.paymentLast4 ?? null,
      status,
      amountCents: j.chargesOnHoldCents ?? 0,
      customerPhone: j.customerPhone ?? null,
    });
  }

  // LeadFlow fallback: check stripeCustomers + paymentAuthorizations
  if (paymentRows.some((r) => r.status === "no_card" || r.status === "no_preauth")) {
    const [lfCustomers, lfAuths] = await Promise.all([
      db
        .select({
          phone: stripeCustomers.phone,
          name: stripeCustomers.name,
          stripePaymentMethodId: stripeCustomers.stripePaymentMethodId,
          cardBrand: stripeCustomers.cardBrand,
          cardLast4: stripeCustomers.cardLast4,
        })
        .from(stripeCustomers),
      db
        .select({
          customerPhone: paymentAuthorizations.customerPhone,
          customerName: paymentAuthorizations.customerName,
          status: paymentAuthorizations.status,
          amountCents: paymentAuthorizations.amountCents,
        })
        .from(paymentAuthorizations)
        .where(
          and(
            eq(paymentAuthorizations.status, "authorized"),
            isNull(paymentAuthorizations.cancelledAt)
          )
        ),
    ]);

    const lfCustomerByPhone = new Map<string, (typeof lfCustomers)[0]>();
    const lfAuthByPhone = new Map<string, (typeof lfAuths)[0]>();
    const lfCustomerByName = new Map<string, (typeof lfCustomers)[0]>();
    const lfAuthByName = new Map<string, (typeof lfAuths)[0]>();

    for (const c of lfCustomers) {
      const norm = normalizePhoneLegacy(c.phone ?? "");
      if (norm) lfCustomerByPhone.set(norm, c);
      if (c.name) lfCustomerByName.set(c.name.toLowerCase().trim(), c);
    }
    for (const a of lfAuths) {
      const norm = normalizePhoneLegacy(a.customerPhone ?? "");
      if (norm) lfAuthByPhone.set(norm, a);
      if (a.customerName)
        lfAuthByName.set(a.customerName.toLowerCase().trim(), a);
    }

    for (const row of paymentRows) {
      if (row.status !== "no_card" && row.status !== "no_preauth") continue;
      const normPhone = normalizePhoneLegacy(row.customerPhone ?? "");
      let lfAuth = normPhone ? lfAuthByPhone.get(normPhone) : undefined;
      let lfCust = normPhone ? lfCustomerByPhone.get(normPhone) : undefined;
      if (!lfAuth && !lfCust) {
        const nameLower = row.customerName.toLowerCase().trim();
        lfAuth = lfAuthByName.get(nameLower);
        lfCust = lfCustomerByName.get(nameLower);
      }
      if (lfAuth) {
        row.status = "lf_on_hold";
        row.amountCents = lfAuth.amountCents;
        row.cardBrand = null;
        row.last4 = null;
      } else if (lfCust?.stripePaymentMethodId) {
        row.status = "lf_card";
        row.cardBrand = lfCust.cardBrand ?? null;
        row.last4 = lfCust.cardLast4 ?? null;
      }
    }
  }

  const paymentsOnHold = paymentRows.filter(
    (r) => r.status === "on_hold" || r.status === "lf_on_hold"
  ).length;
  const paymentsTotal = paymentRows.length;
  const paymentsIssueCount = paymentRows.filter(
    (r) => r.status !== "on_hold" && r.status !== "lf_on_hold"
  ).length;

  // ── DIMENSION 4: Customer Confirmations ──────────────────────────────
  const seenBookings = new Set<string>();
  const confirmationRows: Array<{
    customerName: string;
    jobTime: string | null;
    serviceType: string | null;
    status: "confirmed" | "pending";
    outcomeLabel: string | null;
  }> = [];

  for (const j of jobs) {
    const key = `${j.customerName}|${j.serviceDateTime}`;
    if (seenBookings.has(key)) continue;
    seenBookings.add(key);

    const call = confCallByJobId.get(j.id);
    const effectiveOutcome =
      call?.manualOutcome ?? call?.aiOutcome ?? null;
    const isConfirmed =
      effectiveOutcome === "confirmed" ||
      (call?.smsConfirmedAt ?? 0) > 0;
    const label =
      call?.manualOutcomeLabel ?? call?.aiOutcomeLabel ?? null;

    confirmationRows.push({
      customerName: j.customerName ?? "Unknown",
      jobTime: j.jobTime,
      serviceType: j.serviceType ?? null,
      status: isConfirmed ? "confirmed" : "pending",
      outcomeLabel: label,
    });
  }

  const confirmationsConfirmed = confirmationRows.filter(
    (r) => r.status === "confirmed"
  ).length;
  const confirmationsTotal = confirmationRows.length;
  const confirmationsIssueCount = confirmationRows.filter(
    (r) => r.status === "pending"
  ).length;

  // ── DIMENSION 5: Client Requests ─────────────────────────────────────
  const clientRequestRows: Array<{
    customerName: string;
    jobTime: string | null;
    requestedTeam: string;
    assignedTeam: string | null;
    status: "honored" | "violated" | "unassigned";
  }> = [];

  for (const j of jobs) {
    if (!j.requestedTeam) continue;
    const assignment = assignmentByJobId.get(j.id);

    if (assignment?.isManual === 2) {
      clientRequestRows.push({
        customerName: j.customerName ?? "Unknown",
        jobTime: j.jobTime,
        requestedTeam: j.requestedTeam,
        assignedTeam: assignment.teamName ?? null,
        status: "honored",
      });
      continue;
    }

    if (!j.cleanerProfileId || !assignment) {
      clientRequestRows.push({
        customerName: j.customerName ?? "Unknown",
        jobTime: j.jobTime,
        requestedTeam: j.requestedTeam,
        assignedTeam: null,
        status: "unassigned",
      });
      continue;
    }

    const reqNorm = j.requestedTeam.toLowerCase().trim();
    const assignedNorm = (assignment.teamName ?? "").toLowerCase().trim();
    const honored =
      reqNorm.includes(assignedNorm) || assignedNorm.includes(reqNorm);

    clientRequestRows.push({
      customerName: j.customerName ?? "Unknown",
      jobTime: j.jobTime,
      requestedTeam: j.requestedTeam,
      assignedTeam: assignment.teamName ?? null,
      status: honored ? "honored" : "violated",
    });
  }

  const clientRequestsHonored = clientRequestRows.filter(
    (r) => r.status === "honored"
  ).length;
  const clientRequestsTotal = clientRequestRows.length;
  const clientRequestsIssueCount = clientRequestRows.filter(
    (r) => r.status !== "honored"
  ).length;

  // ── Overall readiness % ───────────────────────────────────────────────
  const score = (
    dim: { total: number; issueCount: number },
    weight: number
  ) => {
    if (dim.total === 0) return weight;
    return weight * (1 - dim.issueCount / dim.total);
  };

  const overallPct = Math.round(
    score(
      { total: confirmationsTotal, issueCount: confirmationsIssueCount },
      30
    ) +
      score(
        { total: paymentsTotal, issueCount: paymentsIssueCount },
        25
      ) +
      score({ total: teamsTotal, issueCount: teamsIssueCount }, 20) +
      score(
        {
          total: clientRequestsTotal,
          issueCount: clientRequestsIssueCount,
        },
        15
      ) +
      score({ total: totalJobs, issueCount: jobsIssueCount }, 10)
  );

  const totalIssues =
    confirmationsIssueCount +
    paymentsIssueCount +
    teamsIssueCount +
    clientRequestsIssueCount +
    jobsIssueCount;

  return {
    date: targetDate,
    overallPct,
    totalIssues,
    jobs,
    dimensions: {
      jobs: {
        total: totalJobs,
        issueCount: jobsIssueCount,
        unassigned: unassignedJobs.map((j) => ({
          customerName: j.customerName ?? "Unknown",
          jobTime: j.jobTime,
        })),
        doubleBooked: doubleBookedJobs,
      },
      teams: {
        total: teamsTotal,
        confirmed: teamsConfirmed,
        issueCount: teamsIssueCount,
        rows: teamRows,
      },
      payments: {
        total: paymentsTotal,
        onHold: paymentsOnHold,
        issueCount: paymentsIssueCount,
        rows: paymentRows,
      },
      confirmations: {
        total: confirmationsTotal,
        confirmed: confirmationsConfirmed,
        issueCount: confirmationsIssueCount,
        rows: confirmationRows,
      },
      clientRequests: {
        total: clientRequestsTotal,
        honored: clientRequestsHonored,
        issueCount: clientRequestsIssueCount,
        rows: clientRequestRows,
      },
    },
  };
}
