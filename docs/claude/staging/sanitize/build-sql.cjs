#!/usr/bin/env node
// Generates the staging sanitizer SQL from column-map.tsv + conversations.json.
//   prepare.sql  — run ONLY in the temporary cleaning database: creates the safety marker + helper tables.
//   sanitize.sql — every statement depends on the marker/helper tables, so it fails (changing nothing) anywhere else.
//                  If the database has any column not in the map (or the map has one the database lacks), it changes nothing.
//   verify.sql   — leak check: returns ONLY rows of failing checks (rule, table, column, count) — never data. Empty = pass.
//   cleanup.sql  — drops the helper tables (run after verify, before export).
// SQL is written for TiDB (MySQL-compatible) and also runs on MariaDB for local testing.
"use strict";
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const outDir = process.argv[2] || dir;

const map = fs.readFileSync(path.join(dir, "column-map.tsv"), "utf8").trim().split("\n").slice(1).map(l => {
  const [table, column, type, rule, note, nullable] = l.split("\t");
  const m = type.match(/^(?:var)?char\((\d+)\)/); // length limit for (var)char only
  return { table, column, type, rule, note, nullable: nullable === "YES", len: m ? +m[1] : null, isString: /char|text|json/.test(type) || rule.startsWith("JSON") };
});
const convo = JSON.parse(fs.readFileSync(path.join(dir, "conversations.json"), "utf8")).scenarios;

const q = s => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
const id = s => "`" + s + "`";
const M = "__staging_sanitize_marker";
const GUARD = `JOIN ${M} m ON m.drift_ok = 1`;
const fit = (expr, c) => (c.len ? `LEFT(${expr}, ${c.len})` : expr);
const empty = c => (c.nullable ? "NULL" : "''");
const notEmpty = c => `t.${id(c.column)} IS NOT NULL AND t.${id(c.column)} <> ''`;
const hash = c => `SHA2(CONCAT(m.salt, t.${id(c.column)}), 256)`;
const PHONE_NORM = x => `RIGHT(REGEXP_REPLACE(${x}, '[^0-9]', ''), 10)`;
// fake phones: +1 999 2xx xxxx. Area code 999 does not exist; the 2 keeps them valid for the app's US-number rule
const PHONE_FAKE_DEFAULT = "'+19992000000'";
// phone in free text: E.164 (+1XXXXXXXXXX) or formatted with separators; area code 999 (our fakes) excluded
const AREA = "([2-8][0-9]{2}|9[0-8][0-9]|99[0-8])";
const PHONE_RE = `(\\\\+1${AREA}[0-9]{7})|(\\\\(?${AREA}\\\\)?[ .-][0-9]{3}[ .-][0-9]{4})`;
const EMAIL_RE = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Za-z]{2,}";
const FAKE_EMAIL_RE = "[A-Za-z0-9._%+-]+@example\\\\.invalid";
const UNUSABLE_BCRYPT = "$2b$10$0r0wwvnpGZXVOQWq.mnBbuuaSWkX3wSg0x/We03UDWRhXhZXmalqW";

const FIRST = ["Alex","Bailey","Casey","Dana","Elliot","Frankie","Gray","Harper","Indy","Jordan","Kai","Logan","Morgan","Noel","Oakley","Parker","Quinn","Riley","Sage","Taylor","Avery","Blake","Cameron","Drew","Emery","Finley","Hayden","Jamie","Kendall","Lane","Marley","Nico","Reese","Rowan","Skyler","Tatum","Remy","Shay","Wren","Ari"];
const LAST = ["Example","Sample","Placeholder","Testwell","Demoson","Fictor","Mockley","Pretendo","Synthia","Fakerson","Dummond","Proxley","Stagewood","Trialton","Modelle","Imagin","Inventa","Notreal","Simmons","Vantage","Ashby","Brookes","Calder","Dalton","Easton","Fairley","Garnet","Holloway","Ingram","Jarvis","Kingsley","Lowell","Merritt","Norwood","Orchard","Prescott","Radley","Sterling","Thorne","Whitlock"];
const STREETS = ["Maple St","Cedar Ave","Elm Rd","Birch Ln","Willow Ct","Aspen Way","Juniper St","Laurel Ave","Hawthorn Rd","Magnolia Ln","Sycamore Ct","Chestnut St","Poplar Ave","Spruce Rd","Linden Ln","Alder Ct","Hazel St","Rowan Ave","Cypress Rd","Holly Ln"];
const TEAM_WORDS = ["Aspen","Birch","Cedar","Dogwood","Elm","Fir","Ginkgo","Hemlock","Ivy","Juniper","Kauri","Larch","Maple","Nutmeg","Oak","Pine","Quince","Redwood","Spruce","Teak","Umber","Violet","Willow","Yew","Zinnia","Acacia","Bamboo","Clover","Daisy","Fern"];

const byRule = r => map.filter(c => c.rule === r);
const tables = [...new Set(map.map(c => c.table))];
const truncTables = [...new Set(byRule("TRUNCATE_TABLE").map(c => c.table))];
const truncSet = new Set(truncTables);

// ---------- prepare.sql ----------
const prep = [];
const PREP_HEADER = (`-- LeadFlow staging sanitizer — PREPARE. Run ONLY inside the temporary cleaning database. NEVER on production or staging.
-- Creates the safety marker (with a fresh random salt) and helper tables. Without these, sanitize.sql cannot change anything.`);
prep.push(`CREATE TABLE ${M} (salt VARCHAR(64) NOT NULL, drift_ok TINYINT NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
prep.push(`INSERT INTO ${M} (salt) VALUES (SHA2(CONCAT(UUID(), RAND(), NOW(6)), 256))`);
prep.push(`CREATE TABLE __column_map (t VARCHAR(128) NOT NULL, c VARCHAR(128) NOT NULL, PRIMARY KEY (t, c))`);
for (let i = 0; i < map.length; i += 250) prep.push(`INSERT INTO __column_map (t, c) VALUES ${map.slice(i, i + 250).map(c => `(${q(c.table)}, ${q(c.column)})`).join(", ")}`);
for (const [name, list] of [["__name_first", FIRST], ["__name_last", LAST], ["__streets", STREETS], ["__team_words", TEAM_WORDS]]) {
  prep.push(`CREATE TABLE ${name} (i INT NOT NULL PRIMARY KEY, v VARCHAR(64) NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  prep.push(`INSERT INTO ${name} (i, v) VALUES ${list.map((v, i) => `(${i}, ${q(v)})`).join(", ")}`);
}
for (const n of ["phone", "email", "name", "team"]) {
  prep.push(`CREATE TABLE __src_${n} (\`real\` VARCHAR(320) NOT NULL PRIMARY KEY) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  prep.push(`CREATE TABLE __map_${n} (\`real\` VARCHAR(320) NOT NULL PRIMARY KEY, fake VARCHAR(255) NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
}
prep.push(`CREATE TABLE __synthetic_conversations (scenario VARCHAR(32) NOT NULL, variant INT NOT NULL, n INT NOT NULL, history MEDIUMTEXT NOT NULL, last_text VARCHAR(1000) NOT NULL, last_role VARCHAR(16) NOT NULL, PRIMARY KEY (scenario, variant)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
const MAXMSG = Math.max(...Object.values(convo).flat().map(c => c.length));
const convRows = [];
for (const [scenario, variants] of Object.entries(convo)) variants.forEach((msgs, v) => {
  const history = "[" + msgs.map(([role, content], i) => `{"role":${JSON.stringify(role)},"content":${JSON.stringify(content)},"ts":__TS${i}__,"synthetic":true}`).join(",") + "]";
  const [lastRole, lastText] = msgs[msgs.length - 1];
  convRows.push(`(${q(scenario)}, ${v}, ${msgs.length}, ${q(history)}, ${q(lastText)}, ${q(lastRole)})`);
});
prep.push(`INSERT INTO __synthetic_conversations (scenario, variant, n, history, last_text, last_role) VALUES ${convRows.join(",\n  ")}`);
prep.push(`SELECT 'PREPARE COMPLETE' AS step, COUNT(*) AS mapped_columns FROM __column_map`);

// ---------- sanitize.sql ----------
const s = [];
const SAN_HEADER = `-- LeadFlow staging sanitizer — SANITIZE. Run ONLY in the temporary cleaning database, after prepare.sql.
-- Every statement joins the marker table; on any other database it fails before changing anything.`;
// 0. drift check
// the sanitizer's own helper tables (exact names). Every other table, including production's own "__" tables, must be mapped.
const helpers = [M, "__column_map", "__name_first", "__name_last", "__streets", "__team_words", "__synthetic_conversations",
  ...["phone", "email", "name", "team"].flatMap(n => [`__src_${n}`, `__map_${n}`])];
const unmapped = `SELECT ic.table_name AS t, ic.column_name AS c FROM information_schema.columns ic LEFT JOIN __column_map cm ON cm.t = ic.table_name AND cm.c = ic.column_name WHERE ic.table_schema = DATABASE() AND ic.table_name NOT IN (${helpers.map(q).join(", ")}) AND cm.t IS NULL`;
const missing = `SELECT cm.t, cm.c FROM __column_map cm LEFT JOIN information_schema.columns ic ON ic.table_schema = DATABASE() AND ic.table_name = cm.t AND ic.column_name = cm.c WHERE ic.column_name IS NULL`;
s.push(`UPDATE ${M} m SET m.drift_ok = IF((SELECT COUNT(*) FROM (${unmapped}) u) = 0 AND (SELECT COUNT(*) FROM (${missing}) x) = 0, 1, 0)`);
s.push(`SELECT 'STRUCTURE CHECK' AS step, m.drift_ok AS ok_1_means_safe_to_continue FROM ${M} m`);
s.push(`SELECT 'NOT IN MAP' AS problem, u.t, u.c FROM (${unmapped}) u UNION ALL SELECT 'IN MAP BUT MISSING', x.t, x.c FROM (${missing}) x`);
// 1. collect originals into source tables
const src = (n, c, expr, extra = "") => s.push(`INSERT IGNORE INTO __src_${n} (\`real\`) SELECT DISTINCT ${expr} FROM ${id(c.table)} t ${GUARD} WHERE ${notEmpty(c)}${extra}`);
for (const c of byRule("PHONE")) src("phone", c, PHONE_NORM(`t.${id(c.column)}`), ` AND LENGTH(REGEXP_REPLACE(t.${id(c.column)}, '[^0-9]', '')) >= 7`);
for (const c of byRule("EMAIL")) src("email", c, `LOWER(TRIM(t.${id(c.column)}))`);
for (const c of byRule("CONTACT")) {
  src("email", c, `LOWER(TRIM(t.${id(c.column)}))`, ` AND t.${id(c.column)} LIKE '%@%'`);
  src("phone", c, PHONE_NORM(`t.${id(c.column)}`), ` AND t.${id(c.column)} NOT LIKE '%@%' AND LENGTH(REGEXP_REPLACE(t.${id(c.column)}, '[^0-9]', '')) >= 10`);
}
for (const c of byRule("PERSON_NAME")) src("name", c, `LOWER(TRIM(t.${id(c.column)}))`);
for (const c of byRule("TEAM_NAME")) src("team", c, `LOWER(TRIM(t.${id(c.column)}))`);
// 2. build one-to-one fake maps (order randomised by the per-refresh salt)
// app tables use mixed text-comparison rules (collations); compare against helper tables by exact bytes
const B = e => `(${e}) COLLATE utf8mb4_bin`;
const rn = n => `ROW_NUMBER() OVER (ORDER BY SHA2(CONCAT(m.salt, x.\`real\`), 256))`;
s.push(`INSERT INTO __map_phone (\`real\`, fake) SELECT x.\`real\`, CONCAT('+19992', LPAD(${rn()}, 6, '0')) FROM __src_phone x ${GUARD}`);
s.push(`INSERT INTO __map_email (\`real\`, fake) SELECT x.\`real\`, CONCAT('u', LPAD(${rn()}, 6, '0'), '@example.invalid') FROM __src_email x ${GUARD}`);
const F = FIRST.length, L = LAST.length, W = TEAM_WORDS.length;
s.push(`INSERT INTO __map_name (\`real\`, fake) SELECT k.\`real\`, CONCAT(f.v, ' ', l.v, IF(k.k >= ${F * L}, CONCAT(' ', k.k DIV ${F * L}), '')) FROM (SELECT x.\`real\`, ${rn()} - 1 AS k FROM __src_name x ${GUARD}) k JOIN __name_first f ON f.i = k.k % ${F} JOIN __name_last l ON l.i = (k.k DIV ${F}) % ${L}`);
s.push(`INSERT INTO __map_team (\`real\`, fake) SELECT k.\`real\`, CONCAT('Team ', w.v, IF(k.k >= ${W}, CONCAT(' ', k.k DIV ${W} + 1), '')) FROM (SELECT x.\`real\`, ${rn()} - 1 AS k FROM __src_team x ${GUARD}) k JOIN __team_words w ON w.i = k.k % ${W}`);
// 3. column rules
const upd = (c, set, extraJoin = "", where = notEmpty(c)) => s.push(`UPDATE ${id(c.table)} t ${GUARD}${extraJoin} SET t.${id(c.column)} = ${set} WHERE ${where}`);
const isFirst = col => /first/i.test(col), isLast = col => /last/i.test(col) && /name/i.test(col);
const PAY_PREFIX = c => /customerid/i.test(c) ? "cus_STAGING_" : /paymentmethodid/i.test(c) ? "pm_STAGING_" : /paymentintentid/i.test(c) ? "pi_STAGING_"
  : /setupintentid/i.test(c) ? "seti_STAGING_" : /invoiceid/i.test(c) ? "in_STAGING_" : /link|url/i.test(c) ? "https://example.invalid/pay/STAGING_"
  : /sessionid/i.test(c) ? "cs_STAGING_" : "py_STAGING_";
for (const c of map) {
  if (truncSet.has(c.table)) continue;
  const col = `t.${id(c.column)}`;
  switch (c.rule) {
    case "PHONE": upd(c, `COALESCE(p.fake, ${PHONE_FAKE_DEFAULT})`, ` LEFT JOIN __map_phone p ON p.\`real\` = ${B(PHONE_NORM(col))}`); break;
    case "EMAIL": upd(c, fit(`COALESCE(e.fake, 'unknown@example.invalid')`, c), ` LEFT JOIN __map_email e ON e.\`real\` = ${B(`LOWER(TRIM(${col}))`)}`); break;
    case "CONTACT": upd(c, fit(`CASE WHEN ${col} LIKE '%@%' THEN COALESCE(e.fake, 'unknown@example.invalid') WHEN p.fake IS NOT NULL THEN p.fake ELSE CONCAT('SIM_', LEFT(${hash(c)}, 24)) END`, c),
      ` LEFT JOIN __map_email e ON e.\`real\` = ${B(`LOWER(TRIM(${col}))`)} LEFT JOIN __map_phone p ON p.\`real\` = ${B(PHONE_NORM(col))} AND ${col} NOT LIKE '%@%' AND LENGTH(REGEXP_REPLACE(${col}, '[^0-9]', '')) >= 10`); break;
    case "PERSON_NAME": {
      const fake = isFirst(c.column) ? "SUBSTRING_INDEX(n.fake, ' ', 1)" : isLast(c.column) ? "SUBSTRING_INDEX(SUBSTRING_INDEX(n.fake, ' ', 2), ' ', -1)" : "n.fake";
      upd(c, fit(`COALESCE(${fake}, 'Alex Example')`, c), ` LEFT JOIN __map_name n ON n.\`real\` = ${B(`LOWER(TRIM(${col}))`)}`); break;
    }
    case "TEAM_NAME": upd(c, fit(`COALESCE(tm.fake, 'Team Aspen')`, c), ` LEFT JOIN __map_team tm ON tm.\`real\` = ${B(`LOWER(TRIM(${col}))`)}`); break;
    case "ADDRESS":
      if (c.column === "apt") { upd(c, empty(c)); break; }
      upd(c, fit(`CONCAT(10 + CONV(SUBSTR(${hash(c)}, 1, 6), 16, 10) % 9000, ' ', st.v, COALESCE(REGEXP_SUBSTR(${col}, ', *[^,]+, *[A-Z]{2} *[0-9]{5}(-[0-9]{4})?'), ''))`, c),
        ` JOIN __streets st ON st.i = CONV(SUBSTR(SHA2(CONCAT(m.salt, 'street', ${col}), 256), 1, 6), 16, 10) % ${STREETS.length}`); break;
    case "GEO_ROUND": upd(c, `ROUND(${col}, 2)`, "", `${col} IS NOT NULL`); break;
    case "FREE_TEXT":
      // public_review_responses.entry must keep key/revision/updatedAt (database CHECK rule); everything else in it is dropped
      if (`${c.table}.${c.column}` === "public_review_responses.entry") { upd(c, "JSON_OBJECT('key', t.`key`, 'revision', t.revision, 'updatedAt', t.updatedAtMs)"); break; }
      upd(c, `CASE WHEN LEFT(TRIM(${col}), 1) = '[' THEN '[]' WHEN LEFT(TRIM(${col}), 1) = '{' THEN '{}' ELSE ${fit("'Sanitized text.'", c)} END`); break;
    case "JSON_EMPTY": upd(c, `CASE WHEN LEFT(TRIM(CAST(${col} AS CHAR)), 1) = '[' THEN '[]' ELSE '{}' END`, "", `${col} IS NOT NULL`); break;
    case "SECRET":
      if (/passwordhash/i.test(c.column)) upd(c, q(UNUSABLE_BCRYPT), "", `${col} IS NOT NULL`);
      else upd(c, c.nullable ? "NULL" : fit(`CONCAT('revoked_', ${hash(c)})`, c), "", `${col} IS NOT NULL`);
      break;
    case "PAYMENT_REF": upd(c, fit(`CONCAT(${q(PAY_PREFIX(c.column))}, LEFT(${hash(c)}, 16))`, c)); break;
    case "CARD_LAST4": upd(c, "'4242'"); break;
    case "EXTERNAL_ID": upd(c, fit(`CONCAT('SIM_', LEFT(${hash(c)}, 24))`, c)); break;
    case "MEDIA_URL": case "BLANK": upd(c, empty(c)); break;
  }
}
// 4. conversations: synthetic scenario matched to the lead's stage; timestamps spaced 10 minutes, ending at the real last-message time
const scen = `CASE
    WHEN cs.stage IN ('BOOKED','DONE','FUTURE_BOOKING','CALL_SCHEDULED','SCHEDULE_CONFIRM_SENT','SCHEDULE_CONFIRM_DONE')
      THEN ELT(1 + cs.id % 4, 'new_booking', 'reschedule', 'recurring', 'new_booking')
    WHEN cs.stage IN ('FOLLOW_UP_SCHEDULED','REACTIVATION','REACTIVATION_TIME','REVIEW_REBOOKING_REQUESTED','REVIEW_REBOOKING_DONE') THEN 'recurring'
    WHEN cs.stage IN ('REVIEW_REQUESTED','REVIEW_DONE','QUALITY_RATING_REQUESTED','QUALITY_MISSED_FOLLOWUP','QUALITY_RATING_DONE')
      THEN ELT(1 + cs.id % 2, 'complaint', 'general')
    WHEN cs.stage IN ('COLD','LOST','NOT_INTERESTED','VOICEMAIL','YELP_CONTACTED') THEN 'cancellation'
    WHEN cs.stage IN ('CLIENT_STATUS_INQUIRY','CLIENT_STATUS_INQUIRY_DONE') THEN 'reschedule'
    WHEN cs.stage IN ('INTERVIEW_LINK_SENT','INTERVIEW_NUDGE_1','INTERVIEW_NUDGE_2','INTERVIEW_LINK_DONE','HIRING_OUTBOUND') THEN 'cleaner_coordination'
    WHEN cs.stage IN ('RESOLVED','UNHANDLED') THEN 'general'
    ELSE 'quote' END`;
const base = "COALESCE(NULLIF(cs.lastMessageTs, 0), UNIX_TIMESTAMP(cs.updatedAt) * 1000)";
let hist = "sc.history";
for (let i = 0; i < MAXMSG; i++) hist = `REPLACE(${hist}, '__TS${i}__', CAST(${base} - (sc.n - 1 - ${i}) * 600000 AS CHAR))`;
const first = "COALESCE(NULLIF(SUBSTRING_INDEX(TRIM(cs.leadName), ' ', 1), ''), 'there')";
s.push(`UPDATE conversation_sessions cs ${GUARD.replace("JOIN", "JOIN")} JOIN __synthetic_conversations sc ON sc.scenario = ${scen} AND sc.variant = cs.id % 3
  SET cs.messageHistory = REPLACE(${hist}, '{first}', ${first}),
      cs.lastMessageText = LEFT(REPLACE(sc.last_text, '{first}', ${first}), 255),
      cs.lastMessageRole = sc.last_role,
      cs.messageCount = sc.n`);
// 5. empty whole tables
for (const t of truncTables) s.push(`DELETE t FROM ${id(t)} t ${GUARD}`);
// 6. neutralise pending actions (values the app treats as finished/cancelled)
const NEUT = {
  "always_on_enrollments.status": ["'SKIPPED'", "t.status = 'PENDING'"],
  "always_on_groups.isActive": ["0", "t.isActive <> 0"],
  "booking_notification_deliveries.status": ["'failed'", "t.status IN ('pending','sending')"],
  "booking_notification_deliveries.claimToken": ["NULL", "t.claimToken IS NOT NULL"],
  "booking_notification_deliveries.claimedAt": ["NULL", "t.claimedAt IS NOT NULL"],
  "lead_notification_deliveries.status": ["'failed'", "t.status IN ('pending','sending')"],
  "lead_notification_deliveries.claimToken": ["NULL", "t.claimToken IS NOT NULL"],
  "lead_notification_deliveries.claimedAt": ["NULL", "t.claimedAt IS NOT NULL"],
  "campaign_approval_batches.status": ["'rejected'", "t.status IN ('pending','approved')"],
  "confirmation_calls.status": ["'failed'", "t.status = 'pending'"],
  "conversation_sessions.autoFollowUpSent": ["1", "t.autoFollowUpSent = 0"],
  "conversation_sessions.followUpSent": ["1", "t.followUpSent = 0"],
  "conversation_sessions.madisonDeferredUntil": ["NULL", "t.madisonDeferredUntil IS NOT NULL"],
  "inbound_sms.processingStatus": ["'failed'", "t.processingStatus = 'pending'"],
  "madison_email_drafts.status": ["'DISMISSED'", "t.status IN ('RECEIVED','CLASSIFIED','TOOLS_RUNNING','DRAFT_READY','SENDING')"],
  "madison_sms_drafts.status": ["'DISMISSED'", "t.status IN ('RECEIVED','CLASSIFIED','TOOLS_RUNNING','DRAFT_READY','SENDING')"],
  "nurture_enrollments.status": ["'paused'", "t.status = 'active'"],
  "nurture_enrollments.nextSendAt": ["NULL", "t.nextSendAt IS NOT NULL"],
  "payable_invoice_attempts.state": ["'expired'", "t.state IN ('pending','session_open')"],
  "payable_invoice_deliveries.state": ["'unknown'", "t.state = 'pending'"],
  "payment_authorizations.status": ["'cancelled'", "t.status IN ('pending','authorized')"],
  "rating_sms_pending.status": ["'skipped'", "t.status IN ('pending','approved')"],
  "reactivation_campaigns.status": ["'PAUSED'", "t.status = 'ACTIVE'"],
  "reactivation_contacts.status": ["'OPTED_OUT'", "t.status = 'PENDING'"],
  "sms_campaigns.status": ["'PAUSED'", "t.status IN ('FROZEN','APPROVED','SENDING')"],
  "sms_campaign_recipients.status": ["'SKIPPED'", "t.status = 'PENDING'"],
  "twilio_lead_bridges.state": ["'cancelled'", "t.state NOT IN ('completed','failed','cancelled') AND t.state NOT LIKE '%failed'"],
};
// internal staff items kept for realism (cannot contact anyone): follow_ups.dueAt, ops_tasks.status/dueAt, issue_engine.status
const INTERNAL_KEEP = new Set(["follow_ups.dueAt", "ops_tasks.status", "ops_tasks.dueAt", "issue_engine.status"]);
const SKIP_NEUT = new Set();
for (const c of byRule("NEUTRALIZE")) {
  const k = `${c.table}.${c.column}`;
  if (INTERNAL_KEEP.has(k)) continue;
  const n = NEUT[k];
  if (!n) throw new Error(`NEUTRALIZE column without a rule: ${k}`);
  // a "clear it" rule on a column that must hold a value is skipped; its status rule already stops it (e.g. nurture_enrollments.nextSendAt)
  if (n[0] === "NULL" && !c.nullable) { SKIP_NEUT.add(k); continue; }
  const val = n[0];
  s.push(`UPDATE ${id(c.table)} t ${GUARD} SET t.${id(c.column)} = ${val} WHERE ${n[1]}`);
}
// 7. phones/emails written inside kept text (templates, prices, settings) -> fake
const keptText = map.filter(c => !truncSet.has(c.table) && ["KEEP", "JSON_KEEP"].includes(c.rule) && c.isString && !/^enum/.test(c.type));
for (const c of keptText) {
  const v = `CAST(t.${id(c.column)} AS CHAR)`;
  s.push(`UPDATE ${id(c.table)} t ${GUARD} SET t.${id(c.column)} = REGEXP_REPLACE(REGEXP_REPLACE(${v}, '${EMAIL_RE}', 'info@example.invalid'), '${PHONE_RE}', '+19992000000') WHERE ${v} REGEXP '${PHONE_RE}' OR REGEXP_REPLACE(${v}, '${FAKE_EMAIL_RE}', '') REGEXP '${EMAIL_RE}'`);
}
// 8. settings that look like credentials
s.push(`UPDATE app_settings t ${GUARD} SET t.\`value\` = '' WHERE LOWER(t.\`key\`) REGEXP 'token|secret|password|api_?key|webhook|credential|private|signing'`);
s.push(`SELECT 'SANITIZE COMPLETE' AS step, m.drift_ok AS ok FROM ${M} m`);

// ---------- verify.sql ----------
const v = [];
const chk = (rule, c, cond) => v.push(`SELECT ${q(rule)} AS rule_name, ${q(c.table)} AS table_name, ${q(c.column)} AS column_name, COUNT(*) AS failing_rows FROM ${id(c.table)} t WHERE ${cond}`);
const col = c => `t.${id(c.column)}`;
v.push(`SELECT 'STRUCTURE' AS rule_name, u.t AS table_name, u.c AS column_name, 1 AS failing_rows FROM (${unmapped}) u`);
for (const t of truncTables) v.push(`SELECT 'TRUNCATE_TABLE', ${q(t)}, '*', COUNT(*) FROM ${id(t)} t`);
for (const c of map) {
  if (truncSet.has(c.table)) continue;
  const x = col(c), ne = `${x} IS NOT NULL AND ${x} <> ''`;
  switch (c.rule) {
    case "PHONE": chk(c.rule, c, `${ne} AND ${x} NOT REGEXP '^\\\\+19992[0-9]{6}$'`); break;
    case "EMAIL": chk(c.rule, c, `${ne} AND ${x} NOT LIKE '%@example.invalid'`); break;
    case "CONTACT": chk(c.rule, c, `${ne} AND ${x} NOT REGEXP '^\\\\+19992[0-9]{6}$' AND ${x} NOT LIKE '%@example.invalid' AND ${x} NOT LIKE 'SIM\\\\_%'`); break;
    case "PERSON_NAME":
      chk(c.rule, c, `${ne} AND ${x} NOT IN ('Alex Example', 'Alex', 'Example') AND ${isFirst(c.column) ? `${B(x)} NOT IN (SELECT v FROM __name_first)` : isLast(c.column) ? `${B(x)} NOT IN (SELECT v FROM __name_last)` : `${B(x)} NOT IN (SELECT fake FROM __map_name)`}`); break;
    case "TEAM_NAME": chk(c.rule, c, `${ne} AND ${B(x)} NOT IN (SELECT fake FROM __map_team) AND ${x} <> 'Team Aspen'`); break;
    case "ADDRESS": chk(c.rule, c, c.column === "apt" ? ne : `${ne} AND ${x} NOT REGEXP '^[0-9]+ (${STREETS.join("|")})'`); break;
    case "FREE_TEXT":
      if (`${c.table}.${c.column}` === "public_review_responses.entry") { chk(c.rule, c, `JSON_LENGTH(${x}) <> 3`); break; }
      chk(c.rule, c, `${ne} AND ${x} NOT IN ('[]', '{}', ${fit("'Sanitized text.'", c)})`); break;
    case "JSON_EMPTY": chk(c.rule, c, `${x} IS NOT NULL AND CAST(${x} AS CHAR) NOT IN ('{}', '[]')`); break;
    case "SECRET": chk(c.rule, c, `${x} IS NOT NULL AND ${x} <> '' AND ${x} <> ${q(UNUSABLE_BCRYPT)} AND ${x} NOT LIKE 'revoked\\\\_%'`); break;
    case "PAYMENT_REF": chk(c.rule, c, `${ne} AND ${x} NOT LIKE '%STAGING%'`); break;
    case "CARD_LAST4": chk(c.rule, c, `${ne} AND ${x} <> '4242'`); break;
    case "EXTERNAL_ID": chk(c.rule, c, `${ne} AND ${x} NOT LIKE 'SIM\\\\_%'`); break;
    case "MEDIA_URL": case "BLANK": chk(c.rule, c, ne); break;
    case "GEO_ROUND": chk(c.rule, c, `${x} IS NOT NULL AND ${x} <> ROUND(${x}, 2)`); break;
    case "CONVERSATION": if (c.column === "messageHistory") chk(c.rule, c, `${x} NOT LIKE '%"synthetic":true%'`); break;
  }
  if (c.isString && !["PHONE", "EMAIL", "CONTACT"].includes(c.rule) && !/^enum/.test(c.type)) {
    const s2 = `CAST(${x} AS CHAR)`;
    chk("PHONE_OR_EMAIL_IN_TEXT", c, `${s2} REGEXP '${PHONE_RE}' OR REGEXP_REPLACE(${s2}, '${FAKE_EMAIL_RE}', '') REGEXP '${EMAIL_RE}'`);
  }
}
for (const [k, n] of Object.entries(NEUT)) { if (SKIP_NEUT.has(k)) continue; const [t, c] = k.split("."); v.push(`SELECT 'NEUTRALIZE', ${q(t)}, ${q(c)}, COUNT(*) FROM ${id(t)} t WHERE ${n[1]}`); }
const verifySql = `-- LeadFlow staging sanitizer — LEAK CHECK. Read-only. Returns ONLY failing checks (rule, table, column, count). No rows returned = PASS.
SELECT * FROM (
${v.join("\nUNION ALL ")}
) checks WHERE failing_rows > 0 ORDER BY rule_name, table_name, column_name;
SELECT 'LEAK CHECK SUMMARY' AS step, ${v.length} AS checks_run;
`;

// ---------- cleanup.sql ----------
const cleanup = `-- Drops the sanitizer helper tables (they hold the original->fake maps). Run after verify.sql passes, before export.\n` +
  helpers.slice(1).map(h => `DROP TABLE IF EXISTS ${h};`).join("\n") + `\nDROP TABLE IF EXISTS ${M};\n`;

const write = (f, stmts, header = "") => fs.writeFileSync(path.join(outDir, f), Array.isArray(stmts) ? header + "\n" + stmts.join(";\n") + ";\n" : stmts);
write("prepare.sql", prep, PREP_HEADER); write("sanitize.sql", s, SAN_HEADER); write("verify.sql", verifySql); write("cleanup.sql", cleanup);
console.log(`prepare.sql: ${prep.length} statements | sanitize.sql: ${s.length} statements | verify.sql: ${v.length} checks | conversations: ${convRows.length}`);
