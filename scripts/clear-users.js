// Delete ALL users and cascading data. Use with caution.
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "..", "db.sqlite");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

try {
  const info = db.prepare("DELETE FROM users").run();
  console.log(`Deleted ${info.changes} user(s).`);
} catch (e) {
  console.error("Failed to delete users:", e);
  process.exitCode = 1;
}
