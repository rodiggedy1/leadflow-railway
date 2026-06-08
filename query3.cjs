const mysql = require('mysql2/promise');
async function main() {
  const conn = await mysql.createConnection({
    uri: "mysql://QXWpcJKwPBoGqNG.f679bd03aa5d:lavuI337Gv3r6hjOW1wI@gateway04.us-east-1.prod.aws.tidbcloud.com:4000/CAeRhAUjAZoEuxNGm5QbPr",
    ssl: { rejectUnauthorized: true },
    connectTimeout: 15000
  });

  // Get recent successes and failures side by side for same steps
  const [rows] = await conn.execute(`
    SELECT step, success, recipientPhone, errorDetail, firedAt
    FROM field_mgmt_log
    WHERE firedAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
    ORDER BY firedAt DESC
    LIMIT 60
  `);

  console.log("step | success | phone | error | time");
  for (const r of rows) {
    console.log(`${r.step} | ${r.success} | ${r.recipientPhone} | ${r.errorDetail || 'OK'} | ${r.firedAt}`);
  }
  await conn.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
