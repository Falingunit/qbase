import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import {
  ensureAssignmentTables,
  upsertAssignmentInDb,
} from "../assignment-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.join(__dirname, "..", "..");
const dbPath = path.join(__dirname, "..", "db.sqlite");
const assignmentsRoot = path.join(repoRoot, "frontend", "data", "question_data");
const assignmentListPath = path.join(
  repoRoot,
  "frontend",
  "data",
  "assignment_list.json"
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadAssignmentMetadataMap() {
  if (!fs.existsSync(assignmentListPath)) return new Map();
  const rows = readJson(assignmentListPath);
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const assignmentId = Number(row?.aID);
    if (!Number.isFinite(assignmentId)) continue;
    map.set(assignmentId, {
      subject: row?.subject ?? null,
      faculty: row?.faculty ?? null,
      chapter: row?.chapter ?? null,
      title: row?.title ?? null,
    });
  }
  return map;
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
ensureAssignmentTables(db);

const metadataMap = loadAssignmentMetadataMap();
const assignmentDirs = fs
  .readdirSync(assignmentsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => Number(a) - Number(b));

let importedAssignments = 0;
let importedQuestions = 0;
let skippedAssignments = 0;

try {
  for (const dirName of assignmentDirs) {
    const assignmentId = Number(dirName);
    const assignmentPath = path.join(assignmentsRoot, dirName, "assignment.json");
    if (!Number.isFinite(assignmentId) || !fs.existsSync(assignmentPath)) {
      skippedAssignments++;
      continue;
    }

    const payload = readJson(assignmentPath);
    const result = upsertAssignmentInDb(db, assignmentId, payload, {
      ...(metadataMap.get(assignmentId) || {}),
      sourceRelPath: `frontend/data/question_data/${dirName}/assignment.json`,
    });

    importedAssignments++;
    importedQuestions += result.questionCount;
    console.log(
      `Synced assignment ${assignmentId}: ${result.questionCount} question(s)`
    );
  }

  console.log(
    `Finished syncing ${importedAssignments} assignment(s), ${importedQuestions} question(s), skipped ${skippedAssignments} folder(s).`
  );
} catch (e) {
  console.error("Assignment sync failed:", e);
  process.exitCode = 1;
} finally {
  db.close();
}
