const mysql = require('mysql2/promise');
async function main() {
  const conn = await mysql.createConnection({
    uri: "mysql://QXWpcJKwPBoGqNG.f679bd03aa5d:lavuI337Gv3r6hjOW1wI@gateway04.us-east-1.prod.aws.tidbcloud.com:4000/CAeRhAUjAZoEuxNGm5QbPr",
    ssl: { rejectUnauthorized: true },
  });
  const [rows] = await conn.execute(
    "SELECT id, leadName, leadPhone, stage, updatedAt, lastMessageRole, unreadCount FROM conversation_sessions WHERE leadName LIKE '%Alex%' ORDER BY updatedAt DESC LIMIT 15"
  );
  console.table(rows);
  await conn.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
