/**
 * Seed script: inserts the 10 pre-built AI call templates into the call_templates table.
 * Run once: node server/seedCallTemplates.mjs
 */
import mysql from "mysql2/promise";

const templates = [
  {
    name: "Cleaner Arrival Confirmation",
    triggerType: "arrival_confirmation",
    targetType: "team",
    sortOrder: 1,
    scriptTemplate:
      "Hi {{team_name}}, this is Madison from Maids in Black. I'm confirming you've arrived at {{address}} for {{client_name}}. Please say 'arrived' or press 1. If you're delayed, say your ETA.",
  },
  {
    name: "Late Team Escalation — Cleaner",
    triggerType: "late_team",
    targetType: "team",
    sortOrder: 2,
    scriptTemplate:
      "Hi {{team_name}}, this is Madison from Maids in Black. We don't see your check-in for the {{time}} job. Please confirm your status now. Are you on-site, on the way, or delayed?",
  },
  {
    name: "Access Issue — Client",
    triggerType: "no_access",
    targetType: "client",
    sortOrder: 3,
    scriptTemplate:
      "Hi {{client_name}}, this is Madison from Maids in Black. Your cleaning team has arrived, but they're unable to access the home right now. Please give us a quick call or text back so we can get started. Thank you.",
  },
  {
    name: "Parking Issue — Client",
    triggerType: "parking",
    targetType: "client",
    sortOrder: 4,
    scriptTemplate:
      "Hi {{client_name}}, this is Madison from Maids in Black. Your team is nearby but looking for parking in the area. They should be there shortly. If you know of any easier parking instructions, feel free to text us back.",
  },
  {
    name: "Delay Update — Client",
    triggerType: "delay_update",
    targetType: "client",
    sortOrder: 5,
    scriptTemplate:
      "Hi {{client_name}}, this is Madison from Maids in Black. I wanted to give you a quick update that your cleaning team is running behind the original ETA due to traffic and schedule timing. Their updated arrival window is approximately {{new_eta}}. We appreciate your patience and will keep you updated if anything changes.",
  },
  {
    name: "Check-In Reminder — Cleaner",
    triggerType: "checkin_reminder",
    targetType: "team",
    sortOrder: 6,
    scriptTemplate:
      "Hi {{team_name}}, this is a reminder that we still need your check-in for the {{time}} appointment at {{client_name}}. Please check in now so the office can update the customer.",
  },
  {
    name: "Lockout Warning — Client",
    triggerType: "lockout_warning",
    targetType: "client",
    sortOrder: 7,
    scriptTemplate:
      "Hi {{client_name}}, this is Madison from Maids in Black. Your cleaning team has arrived but no one appears to be home and we haven't been able to access the property yet. Please call or text us as soon as possible so we can avoid delays or lockout fees.",
  },
  {
    name: "Lockout Final Notice — Client",
    triggerType: "lockout_final",
    targetType: "client",
    sortOrder: 8,
    scriptTemplate:
      "Hi {{client_name}}, this is Madison from Maids in Black. We're still unable to access the property after arriving for your scheduled appointment. Please contact us within the next few minutes so we can determine whether the appointment can still proceed today.",
  },
  {
    name: "Utility Issue — Client",
    triggerType: "utility_issue",
    targetType: "client",
    sortOrder: 9,
    scriptTemplate:
      "Hi {{client_name}}, this is Madison from Maids in Black. The team has arrived but there appears to be an issue with {{water_power_access}} at the property. Please give us a quick call or text so we can determine the best next step.",
  },
  {
    name: "Completion Walkthrough — Client",
    triggerType: "completion_walkthrough",
    targetType: "client",
    sortOrder: 10,
    scriptTemplate:
      "Hi {{client_name}}, your cleaning has just been completed. If you're home, we'd love for you to do a quick walkthrough while the team is still nearby in case there's anything you'd like touched up.",
  },
];

async function seed() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    for (const t of templates) {
      // Skip if a template with this name already exists
      const [existing] = await conn.execute(
        "SELECT id FROM call_templates WHERE name = ? LIMIT 1",
        [t.name]
      );
      if (existing.length > 0) {
        console.log(`  SKIP (exists): ${t.name}`);
        continue;
      }
      await conn.execute(
        `INSERT INTO call_templates (name, triggerType, targetType, scriptTemplate, isActive, sortOrder, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 1, ?, NOW(), NOW())`,
        [t.name, t.triggerType, t.targetType, t.scriptTemplate, t.sortOrder]
      );
      console.log(`  INSERTED: ${t.name}`);
    }
    console.log("Seed complete.");
  } finally {
    conn.end();
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
