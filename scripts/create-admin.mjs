import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const email = "rohangilkes@hey.com";
const password = "354MTWMR6381";
const name = "Rohan Gilkes";

const passwordHash = await bcrypt.hash(password, 12);

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check if already exists
const [rows] = await conn.execute("SELECT id FROM agents WHERE email = ?", [email]);

if (rows.length > 0) {
  // Update existing to ensure isAdmin=true and correct password
  await conn.execute(
    "UPDATE agents SET passwordHash = ?, isAdmin = 1, isActive = 1, name = ? WHERE email = ?",
    [passwordHash, name, email]
  );
  console.log(`✅ Updated existing account for ${email} — isAdmin=true`);
} else {
  // Insert new admin
  await conn.execute(
    "INSERT INTO agents (name, email, passwordHash, isAdmin, isActive, createdAt) VALUES (?, ?, ?, 1, 1, NOW())",
    [name, email, passwordHash]
  );
  console.log(`✅ Created admin account for ${email}`);
}

await conn.end();
console.log("Done.");
