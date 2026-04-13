import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { ensureAssignmentTables } from "../assignment-store.js";
import {
  loadAssignmentsFromRepo,
  syncAssignmentsToDb,
} from "../assignment-sync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.join(__dirname, "..", "..");
const dbPath = path.join(__dirname, "..", "db.sqlite");

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
ensureAssignmentTables(db);

try {
  const assignments = loadAssignmentsFromRepo(repoRoot);
  const summary = syncAssignmentsToDb(db, assignments, {
    onAssignment(result) {
      console.log(
        `Synced assignment ${result.assignmentId}: ${result.questionCount} question(s)`
      );
    },
  });

  console.log(
    `Finished syncing ${summary.importedAssignments} assignment(s), ${summary.importedQuestions} question(s), skipped 0 folder(s).`
  );
} catch (e) {
  console.error("Assignment sync failed:", e);
  process.exitCode = 1;
} finally {
  db.close();
}
