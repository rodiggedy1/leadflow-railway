import { getDb } from './server/db';
import { nurtureEnrollments } from './drizzle/schema';

async function main() {
  const db = await getDb();
  if (!db) { console.log('no db'); return; }
  const all = await db.select().from(nurtureEnrollments);
  console.log('Total:', all.length);
  all.forEach(r => console.log(JSON.stringify({ id: r.id, name: r.leadFirstName, phone: r.leadPhone, status: r.status, enrolledAt: r.enrolledAt })));
}
main().catch(console.error).finally(() => process.exit(0));
