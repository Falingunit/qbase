import path from "path";
import { fileURLToPath } from "url";
import { loadAssignmentsFromRepo } from "../assignment-sync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..", "..");

const backendUrl = process.env.BACKEND_ASSIGNMENTS_SYNC_URL || "";
const syncSecret = process.env.ASSIGNMENT_SYNC_SECRET || "";
const commitSha = process.env.GITHUB_SHA || null;
const source = process.env.ASSIGNMENT_SYNC_SOURCE || "github-pages";

if (!backendUrl) {
  console.error("Missing BACKEND_ASSIGNMENTS_SYNC_URL");
  process.exit(1);
}

if (!syncSecret) {
  console.error("Missing ASSIGNMENT_SYNC_SECRET");
  process.exit(1);
}

const generatedAt = new Date().toISOString();
const assignments = loadAssignmentsFromRepo(repoRoot);

let importedAssignments = 0;
let importedQuestions = 0;

for (const assignment of assignments) {
  const response = await fetch(backendUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-assignment-sync-secret": syncSecret,
    },
    body: JSON.stringify({
      ...assignment,
      source,
      commitSha,
      generatedAt,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Sync failed for assignment ${assignment.assignmentId}: ${response.status} ${text}`
    );
  }

  const json = await response.json();
  const questionCount =
    Array.isArray(json?.results) && json.results[0]
      ? Number(json.results[0].questionCount || 0)
      : 0;

  importedAssignments++;
  importedQuestions += questionCount;
  console.log(
    `Synced assignment ${assignment.assignmentId}: ${questionCount} question(s)`
  );
}

console.log(
  `Finished syncing ${importedAssignments} assignment(s), ${importedQuestions} question(s).`
);
