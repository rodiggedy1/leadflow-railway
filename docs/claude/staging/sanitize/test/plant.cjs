#!/usr/bin/env node
// TEST ONLY — local throwaway database. Fills every table with fake-but-realistic-looking personal data
// ("planted" values) so the sanitizer and leak check can be proven before any real data is involved.
// Usage: node plant.cjs mysql://user:pass@127.0.0.1:3306/dbname
"use strict";
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const url = process.argv[2];
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url || "")) throw new Error("local database only");

const map = new Map(fs.readFileSync(path.join(__dirname, "..", "column-map.tsv"), "utf8").trim().split("\n").slice(1)
  .map(l => l.split("\t")).map(([t, c, , rule]) => [`${t}.${c}`, rule]));
const PHONES = ["+12025550101", "(202) 555-0102", "202.555.0103", "+1 301 555 0104"];
const EMAILS = ["sarah.johnson@gmail.com", "MIKE.BROWN@yahoo.com", "jlee@company.org", "ana.r@outlook.com"];
const NAMES = ["Sarah Johnson", "Michael Brown", "Jennifer Lee", "Ana Rodriguez"];
const TEAMS = ["Maria's Team", "Team Carlos", "Rosa & Linda", "Team Grace"];
const PII_TEXT = "Call Sarah Johnson at (202) 555-0101 or sarah.johnson@gmail.com. Gate code 4471, 1234 Oak Street.";
const HISTORY = JSON.stringify([{ role: "user", content: "Hi, it's Sarah Johnson, 1234 Oak St, call me at 202-555-0101", ts: 1764000000000 },
  { role: "assistant", content: "Thanks Sarah! Your quote is $165.", ts: 1764000060000 }]);
// values that count as "pending" for the neutralize checks
const PENDING = {
  "always_on_enrollments.status": "PENDING", "always_on_groups.isActive": 1, "booking_notification_deliveries.status": "pending",
  "booking_notification_deliveries.claimToken": "claim-abc", "lead_notification_deliveries.status": "sending", "lead_notification_deliveries.claimToken": "claim-def",
  "campaign_approval_batches.status": "approved", "confirmation_calls.status": "pending", "conversation_sessions.autoFollowUpSent": 0,
  "conversation_sessions.followUpSent": 0, "conversation_sessions.madisonDeferredUntil": 1764000000000, "inbound_sms.processingStatus": "pending",
  "madison_email_drafts.status": "DRAFT_READY", "madison_sms_drafts.status": "SENDING", "nurture_enrollments.status": "active",
  "payable_invoice_attempts.state": "session_open", "payable_invoice_deliveries.state": "pending", "payment_authorizations.status": "authorized",
  "rating_sms_pending.status": "approved", "reactivation_campaigns.status": "ACTIVE", "reactivation_contacts.status": "PENDING",
  "sms_campaigns.status": "SENDING", "sms_campaign_recipients.status": "PENDING", "twilio_lead_bridges.state": "dialing_customer",
};
const TEMPLATE_WITH_CONTACT = new Set(["message_templates.body", "response_templates.message", "sms_campaigns.messageTemplate", "app_settings.value"]);

// invoice tables have strict CHECK rules and foreign keys: give them consistent, valid values
const UUID = i => `00000000-0000-0000-0000-00000000000${i}`;
function special(table, col, i) {
  const n = col.name;
  if (table === "public_review_responses") {
    const key = String(i).repeat(64);
    if (n === "key") return key;
    if (n === "revision") return 1;
    if (n === "updatedAtMs") return 1764000000000 + i;
    if (n === "entry") return JSON.stringify({ key, revision: 1, updatedAt: 1764000000000 + i, text: PII_TEXT, reviewer: NAMES[i] });
  }
  if (/^payable_/.test(table)) {
    if (n === "currency") return "usd";
    if (/amountCents$/.test(n)) return 1000;
    if (/^(paidCents|manualPaidCents)$/.test(n)) return 0;
    if (n === "periodFrom") return "2026-11-01";
    if (n === "periodTo") return "2026-11-30";
    if (table === "payable_invoices" && n === "status") return "open";
    if (table === "payable_invoices" && n === "paidAtMs") return null;
    if (n === "selectedLineIds") return "[1]";
    if (table === "payable_invoice_attempts") {
      if (n === "state") return i === 3 ? "paid" : "session_open";
      if (n === "paymentId" || n === "paidAtMs") return i === 3 ? (n === "paymentId" ? "py_RealPayment3" : 1764000000003) : null;
    }
    if (/^(id|attemptId|requestId|activeAttemptId)$/.test(n) && col.len === 36) return UUID(i);
    if (/^(invoiceId|lineId)$/.test(n)) return i + 1;
  }
  return undefined;
}

function value(table, col, i) {
  const key = `${table}.${col.name}`, rule = map.get(key), t = col.data_type, len = col.len;
  const cut = v => (typeof v === "string" && len ? v.slice(0, len) : v);
  const sp = special(table, col, i);
  if (sp !== undefined) return sp;
  if (key in PENDING) return PENDING[key];
  if (JSON_CHECKED.has(key) && !["JSON_EMPTY", "JSON_KEEP", "CONVERSATION"].includes(rule))
    return rule === "FREE_TEXT" ? JSON.stringify({ note: PII_TEXT }) : "{}";
  if (/^enum$/.test(t)) return col.enumValues[i % col.enumValues.length];
  const num = /int|decimal|double|float/.test(t), date = /date|time/.test(t);
  if (num) return rule === "GEO_ROUND" ? 38.9071923 + i : /tinyint/.test(t) ? i % 2 : /bigint/.test(t) ? 1764000000000 + i : i + 1;
  if (date) return t === "date" ? "2026-11-20" : "2026-11-20 10:00:00";
  switch (rule) {
    case "PHONE": return cut(PHONES[i]);
    case "EMAIL": return cut(EMAILS[i]);
    case "CONTACT": return cut(i % 2 ? EMAILS[i] : PHONES[i]);
    case "PERSON_NAME": return cut(/first/i.test(col.name) ? NAMES[i].split(" ")[0] : /last/i.test(col.name) && /name/i.test(col.name) ? NAMES[i].split(" ")[1] : NAMES[i]);
    case "TEAM_NAME": return cut(TEAMS[i]);
    case "ADDRESS": return cut(col.name === "apt" ? "5B" : `${1234 + i} Oak Street, Apt 5, Washington, DC 2000${i}`);
    case "FREE_TEXT": return cut(col.name === "history" ? `[{"note":"${PII_TEXT}"}]` : PII_TEXT);
    case "CONVERSATION": return col.name === "messageHistory" ? HISTORY : cut("Sarah here, call me at 202-555-0101");
    case "SECRET": return cut(/passwordhash/i.test(col.name) ? "$2b$10$realLookingHashOfARealPassword000000000000000000000" : `tok_live_SECRET${i}abcdef`);
    case "PAYMENT_REF": return cut(`cus_RealCustomer${i}XYZ`);
    case "CARD_LAST4": return "1234";
    case "EXTERNAL_ID": return cut(`AC9f8e7d6c5b4a${i}${table.length}`);
    case "MEDIA_URL": return cut(`https://pub-real.r2.dev/recordings/call-${i}.mp3`);
    case "JSON_EMPTY": return JSON.stringify({ name: NAMES[i], phone: PHONES[i], email: EMAILS[i] });
    case "JSON_KEEP": return JSON.stringify({ price: 150 + i, note: `call ${PHONES[i]}` });
    case "BLANK": return cut("+12025550101,+12025550102");
  }
  if (TEMPLATE_WITH_CONTACT.has(key)) return cut(`Questions? Text us at (202) 555-0199 or email hello@maidsinblack.com (${i})`);
  if (/json/.test(t) || /text/.test(t) && /history|extras|items|selection|snapshot|stages|tags|permissions|ids$/i.test(col.name)) return "[]";
  return cut(`${i}-${col.name}`);
}
const JSON_CHECKED = new Set();
const PARENTS_FIRST = ["payable_invoices", "payable_invoice_lines", "payable_invoice_attempts"];

(async () => {
  const db = await mysql.createConnection(url);
  const [cols] = await db.query(`SELECT table_name, column_name, data_type, column_type, character_maximum_length len, extra, is_nullable
    FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name NOT LIKE '\\_\\_%' ORDER BY table_name, ordinal_position`);
  const [checks] = await db.query(`SELECT table_name t, check_clause cc FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND check_clause LIKE 'json_valid(%'`);
  for (const r of checks) { const m = String(r.cc ?? r.CHECK_CLAUSE).match(/json_valid\(`([^`]+)`\)/); if (m) JSON_CHECKED.add(`${r.t ?? r.TABLE_NAME}.${m[1]}`); }
  const byTable = new Map(PARENTS_FIRST.map(t => [t, []]));
  for (const c of cols) {
    const t = c.table_name ?? c.TABLE_NAME;
    const col = { name: c.column_name ?? c.COLUMN_NAME, data_type: (c.data_type ?? c.DATA_TYPE).toLowerCase(), len: c.len ?? c.LEN,
      extra: (c.extra ?? c.EXTRA) || "", enumValues: [] };
    const ct = c.column_type ?? c.COLUMN_TYPE;
    if (col.data_type === "enum") col.enumValues = [...ct.matchAll(/'([^']*)'/g)].map(m => m[1]);
    if (/generated|auto_increment/i.test(col.extra)) continue;
    (byTable.get(t) || byTable.set(t, []).get(t)).push(col);
  }
  let rows = 0, failed = 0;
  for (const [t, cs] of byTable) for (let i = 0; i < 4; i++) {
    const vals = cs.map(c => value(t, c, i));
    try { await db.query(`INSERT INTO \`${t}\` (${cs.map(c => `\`${c.name}\``).join(",")}) VALUES (${cs.map(() => "?").join(",")})`, vals); rows++; }
    catch (e) { failed++; if (!globalThis.__seen?.has(t)) { (globalThis.__seen ??= new Set()).add(t); console.log(`  insert failed ${t}: ${e.message.slice(0, 160)}`); } }
  }
  // coverage: how many sensitive (non-KEEP) columns actually hold planted data
  let covered = 0, total = 0; const empty = [];
  for (const [key, rule] of map) {
    if (["KEEP", "JSON_KEEP", "TRUNCATE_TABLE"].includes(rule)) continue;
    const [t, c] = key.split("."); total++;
    const [[r]] = await db.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE \`${c}\` IS NOT NULL AND CAST(\`${c}\` AS CHAR) <> ''`);
    if (Number(r.n) > 0) covered++; else empty.push(key);
  }
  console.log(`planted rows: ${rows} (failed inserts: ${failed}) | sensitive columns holding planted data: ${covered}/${total}`);
  if (empty.length) console.log(`  not planted: ${empty.join(", ")}`);
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
