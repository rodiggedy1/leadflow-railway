/**
 * Debug script: test the Launch27 API directly to diagnose the "no bookings" issue.
 * Run: node scripts/debug-launch27.mjs [YYYY-MM-DD]
 */
import { config } from "dotenv";
config({ path: ".env" });

const date = process.argv[2] || "2026-03-16";
const subdomain = process.env.LAUNCH27_TENANT || "maidsinblack";
const bearer = process.env.LAUNCH27_BEARER_TOKEN;

if (!bearer) {
  console.error("ERROR: LAUNCH27_BEARER_TOKEN not set in .env");
  process.exit(1);
}

const baseUrl = `https://${subdomain}.launch27.com`;
console.log(`\n=== Launch27 API Debug ===`);
console.log(`Base URL: ${baseUrl}`);
console.log(`Target date: ${date}`);
console.log(`Token (first 20 chars): ${bearer.substring(0, 20)}...`);

// Test 1: The exact call the sync makes
console.log(`\n--- Test 1: Exact sync call (completed, from=${date}, to=${date}) ---`);
{
  const params = new URLSearchParams({
    from: date,
    to: date,
    options: "completed,exclude_forecasted",
    limit: "20",
    offset: "0",
    sort: "asc",
  });
  const url = `${baseUrl}/v1/staff/bookings?${params.toString()}`;
  console.log(`URL: ${url}`);
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
  });
  console.log(`Status: ${resp.status}`);
  const body = await resp.text();
  if (resp.ok) {
    try {
      const data = JSON.parse(body);
      if (Array.isArray(data)) {
        console.log(`Count: ${data.length}`);
        if (data.length > 0) {
          console.log(`First booking keys: ${Object.keys(data[0]).join(", ")}`);
          console.log(`First booking status: ${data[0].booking_status}`);
          console.log(`First booking service_date: ${data[0].service_date}`);
          console.log(`First booking completed: ${data[0].completed}`);
        }
      } else {
        console.log(`Response type: ${typeof data}`);
        console.log(`Response keys: ${Object.keys(data).join(", ")}`);
        console.log(JSON.stringify(data, null, 2).substring(0, 500));
      }
    } catch {
      console.log(`Raw body: ${body.substring(0, 500)}`);
    }
  } else {
    console.log(`Error body: ${body.substring(0, 500)}`);
  }
}

// Test 2: Without the options filter — see ALL bookings for that date
console.log(`\n--- Test 2: No status filter (all bookings for ${date}) ---`);
{
  const params = new URLSearchParams({
    from: date,
    to: date,
    limit: "20",
    offset: "0",
    sort: "asc",
  });
  const url = `${baseUrl}/v1/staff/bookings?${params.toString()}`;
  console.log(`URL: ${url}`);
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
  });
  console.log(`Status: ${resp.status}`);
  const body = await resp.text();
  if (resp.ok) {
    try {
      const data = JSON.parse(body);
      if (Array.isArray(data)) {
        console.log(`Count: ${data.length}`);
        if (data.length > 0) {
          const statuses = [...new Set(data.map(b => b.booking_status))];
          console.log(`Unique statuses: ${statuses.join(", ")}`);
          data.slice(0, 3).forEach((b, i) => {
            console.log(`  [${i}] id=${b.id}, status=${b.booking_status}, service_date=${b.service_date}, completed=${b.completed}`);
          });
        }
      } else {
        console.log(JSON.stringify(data, null, 2).substring(0, 500));
      }
    } catch {
      console.log(`Raw body: ${body.substring(0, 500)}`);
    }
  } else {
    console.log(`Error body: ${body.substring(0, 500)}`);
  }
}

// Test 3: Try a wider date range to confirm there ARE bookings in the system
console.log(`\n--- Test 3: Last 7 days (no status filter) ---`);
{
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 7);
  const from = fromDate.toISOString().slice(0, 10);
  const to = toDate.toISOString().slice(0, 10);
  const params = new URLSearchParams({ from, to, limit: "5", offset: "0", sort: "desc" });
  const url = `${baseUrl}/v1/staff/bookings?${params.toString()}`;
  console.log(`URL: ${url}`);
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
  });
  console.log(`Status: ${resp.status}`);
  const body = await resp.text();
  if (resp.ok) {
    try {
      const data = JSON.parse(body);
      if (Array.isArray(data)) {
        console.log(`Count (up to 5): ${data.length}`);
        data.slice(0, 5).forEach((b, i) => {
          console.log(`  [${i}] id=${b.id}, status=${b.booking_status}, service_date=${b.service_date}, completed=${b.completed}`);
        });
      } else {
        console.log(JSON.stringify(data, null, 2).substring(0, 500));
      }
    } catch {
      console.log(`Raw body: ${body.substring(0, 500)}`);
    }
  } else {
    console.log(`Error body: ${body.substring(0, 500)}`);
  }
}

// Test 4: Try with "completed" only (not exclude_forecasted)
console.log(`\n--- Test 4: Only "completed" option (no exclude_forecasted) ---`);
{
  const params = new URLSearchParams({
    from: date,
    to: date,
    options: "completed",
    limit: "20",
    offset: "0",
  });
  const url = `${baseUrl}/v1/staff/bookings?${params.toString()}`;
  console.log(`URL: ${url}`);
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
  });
  console.log(`Status: ${resp.status}`);
  const body = await resp.text();
  if (resp.ok) {
    try {
      const data = JSON.parse(body);
      if (Array.isArray(data)) {
        console.log(`Count: ${data.length}`);
        if (data.length > 0) {
          data.slice(0, 3).forEach((b, i) => {
            console.log(`  [${i}] id=${b.id}, status=${b.booking_status}, service_date=${b.service_date}`);
          });
        }
      } else {
        console.log(JSON.stringify(data, null, 2).substring(0, 500));
      }
    } catch {
      console.log(`Raw body: ${body.substring(0, 500)}`);
    }
  } else {
    console.log(`Error body: ${body.substring(0, 500)}`);
  }
}

console.log(`\n=== Done ===`);
