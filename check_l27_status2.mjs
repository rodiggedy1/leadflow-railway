import * as dotenv from "dotenv";
dotenv.config();

const token = process.env.LAUNCH27_BEARER_TOKEN;
const subdomain = process.env.LAUNCH27_TENANT ?? "maidsinblack";
const BASE = `https://${subdomain}.launch27.com/api/v1`;

// Try appointments endpoint instead of bookings
const bookingIds = [444021, 444261, 443676, 444190, 444455, 444472, 444328];
const customers =  ["Michelle Balch", "Derek khanna", "Denise JONES", "James Zee", "Jonathan Aries", "Kim Butler", "Laura Henry"];

// Test one with appointments
const res = await fetch(`${BASE}/appointments/${bookingIds[0]}`, {
  headers: { Authorization: `Bearer ${token}` }
});
console.log(`appointments/${bookingIds[0]} → HTTP ${res.status}`);
if (res.ok) {
  const d = await res.json();
  console.log(JSON.stringify(d).slice(0, 300));
}

// Also try jobs endpoint
const res2 = await fetch(`${BASE}/jobs/${bookingIds[0]}`, {
  headers: { Authorization: `Bearer ${token}` }
});
console.log(`jobs/${bookingIds[0]} → HTTP ${res2.status}`);
