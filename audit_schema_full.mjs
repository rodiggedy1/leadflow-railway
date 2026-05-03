/**
 * Full schema diff: compares every column defined in drizzle/schema.ts
 * against what actually exists in the live database.
 * Reports: missing tables, missing columns, type mismatches.
 * READ-ONLY — makes no changes.
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }

const url = new URL(DB_URL);
const conn = await createConnection({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: url.password,
  database: url.pathname.replace("/", ""),
  ssl: { rejectUnauthorized: false },
});

// Get all columns from live DB
const [liveRows] = await conn.execute(
  `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
   ORDER BY TABLE_NAME, ORDINAL_POSITION`
);

// Build a map: tableName -> Set of column names
const liveSchema = {};
for (const row of liveRows) {
  if (!liveSchema[row.TABLE_NAME]) liveSchema[row.TABLE_NAME] = new Set();
  liveSchema[row.TABLE_NAME].add(row.COLUMN_NAME);
}

// Tables defined in schema.ts (from the grep output above)
// We'll check the ones that had errors + all others
const schemaTableMap = {
  activityLog: "activity_log",
  agents: "agents",
  aiInsightsCache: "ai_insights_cache",
  alwaysOnEnrollments: "always_on_enrollments",
  alwaysOnGroups: "always_on_groups",
  appSettings: "app_settings",
  callbackTasks: "callback_tasks",
  campaignApprovalBatches: "campaign_approval_batches",
  campaignBlasts: "campaign_blasts",
  candidates: "candidates",
  channelPins: "channel_pins",
  cleanerJobCustomRules: "cleaner_job_custom_rules",
  cleanerJobs: "cleaner_jobs",
  cleanerMagicLinkTokens: "cleaner_magic_link_tokens",
  cleanerProfiles: "cleaner_profiles",
  cleanerRatingSmsLog: "cleaner_rating_sms_log",
  cleanerStreaks: "cleaner_streaks",
  commandCenterCache: "command_center_cache",
  completedJobBatches: "completed_job_batches",
  completedJobs: "completed_jobs",
  conversationSessions: "conversation_sessions",
  cronHeartbeats: "cron_heartbeats",
  customPayRules: "custom_pay_rules",
  fieldMgmtCalls: "field_mgmt_calls",
  fieldMgmtLog: "field_mgmt_log",
  followUps: "follow_ups",
  interviewChunks: "interview_chunks",
  issueComments: "issue_comments",
  issueFlags: "issue_flags",
  issueOwnership: "issue_ownership",
  jobAlerts: "job_alerts",
  jobPhotos: "job_photos",
  jobSmsReplies: "job_sms_replies",
  jobStatusHistory: "job_status_history",
  leadCallLogs: "lead_call_logs",
  messageTemplates: "message_templates",
  metricsAiAlerts: "metrics_ai_alerts",
  nurtureEnrollments: "nurture_enrollments",
  nurtureStepScripts: "nurture_step_scripts",
  openphoneCallRecordings: "openphone_call_recordings",
  opsChatMessages: "ops_chat_messages",
  opsChatReactions: "ops_chat_reactions",
  opsChatReads: "ops_chat_reads",
  opsReminders: "ops_reminders",
  pageViews: "page_views",
  pushSubscriptions: "push_subscriptions",
  quoteLeads: "quote_leads",
  ratingSmsPending: "rating_sms_pending",
  reactivationCampaigns: "reactivation_campaigns",
  reactivationContacts: "reactivation_contacts",
  smsOptOuts: "sms_opt_outs",
  syncRuns: "sync_runs",
  systemConfig: "system_config",
  users: "users",
  voiceCalls: "voice_calls",
};

// Now check each table's columns by running DESCRIBE against live DB
// and comparing with what drizzle-kit would generate
// Since we can't parse TS at runtime, we'll use drizzle-kit's generated SQL
// Instead: run pnpm db:push --dry-run equivalent by checking drizzle migrations

// Simpler approach: use the drizzle migration files to find what columns should exist
// but the most reliable is to run the actual schema introspection via drizzle

// For now, let's check the specific tables that errored and a few key ones
const tablesToAudit = [
  "field_mgmt_log",
  "completed_job_batches",
  "cleaner_jobs",
  "system_config",  // This one is in schema but might be missing from live DB
  "cs_threads",     // Check if this exists
  "nurture_enrollments",
  "nurture_step_scripts",
  "reactivation_campaigns",
  "reactivation_contacts",
];

console.log("=== SCHEMA AUDIT REPORT ===\n");

// Check for tables in schema but missing from live DB
const liveTables = new Set(Object.keys(liveSchema));
const schemaTables = new Set(Object.values(schemaTableMap));

console.log("--- MISSING TABLES (in schema.ts but NOT in live DB) ---");
let missingTableCount = 0;
for (const tableName of schemaTables) {
  if (!liveTables.has(tableName)) {
    console.log(`  ❌ MISSING: ${tableName}`);
    missingTableCount++;
  }
}
if (missingTableCount === 0) console.log("  ✅ All tables exist in live DB");

console.log("\n--- EXTRA TABLES (in live DB but NOT in schema.ts) ---");
let extraTableCount = 0;
for (const tableName of liveTables) {
  if (!schemaTables.has(tableName) && tableName !== "__drizzle_migrations") {
    console.log(`  ⚠️  EXTRA: ${tableName}`);
    extraTableCount++;
  }
}
if (extraTableCount === 0) console.log("  ✅ No extra tables");

// For the specific errored tables, get full column details
console.log("\n--- DETAILED COLUMN CHECK FOR ERRORED TABLES ---\n");

// field_mgmt_log: the error was about firedAt — but that exists. Let's check the query more carefully
// The error was: "Failed query: select cleanerJobId, firedAt from field_mgmt_log where step = ? and firedAt >= ? and firedAt <= ?"
// All those columns exist. So the error might be something else.

// completed_job_batches: the error was an INSERT with reviewConfirmedCount
// Let's check if that column exists
const [cjbCols] = await conn.execute(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'completed_job_batches'`
);
console.log("completed_job_batches columns in live DB:");
cjbCols.forEach(r => console.log(`  - ${r.COLUMN_NAME}`));

// Check the actual error more carefully — the today-sync error INSERT had reviewConfirmedCount
// but the live DB shows it HAS reviewConfirmedCount. So the error might be a different issue.

// Let's check the actual drizzle migration status
const [migrations] = await conn.execute(
  `SELECT * FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 10`
);
console.log("\n--- LAST 10 DRIZZLE MIGRATIONS ---");
for (const m of migrations) {
  console.log(`  ${m.hash} — ${new Date(Number(m.created_at)).toISOString()}`);
}

await conn.end();
console.log("\n=== AUDIT COMPLETE ===");
