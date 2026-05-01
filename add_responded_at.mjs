import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

const conn = await createConnection(url);

try {
  // Check if column already exists
  const [rows] = await conn.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() 
     AND TABLE_NAME = 'conversation_sessions' 
     AND COLUMN_NAME = 'respondedAt'`
  );
  if (rows.length > 0) {
    console.log("Column respondedAt already exists — skipping.");
  } else {
    await conn.execute(
      `ALTER TABLE conversation_sessions 
       ADD COLUMN respondedAt BIGINT NULL DEFAULT NULL 
       AFTER specialNotes`
    );
    console.log("✅ Added respondedAt column to conversation_sessions");
  }
} finally {
  await conn.end();
}
