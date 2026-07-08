/**
 * AudiencePlanner.ts
 *
 * Pure audience planning service. No DB writes. No campaign creation. No OpenPhone.
 *
 * Takes an AudienceDefinition and returns a PlannerResult containing:
 *   - matchedCustomers count
 *   - exclusionBreakdown (STOP, invalid phone, complaint, recently texted, duplicate)
 *   - sampleIncluded (up to 10) with matchedBecause[]
 *   - sampleExcluded (up to 10) with reason + reasonLabel
 *   - audienceStats (avg ticket, avg days since booking, frequency breakdown)
 *   - AudienceSummary (quality score, estimated revenue/bookings/replies)
 *   - ruleHash (SHA-256 of canonical AudienceDefinition JSON)
 *
 * Performance: single SQL query per planner pass. No N+1. No looping over customers.
 */

import crypto from "crypto";
import { sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type {
  AudienceDefinition,
  AudienceStats,
  AudienceSummary,
  ExcludedCustomer,
  ExclusionBreakdown,
  ExclusionReason,
  PlannerResult,
  Rule,
  SampleCustomer,
} from "./plannerTypes";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Estimation constants — auditable, adjustable */
const REBOOK_RATE = 0.18;        // 18% of matched customers rebook after campaign
const RESPONSE_RATE = 0.15;      // 15% respond to the SMS
const CONVERSION_RATE = 0.55;    // 55% of responders book
const REPLY_RATE = 0.14;         // 14% reply (different from booking)

/** Quality score weights */
const QUALITY_WEIGHTS = {
  formerRecurring: +20,
  withinFiveMiles: +15,        // placeholder — geography Stage 3
  days90to180: +10,
  days180to365: +5,
  highAvgTicket: +10,          // avg ticket > $200
  noComplaints: +5,
  recentComplaintsPresent: -25,
  lowAvgSpend: -15,            // avg ticket < $100
  largeAudience: -5,           // > 500 matched (risk of blast)
  recentlyTextedHigh: -10,     // > 30% recently texted
} as const;

// ─── Preset expansion ─────────────────────────────────────────────────────────

const RECURRING_FREQUENCIES = [
  "Weekly",
  "Bi-Weekly",
  "Every 2 Weeks",
  "Monthly",
  "Every 4 Weeks",
  "Every 3 Weeks",
];

function expandPresets(def: AudienceDefinition): Rule[] {
  const rules: Rule[] = [];
  for (const preset of def.presets) {
    switch (preset) {
      case "win-back":
        rules.push({ field: "lastBookingDays", op: ">", value: 90 });
        rules.push({ field: "recurringStatus", op: "=", value: "former-recurring" });
        break;
      case "former-recurring":
        rules.push({ field: "recurringStatus", op: "=", value: "former-recurring" });
        break;
      case "last-minute-openings":
        rules.push({ field: "lastBookingDays", op: ">", value: 30 });
        break;
      case "five-star-no-issues":
        rules.push({ field: "reviewScore", op: ">=", value: 5 });
        rules.push({ field: "hasComplaint", op: "is_false", value: false });
        break;
      case "high-value":
        rules.push({ field: "lifetimeRevenue", op: ">", value: 500 });
        break;
      case "not-contacted-30d":
        rules.push({ field: "lastSmsDays", op: ">", value: 30 });
        break;
      case "due-for-recurring":
        rules.push({ field: "recurringStatus", op: "=", value: "former-recurring" });
        rules.push({ field: "lastBookingDays", op: ">", value: 45 });
        break;
      case "spent-over-500":
        rules.push({ field: "lifetimeRevenue", op: ">", value: 500 });
        break;
      case "within-x-miles":
        // Geography — Stage 3. No-op for now.
        break;
    }
  }
  return rules;
}

// ─── SQL WHERE clause builder ─────────────────────────────────────────────────

interface WhereClause {
  sql: string;
  matchLabels: string[]; // human-readable labels for matchedBecause
}

function buildIncludeWhere(rules: Rule[]): WhereClause {
  const conditions: string[] = [];
  const labels: string[] = [];

  for (const rule of rules) {
    switch (rule.field) {
      case "lastBookingDays": {
        const days = Number(rule.value);
        if (rule.op === ">") {
          conditions.push(`DATEDIFF(NOW(), cv.lastJobDate) > ${days}`);
          labels.push(`Last booking ${days}+ days ago`);
        } else if (rule.op === ">=") {
          conditions.push(`DATEDIFF(NOW(), cv.lastJobDate) >= ${days}`);
          labels.push(`Last booking ${days}+ days ago`);
        } else if (rule.op === "<") {
          conditions.push(`DATEDIFF(NOW(), cv.lastJobDate) < ${days}`);
          labels.push(`Last booking within ${days} days`);
        } else if (rule.op === "<=") {
          conditions.push(`DATEDIFF(NOW(), cv.lastJobDate) <= ${days}`);
          labels.push(`Last booking within ${days} days`);
        }
        break;
      }
      case "bookingCount": {
        const count = Number(rule.value);
        conditions.push(`cv.bookingCount ${rule.op} ${count}`);
        labels.push(`${count}${rule.op === ">=" ? "+" : ""} bookings`);
        break;
      }
      case "recurringStatus": {
        const val = String(rule.value);
        if (val === "former-recurring") {
          conditions.push(
            `(cv.frequency IN (${RECURRING_FREQUENCIES.map((f) => `'${f}'`).join(",")}) AND DATEDIFF(NOW(), cv.lastJobDate) > 60)`
          );
          labels.push("Former recurring");
        } else if (val === "active-recurring") {
          conditions.push(
            `(cv.frequency IN (${RECURRING_FREQUENCIES.map((f) => `'${f}'`).join(",")}) AND DATEDIFF(NOW(), cv.lastJobDate) <= 60)`
          );
          labels.push("Active recurring");
        } else if (val === "one-time") {
          conditions.push(
            `(cv.frequency NOT IN (${RECURRING_FREQUENCIES.map((f) => `'${f}'`).join(",")}) OR cv.frequency IS NULL)`
          );
          labels.push("One-time customer");
        }
        break;
      }
      case "serviceType": {
        const val = String(rule.value);
        conditions.push(`cv.serviceType = '${val.replace(/'/g, "''")}'`);
        labels.push(`Service: ${val}`);
        break;
      }
      case "bedrooms": {
        conditions.push(`cv.bedrooms ${rule.op} ${Number(rule.value)}`);
        labels.push(`${rule.value} bedroom${rule.op === ">=" ? "+" : ""}`);
        break;
      }
      case "bathrooms": {
        conditions.push(`cv.bathrooms ${rule.op} ${Number(rule.value)}`);
        labels.push(`${rule.value} bathroom${rule.op === ">=" ? "+" : ""}`);
        break;
      }
      case "lifetimeRevenue": {
        const amount = Number(rule.value);
        conditions.push(`cv.lifetimeRevenue ${rule.op} ${amount}`);
        labels.push(`Lifetime spend ${rule.op} $${amount}`);
        break;
      }
      case "avgTicket": {
        const amount = Number(rule.value);
        conditions.push(`cv.avgTicket ${rule.op} ${amount}`);
        labels.push(`Avg ticket ${rule.op} $${amount}`);
        break;
      }
      case "lastBookingPrice": {
        const amount = Number(rule.value);
        conditions.push(`cv.lastBookingPrice ${rule.op} ${amount}`);
        labels.push(`Last booking price ${rule.op} $${amount}`);
        break;
      }
      case "reviewScore": {
        const score = Number(rule.value);
        conditions.push(`cv.maxRating ${rule.op} ${score}`);
        labels.push(`Rating ${rule.op} ${score}★`);
        break;
      }
      case "hasComplaint": {
        if (rule.op === "is_false") {
          conditions.push(`cv.hasComplaint = 0`);
          labels.push("No complaints");
        } else if (rule.op === "is_true") {
          conditions.push(`cv.hasComplaint = 1`);
          labels.push("Has complaint");
        }
        break;
      }
      case "lastSmsDays": {
        const days = Number(rule.value);
        if (rule.op === ">") {
          conditions.push(`(cv.lastSmsDaysAgo IS NULL OR cv.lastSmsDaysAgo > ${days})`);
          labels.push(`Not texted in ${days}+ days`);
        } else if (rule.op === "<") {
          conditions.push(`cv.lastSmsDaysAgo < ${days}`);
          labels.push(`Texted within ${days} days`);
        }
        break;
      }
      case "stopStatus": {
        if (rule.op === "is_false") {
          conditions.push(`cv.isOptedOut = 0`);
          labels.push("Not on STOP list");
        }
        break;
      }
      // Geography — Stage 3
      case "radiusMiles":
      case "city":
      case "zip":
        // No-op until geocoding is implemented
        break;
      // Placeholders
      case "hasRefund":
      case "hasChargeback":
      case "lastEmailDays":
      case "openRate":
      case "replyRate":
      case "aiLikelihoodToBook":
      case "aiLikelihoodToRespond":
        break;
    }
  }

  return {
    sql: conditions.length > 0 ? conditions.join(" AND ") : "1=1",
    matchLabels: labels,
  };
}

// ─── Canonical JSON hash ──────────────────────────────────────────────────────

function canonicalHash(def: AudienceDefinition): string {
  // Sort keys recursively to ensure stable JSON regardless of object key insertion order
  const canonical = JSON.stringify(def, (_, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((acc: Record<string, unknown>, k) => {
          acc[k] = val[k];
          return acc;
        }, {});
    }
    return val;
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// ─── Quality score ────────────────────────────────────────────────────────────

function computeQualityScore(
  def: AudienceDefinition,
  stats: { avgTicket: number; matchedCustomers: number; recentlyTextedCount: number; hasComplaints: boolean }
): number {
  let score = 50; // baseline

  // Preset bonuses
  if (def.presets.includes("former-recurring") || def.presets.includes("win-back")) {
    score += QUALITY_WEIGHTS.formerRecurring;
  }

  // Rule-based bonuses
  const allRules = [...expandPresets(def), ...def.includeRules];
  for (const rule of allRules) {
    if (rule.field === "recurringStatus" && rule.value === "former-recurring") {
      score += QUALITY_WEIGHTS.formerRecurring;
    }
    if (rule.field === "lastBookingDays" && rule.op === ">" && Number(rule.value) >= 90 && Number(rule.value) <= 180) {
      score += QUALITY_WEIGHTS.days90to180;
    }
    if (rule.field === "lastBookingDays" && rule.op === ">" && Number(rule.value) > 180 && Number(rule.value) <= 365) {
      score += QUALITY_WEIGHTS.days180to365;
    }
  }

  // Stats-based adjustments
  if (stats.avgTicket > 200) score += QUALITY_WEIGHTS.highAvgTicket;
  if (stats.avgTicket < 100) score += QUALITY_WEIGHTS.lowAvgSpend;
  if (stats.hasComplaints) score += QUALITY_WEIGHTS.recentComplaintsPresent;
  if (stats.matchedCustomers > 500) score += QUALITY_WEIGHTS.largeAudience;
  if (stats.matchedCustomers > 0 && stats.recentlyTextedCount / stats.matchedCustomers > 0.3) {
    score += QUALITY_WEIGHTS.recentlyTextedHigh;
  }

  return Math.max(0, Math.min(100, score));
}

function qualityGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}

// ─── Main planner function ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function planAudience(db: MySql2Database<any>, def: AudienceDefinition): Promise<PlannerResult> {
  const recentSmsDays = def.options?.recentSmsDays ?? 30;
  const sampleSize = def.options?.sampleSize ?? 10;

  // Merge preset rules with user include rules
  const allIncludeRules = [...expandPresets(def), ...def.includeRules];
  const includeWhere = buildIncludeWhere(allIncludeRules);

  // ── Single SQL query ─────────────────────────────────────────────────────────
  // Customer View CTE: one row per normalized phone (latest job per phone)
  // Joined with:
  //   - cleanerJobs for customerRating and customerComplaint
  //   - conversationSessions for lastAiMessageAt (recently texted)
  //   - alwaysOnEnrollments for OPTED_OUT status
  // All aggregation happens in SQL — no N+1, no looping.

  const rawQuery = `
    WITH customer_view AS (
      SELECT
        -- Normalize phone inline (Stage 3 will use stored column)
        CASE
          WHEN LENGTH(REGEXP_REPLACE(cj.phone, '[^0-9]', '')) = 10
            THEN CONCAT('+1', REGEXP_REPLACE(cj.phone, '[^0-9]', ''))
          WHEN LENGTH(REGEXP_REPLACE(cj.phone, '[^0-9]', '')) = 11
            AND LEFT(REGEXP_REPLACE(cj.phone, '[^0-9]', ''), 1) = '1'
            THEN CONCAT('+', REGEXP_REPLACE(cj.phone, '[^0-9]', ''))
          ELSE cj.phone
        END AS phoneNormalized,
        cj.firstName,
        cj.name,
        cj.address,
        cj.serviceType,
        cj.frequency,
        cj.bedrooms,
        cj.bathrooms,
        cj.lastBookingPrice,
        cj.jobDate AS lastJobDate,
        cj.phoneInvalid,
        cj.status AS jobStatus,
        -- Booking count per normalized phone
        COUNT(*) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS bookingCount,
        -- Lifetime revenue per normalized phone
        SUM(cj.lastBookingPrice) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS lifetimeRevenue,
        -- Average ticket per normalized phone
        AVG(cj.lastBookingPrice) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS avgTicket,
        -- Row number to deduplicate (latest job per phone)
        ROW_NUMBER() OVER (
          PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')
          ORDER BY cj.jobDate DESC
        ) AS rn,
        -- Max rating across all jobs for this phone
        MAX(clj.customerRating) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS maxRating,
        -- Has any complaint across all jobs
        MAX(CASE WHEN clj.customerComplaint IS NOT NULL AND clj.customerComplaint != '' THEN 1 ELSE 0 END)
          OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS hasComplaint,
        -- Last outbound SMS (days ago)
        DATEDIFF(NOW(), MAX(cs.lastAiMessageAt) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', ''))) AS lastSmsDaysAgo,
        -- Is opted out (STOP)
        MAX(CASE
          WHEN aoe.status = 'OPTED_OUT' THEN 1
          WHEN cs.smsOptOut = 1 THEN 1
          WHEN cj.status = 'OPTED_OUT' THEN 1
          ELSE 0
        END) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS isOptedOut
      FROM completed_jobs cj
      LEFT JOIN cleaner_jobs clj ON clj.completedJobId = cj.id
      LEFT JOIN conversation_sessions cs ON cs.leadPhone = cj.phone
      LEFT JOIN always_on_enrollments aoe ON aoe.phone = cj.phone
    ),
    deduplicated AS (
      SELECT * FROM customer_view WHERE rn = 1
    ),
    -- Apply include rules
    included AS (
      SELECT * FROM deduplicated
      WHERE phoneInvalid = 0
        AND ${includeWhere.sql}
    ),
    -- Apply hard exclusions (always applied)
    excluded_stop AS (
      SELECT phoneNormalized, 'STOP_OPT_OUT' AS reason FROM included WHERE isOptedOut = 1
    ),
    excluded_invalid AS (
      SELECT phoneNormalized, 'INVALID_PHONE' AS reason FROM deduplicated WHERE phoneInvalid = 1
    ),
    excluded_complaint AS (
      SELECT phoneNormalized, 'OPEN_COMPLAINT' AS reason FROM included WHERE hasComplaint = 1 AND isOptedOut = 0
    ),
    excluded_recent_sms AS (
      SELECT phoneNormalized, 'RECENTLY_TEXTED' AS reason FROM included
      WHERE lastSmsDaysAgo IS NOT NULL AND lastSmsDaysAgo <= ${recentSmsDays}
        AND isOptedOut = 0 AND hasComplaint = 0
    ),
    -- Final matched set (included minus all exclusions)
    matched AS (
      SELECT i.* FROM included i
      WHERE i.isOptedOut = 0
        AND i.hasComplaint = 0
        AND (i.lastSmsDaysAgo IS NULL OR i.lastSmsDaysAgo > ${recentSmsDays})
    ),
    -- Aggregate stats
    stats AS (
      SELECT
        COUNT(*) AS matchedCount,
        AVG(DATEDIFF(NOW(), lastJobDate)) AS avgDaysSinceBooking,
        AVG(lastBookingPrice) AS avgLastPrice,
        AVG(avgTicket) AS avgTicketOverall,
        AVG(bookingCount) AS avgBookingCount,
        SUM(CASE WHEN frequency IN (${RECURRING_FREQUENCIES.map((f) => `'${f}'`).join(",")}) THEN 1 ELSE 0 END) AS recurringCount,
        SUM(CASE WHEN frequency NOT IN (${RECURRING_FREQUENCIES.map((f) => `'${f}'`).join(",")}) OR frequency IS NULL THEN 1 ELSE 0 END) AS oneTimeCount,
        MAX(CASE WHEN hasComplaint = 1 THEN 1 ELSE 0 END) AS anyComplaints
      FROM matched
    ),
    -- Exclusion counts
    excl_counts AS (
      SELECT
        (SELECT COUNT(*) FROM excluded_stop) AS stopCount,
        (SELECT COUNT(*) FROM excluded_invalid) AS invalidCount,
        (SELECT COUNT(*) FROM excluded_complaint) AS complaintCount,
        (SELECT COUNT(*) FROM excluded_recent_sms) AS recentSmsCount
    )
    SELECT
      -- Stats row
      s.matchedCount,
      s.avgDaysSinceBooking,
      s.avgLastPrice,
      s.avgTicketOverall,
      s.avgBookingCount,
      s.recurringCount,
      s.oneTimeCount,
      s.anyComplaints,
      -- Exclusion counts
      ec.stopCount,
      ec.invalidCount,
      ec.complaintCount,
      ec.recentSmsCount,
      -- Sample included (up to sampleSize rows)
      NULL AS _sentinel
    FROM stats s, excl_counts ec
    LIMIT 1
  `;

  // Run stats query
  const [statsRows] = await db.execute(sql.raw(rawQuery));
  const statsRow = (statsRows as Record<string, unknown>[])[0] ?? {};

  const matchedCount = Number(statsRow.matchedCount ?? 0);
  const avgDaysSinceBooking = Number(statsRow.avgDaysSinceBooking ?? 0);
  const avgLastPrice = Number(statsRow.avgLastPrice ?? 0);
  const avgTicketOverall = Number(statsRow.avgTicketOverall ?? 0);
  const avgBookingCount = Number(statsRow.avgBookingCount ?? 0);
  const recurringCount = Number(statsRow.recurringCount ?? 0);
  const oneTimeCount = Number(statsRow.oneTimeCount ?? 0);
  const stopCount = Number(statsRow.stopCount ?? 0);
  const invalidCount = Number(statsRow.invalidCount ?? 0);
  const complaintCount = Number(statsRow.complaintCount ?? 0);
  const recentSmsCount = Number(statsRow.recentSmsCount ?? 0);
  const anyComplaints = Number(statsRow.anyComplaints ?? 0) === 1;

  // ── Sample included customers ─────────────────────────────────────────────
  const sampleIncludedQuery = `
    WITH customer_view AS (
      SELECT
        CASE
          WHEN LENGTH(REGEXP_REPLACE(cj.phone, '[^0-9]', '')) = 10
            THEN CONCAT('+1', REGEXP_REPLACE(cj.phone, '[^0-9]', ''))
          WHEN LENGTH(REGEXP_REPLACE(cj.phone, '[^0-9]', '')) = 11
            AND LEFT(REGEXP_REPLACE(cj.phone, '[^0-9]', ''), 1) = '1'
            THEN CONCAT('+', REGEXP_REPLACE(cj.phone, '[^0-9]', ''))
          ELSE cj.phone
        END AS phoneNormalized,
        cj.firstName, cj.name, cj.serviceType, cj.frequency,
        cj.lastBookingPrice, cj.jobDate AS lastJobDate, cj.phoneInvalid, cj.status AS jobStatus,
        COUNT(*) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS bookingCount,
        SUM(cj.lastBookingPrice) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS lifetimeRevenue,
        AVG(cj.lastBookingPrice) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS avgTicket,
        ROW_NUMBER() OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '') ORDER BY cj.jobDate DESC) AS rn,
        MAX(clj.customerRating) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS maxRating,
        MAX(CASE WHEN clj.customerComplaint IS NOT NULL AND clj.customerComplaint != '' THEN 1 ELSE 0 END)
          OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS hasComplaint,
        DATEDIFF(NOW(), MAX(cs.lastAiMessageAt) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', ''))) AS lastSmsDaysAgo,
        MAX(CASE WHEN aoe.status = 'OPTED_OUT' THEN 1 WHEN cs.smsOptOut = 1 THEN 1 WHEN cj.status = 'OPTED_OUT' THEN 1 ELSE 0 END)
          OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS isOptedOut
      FROM completed_jobs cj
      LEFT JOIN cleaner_jobs clj ON clj.completedJobId = cj.id
      LEFT JOIN conversation_sessions cs ON cs.leadPhone = cj.phone
      LEFT JOIN always_on_enrollments aoe ON aoe.phone = cj.phone
    )
    SELECT phoneNormalized, firstName, name, serviceType, frequency,
           lastBookingPrice, lastJobDate, bookingCount, lifetimeRevenue, avgTicket, maxRating
    FROM customer_view
    WHERE rn = 1
      AND phoneInvalid = 0
      AND isOptedOut = 0
      AND hasComplaint = 0
      AND (lastSmsDaysAgo IS NULL OR lastSmsDaysAgo > ${recentSmsDays})
      AND ${includeWhere.sql}
    ORDER BY RAND()
    LIMIT ${sampleSize}
  `;

  const [sampleIncludedRows] = await db.execute(sql.raw(sampleIncludedQuery));
  const sampleIncluded: SampleCustomer[] = (sampleIncludedRows as Record<string, unknown>[]).map((row) => {
    const firstName = String(row.firstName ?? "");
    const lastName = String(row.name ?? "").split(" ").slice(1).join(" ");
    const lastInitial = lastName ? lastName[0] + "." : "";
    const displayName = [firstName, lastInitial].filter(Boolean).join(" ") || "Customer";
    const daysSince = row.lastJobDate
      ? Math.floor((Date.now() - new Date(String(row.lastJobDate)).getTime()) / 86400000)
      : 0;

    // Build matchedBecause from the include rules that apply to this customer
    const matchedBecause: string[] = [...includeWhere.matchLabels];
    if (daysSince > 0) {
      // Replace generic "Last booking X+ days ago" with specific value
      const idx = matchedBecause.findIndex((l) => l.includes("days ago"));
      if (idx !== -1) matchedBecause[idx] = `Last booking ${daysSince} days ago`;
    }

    return {
      displayName,
      phoneNormalized: String(row.phoneNormalized ?? ""),
      lastJobDate: String(row.lastJobDate ?? ""),
      daysSinceLastBooking: daysSince,
      lastBookingPrice: Number(row.lastBookingPrice ?? 0),
      bookingCount: Number(row.bookingCount ?? 0),
      frequency: String(row.frequency ?? "Unknown"),
      serviceType: String(row.serviceType ?? "Unknown"),
      reviewScore: row.maxRating != null ? Number(row.maxRating) : null,
      matchedBecause,
    };
  });

  // ── Sample excluded customers ─────────────────────────────────────────────
  const sampleExcludedQuery = `
    WITH customer_view AS (
      SELECT
        CASE
          WHEN LENGTH(REGEXP_REPLACE(cj.phone, '[^0-9]', '')) = 10
            THEN CONCAT('+1', REGEXP_REPLACE(cj.phone, '[^0-9]', ''))
          WHEN LENGTH(REGEXP_REPLACE(cj.phone, '[^0-9]', '')) = 11
            AND LEFT(REGEXP_REPLACE(cj.phone, '[^0-9]', ''), 1) = '1'
            THEN CONCAT('+', REGEXP_REPLACE(cj.phone, '[^0-9]', ''))
          ELSE cj.phone
        END AS phoneNormalized,
        cj.firstName, cj.name, cj.jobDate AS lastJobDate, cj.phoneInvalid, cj.status AS jobStatus,
        ROW_NUMBER() OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '') ORDER BY cj.jobDate DESC) AS rn,
        MAX(CASE WHEN clj.customerComplaint IS NOT NULL AND clj.customerComplaint != '' THEN 1 ELSE 0 END)
          OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS hasComplaint,
        DATEDIFF(NOW(), MAX(cs.lastAiMessageAt) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', ''))) AS lastSmsDaysAgo,
        MAX(CASE WHEN aoe.status = 'OPTED_OUT' THEN 1 WHEN cs.smsOptOut = 1 THEN 1 WHEN cj.status = 'OPTED_OUT' THEN 1 ELSE 0 END)
          OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS isOptedOut
      FROM completed_jobs cj
      LEFT JOIN cleaner_jobs clj ON clj.completedJobId = cj.id
      LEFT JOIN conversation_sessions cs ON cs.leadPhone = cj.phone
      LEFT JOIN always_on_enrollments aoe ON aoe.phone = cj.phone
    ),
    deduplicated AS (SELECT * FROM customer_view WHERE rn = 1),
    included_base AS (
      SELECT * FROM deduplicated WHERE phoneInvalid = 0 AND ${includeWhere.sql}
    ),
    excluded_union AS (
      SELECT phoneNormalized, firstName, name, 'STOP_OPT_OUT' AS reason
      FROM included_base WHERE isOptedOut = 1
      UNION ALL
      SELECT phoneNormalized, firstName, name, 'INVALID_PHONE' AS reason
      FROM deduplicated WHERE phoneInvalid = 1
      UNION ALL
      SELECT phoneNormalized, firstName, name, 'OPEN_COMPLAINT' AS reason
      FROM included_base WHERE hasComplaint = 1 AND isOptedOut = 0
      UNION ALL
      SELECT phoneNormalized, firstName, name, 'RECENTLY_TEXTED' AS reason
      FROM included_base
      WHERE lastSmsDaysAgo IS NOT NULL AND lastSmsDaysAgo <= ${recentSmsDays}
        AND isOptedOut = 0 AND hasComplaint = 0
    )
    SELECT phoneNormalized, firstName, name, reason FROM excluded_union
    ORDER BY RAND()
    LIMIT ${sampleSize}
  `;

  const [sampleExcludedRows] = await db.execute(sql.raw(sampleExcludedQuery));
  const sampleExcluded: ExcludedCustomer[] = (sampleExcludedRows as Record<string, unknown>[]).map((row) => {
    const firstName = String(row.firstName ?? "");
    const lastName = String(row.name ?? "").split(" ").slice(1).join(" ");
    const lastInitial = lastName ? lastName[0] + "." : "";
    const displayName = [firstName, lastInitial].filter(Boolean).join(" ") || "Customer";
    const reason = String(row.reason ?? "STOP_OPT_OUT") as ExclusionReason;
    const reasonLabels: Record<ExclusionReason, string> = {
      STOP_OPT_OUT: "Opted out via STOP",
      INVALID_PHONE: "Invalid phone number",
      OPEN_COMPLAINT: "Has open complaint",
      RECENTLY_TEXTED: `Texted within last ${recentSmsDays} days`,
      ACTIVE_RECURRING: "Active recurring customer",
      REFUND_ON_FILE: "Refund on file",
      CHARGEBACK_ON_FILE: "Chargeback on file",
      DUPLICATE_PHONE: "Duplicate phone number",
    };
    return {
      displayName,
      phoneNormalized: String(row.phoneNormalized ?? ""),
      reason,
      reasonLabel: reasonLabels[reason] ?? reason,
    };
  });

  // ── Frequency breakdown ───────────────────────────────────────────────────
  const freqQuery = `
    WITH cv AS (
      SELECT cj.frequency,
        ROW_NUMBER() OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '') ORDER BY cj.jobDate DESC) AS rn,
        MAX(CASE WHEN aoe.status = 'OPTED_OUT' THEN 1 WHEN cs.smsOptOut = 1 THEN 1 WHEN cj.status = 'OPTED_OUT' THEN 1 ELSE 0 END)
          OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS isOptedOut,
        MAX(CASE WHEN clj.customerComplaint IS NOT NULL AND clj.customerComplaint != '' THEN 1 ELSE 0 END)
          OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS hasComplaint,
        DATEDIFF(NOW(), MAX(cs.lastAiMessageAt) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', ''))) AS lastSmsDaysAgo,
        cj.phoneInvalid,
        CASE
          WHEN LENGTH(REGEXP_REPLACE(cj.phone, '[^0-9]', '')) = 10
            THEN CONCAT('+1', REGEXP_REPLACE(cj.phone, '[^0-9]', ''))
          ELSE cj.phone
        END AS phoneNormalized,
        SUM(cj.lastBookingPrice) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS lifetimeRevenue,
        AVG(cj.lastBookingPrice) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS avgTicket,
        COUNT(*) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS bookingCount,
        MAX(clj.customerRating) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS maxRating,
        cj.lastBookingPrice, cj.jobDate AS lastJobDate, cj.serviceType, cj.bedrooms, cj.bathrooms
      FROM completed_jobs cj
      LEFT JOIN cleaner_jobs clj ON clj.completedJobId = cj.id
      LEFT JOIN conversation_sessions cs ON cs.leadPhone = cj.phone
      LEFT JOIN always_on_enrollments aoe ON aoe.phone = cj.phone
    )
    SELECT COALESCE(frequency, 'Unknown') AS freq, COUNT(*) AS cnt
    FROM cv
    WHERE rn = 1 AND phoneInvalid = 0 AND isOptedOut = 0 AND hasComplaint = 0
      AND (lastSmsDaysAgo IS NULL OR lastSmsDaysAgo > ${recentSmsDays})
      AND ${includeWhere.sql}
    GROUP BY frequency
    ORDER BY cnt DESC
    LIMIT 5
  `;

  const [freqRows] = await db.execute(sql.raw(freqQuery));
  const topFrequencies = (freqRows as Record<string, unknown>[]).map((r) => ({
    label: String(r.freq ?? "Unknown"),
    count: Number(r.cnt ?? 0),
  }));

  // ── Service type breakdown ────────────────────────────────────────────────
  const svcQuery = `
    WITH cv AS (
      SELECT cj.serviceType,
        ROW_NUMBER() OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '') ORDER BY cj.jobDate DESC) AS rn,
        MAX(CASE WHEN aoe.status = 'OPTED_OUT' THEN 1 WHEN cs.smsOptOut = 1 THEN 1 WHEN cj.status = 'OPTED_OUT' THEN 1 ELSE 0 END)
          OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS isOptedOut,
        MAX(CASE WHEN clj.customerComplaint IS NOT NULL AND clj.customerComplaint != '' THEN 1 ELSE 0 END)
          OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS hasComplaint,
        DATEDIFF(NOW(), MAX(cs.lastAiMessageAt) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', ''))) AS lastSmsDaysAgo,
        cj.phoneInvalid,
        SUM(cj.lastBookingPrice) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS lifetimeRevenue,
        AVG(cj.lastBookingPrice) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS avgTicket,
        COUNT(*) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS bookingCount,
        MAX(clj.customerRating) OVER (PARTITION BY REGEXP_REPLACE(cj.phone, '[^0-9]', '')) AS maxRating,
        cj.lastBookingPrice, cj.jobDate AS lastJobDate, cj.bedrooms, cj.bathrooms,
        cj.frequency
      FROM completed_jobs cj
      LEFT JOIN cleaner_jobs clj ON clj.completedJobId = cj.id
      LEFT JOIN conversation_sessions cs ON cs.leadPhone = cj.phone
      LEFT JOIN always_on_enrollments aoe ON aoe.phone = cj.phone
    )
    SELECT COALESCE(serviceType, 'Unknown') AS svc, COUNT(*) AS cnt
    FROM cv
    WHERE rn = 1 AND phoneInvalid = 0 AND isOptedOut = 0 AND hasComplaint = 0
      AND (lastSmsDaysAgo IS NULL OR lastSmsDaysAgo > ${recentSmsDays})
      AND ${includeWhere.sql}
    GROUP BY serviceType
    ORDER BY cnt DESC
    LIMIT 5
  `;

  const [svcRows] = await db.execute(sql.raw(svcQuery));
  const topServiceTypes = (svcRows as Record<string, unknown>[]).map((r) => ({
    label: String(r.svc ?? "Unknown"),
    count: Number(r.cnt ?? 0),
  }));

  // ── Assemble result ───────────────────────────────────────────────────────

  const totalExcluded = stopCount + invalidCount + complaintCount + recentSmsCount;

  const audienceStats: AudienceStats = {
    avgDaysSinceLastBooking: Math.round(avgDaysSinceBooking),
    avgLastBookingPrice: Math.round(avgLastPrice),
    avgBookingCount: Math.round(avgBookingCount * 10) / 10,
    recurringPercent: matchedCount > 0 ? Math.round((recurringCount / matchedCount) * 100) : 0,
    oneTimePercent: matchedCount > 0 ? Math.round((oneTimeCount / matchedCount) * 100) : 0,
    topServiceTypes,
    topFrequencies,
    avgDistanceMiles: null,
  };

  const qualityScore = computeQualityScore(def, {
    avgTicket: avgTicketOverall,
    matchedCustomers: matchedCount,
    recentlyTextedCount: recentSmsCount,
    hasComplaints: anyComplaints,
  });

  const summary: AudienceSummary = {
    matchedCustomers: matchedCount,
    excludedCustomers: totalExcluded,
    estimatedRevenue: Math.round(matchedCount * avgLastPrice * REBOOK_RATE),
    estimatedBookings: Math.round(matchedCount * RESPONSE_RATE * CONVERSION_RATE),
    estimatedReplies: Math.round(matchedCount * REPLY_RATE),
    averageTicket: Math.round(avgTicketOverall),
    averageDistance: null,
    qualityScore,
    qualityGrade: qualityGrade(qualityScore),
  };

  const exclusionBreakdown: ExclusionBreakdown = {
    stopOptOut: stopCount,
    invalidPhone: invalidCount,
    openComplaint: complaintCount,
    recentlyTexted: recentSmsCount,
    activeRecurring: 0,
    duplicate: 0,
    other: 0,
  };

  return {
    summary,
    stats: audienceStats,
    exclusionBreakdown,
    sampleIncluded,
    sampleExcluded,
    ruleHash: canonicalHash(def),
    generatedAt: Date.now(),
  };
}
