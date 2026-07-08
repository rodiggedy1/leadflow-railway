/**
 * schemaCheck.ts
 *
 * Startup schema compatibility guard for SMS campaign tables.
 *
 * Run this once before the server starts accepting requests.  If any required
 * column is missing the process exits with a clear, actionable error message
 * instead of letting MySQL throw a cryptic insert error mid-request.
 *
 * Usage (in server/_core/index.ts, inside startServer(), before app.listen):
 *   import { checkSmsCampaignSchema } from "../sms/schemaCheck";
 *   await checkSmsCampaignSchema();
 */

import { getDb } from "../db";
import { sql } from "drizzle-orm";

interface ColumnRow {
  COLUMN_NAME: string;
}

/**
 * Required columns per table.  Add entries here whenever a migration adds
 * columns that the application code depends on.
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  sms_campaign_recipients: [
    // Original columns (sanity check)
    "id",
    "campaignId",
    "customerId",
    "phone",
    "status",
    // Snapshot columns added in migration 0083
    "snapshotFirstName",
    "snapshotLastService",
    "snapshotLastPrice",
    "snapshotCity",
    "snapshotFrequency",
    "snapshotBedrooms",
    "snapshotDaysSinceBooking",
    "snapshotPreferredTeam",
    // BOOKED status is an enum value, not a column — verified separately below
  ],
  sms_campaigns: [
    "id",
    "name",
    "status",
    "messageTemplate",
    "frozenRecipientCount",
    "sentCount",
    "repliedCount",
    "bookedCount",
  ],
};

/**
 * Verify the BOOKED value exists in the sms_campaign_recipients.status enum.
 */
async function checkBookedEnumValue(db: Awaited<ReturnType<typeof getDb>>): Promise<string | null> {
  const rows = await db.execute(sql.raw(`
    SELECT COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'sms_campaign_recipients'
      AND COLUMN_NAME  = 'status'
  `)) as unknown as [Array<{ COLUMN_TYPE: string }>];

  const columnType: string = rows[0]?.[0]?.COLUMN_TYPE ?? "";
  if (!columnType.includes("'BOOKED'")) {
    return "sms_campaign_recipients.status enum is missing the 'BOOKED' value. Run migration 0083.";
  }
  return null;
}

export async function checkSmsCampaignSchema(): Promise<void> {
  const db = await getDb();

  const errors: string[] = [];

  for (const [tableName, requiredCols] of Object.entries(REQUIRED_COLUMNS)) {
    // Fetch all existing columns for this table from INFORMATION_SCHEMA
    const rows = await db.execute(sql.raw(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = '${tableName}'
    `)) as unknown as [ColumnRow[]];

    const existing = new Set((rows[0] ?? []).map((r) => r.COLUMN_NAME));

    for (const col of requiredCols) {
      if (!existing.has(col)) {
        errors.push(
          `Database schema is out of date. Missing column: ${tableName}.${col}. ` +
          `Run migration 0083_sms_campaign_recipients_snapshot_columns.sql on production.`
        );
      }
    }
  }

  // Check BOOKED enum value separately
  const enumError = await checkBookedEnumValue(db);
  if (enumError) errors.push(enumError);

  if (errors.length > 0) {
    console.error("\n[SchemaCheck] ❌ Schema compatibility check FAILED:");
    for (const err of errors) {
      console.error(`  • ${err}`);
    }
    console.error(
      "\n[SchemaCheck] The application cannot start safely. " +
      "Apply the pending migration(s) and redeploy.\n"
    );
    process.exit(1);
  }

  console.log("[SchemaCheck] ✓ SMS campaign schema compatibility check passed.");
}
