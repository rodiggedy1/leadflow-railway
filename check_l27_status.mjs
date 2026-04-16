import * as dotenv from "dotenv";
dotenv.config();

const token = process.env.LAUNCH27_BEARER_TOKEN;
const subdomain = process.env.LAUNCH27_TENANT ?? "maidsinblack";
const BASE = `https://${subdomain}.launch27.com/api/v1`;

// Check each zombie job's booking status in Launch27
const bookingIds = [444021, 444261, 443676, 444190, 444455, 444472, 444328];
const customers =  ["Michelle Balch", "Derek khanna", "Denise JONES", "James Zee", "Jonathan Aries", "Kim Butler", "Laura Henry"];

for (let i = 0; i < bookingIds.length; i++) {
  const bid = bookingIds[i];
  try {
    const res = await fetch(`${BASE}/bookings/${bid}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
    if (!res.ok) {
      console.log(`  bookingId=${bid} customer=${customers[i]} → HTTP ${res.status}`);
      continue;
    }
    const data = await res.json();
    console.log(`  bookingId=${bid} customer=${customers[i]} → status=${data.status} active=${data.active}`);
  } catch (e) {
    console.log(`  bookingId=${bid} customer=${customers[i]} → ERROR: ${e.message}`);
  }
}
