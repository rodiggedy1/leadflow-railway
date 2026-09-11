/**
 * trackerCron — sends customer portal SMS links at 8 AM on the job day.
 *
 * For each cleanerJob today that:
 *   - has a customerPhone
 *   - has NOT already had its day-of portal SMS sent (legacy trackerSmsSentAt
 *     remains the existing durable send marker to avoid duplicate messages)
 */

import { getDb } from "./db";
import { cleanerJobs } from "../drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { getOrCreateCustomerPortalMagicLink } from "./customerPortalService";

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function sendTrackerLinksForToday(dateOverride?: string): Promise<{
  sent: number;
  skipped: number;
  errors: string[];
  date: string;
}> {
  const db = await getDb();
  if (!db) return { sent: 0, skipped: 0, errors: ["DB unavailable"], date: "" };

  const targetDate = dateOverride ?? getTodayET();
  // Find all jobs for today that have not had the established day-of portal SMS.
  const jobs = await db
    .select()
    .from(cleanerJobs)
    .where(
      and(
        eq(cleanerJobs.jobDate, targetDate),
        isNull(cleanerJobs.trackerSmsSentAt)
      )
    );

  // Deduplicate by customerPhone — only send one link per customer per day
  // (a customer might have multiple cleaners assigned)
  const seenPhones = new Set<string>();
  const uniqueJobs = jobs.filter(job => {
    if (!job.customerPhone) return false;
    if (seenPhones.has(job.customerPhone)) return false;
    seenPhones.add(job.customerPhone);
    return true;
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const job of uniqueJobs) {
    if (!job.customerPhone) {
      skipped++;
      continue;
    }

    const portalUrl = await getOrCreateCustomerPortalMagicLink(db, {
      customerName: job.customerName ?? "Customer",
      customerPhone: job.customerPhone,
    });
    const firstName = job.customerName?.split(" ")[0] ?? "there";
    const message = `Hi ${firstName}! Your Maids in Black team is confirmed for today. Open My Home: ${portalUrl}`;

    const result = await sendSms({ to: job.customerPhone, content: message, fromNumberId: ENV.openPhoneCsNumberId }).catch(
      (err: unknown) => ({ success: false, error: String(err) })
    );

    if (result.success) {
      await db
        .update(cleanerJobs)
        .set({ trackerSmsSentAt: new Date() })
        .where(eq(cleanerJobs.id, job.id));
      sent++;
    } else {
      errors.push(`${job.customerPhone}: ${(result as { error?: string }).error ?? "unknown"}`);
    }
  }

  return { sent, skipped, errors, date: targetDate };
}
