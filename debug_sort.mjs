import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Replicate exactly what rerunDistances does
const [allJobsRaw] = await conn.execute(
  'SELECT id, jobDate, teamName, serviceDateTime FROM cleaner_jobs WHERE jobDate = "2026-06-11" AND bookingStatus != "cancelled"'
);

const [assignmentsRaw] = await conn.execute(
  'SELECT cleanerJobId, teamId, routeOrder, driveTimeSecs, isManual, jobDate FROM schedule_assignments WHERE jobDate = "2026-06-11" AND teamId = 1'
);

console.log('Raw allJobs serviceDateTime for B,Karla jobs:');
for (const j of allJobsRaw) {
  if (j.id === 1620387 || j.id === 1620397) {
    console.log(`  job${j.id}: serviceDateTime=${JSON.stringify(j.serviceDateTime)} type=${typeof j.serviceDateTime} getTime=${j.serviceDateTime ? new Date(j.serviceDateTime).getTime() : 'null'}`);
  }
}

const jobSvcMs = new Map();
for (const j of allJobsRaw) {
  jobSvcMs.set(j.id, j.serviceDateTime ? new Date(j.serviceDateTime).getTime() : Infinity);
}

const active = assignmentsRaw
  .filter(a => a.isManual !== 2)
  .sort((a, b) => {
    const ta = jobSvcMs.get(a.cleanerJobId) ?? Infinity;
    const tb = jobSvcMs.get(b.cleanerJobId) ?? Infinity;
    if (ta !== tb) return ta - tb;
    return (a.routeOrder ?? 0) - (b.routeOrder ?? 0);
  });

console.log('\nSorted active order for team1 (B,Karla):');
for (let i = 0; i < active.length; i++) {
  const svcMs = jobSvcMs.get(active[i].cleanerJobId);
  console.log(`  [${i}] job${active[i].cleanerJobId} svcMs=${svcMs} routeOrder=${active[i].routeOrder}`);
}

await conn.end();
