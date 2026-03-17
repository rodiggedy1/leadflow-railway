/**
 * Check when the March 16 bookings were marked "completed" in Launch27.
 * This tells us if the sync ran before they were marked complete.
 */
import { config } from "dotenv";
config({ path: ".env" });

const date = process.argv[2] || "2026-03-16";
const subdomain = process.env.LAUNCH27_TENANT || "maidsinblack";
const bearer = process.env.LAUNCH27_BEARER_TOKEN;
const baseUrl = `https://${subdomain}.launch27.com`;

const params = new URLSearchParams({
  from: date,
  to: date,
  options: "completed,exclude_forecasted",
  limit: "20",
  offset: "0",
  sort: "asc",
});

const resp = await fetch(`${baseUrl}/v1/staff/bookings?${params}`, {
  headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
});
const bookings = await resp.json();

console.log(`\n=== Booking Completion Timestamps for ${date} ===`);
console.log(`Sync ran at: 2026-03-17 02:41 UTC (10:41 PM ET on March 16)\n`);

for (const b of bookings) {
  // Look for any timestamp fields that indicate when it was completed
  const relevantFields = {
    id: b.id,
    booking_status: b.booking_status,
    completed: b.completed,
    service_date: b.service_date,
    staff_confirmed_at: b.staff_confirmed_at,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
  
  // Also check actions array for completion action
  const actionsArr = Array.isArray(b.actions) ? b.actions : [];
  const completionAction = actionsArr.find(a => 
    a.action_type === "completed" || a.action_type === "finish" || 
    (a.description && a.description.toLowerCase().includes("complet"))
  );
  
  console.log(`Booking ${b.id} (${b.user?.name}):`);
  console.log(`  service_date: ${b.service_date}`);
  console.log(`  booking_status: ${b.booking_status}`);
  console.log(`  completed: ${b.completed}`);
  console.log(`  staff_confirmed_at: ${b.staff_confirmed_at ?? "null"}`);
  console.log(`  created_at: ${b.created_at ?? "null"}`);
  if (b.updated_at) console.log(`  updated_at: ${b.updated_at}`);
  if (completionAction) console.log(`  completion_action: ${JSON.stringify(completionAction)}`);
  
  // Check if staff_confirmed_at is AFTER the sync time (02:41 UTC March 17)
  if (b.staff_confirmed_at) {
    const confirmedAt = new Date(b.staff_confirmed_at);
    const syncRanAt = new Date("2026-03-17T02:41:59Z");
    const wasLate = confirmedAt > syncRanAt;
    if (wasLate) {
      console.log(`  ⚠️  CONFIRMED AFTER SYNC RAN (${b.staff_confirmed_at} > 02:41 UTC March 17)`);
    } else {
      console.log(`  ✓  Confirmed before sync ran`);
    }
  }
  console.log();
}

// Also check the first raw booking in full detail
if (bookings.length > 0) {
  console.log(`\n=== Full first booking raw data ===`);
  const first = bookings[0];
  // Print all top-level keys and their values (skip large arrays)
  for (const [key, val] of Object.entries(first)) {
    if (Array.isArray(val) && val.length > 3) {
      console.log(`  ${key}: [array of ${val.length}]`);
    } else if (typeof val === "object" && val !== null) {
      console.log(`  ${key}: ${JSON.stringify(val).substring(0, 100)}`);
    } else {
      console.log(`  ${key}: ${val}`);
    }
  }
}
