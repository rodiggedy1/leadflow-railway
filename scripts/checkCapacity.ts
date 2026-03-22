import { getCompletedBookingsForDate } from "../server/launch27.ts";

async function main() {
  const EASTERN_TZ = "America/New_York";
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: EASTERN_TZ }));
  const todayET = new Date(nowET);
  const tomorrowET = new Date(nowET);
  tomorrowET.setDate(tomorrowET.getDate() + 1);

  const toDateStr = (d: Date) => [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");

  const todayStr = toDateStr(todayET);
  const tomorrowStr = toDateStr(tomorrowET);

  console.log("ET now:", nowET.toString());
  console.log("Today (ET):", todayStr);
  console.log("Tomorrow (ET):", tomorrowStr);

  const [todayResult, tomorrowResult] = await Promise.all([
    getCompletedBookingsForDate(todayStr, { includeAll: true }),
    getCompletedBookingsForDate(tomorrowStr, { includeAll: true }),
  ]);

  console.log("\n=== TODAY ===");
  console.log("Bookings:", todayResult.bookings.length);
  const todayTeams = new Set(todayResult.bookings.flatMap(b => b.teams.map(t => t.title)));
  console.log("Unique teams:", [...todayTeams]);

  console.log("\n=== TOMORROW ===");
  console.log("Bookings:", tomorrowResult.bookings.length);
  const tomorrowTeams = new Set(tomorrowResult.bookings.flatMap(b => b.teams.map(t => t.title)));
  console.log("Unique teams:", [...tomorrowTeams]);
  if (tomorrowResult.bookings[0]) console.log("Sample booking:", JSON.stringify(tomorrowResult.bookings[0], null, 2));
}

main().catch(console.error);
