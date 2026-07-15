/**
 * trackerCron — sends job tracker SMS links to customers at 8 AM on their job day.
 *
 * For each cleanerJob today that:
 *   - has a customerPhone
 *   - has NOT already had a tracker SMS sent (trackerSmsSentAt IS NULL)
 *
 * Generates a unique trackerToken, stores it, then texts the customer a link to
 * https://quote.maidinblack.com/track/{token}
 */

import { getDb } from "./db";
import { cleanerJobs } from "../drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

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
  const baseUrl = "https://quote.maidinblack.com";

  // Find all jobs for today that haven't had a tracker SMS sent yet
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

    // Generate token if not already set
    let token = job.trackerToken;
    if (!token) {
      token = generateToken();
      await db
        .update(cleanerJobs)
        .set({ trackerToken: token })
        .where(eq(cleanerJobs.id, job.id));
    }

    const trackerUrl = `${baseUrl}/track/${token}`;
    const firstName = job.customerName?.split(" ")[0] ?? "there";
    const message = `Hi ${firstName}! Your Maids in Black team is confirmed for today. Track your clean in real time: ${trackerUrl} 🧹`;

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
