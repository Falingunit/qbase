import crypto from "crypto";

function normalizeForHash(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeForHash(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeForHash(value[key]);
    }
    return out;
  }
  if (typeof value === "string") return value.replace(/\r\n/g, "\n");
  return value;
}

function cloneJSON(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function normalizeAssignmentPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      shape: "array",
      meta: null,
      questions: payload,
    };
  }
  if (payload && Array.isArray(payload.questions)) {
    const meta = { ...payload };
    delete meta.questions;
    return {
      shape: "questions",
      meta,
      questions: payload.questions,
    };
  }
  if (payload && Array.isArray(payload.data)) {
    const meta = { ...payload };
    delete meta.data;
    return {
      shape: "data",
      meta,
      questions: payload.data,
    };
  }
  return {
    shape: "questions",
    meta: null,
    questions: [],
  };
}

export function deriveQuestionContentHash(question) {
  const canonical = JSON.stringify(normalizeForHash(question));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function buildAssignmentQuestionRows(assignmentId, questions) {
  const seenIds = new Map();
  return (Array.isArray(questions) ? questions : []).map((question, index) => {
    const payload = cloneJSON(question) || {};
    const contentHash = deriveQuestionContentHash(payload);
    const baseId = `aq_${contentHash.slice(0, 24)}`;
    const nextCount = (seenIds.get(baseId) || 0) + 1;
    seenIds.set(baseId, nextCount);
    const questionId = nextCount === 1 ? baseId : `${baseId}:${nextCount}`;
    return {
      assignmentId,
      questionId,
      sourceIndex: index,
      contentHash,
      qType: payload?.qType == null ? null : String(payload.qType),
      passageId: payload?.passageId == null ? null : String(payload.passageId),
      isPassage: payload?.qType === "Passage" ? 1 : 0,
      qText: payload?.qText == null ? null : String(payload.qText),
      image: payload?.image == null ? null : String(payload.image),
      payloadJson: JSON.stringify(payload),
    };
  });
}

export function ensureAssignmentTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY,
      payload_shape TEXT NOT NULL DEFAULT 'questions',
      meta_json TEXT,
      question_count INTEGER NOT NULL DEFAULT 0,
      source_relpath TEXT,
      subject TEXT,
      faculty TEXT,
      chapter TEXT,
      title TEXT,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assignment_questions (
      assignment_id INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      source_index INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      q_type TEXT,
      passage_id TEXT,
      is_passage INTEGER NOT NULL DEFAULT 0,
      q_text TEXT,
      image TEXT,
      payload_json TEXT NOT NULL,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (assignment_id, question_id),
      UNIQUE (assignment_id, source_index),
      FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_assignment_questions_lookup
      ON assignment_questions (assignment_id, source_index);

    CREATE INDEX IF NOT EXISTS idx_assignment_questions_hash
      ON assignment_questions (content_hash);
  `);
}

export function rebuildAssignmentPayload(shape, meta, questionRows) {
  const questions = (Array.isArray(questionRows) ? questionRows : []).map((row) =>
    JSON.parse(row.payload_json)
  );
  if (shape === "array") return questions;
  const base =
    meta && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
  if (shape === "data") return { ...base, data: questions };
  return { ...base, questions };
}

export function loadAssignmentFromDb(db, assignmentId) {
  const assignmentRow = db
    .prepare(
      `SELECT id, payload_shape, meta_json
         FROM assignments
        WHERE id = ?`
    )
    .get(assignmentId);
  if (!assignmentRow) return null;

  const questionRows = db
    .prepare(
      `SELECT payload_json
         FROM assignment_questions
        WHERE assignment_id = ?
        ORDER BY source_index ASC`
    )
    .all(assignmentId);

  let meta = null;
  try {
    meta = assignmentRow.meta_json ? JSON.parse(assignmentRow.meta_json) : null;
  } catch {
    meta = null;
  }

  return rebuildAssignmentPayload(assignmentRow.payload_shape, meta, questionRows);
}

export function upsertAssignmentInDb(db, assignmentId, payload, metadata = {}) {
  const normalized = normalizeAssignmentPayload(payload);
  const rows = buildAssignmentQuestionRows(assignmentId, normalized.questions);
  const metaJson =
    normalized.meta == null ? null : JSON.stringify(cloneJSON(normalized.meta));
  const sourceRelPath =
    metadata?.sourceRelPath == null ? null : String(metadata.sourceRelPath);
  const subject = metadata?.subject == null ? null : String(metadata.subject);
  const faculty = metadata?.faculty == null ? null : String(metadata.faculty);
  const chapter = metadata?.chapter == null ? null : String(metadata.chapter);
  const title = metadata?.title == null ? null : String(metadata.title);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO assignments (
         id, payload_shape, meta_json, question_count, source_relpath,
         subject, faculty, chapter, title, imported_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         payload_shape = excluded.payload_shape,
         meta_json = excluded.meta_json,
         question_count = excluded.question_count,
         source_relpath = excluded.source_relpath,
         subject = excluded.subject,
         faculty = excluded.faculty,
         chapter = excluded.chapter,
         title = excluded.title,
         updated_at = CURRENT_TIMESTAMP`
    ).run(
      assignmentId,
      normalized.shape,
      metaJson,
      rows.length,
      sourceRelPath,
      subject,
      faculty,
      chapter,
      title
    );

    db.prepare("DELETE FROM assignment_questions WHERE assignment_id = ?").run(
      assignmentId
    );

    const insertQuestion = db.prepare(
      `INSERT INTO assignment_questions (
         assignment_id, question_id, source_index, content_hash, q_type,
         passage_id, is_passage, q_text, image, payload_json,
         imported_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    );

    for (const row of rows) {
      insertQuestion.run(
        row.assignmentId,
        row.questionId,
        row.sourceIndex,
        row.contentHash,
        row.qType,
        row.passageId,
        row.isPassage,
        row.qText,
        row.image,
        row.payloadJson
      );
    }
  });

  tx();
  return {
    assignmentId,
    payloadShape: normalized.shape,
    questionCount: rows.length,
  };
}
