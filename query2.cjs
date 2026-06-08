const mysql = require('mysql2/promise');
async function main() {
  const conn = await mysql.createConnection({
    uri: "mysql://QXWpcJKwPBoGqNG.f679bd03aa5d:lavuI337Gv3r6hjOW1wI@gateway04.us-east-1.prod.aws.tidbcloud.com:4000/CAeRhAUjAZoEuxNGm5QbPr",
    ssl: { rejectUnauthorized: true },
    connectTimeout: 15000
  });
  console.log("Connected");
  
  // Get the pattern of failures - how often do they occur?
  const [rows] = await conn.execute(`
    SELECT 
      DATE(firedAt) as date,
      HOUR(firedAt) as hour,
      MINUTE(firedAt) as minute,
      step,
      COUNT(*) as count,
      errorDetail
    FROM field_mgmt_log
    WHERE errorDetail = 'OpenPhone credentials not configured'
    GROUP BY DATE(firedAt), HOUR(firedAt), MINUTE(firedAt), step, errorDetail
    ORDER BY date DESC, hour DESC, minute DESC
    LIMIT 50
  `);
  
  console.log("\n=== Failure pattern ===");
  for (const row of rows) {
    console.log(`${row.date} ${String(row.hour).padStart(2,'0')}:${String(row.minute).padStart(2,'0')} UTC | step=${row.step} | count=${row.count}`);
  }
  
  await conn.end();
}
main().catch(e => { console.error("Error:", e.message); process.exit(1); });
