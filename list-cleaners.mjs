import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  "SELECT id, name, email, phone, isActive, (passwordHash IS NOT NULL) as has_password FROM cleaner_profiles ORDER BY id"
);
console.table(rows);
await conn.end();
