/**
 * confirmationMatchHelper.ts
 *
 * Single source of truth for matching confirmation_calls rows to cleaner_jobs rows.
 *
 * Matching order (most reliable → least reliable):
 *   1. cleanerJobId  — exact FK match (fails when job is deleted+re-inserted with new ID)
 *   2. normalized phone number — matches even after job ID changes
 *   3. normalized customer name — last-resort fallback
 *
 * Logs a warning whenever phone/name fallback is used so we can track how often
 * jobs are being recreated with new IDs.
 */

export type ConfCallRow = {
  cleanerJobId: number;
  calledPhone: string | null;
  clientName: string | null;
  aiOutcome: string | null;
  manualOutcome: string | null;
  smsConfirmedAt: number | null;
  aiOutcomeLabel: string | null;
  manualOutcomeLabel: string | null;
  smsReplies?: Array<{ text: string; receivedAt: number }> | null;
};

export type JobRow = {
  id: number;
  customerName: string | null;
  customerPhone: string | null;
};

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.trim().toLowerCase();
}

/**
 * Build a Map<jobId, ConfCallRow> from a list of jobs and confirmation call rows.
 *
 * Both arrays should already be pre-fetched for the same date.
 * The function does NOT query the database.
 *
 * @param jobs        - Array of job rows (must have id, customerName, customerPhone)
 * @param confCalls   - Array of confirmation_calls rows for the same date
 * @returns           - Map from job.id to the best matching ConfCallRow
 */
export function matchConfirmationCallsToJobs<
  J extends JobRow,
  C extends ConfCallRow,
>(jobs: J[], confCalls: C[]): Map<number, C> {
  // Build lookup indexes on the confirmation calls side
  const byJobId = new Map<number, C>();
  const byPhone = new Map<string, C>();
  const byName = new Map<string, C>();

  for (const c of confCalls) {
    // Index by cleanerJobId (primary)
    if (!byJobId.has(c.cleanerJobId)) {
      byJobId.set(c.cleanerJobId, c);
    }
    // Index by normalized phone (secondary) — keep most recent (first in desc order)
    const phone = normalizePhone(c.calledPhone);
    if (phone && !byPhone.has(phone)) {
      byPhone.set(phone, c);
    }
    // Index by normalized name (tertiary fallback)
    const name = normalizeName(c.clientName);
    if (name && !byName.has(name)) {
      byName.set(name, c);
    }
  }

  const result = new Map<number, C>();

  for (const job of jobs) {
    // Step 1: exact cleanerJobId match
    const byId = byJobId.get(job.id);
    if (byId) {
      result.set(job.id, byId);
      continue;
    }

    // Step 2: phone fallback
    const phone = normalizePhone(job.customerPhone);
    const byPhoneMatch = phone ? byPhone.get(phone) : undefined;
    if (byPhoneMatch) {
      console.warn(
        `[ConfirmMatch] job ${job.id} (${job.customerName}) matched by PHONE — ` +
        `confCall.cleanerJobId=${byPhoneMatch.cleanerJobId}. Job may have been recreated with new ID.`
      );
      result.set(job.id, byPhoneMatch);
      continue;
    }

    // Step 3: name fallback
    const name = normalizeName(job.customerName);
    const byNameMatch = name ? byName.get(name) : undefined;
    if (byNameMatch) {
      console.warn(
        `[ConfirmMatch] job ${job.id} (${job.customerName}) matched by NAME — ` +
        `confCall.cleanerJobId=${byNameMatch.cleanerJobId}. Job may have been recreated with new ID.`
      );
      result.set(job.id, byNameMatch);
      continue;
    }

    // No match found — job has no confirmation call row
  }

  return result;
}
