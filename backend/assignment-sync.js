import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { upsertAssignmentInDb } from "./assignment-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toAssignmentId(value) {
  if (value == null || value === "") return null;
  const assignmentId = Number(value);
  if (!Number.isInteger(assignmentId) || assignmentId < 0) return null;
  return assignmentId;
}

function pickMetadata(source = {}) {
  const title =
    source.title ?? source.meta?.title ?? source.assignmentMeta?.title ?? null;
  const subject =
    source.subject ??
    source.meta?.subject ??
    source.assignmentMeta?.subject ??
    null;
  const faculty =
    source.faculty ??
    source.meta?.faculty ??
    source.assignmentMeta?.faculty ??
    null;
  const chapter =
    source.chapter ??
    source.meta?.chapter ??
    source.assignmentMeta?.chapter ??
    null;
  const sourceRelPath =
    source.sourceRelPath ??
    source.meta?.sourceRelPath ??
    source.assignmentMeta?.sourceRelPath ??
    null;

  return {
    title: title == null ? null : String(title).trim(),
    subject: subject == null ? null : String(subject).trim(),
    faculty: faculty == null ? null : String(faculty).trim(),
    chapter: chapter == null ? null : String(chapter).trim(),
    sourceRelPath:
      sourceRelPath == null ? null : String(sourceRelPath).trim(),
  };
}

export function normalizeAssignmentSyncEntry(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  const rawAssignmentId =
    source.assignmentId ?? source.aID ?? source.id ?? source.assignment?.aID;
  const assignmentId = toAssignmentId(rawAssignmentId);
  if (assignmentId == null) {
    throw new Error("assignmentId must be a non-negative integer");
  }

  const payload =
    source.assignment ??
    source.payload ??
    (Array.isArray(source.questions) || Array.isArray(source.data)
      ? source
      : null) ??
    (Array.isArray(source) ? source : null);
  if (
    payload == null ||
    (typeof payload !== "object" && !Array.isArray(payload))
  ) {
    throw new Error(`assignment ${assignmentId}: assignment payload is required`);
  }

  return {
    assignmentId,
    payload,
    metadata: pickMetadata(source),
  };
}

export function buildAssignmentMetadataMap(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const assignmentId = toAssignmentId(row?.aID);
    if (assignmentId == null) continue;
    map.set(assignmentId, {
      subject: row?.subject ?? null,
      faculty: row?.faculty ?? null,
      chapter: row?.chapter ?? null,
      title: row?.title ?? null,
    });
  }
  return map;
}

export function loadAssignmentsFromRepo(repoRoot = DEFAULT_REPO_ROOT) {
  const assignmentsRoot = path.join(repoRoot, "frontend", "data", "question_data");
  const assignmentListPath = path.join(
    repoRoot,
    "frontend",
    "data",
    "assignment_list.json"
  );
  const metadataMap = fs.existsSync(assignmentListPath)
    ? buildAssignmentMetadataMap(readJson(assignmentListPath))
    : new Map();

  return fs
    .readdirSync(assignmentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => Number(a) - Number(b))
    .flatMap((dirName) => {
      const assignmentId = toAssignmentId(dirName);
      const assignmentPath = path.join(assignmentsRoot, dirName, "assignment.json");
      if (assignmentId == null || !fs.existsSync(assignmentPath)) return [];
      return [
        {
          assignmentId,
          assignment: readJson(assignmentPath),
          ...metadataMap.get(assignmentId),
          sourceRelPath: `frontend/data/question_data/${dirName}/assignment.json`,
        },
      ];
    });
}

export function syncAssignmentsToDb(db, entries, { onAssignment } = {}) {
  const results = [];
  let importedAssignments = 0;
  let importedQuestions = 0;

  for (const entry of Array.isArray(entries) ? entries : []) {
    const { assignmentId, payload, metadata } = normalizeAssignmentSyncEntry(entry);
    const result = upsertAssignmentInDb(db, assignmentId, payload, metadata);
    importedAssignments++;
    importedQuestions += result.questionCount;
    results.push(result);
    if (typeof onAssignment === "function") onAssignment(result, metadata);
  }

  return {
    importedAssignments,
    importedQuestions,
    results,
  };
}
