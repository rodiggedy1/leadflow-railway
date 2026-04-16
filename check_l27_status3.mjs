import * as dotenv from "dotenv";
dotenv.config();

const token = process.env.LAUNCH27_BEARER_TOKEN;
const subdomain = process.env.LAUNCH27_TENANT ?? "maidsinblack";
const BASE = `https://${subdomain}.launch27.com`;

// Zombie jobs: jobId → { bookingId, customer, jobDate }
const zombies = [
  { jobId: 30008,  bookingId: 444021, customer: "Michelle Balch",  jobDate: "2026-03-19" },
  { jobId: 210011, bookingId: 444261, customer: "Derek khanna",    jobDate: "2026-03-27" },
  { jobId: 240005, bookingId: 443676, customer: "Denise JONES",    jobDate: "2026-03-28" },
  { jobId: 270009, bookingId: 444190, customer: "James Zee",       jobDate: "2026-03-30" },
  { jobId: 270020, bookingId: 444455, customer: "Jonathan Aries",  jobDate: "2026-03-31" },
  { jobId: 360015, bookingId: 444472, customer: "Kim Butler",      jobDate: "2026-04-07" },
  { jobId: 390043, bookingId: 444328, customer: "Laura Henry",     jobDate: "2026-04-09" },
];

for (const z of zombies) {
  const params = new URLSearchParams({ from: z.jobDate, to: z.jobDate, limit: "50", offset: "0", sort: "asc" });
  const url = `${BASE}/v1/staff/bookings?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) { console.log(`  jobId=${z.jobId} → HTTP ${res.status}`); continue; }
  const bookings = await res.json();
  const match = bookings.find(b => b.id === z.bookingId);
  if (match) {
    console.log(`  jobId=${z.jobId} bookingId=${z.bookingId} customer=${z.customer} → L27 status=${match.booking_status ?? match.status} completed=${match.completed}`);
  } else {
    console.log(`  jobId=${z.jobId} bookingId=${z.bookingId} customer=${z.customer} jobDate=${z.jobDate} → NOT FOUND in L27 for that date (${bookings.length} bookings on that day)`);
    if (bookings.length > 0) {
      console.log(`    Available IDs: ${bookings.map(b => b.id).join(", ")}`);
    }
  }
}
