/**
 * audienceHelpers.ts
 *
 * Single source of truth for "recently texted via campaign" logic.
 *
 * Both AudienceFreezer and AudiencePlanner must use these helpers
 * so the definition of "recently texted" can never drift between
 * the UI preview and the actual send/freeze path.
 */

import { and, eq, gt, isNotNull } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { smsCampaignRecipients } from "../../drizzle/schema";

/**
 * Returns a Set of E.164-normalized phone numbers that received a
 * campaign SMS within the last `cutoffMs` milliseconds.
 *
 * Used by AudienceFreezer at freeze/send time.
 */
export async function getRecentlyTextedPhones(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: MySql2Database<any>,
  cutoffMs: number
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ phone: smsCampaignRecipients.phoneNormalized })
    .from(smsCampaignRecipients)
    .where(
      and(
        eq(smsCampaignRecipients.status, "SENT"),
        isNotNull(smsCampaignRecipients.sentAt),
        gt(smsCampaignRecipients.sentAt, cutoffMs)
      )
    );

  const set = new Set<string>();
  for (const r of rows) {
    if (r.phone) set.add(r.phone);
  }
  return set;
}

/**
 * SQL fragment for the recent_campaign_sms CTE used inside raw SQL queries
 * in AudiencePlanner. Interpolate cutoffMs as a JS template literal.
 *
 * Usage inside a WITH block:
 *   `WITH ${RECENT_CAMPAIGN_SMS_CTE(cutoffMs)}, customer_view AS ( ... )`
 */
export function RECENT_CAMPAIGN_SMS_CTE(cutoffMs: number): string {
  return `recent_campaign_sms AS (
      SELECT phoneNormalized, MAX(sentAt) AS lastSentAt
      FROM sms_campaign_recipients
      WHERE status = 'SENT'
        AND sentAt > ${cutoffMs}
      GROUP BY phoneNormalized
    )`;
}
