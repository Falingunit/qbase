// server.js — JWT (no cookies) + SQLite + flexible CORS
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import multer from "multer";
import {
  ensureAssignmentTables,
  loadAssignmentFromDb,
  upsertAssignmentInDb,
} from "./assignment-store.js";
import { syncAssignmentsToDb } from "./assignment-sync.js";

// ---------- Paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Config ----------
const isDev = process.env.NODE_ENV !== "production";
const PORT = process.env.PORT || 3000;

// JWT
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// Frontend & assets
// Your GitHub Pages site hosts the data/ folder (prod)
const FRONTEND_ORIGIN = "https://falingunit.github.io";
const ASSETS_BASE =
  process.env.ASSETS_BASE || "https://falingunit.github.io/qbase";
// Optional: forward reports to a webhook (e.g., Slack/Discord)
const REPORTS_WEBHOOK_URL = process.env.REPORTS_WEBHOOK_URL || "";
const ASSIGNMENT_SYNC_SECRET = process.env.ASSIGNMENT_SYNC_SECRET || "";

// For Zoom/in-app browsers, requests still come from the frontend origin.
// But we’ll also allow dev and your nip.io domain for safety.
const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://qbase.103.125.154.215.nip.io",
];

// If you want to temporarily allow everything while testing,
// set ALLOW_ALL_ORIGINS=1 in the environment.
const ALLOW_ALL = process.env.ALLOW_ALL_ORIGINS === "1";

const app = express();
app.set("trust proxy", 1);

// ---------- CORS ----------
app.use((req, res, next) => {
  if (
    req.method === "OPTIONS" &&
    req.headers["access-control-request-private-network"] === "true"
  ) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  next();
});

const corsFn = cors({
  origin: (origin, cb) => {
    if (ALLOW_ALL) return cb(null, true);
    if (!origin) return cb(null, true); // allow curl/postman
    if (origin === "null") return cb(null, true); // allow file:// pages

    let ok = false;
    try {
      const u = new URL(origin);
      const host = u.hostname;
      // Allow configured list (exact matches)
      if (ALLOWED_ORIGINS.includes(origin)) ok = true;
      // Allow any *.github.io page
      if (!ok && /\.github\.io$/i.test(host)) ok = true;
      // Allow WireGuard client host 10.0.0.3 (any scheme/port)
      if (!ok && host === "10.0.0.3") ok = true;
      // Allow local development hosts
      if (!ok && (host === "localhost" || host === "127.0.0.1")) ok = true;
    } catch {}

    cb(ok ? null : new Error(`Origin ${origin} not allowed by CORS`), ok);
  },
});
app.use(corsFn);

// ---------- Parsers ----------
app.use(express.json({ limit: "25mb" }));

// ---------- Static uploads ----------
const uploadsDir = path.join(__dirname, "uploads");
import fs from "fs";
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {}
app.use("/uploads", express.static(uploadsDir, { maxAge: "365d", etag: true }));
// Icons subdir for remote cache
const iconsDir = path.join(uploadsDir, "icons");
try {
  fs.mkdirSync(iconsDir, { recursive: true });
} catch {}

// ---------- Local PYQs assets (if available) ----------
const pyqsAssetsDir = path.join(__dirname, "pyqs_assets");
try {
  fs.mkdirSync(pyqsAssetsDir, { recursive: true });
} catch {}
app.use(
  "/pyqs-assets",
  express.static(pyqsAssetsDir, { maxAge: "365d", etag: true })
);

// Optional local PYQs database (populated by utils/scraper/pyqs_downloader.py)
const pyqsLocalDbPath = path.join(__dirname, "pyqs_local.sqlite");
let pyqsDb = null;
try {
  if (fs.existsSync(pyqsLocalDbPath)) {
    pyqsDb = new Database(pyqsLocalDbPath);
    pyqsDb.pragma("foreign_keys = ON");
    pyqsDb.pragma("journal_mode = WAL");
  }
} catch (e) {
  console.warn("PYQs local DB not available:", e?.message || e);
}
const USE_LOCAL_PYQS = !!pyqsDb;

// ---------- Disable caching for dynamic content ----------
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// Helper: send JSON with ETag and Cache-Control (overrides global no-store)
function hashOf(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj);
  return crypto.createHash("sha1").update(text).digest("hex");
}
function sendJsonWithCache(req, res, obj, maxAgeSec = 600) {
  try {
    const etag = `W/\"${hashOf(obj)}\"`;
    const inm = req.headers["if-none-match"];
    if (inm && inm === etag) {
      res.status(304);
      res.set("ETag", etag);
      res.set("Cache-Control", `public, max-age=${maxAgeSec}`);
      return res.end();
    }
    res.set("ETag", etag);
    res.set("Cache-Control", `public, max-age=${maxAgeSec}`);
  } catch {}
  return res.json(obj);
}

function reqOrigin(req) {
  try {
    const proto = "https".split(",")[0].trim();
    const host = req.get("host");
    return `${proto}://${host}`;
  } catch {
    return "";
  }
}

// Legacy helpers (now no-ops) kept for backward compatibility.
function sanitizeLatex(latex) {
  return typeof latex === "string" ? latex : latex || "";
}

function fixCommonLatexErrors(input) {
  return typeof input === "string" ? input : input || "";
}

function escapeTexSpecialsInsideTextBlocks(latex) {
  return typeof latex === "string" ? latex : latex || "";
}

function replaceMathMLWithLatex(input) {
  return typeof input === "string" ? input : input || "";
}

function toAbsoluteAsset(pathStr, req) {
  try {
    if (typeof pathStr === "string" && pathStr.startsWith("/pyqs-assets/")) {
      const origin = reqOrigin(req);
      if (origin) return origin + pathStr;
    }
  } catch {}
  return pathStr;
}

function absolutizeHtml(html, req) {
  try {
    if (!html || typeof html !== "string") return html || "";
    const origin = reqOrigin(req);
    if (!origin) return html;
    return html.split("/pyqs-assets/").join(`${origin}/pyqs-assets/`);
  } catch {
    return html || "";
  }
}

function absolutizeQuestion(q, req) {
  if (!q || typeof q !== "object") return q;
  const out = { ...q };
  if (out.qImage) out.qImage = toAbsoluteAsset(out.qImage, req);
  if (out.solution) {
    out.solution = { ...out.solution };
    if (out.solution.sImage)
      out.solution.sImage = toAbsoluteAsset(out.solution.sImage, req);
    if (out.solution.sText)
      out.solution.sText = replaceMathMLWithLatex(
        absolutizeHtml(out.solution.sText, req)
      );
  }
  if (Array.isArray(out.options)) {
    out.options = out.options.map((o) => {
      const oo = { ...o };
      if (oo.oImage) oo.oImage = toAbsoluteAsset(oo.oImage, req);
      if (oo.oText)
        oo.oText = replaceMathMLWithLatex(absolutizeHtml(oo.oText, req));
      return oo;
    });
  }
  if (out.qText)
    out.qText = replaceMathMLWithLatex(absolutizeHtml(out.qText, req));
  return out;
}

// ---------- SQLite ----------
const dbPath = path.join(__dirname, "db.sqlite");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    force_pw_reset INTEGER DEFAULT 0,
    getmarks_token TEXT
  );

  CREATE TABLE IF NOT EXISTS states (
    userId TEXT NOT NULL,
    assignmentId INTEGER NOT NULL,
    state TEXT NOT NULL,
    PRIMARY KEY (userId, assignmentId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS assignment_scores (
    userId TEXT NOT NULL,
    assignmentId INTEGER NOT NULL,
    score INTEGER NOT NULL,
    maxScore INTEGER NOT NULL,
    PRIMARY KEY (userId, assignmentId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bookmark_tags (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(userId, name)
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    assignmentId INTEGER NOT NULL,
    questionIndex INTEGER NOT NULL,
    tagId TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (tagId) REFERENCES bookmark_tags(id) ON DELETE CASCADE,
    UNIQUE(userId, assignmentId, questionIndex, tagId)
  );

  -- PYQs bookmarks (per exam/subject/chapter question)
  CREATE TABLE IF NOT EXISTS pyqs_bookmarks (
    userId TEXT NOT NULL,
    examId TEXT NOT NULL,
    subjectId TEXT NOT NULL,
    chapterId TEXT NOT NULL,
    questionIndex INTEGER NOT NULL,
    tagId TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, examId, subjectId, chapterId, questionIndex, tagId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (tagId) REFERENCES bookmark_tags(id) ON DELETE CASCADE
  );

  -- Per-question color marks
  CREATE TABLE IF NOT EXISTS question_marks (
    userId TEXT NOT NULL,
    assignmentId INTEGER NOT NULL,
    questionIndex INTEGER NOT NULL,
    color TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, assignmentId, questionIndex),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  -- PYQs per-question color marks
  CREATE TABLE IF NOT EXISTS pyqs_question_marks (
    userId TEXT NOT NULL,
    examId TEXT NOT NULL,
    subjectId TEXT NOT NULL,
    chapterId TEXT NOT NULL,
    questionIndex INTEGER NOT NULL,
    color TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, examId, subjectId, chapterId, questionIndex),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Starred assignments
  CREATE TABLE IF NOT EXISTS starred_assignments (
    userId TEXT NOT NULL,
    assignmentId INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, assignmentId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Starred PYQ resources (exams, chapters)
  CREATE TABLE IF NOT EXISTS starred_pyqs (
    userId TEXT NOT NULL,
    kind TEXT NOT NULL, -- 'exam' | 'chapter'
    examId TEXT,
    subjectId TEXT,
    chapterId TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, kind, examId, subjectId, chapterId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  -- PYQs per-user state (exam/subject/chapter keyed)
  CREATE TABLE IF NOT EXISTS pyqs_states (
    userId TEXT NOT NULL,
    examId TEXT NOT NULL,
    subjectId TEXT NOT NULL,
    chapterId TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, examId, subjectId, chapterId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  -- PYQs per-user preferences (filters, view state)
  CREATE TABLE IF NOT EXISTS pyqs_prefs (
    userId TEXT NOT NULL,
    examId TEXT NOT NULL,
    subjectId TEXT NOT NULL,
    chapterId TEXT NOT NULL,
    prefs TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, examId, subjectId, chapterId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Reported questions (assignment or PYQs)
  CREATE TABLE IF NOT EXISTS question_reports (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    kind TEXT NOT NULL, -- 'assignment' | 'pyqs'
    assignmentId INTEGER,
    examId TEXT,
    subjectId TEXT,
    chapterId TEXT,
    questionIndex INTEGER NOT NULL, -- original index in source set
    reason TEXT NOT NULL,
    message TEXT,
    meta TEXT, -- JSON with extra context (title, names, etc.)
    status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'wip' | 'closed'
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Questions that are blocked from receiving further reports
  CREATE TABLE IF NOT EXISTS question_report_blocks (
    kind TEXT NOT NULL, -- 'assignment' | 'pyqs'
    assignmentId INTEGER,
    examId TEXT,
    subjectId TEXT,
    chapterId TEXT,
    questionIndex INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (kind, assignmentId, examId, subjectId, chapterId, questionIndex)
  );

  -- Per-user notifications
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    title TEXT NOT NULL,
    body_md TEXT NOT NULL,
    meta TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    share_with_json TEXT,
    config_json TEXT NOT NULL,
    reuse_policy_json TEXT,
    status TEXT NOT NULL DEFAULT 'unattempted',
    archived_at DATETIME,
    score REAL DEFAULT 0,
    max_score REAL DEFAULT 0,
    attempted_count INTEGER DEFAULT 0,
    total_questions INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS test_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    testId INTEGER NOT NULL,
    order_index INTEGER NOT NULL,
    section_id TEXT,
    section_name TEXT,
    question_type TEXT,
    subject_key TEXT,
    subject_name TEXT,
    kind TEXT NOT NULL,
    source_id TEXT,
    assignmentId INTEGER,
    examId TEXT,
    subjectId TEXT,
    chapterId TEXT,
    questionIndex INTEGER NOT NULL,
    question_key TEXT NOT NULL,
    positive_marks REAL DEFAULT 0,
    negative_marks REAL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (testId) REFERENCES tests(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_test_questions_test
    ON test_questions (testId, order_index);

  CREATE TABLE IF NOT EXISTS starred_tests (
    userId TEXT NOT NULL,
    testId INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, testId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (testId) REFERENCES tests(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS test_access (
    userId TEXT NOT NULL,
    testId INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, testId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (testId) REFERENCES tests(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS unlisted_tests (
    userId TEXT NOT NULL,
    testId INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userId, testId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (testId) REFERENCES tests(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS test_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    testId INTEGER NOT NULL,
    userId TEXT NOT NULL,
    score REAL DEFAULT 0,
    max_score REAL DEFAULT 0,
    attempted_count INTEGER DEFAULT 0,
    total_questions INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'submitted',
    state_json TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (testId) REFERENCES tests(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_test_attempts_test
    ON test_attempts (testId, score DESC, submitted_at DESC);
`);
ensureAssignmentTables(db);
ensureTestTables(db);
const TESTS_COLUMNS = getTableColumns(db, "tests");
const TEST_QUESTIONS_COLUMNS = getTableColumns(db, "test_questions");
const TEST_ATTEMPTS_COLUMNS = getTableColumns(db, "test_attempts");
const TESTS_USE_TEXT_IDS = testsUseTextIds(db);
const TEST_QUESTIONS_USE_TEXT_IDS = tableUsesTextIds(db, "test_questions");
const TEST_ATTEMPTS_USE_TEXT_IDS = tableUsesTextIds(db, "test_attempts");

function ensureTestTables(db) {
  try {
    const testCols = new Set(
      db.prepare("PRAGMA table_info(tests)").all().map((col) => col.name)
    );
    const addTestCol = (name, ddl) => {
      if (!testCols.has(name)) db.exec(`ALTER TABLE tests ADD COLUMN ${ddl}`);
    };
    addTestCol("ownerId", "ownerId TEXT");
    addTestCol("userId", "userId TEXT");
    addTestCol("name", "name TEXT");
    addTestCol("mode", "mode TEXT");
    addTestCol("title", "title TEXT NOT NULL DEFAULT 'Untitled test'");
    addTestCol("description", "description TEXT");
    addTestCol("share_with_json", "share_with_json TEXT");
    addTestCol("config_json", "config_json TEXT NOT NULL DEFAULT '{}'");
    addTestCol("years_json", "years_json TEXT");
    addTestCol("reuse_policy_json", "reuse_policy_json TEXT");
    addTestCol("time_limit_sec", "time_limit_sec INTEGER");
    addTestCol("status", "status TEXT NOT NULL DEFAULT 'unattempted'");
    addTestCol("archived_at", "archived_at DATETIME");
    addTestCol("score", "score REAL DEFAULT 0");
    addTestCol("max_score", "max_score REAL DEFAULT 0");
    addTestCol("attempted_count", "attempted_count INTEGER DEFAULT 0");
    addTestCol("total_questions", "total_questions INTEGER DEFAULT 0");
    addTestCol("created_at", "created_at DATETIME");
    addTestCol("updated_at", "updated_at DATETIME");
  } catch (e) {
    console.warn("tests migration failed:", e?.message || e);
  }

  try {
    const questionCols = new Set(
      db.prepare("PRAGMA table_info(test_questions)").all().map((col) => col.name)
    );
    const addQuestionCol = (name, ddl) => {
      if (!questionCols.has(name)) {
        db.exec(`ALTER TABLE test_questions ADD COLUMN ${ddl}`);
      }
    };
    addQuestionCol("test_id", "test_id TEXT");
    addQuestionCol("testId", "testId INTEGER");
    addQuestionCol("order_index", "order_index INTEGER NOT NULL DEFAULT 0");
    addQuestionCol("exam_id", "exam_id TEXT");
    addQuestionCol("subject_id", "subject_id TEXT");
    addQuestionCol("chapter_id", "chapter_id TEXT");
    addQuestionCol("question_index", "question_index INTEGER");
    addQuestionCol("year", "year INTEGER");
    addQuestionCol("difficulty", "difficulty INTEGER");
    addQuestionCol("q_type", "q_type TEXT");
    addQuestionCol("tags_json", "tags_json TEXT");
    addQuestionCol("section_id", "section_id TEXT");
    addQuestionCol("section_name", "section_name TEXT");
    addQuestionCol("question_type", "question_type TEXT");
    addQuestionCol("subject_key", "subject_key TEXT");
    addQuestionCol("subject_name", "subject_name TEXT");
    addQuestionCol("kind", "kind TEXT NOT NULL DEFAULT 'assignment'");
    addQuestionCol("source_id", "source_id TEXT");
    addQuestionCol("assignmentId", "assignmentId INTEGER");
    addQuestionCol("examId", "examId TEXT");
    addQuestionCol("subjectId", "subjectId TEXT");
    addQuestionCol("chapterId", "chapterId TEXT");
    addQuestionCol("questionIndex", "questionIndex INTEGER NOT NULL DEFAULT 0");
    addQuestionCol("question_key", "question_key TEXT NOT NULL DEFAULT ''");
    addQuestionCol("positive_marks", "positive_marks REAL DEFAULT 0");
    addQuestionCol("negative_marks", "negative_marks REAL DEFAULT 0");
    addQuestionCol("payload_json", "payload_json TEXT NOT NULL DEFAULT '{}'");
    addQuestionCol("created_at", "created_at DATETIME");
  } catch (e) {
    console.warn("test_questions migration failed:", e?.message || e);
  }

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_test_questions_test
        ON test_questions (testId, order_index);
      CREATE INDEX IF NOT EXISTS idx_test_questions_key
        ON test_questions (question_key);
    `);
  } catch (e) {
    console.warn("test question indexes migration failed:", e?.message || e);
  }

  try {
    const attemptCols = new Set(
      db.prepare("PRAGMA table_info(test_attempts)").all().map((col) => col.name)
    );
    const addAttemptCol = (name, ddl) => {
      if (!attemptCols.has(name)) {
        db.exec(`ALTER TABLE test_attempts ADD COLUMN ${ddl}`);
      }
    };
    addAttemptCol("testId", "testId INTEGER");
    addAttemptCol("userId", "userId TEXT");
    addAttemptCol("questions_json", "questions_json TEXT");
    addAttemptCol("time_limit_sec", "time_limit_sec INTEGER");
    addAttemptCol("score", "score REAL DEFAULT 0");
    addAttemptCol("maxScore", "maxScore REAL DEFAULT 0");
    addAttemptCol("max_score", "max_score REAL DEFAULT 0");
    addAttemptCol("attempted_count", "attempted_count INTEGER DEFAULT 0");
    addAttemptCol("total_questions", "total_questions INTEGER DEFAULT 0");
    addAttemptCol("status", "status TEXT NOT NULL DEFAULT 'submitted'");
    addAttemptCol("state_json", "state_json TEXT");
    addAttemptCol("started_at", "started_at DATETIME");
    addAttemptCol("submitted_at", "submitted_at DATETIME");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_test_attempts_test
        ON test_attempts (testId, score DESC, submitted_at DESC);
    `);
  } catch (e) {
    console.warn("test_attempts migration failed:", e?.message || e);
  }
}

function testsUseTextIds(db) {
  return tableUsesTextIds(db, "tests");
}

function tableUsesTextIds(db, tableName) {
  try {
    const idColumn = db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .find((col) => String(col.name || "").toLowerCase() === "id");
    return !!idColumn && !String(idColumn.type || "").toUpperCase().includes("INT");
  } catch {
    return false;
  }
}

function getTableColumns(db, tableName) {
  try {
    return new Set(
      db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all()
        .map((col) => String(col.name || ""))
    );
  } catch {
    return new Set();
  }
}

// --- Lightweight migration: ensure users.password_hash and force_pw_reset exist ---
try {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const hasPw = cols.some(
    (c) => String(c.name).toLowerCase() === "password_hash"
  );
  if (!hasPw) {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
  }
  const hasForce = cols.some(
    (c) => String(c.name).toLowerCase() === "force_pw_reset"
  );
  if (!hasForce) {
    db.exec("ALTER TABLE users ADD COLUMN force_pw_reset INTEGER DEFAULT 0");
  }
  const hasMarks = cols.some(
    (c) => String(c.name).toLowerCase() === "getmarks_token"
  );
  if (!hasMarks) {
    db.exec("ALTER TABLE users ADD COLUMN getmarks_token TEXT");
  }
  const hasAdmin = cols.some(
    (c) => String(c.name).toLowerCase() === "is_admin"
  );
  if (!hasAdmin) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
  }
} catch (e) {
  console.warn("users.password_hash migration check failed:", e?.message || e);
}

// Ensure question_reports has a status column if created earlier
try {
  const cols = db.prepare("PRAGMA table_info(question_reports)").all();
  const hasStatus = cols.some((c) => String(c.name).toLowerCase() === "status");
  if (!hasStatus) {
    db.exec(
      "ALTER TABLE question_reports ADD COLUMN status TEXT DEFAULT 'open'"
    );
  }
  const hasNotes = cols.some(
    (c) => String(c.name).toLowerCase() === "admin_notes"
  );
  if (!hasNotes) {
    db.exec("ALTER TABLE question_reports ADD COLUMN admin_notes TEXT");
  }
} catch (e) {
  console.warn(
    "question_reports.status migration check failed:",
    e?.message || e
  );
}

// Ensure notifications table has required columns if created earlier
try {
  const cols = db.prepare("PRAGMA table_info(notifications)").all();
  const needCols = {
    id: false,
    userId: false,
    title: false,
    body_md: false,
    meta: false,
    created_at: false,
    read_at: false,
  };
  for (const c of cols) {
    const n = String(c?.name || "").toLowerCase();
    if (n in needCols) needCols[n] = true;
  }
  // Add missing columns conservatively
  if (!needCols["meta"]) db.exec("ALTER TABLE notifications ADD COLUMN meta TEXT");
  if (!needCols["read_at"]) db.exec("ALTER TABLE notifications ADD COLUMN read_at DATETIME");
} catch (e) {
  console.warn("notifications migration check failed:", e?.message || e);
}

// Ensure admin user exists and can login with the specified credentials
function ensureAdminUser() {
  try {
    const uname = "adminlol";
    const row = db
      .prepare("SELECT id, username, is_admin FROM users WHERE username = ?")
      .get(uname);
    const pwHash = hashPassword("adminlol");
    if (!row) {
      const id = nanoid();
      db.prepare(
        "INSERT INTO users (id, username, password_hash, is_admin, force_pw_reset) VALUES (?, ?, ?, 1, 0)"
      ).run(id, uname, pwHash);
    } else {
      // Ensure admin flag; refresh password to the known value
      db.prepare(
        "UPDATE users SET is_admin = 1, password_hash = ? WHERE id = ?"
      ).run(pwHash, row.id);
    }
  } catch (e) {
    console.warn("ensureAdminUser failed:", e?.message || e);
  }
}
ensureAdminUser();

// ---------- Auth helpers ----------
function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Password helpers using Node's scrypt
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(String(password), salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":"))
    return false;
  const [salt, keyHex] = stored.split(":");
  const keyBuf = Buffer.from(keyHex, "hex");
  const test = crypto.scryptSync(String(password), salt, 64);
  if (test.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(test, keyBuf);
}

function secretsMatch(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    const uid = String(payload.sub || "");
    if (!uid) return res.status(401).json({ error: "Invalid token" });
    // Guard against tokens from a previous/reset DB: ensure user exists
    const row = db.prepare("SELECT id FROM users WHERE id = ?").get(uid);
    if (!row) return res.status(401).json({ error: "Invalid token" });
    req.userId = uid;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  try {
    const row = db
      .prepare("SELECT is_admin FROM users WHERE id = ?")
      .get(req.userId);
    if (!row || !row.is_admin)
      return res.status(403).json({ error: "Forbidden" });
    next();
  } catch {
    return res.status(403).json({ error: "Forbidden" });
  }
}

// ---------- Public routes ----------
app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/api/assignments", (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT
           id AS aID,
           COALESCE(subject, '(No subject)') AS subject,
           COALESCE(faculty, '') AS faculty,
           COALESCE(chapter, '') AS chapter,
           COALESCE(title, 'Assignment ' || id) AS title,
           question_count AS totalQuestions
         FROM assignments
         ORDER BY
           LOWER(COALESCE(subject, '')),
           LOWER(COALESCE(chapter, '')),
           LOWER(COALESCE(title, '')),
           id ASC`
      )
      .all();
    res.json(rows);
  } catch (e) {
    console.error("list assignments:", e);
    res.status(500).json({ error: "Failed to load assignments" });
  }
});
app.get("/api/assignments/:aID", async (req, res) => {
  try {
    const aID = Number(req.params.aID);
    if (!Number.isFinite(aID)) {
      return res.status(400).json({ error: "invalid assignment id" });
    }

    const assignment = await loadAssignment(aID);
    const meta = db
      .prepare(
        `SELECT
           id AS aID,
           COALESCE(subject, '(No subject)') AS subject,
           COALESCE(faculty, '') AS faculty,
           COALESCE(chapter, '') AS chapter,
           COALESCE(title, 'Assignment ' || id) AS title,
           question_count AS totalQuestions
         FROM assignments
         WHERE id = ?`
      )
      .get(aID) || {
      aID,
      subject: "(No subject)",
      faculty: "",
      chapter: "",
      title: `Assignment ${aID}`,
      totalQuestions: Array.isArray(assignment?.questions)
        ? assignment.questions.length
        : Array.isArray(assignment)
          ? assignment.length
          : 0,
    };

    res.json({ assignment, meta });
  } catch (e) {
    console.error("get assignment:", e);
    res.status(500).json({ error: "Failed to load assignment" });
  }
});

// ---------- PYQs proxy (public) ----------
// Uses per-user token when available (from profile), otherwise falls back to server-side token.
const GETMARKS_AUTH_TOKEN =
  process.env.GETMARKS_AUTH_TOKEN ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2OTkxNzVmNjcwMTY3ODUwOTBiZGI0ZiIsImlhdCI6MTc2MDE4ODAyOCwiZXhwIjoxNzYyNzgwMDI4fQ.v7tZWhoru3bC6c4H8RjtaGdkHm4luZQWvQ1kivF1Jl0";
const GM_BASE = {
  dashboard: "https://web.getmarks.app/api/v3/dashboard/platform/web",
  exam_subjects: (examId) =>
    `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(examId)}`,
  subject_chapters: (examId, subjectId) =>
    `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(
      examId
    )}/subject/${encodeURIComponent(subjectId)}`,
  questions: (examId, subjectId, chapterId) =>
    `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(
      examId
    )}/subject/${encodeURIComponent(subjectId)}/chapter/${encodeURIComponent(
      chapterId
    )}/questions`,
};

// ---------- In-memory caches (best-effort) ----------
const SUBJECT_CHAPTERS_TTL_MS = 60 * 60 * 1000; // 1h
const SUBJECT_META_TTL_MS = 10 * 60 * 1000; // 10m
const subjectChaptersCache = new Map(); // key -> { ts, list: [{ id, total }] }
const subjectMetaCache = new Map(); // key -> { ts, map: { [chapterId]: meta[] } }

async function getSubjectChaptersCached(req, examId, subjectId) {
  if (USE_LOCAL_PYQS) {
    try {
      const rows = pyqsDb
        .prepare(
          "SELECT id, name, icon_name, total_questions FROM chapters WHERE examId = ? AND subjectId = ?"
        )
        .all(String(examId), String(subjectId));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        icon_name: r.icon_name,
        total: Number(r.total_questions || 0),
      }));
    } catch {
      return [];
    }
  }
  const key = `${examId}__${subjectId}`;
  const now = Date.now();
  const ent = subjectChaptersCache.get(key);
  if (ent && now - ent.ts < SUBJECT_CHAPTERS_TTL_MS) return ent.list;
  const data = await gmFetch(req, GM_BASE.subject_chapters(examId, subjectId), {
    limit: 10000,
  });
  const list = (data?.data?.chapters?.data || [])
    .map((c) => ({
      id: c?._id,
      name: c?.title,
      icon_name: c?.icon,
      total: c?.allPyqs?.totalQs ?? 0,
    }))
    .filter((x) => x.id);
  subjectChaptersCache.set(key, { ts: now, list });
  return list;
}

async function getSubjectMetaPartial(req, examId, subjectId, neededIds) {
  if (USE_LOCAL_PYQS) {
    const out = {};
    for (const chId of neededIds) {
      try {
        const rows = pyqsDb
          .prepare(
            "SELECT data_json FROM questions WHERE examId = ? AND subjectId = ? AND chapterId = ? ORDER BY idx ASC"
          )
          .all(String(examId), String(subjectId), String(chId));
        out[String(chId)] = rows.map((r) => {
          const q = safeParseJSON(r.data_json, {});
          const base = {
            diffuculty: q.diffuculty,
            pyqInfo: q.pyqInfo,
            qText: q.qText,
          };
          return base;
        });
      } catch {
        out[String(chId)] = [];
      }
    }
    return out;
  }
  const key = `${examId}__${subjectId}`;
  const now = Date.now();
  let ent = subjectMetaCache.get(key);
  if (!ent || now - ent.ts >= SUBJECT_META_TTL_MS) {
    ent = { ts: now, map: {} };
    subjectMetaCache.set(key, ent);
  }
  const missing = [];
  neededIds.forEach((id) => {
    if (!ent.map[id]) missing.push(id);
  });
  if (missing.length) {
    const CONC = 6;
    for (let i = 0; i < missing.length; i += CONC) {
      const chunk = missing.slice(i, i + CONC);
      await Promise.all(
        chunk.map(async (chId) => {
          try {
            const qRes = await gmFetch(
              req,
              GM_BASE.questions(examId, subjectId, chId),
              { limit: 10000, hideOutOfSyllabus: "false" }
            );
            ent.map[chId] = (qRes?.data?.questions || []).map(gmToMeta);
          } catch {
            ent.map[chId] = [];
          }
        })
      );
    }
    ent.ts = now;
    subjectMetaCache.set(key, ent);
  }
  // Build subset map
  const out = {};
  neededIds.forEach((id) => {
    out[id] = ent.map[id] || [];
  });
  return out;
}

// ---------- Helpers: icon proxy/cache ----------
const contentTypeToExt = (ct = "") => {
  const t = String(ct).toLowerCase();
  if (t.includes("image/svg")) return "svg";
  if (t.includes("image/png")) return "png";
  if (t.includes("image/jpeg") || t.includes("image/jpg")) return "jpg";
  if (t.includes("image/webp")) return "webp";
  if (t.includes("image/gif")) return "gif";
  return "img";
};
const iconFetchInFlight = new Map(); // url -> Promise<relativePath>
async function cacheIcon(url) {
  const key = String(url || "").trim();
  if (!key) throw new Error("missing icon url");
  const cryptoHash = crypto.createHash("sha1").update(key).digest("hex");
  // Use .bin until we know content type; will rename after fetch
  const existing = fs
    .readdirSync(iconsDir)
    .find((f) => f.startsWith(cryptoHash + "."));
  if (existing) return path.join("/uploads/icons", existing);

  if (iconFetchInFlight.has(key)) return iconFetchInFlight.get(key);
  const p = (async () => {
    const r = await fetch(key, { cache: "no-store" });
    if (!r.ok) throw new Error(`icon fetch failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "";
    const ext = contentTypeToExt(ct);
    const file = `${cryptoHash}.${ext}`;
    const dest = path.join(iconsDir, file);
    await fs.promises.writeFile(dest, buf);
    return path.join("/uploads/icons", file);
  })().finally(() => iconFetchInFlight.delete(key));
  iconFetchInFlight.set(key, p);
  return p;
}
// Note: icons now return original remote URLs (no proxy caching)

function getUserIdOptional(req) {
  try {
    const h = req?.headers?.authorization || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const { sub } = jwt.verify(m[1], JWT_SECRET);
    return String(sub || "");
  } catch {
    return null;
  }
}

function buildUrlWithParams(url, params = {}) {
  const qs = new URL(url);
  for (const [k, v] of Object.entries(params || {})) qs.searchParams.set(k, v);
  return qs.toString();
}

async function gmFetchWithToken(url, params = {}, token) {
  if (!token) {
    const e = new Error("Missing GetMarks token");
    e.status = 503;
    throw e;
  }
  const target = buildUrlWithParams(url, params);
  const r = await fetch(target, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) {
    const e = new Error(`GetMarks fetch failed: ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return await r.json();
}

async function gmFetch(req, url, params = {}) {
  // Prefer per-user token if a valid Qbase JWT is provided
  try {
    const uid = getUserIdOptional(req);
    if (uid) {
      const row = db
        .prepare("SELECT getmarks_token FROM users WHERE id = ?")
        .get(uid);
      const userTok = row?.getmarks_token;
      if (userTok && String(userTok).trim()) {
        return await gmFetchWithToken(url, params, String(userTok).trim());
      }
    }
  } catch {}
  // Fallback to server token
  if (!GETMARKS_AUTH_TOKEN) {
    const e = new Error("GETMARKS_AUTH_TOKEN not configured");
    e.status = 503;
    throw e;
  }
  return await gmFetchWithToken(url, params, GETMARKS_AUTH_TOKEN);
}

// GET /api/pyqs/exams -> [{ id, name, icon }]
app.get("/api/pyqs/exams", async (req, res) => {
  try {
    let exams;
    if (USE_LOCAL_PYQS) {
      exams = pyqsDb
        .prepare("SELECT id, name, COALESCE(icon_path,'') AS icon FROM exams")
        .all()
        .map((e) => ({ ...e, icon: toAbsoluteAsset(e.icon, req) }));
    } else {
      const data = await gmFetch(req, GM_BASE.dashboard, { limit: 10000 });
      const items = data?.data?.items || [];
      const comp = items.find(
        (it) => it?.componentTitle === "ChapterwiseExams"
      );
      exams = (comp?.items || [])
        .map((ex) => ({
          id: ex?.examId,
          name: ex?.title,
          icon: ex?.icon?.dark || ex?.icon?.light || "",
        }))
        .filter((x) => x.id && x.name);
    }
    return sendJsonWithCache(req, res, exams, 3600);
  } catch (e) {
    const code = e.status || 500;
    return res.status(code).json({ error: String(e.message || e) });
  }
});

// Bootstrap aggregator (public; includes auth-based data if token present)
app.get("/api/pyqs/bootstrap", async (req, res) => {
  try {
    const result = {};
    // Optional user
    const uid = getUserIdOptional(req);
    if (uid) {
      const u = db
        .prepare(
          "SELECT id, username, force_pw_reset, getmarks_token FROM users WHERE id = ?"
        )
        .get(uid);
      if (u)
        result.user = {
          id: u.id,
          username: u.username,
          mustChangePassword: !!u.force_pw_reset,
          hasMarksAuth: !!(u.getmarks_token && String(u.getmarks_token).trim()),
        };
      // starred
      const ex = db
        .prepare(
          "SELECT examId FROM starred_pyqs WHERE userId = ? AND kind = 'exam'"
        )
        .all(uid)
        .map((r) => r.examId);
      const ch = db
        .prepare(
          "SELECT examId, subjectId, chapterId FROM starred_pyqs WHERE userId = ? AND kind = 'chapter'"
        )
        .all(uid);
      result.starred = { exams: ex, chapters: ch };
      // bookmark tags
      result.bookmarkTags = db
        .prepare(
          "SELECT id, name, created_at FROM bookmark_tags WHERE userId = ? ORDER BY name = 'Doubt' DESC, name ASC"
        )
        .all(uid);
    } else {
      result.user = null;
    }
    // Optionally include catalog slices
    const { exam, subject } = req.query || {};
    if (String(req.query.includeExams || "1") === "1") {
      if (USE_LOCAL_PYQS) {
        result.exams = pyqsDb
          .prepare("SELECT id, name, COALESCE(icon_path,'') AS icon FROM exams")
          .all()
          .map((e) => ({ ...e, icon: toAbsoluteAsset(e.icon, req) }));
      } else {
        const data = await gmFetch(req, GM_BASE.dashboard, { limit: 10000 });
        const items = data?.data?.items || [];
        const comp = items.find(
          (it) => it?.componentTitle === "ChapterwiseExams"
        );
        result.exams = (comp?.items || [])
          .map((ex) => ({
            id: ex?.examId,
            name: ex?.title,
            icon: ex?.icon?.dark || ex?.icon?.light || "",
          }))
          .filter((x) => x.id && x.name);
      }
    }
    if (exam) {
      if (USE_LOCAL_PYQS) {
        result.subjects = pyqsDb
          .prepare(
            "SELECT id, name, COALESCE(icon_path,'') AS icon FROM subjects WHERE examId = ?"
          )
          .all(String(exam))
          .map((s) => ({ ...s, icon: toAbsoluteAsset(s.icon, req) }));
      } else {
        const sData = await gmFetch(req, GM_BASE.exam_subjects(exam), {
          limit: 10000,
        });
        result.subjects = (sData?.data?.subjects || [])
          .map((s) => ({ id: s?._id, name: s?.title, icon: s?.icon || "" }))
          .filter((x) => x.id && x.name);
      }
    }
    if (exam && subject) {
      if (USE_LOCAL_PYQS) {
        result.chapters = pyqsDb
          .prepare(
            "SELECT id, name, icon_name, total_questions FROM chapters WHERE examId = ? AND subjectId = ?"
          )
          .all(String(exam), String(subject))
          .map((c) => ({
            id: c.id,
            name: c.name,
            icon_name: c.icon_name,
            total_questions: Number(c.total_questions || 0),
          }));
      } else {
        const cData = await gmFetch(
          req,
          GM_BASE.subject_chapters(exam, subject),
          { limit: 10000 }
        );
        result.chapters = (cData?.data?.chapters?.data || [])
          .map((c) => ({
            id: c?._id,
            name: c?.title,
            icon_name: c?.icon,
            total_questions: c?.allPyqs?.totalQs ?? 0,
          }))
          .filter((x) => x.id && x.name);
      }
    }
    return res.json(result);
  } catch (e) {
    const code = e.status || 500;
    return res.status(code).json({ error: String(e.message || e) });
  }
});

// GET /api/pyqs/exams/:examId/subjects -> [{ id, name, icon }]
app.get("/api/pyqs/exams/:examId/subjects", async (req, res) => {
  try {
    const { examId } = req.params;
    let subjects;
    if (USE_LOCAL_PYQS) {
      subjects = pyqsDb
        .prepare(
          "SELECT id, name, COALESCE(icon_path,'') AS icon FROM subjects WHERE examId = ?"
        )
        .all(String(examId))
        .map((s) => ({ ...s, icon: toAbsoluteAsset(s.icon, req) }));
    } else {
      const data = await gmFetch(req, GM_BASE.exam_subjects(examId), {
        limit: 10000,
      });
      subjects = (data?.data?.subjects || [])
        .map((s) => ({
          id: s?._id,
          name: s?.title,
          icon: s?.icon || "",
        }))
        .filter((x) => x.id && x.name);
    }
    return sendJsonWithCache(req, res, subjects, 3600);
  } catch (e) {
    const code = e.status || 500;
    return res.status(code).json({ error: String(e.message || e) });
  }
});

// GET /api/pyqs/exams/:examId/subjects/:subjectId/chapters -> [{ id, name, icon_name, total_questions }]
app.get(
  "/api/pyqs/exams/:examId/subjects/:subjectId/chapters",
  async (req, res) => {
    try {
      const { examId, subjectId } = req.params;
      let chapters;
      if (USE_LOCAL_PYQS) {
        chapters = pyqsDb
          .prepare(
            "SELECT id, name, icon_name, total_questions FROM chapters WHERE examId = ? AND subjectId = ?"
          )
          .all(String(examId), String(subjectId))
          .map((c) => ({
            id: c.id,
            name: c.name,
            icon_name: c.icon_name,
            total_questions: Number(c.total_questions || 0),
          }));
      } else {
        const data = await gmFetch(
          req,
          GM_BASE.subject_chapters(examId, subjectId),
          { limit: 10000 }
        );
        chapters = (data?.data?.chapters?.data || [])
          .map((c) => ({
            id: c?._id,
            name: c?.title,
            icon_name: c?.icon,
            total_questions: c?.allPyqs?.totalQs ?? 0,
          }))
          .filter((x) => x.id && x.name);
      }
      return sendJsonWithCache(req, res, chapters, 1800);
    } catch (e) {
      const code = e.status || 500;
      return res.status(code).json({ error: String(e.message || e) });
    }
  }
);

// GET /api/pyqs/exams/:examId/subjects/:subjectId/chapters/:chapterId/questions
// -> [{ type, diffuculty, pyqInfo, qText, qImage, options:[{oText,oImage}], correctAnswer, solution:{sText,sImage} }]
app.get(
  "/api/pyqs/exams/:examId/subjects/:subjectId/chapters/:chapterId/questions",
  async (req, res) => {
    try {
      const { examId, subjectId, chapterId } = req.params;
      const fields = new Set(
        String(req.query.fields || "year,diff,text")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
      const isMeta = String(req.query.meta || "0") === "1";
      let questions;
      if (USE_LOCAL_PYQS) {
        const rows = pyqsDb
          .prepare(
            "SELECT data_json FROM questions WHERE examId = ? AND subjectId = ? AND chapterId = ? ORDER BY idx ASC"
          )
          .all(String(examId), String(subjectId), String(chapterId));
        const full = rows.map((r) =>
          absolutizeQuestion(safeParseJSON(r.data_json, {}), req)
        );
        if (isMeta) {
          questions = full.map((q) => {
            const base = {
              diffuculty: q.diffuculty,
              pyqInfo: q.pyqInfo,
              qText: q.qText,
            };
            if (!fields.has("text")) {
              const { qText, ...rest } = base;
              return rest;
            }
            return base;
          });
        } else {
          questions = full;
        }
      } else {
        const data = await gmFetch(
          req,
          GM_BASE.questions(examId, subjectId, chapterId),
          { limit: 10000, hideOutOfSyllabus: "false" }
        );
        const qs = data?.data?.questions || [];
        if (isMeta) {
          questions = qs.map((q) => {
            const base = {
              diffuculty: q?.level,
              pyqInfo:
                (Array.isArray(q?.previousYearPapers) &&
                  q.previousYearPapers[0]?.title) ||
                "",
              qText: replaceMathMLWithLatex(q?.question?.text || ""),
            };
            if (!fields.has("text")) {
              const { qText, ...rest } = base;
              return rest;
            }
            return base;
          });
        } else {
          questions = qs.map((q) => {
            const base = {
              diffuculty: q?.level,
              pyqInfo:
                (Array.isArray(q?.previousYearPapers) &&
                  q.previousYearPapers[0]?.title) ||
                "",
              qText: replaceMathMLWithLatex(q?.question?.text || ""),
            };
            const opts = Array.isArray(q?.options) ? q.options : [];
            const correctLetters = [];
            if (Array.isArray(opts)) {
              const letters = ["A", "B", "C", "D"];
              opts.forEach((o, i) => {
                if (o?.isCorrect)
                  correctLetters.push(letters[i] || String(i + 1));
              });
            }
            return {
              type: q?.type,
              ...base,
              qImage: q?.question?.image || "",
              options: opts.map((o) => ({
                oText: replaceMathMLWithLatex(o?.text || ""),
                oImage: o?.image || "",
              })),
              correctAnswer:
                q?.type === "numerical" ? q?.correctValue : correctLetters,
              solution: {
                sText: replaceMathMLWithLatex(q?.solution?.text || ""),
                sImage: q?.solution?.image || "",
              },
            };
          });
        }
      }
      return res.json(questions);
    } catch (e) {
      const code = e.status || 500;
      return res.status(code).json({ error: String(e.message || e) });
    }
  }
);

// Exam overview (subjects + optional chapter counts summary)
app.get("/api/pyqs/exam-overview/:examId", async (req, res) => {
  try {
    const { examId } = req.params;
    const includeCounts = String(req.query.includeCounts || "0") === "1";
    let subjects;
    if (USE_LOCAL_PYQS) {
      subjects = pyqsDb
        .prepare(
          "SELECT id, name, COALESCE(icon_path,'') AS icon FROM subjects WHERE examId = ?"
        )
        .all(String(examId));
    } else {
      const sData = await gmFetch(req, GM_BASE.exam_subjects(examId), {
        limit: 10000,
      });
      subjects = (sData?.data?.subjects || [])
        .map((s) => ({ id: s?._id, name: s?.title, icon: s?.icon || "" }))
        .filter((x) => x.id && x.name);
    }
    const out = { subjects };
    if (includeCounts) {
      const counts = {};
      if (USE_LOCAL_PYQS) {
        for (const s of subjects) {
          const r = pyqsDb
            .prepare(
              "SELECT COUNT(1) AS c FROM chapters WHERE examId = ? AND subjectId = ?"
            )
            .get(String(examId), String(s.id));
          counts[String(s.id)] = Number(r?.c || 0);
        }
      } else {
        const CONC = 4;
        for (let i = 0; i < subjects.length; i += CONC) {
          const chunk = subjects.slice(i, i + CONC);
          await Promise.all(
            chunk.map(async (s) => {
              try {
                const cData = await gmFetch(
                  req,
                  GM_BASE.subject_chapters(examId, s.id),
                  { limit: 10000 }
                );
                counts[String(s.id)] = (
                  cData?.data?.chapters?.data || []
                ).length;
              } catch {
                counts[String(s.id)] = 0;
              }
            })
          );
        }
      }
      out.counts = counts;
    }
    return sendJsonWithCache(req, res, out, 1800);
  } catch (e) {
    const code = e.status || 500;
    return res.status(code).json({ error: String(e.message || e) });
  }
});

// Subject overview (chapters + progress)
app.get(
  "/api/pyqs/subject-overview/:examId/:subjectId",
  auth,
  async (req, res) => {
    try {
      const { examId, subjectId } = req.params;
      const chList = await getSubjectChaptersCached(req, examId, subjectId);
      const chapters = chList.map((c) => ({
        id: c.id,
        name: c.name,
        icon_name: c.icon_name,
        total_questions: c.total,
      }));
      // Reuse progress handler logic by invoking the same internals
      req.query.chapters = chapters.map((c) => c.id).join(",");
      // Call functionally: duplicate progress compute quickly
      const progReq = {
        ...req,
        params: { examId, subjectId },
        query: { chapters: req.query.chapters },
      };
      const resp = {};
      await (async () => {
        // Inline small compute: use the same process as /progress
        const totalsById = Object.fromEntries(
          chList.map((c) => [String(c.id), Number(c.total || 0)])
        );
        const prefRows = db
          .prepare(
            "SELECT chapterId, prefs FROM pyqs_prefs WHERE userId = ? AND examId = ? AND subjectId = ?"
          )
          .all(req.userId, String(examId), String(subjectId));
        const stateRows = db
          .prepare(
            "SELECT chapterId, state FROM pyqs_states WHERE userId = ? AND examId = ? AND subjectId = ?"
          )
          .all(req.userId, String(examId), String(subjectId));
        const prefsMap = {};
        for (const r of prefRows) {
          const o = safeParseJSON(r.prefs, {});
          if (o && typeof o === "object") prefsMap[String(r.chapterId)] = o;
        }
        const normalizeStates = (raw) => {
          if (Array.isArray(raw)) return raw;
          const out = [];
          if (raw && typeof raw === "object") {
            for (const k of Object.keys(raw)) {
              const idx = Number(k);
              if (!Number.isNaN(idx)) out[idx] = raw[k];
            }
          }
          return out;
        };
        const statesMap = {};
        for (const r of stateRows)
          statesMap[String(r.chapterId)] = normalizeStates(
            safeParseJSON(r.state, [])
          );
        const out = {};
        const parseYear = (pyqInfo) => {
          try {
            const m = String(pyqInfo || "").match(/(19|20)\d{2}/);
            return m ? Number(m[0]) : null;
          } catch {
            return null;
          }
        };
        const normDiff = (d) => {
          const s = String(d || "").toLowerCase();
          if (s.startsWith("1") || s.startsWith("e")) return "easy";
          if (s.startsWith("2") || s.startsWith("m")) return "medium";
          if (s.startsWith("3") || s.startsWith("h")) return "hard";
          return "";
        };
        const statusFromState = (st) => {
          if (!st) return "not-started";
          if (st.isAnswerEvaluated) {
            if (st.evalStatus === "correct") return "correct";
            if (st.evalStatus === "partial") return "partial";
            if (st.evalStatus === "incorrect") return "incorrect";
            return "completed";
          }
          if (st.isAnswerPicked) return "in-progress";
          return "not-started";
        };
        // All chapters default: status-only path using totals + states
        for (const c of chapters) {
          const cid = String(c.id);
          const f = Object.assign(
            { q: "", years: [], status: [], diff: [], sort: "index" },
            prefsMap[cid] || {}
          );
          const activeDiffs = Array.isArray(f.diff)
            ? f.diff.filter(Boolean).map((v) => String(v))
            : f.diff
            ? [String(f.diff)]
            : [];
          const activeStatuses = Array.isArray(f.status)
            ? f.status.filter(Boolean).map((v) => String(v))
            : f.status
            ? [String(f.status)]
            : [];
          const stArr = Array.isArray(statesMap[cid]) ? statesMap[cid] : [];
          const totalQs = Math.max(0, Number(totalsById[cid] || 0));
          let correct = 0,
            incorrect = 0,
            partial = 0,
            inProgress = 0,
            evaluated = 0;
          for (let i = 0; i < stArr.length; i++) {
            const st = stArr[i];
            if (!st) continue;
            if (st.isAnswerEvaluated) {
              evaluated++;
              if (st.evalStatus === "correct") correct++;
              else if (st.evalStatus === "incorrect") incorrect++;
              else if (st.evalStatus === "partial") partial++;
            } else if (st.isAnswerPicked) {
              inProgress++;
            }
          }
          let total = 0,
            green = 0,
            red = 0,
            grey = 0;
          if (
            !f.q &&
            !(Array.isArray(f.years) && f.years.length) &&
            !activeDiffs.length
          ) {
            if (!activeStatuses.length) {
              green = correct;
              red = incorrect + partial;
              grey = Math.max(0, totalQs - green - red);
              total = totalQs;
            } else {
              const statusSet = new Set(activeStatuses);
              if (statusSet.has("completed") || statusSet.has("correct"))
                green += correct;
              if (statusSet.has("completed") || statusSet.has("incorrect"))
                red += incorrect;
              if (statusSet.has("completed") || statusSet.has("partial"))
                red += partial;
              if (statusSet.has("in-progress")) grey += inProgress;
              if (statusSet.has("not-started"))
                grey += Math.max(0, totalQs - evaluated - inProgress);
              total = green + red + grey;
            }
          }
          out[cid] = { total, green, red, grey };
        }
        resp.progress = out;
      })();
      return res.json({ chapters, progress: resp.progress });
    } catch (e) {
      const code = e.status || 500;
      return res.status(code).json({ error: String(e.message || e) });
    }
  }
);

// Build minimal meta from a GetMarks question
function gmToMeta(q) {
  return {
    diffuculty: q?.level,
    pyqInfo:
      (Array.isArray(q?.previousYearPapers) &&
        q.previousYearPapers[0]?.title) ||
      "",
    qText: replaceMathMLWithLatex(q?.question?.text || ""),
  };
}

// GET subject-level questions meta (aggregates per chapter in one response)
// /api/pyqs/exams/:examId/subjects/:subjectId/questions-meta?chapters=id1,id2
app.get(
  "/api/pyqs/exams/:examId/subjects/:subjectId/questions-meta",
  async (req, res) => {
    try {
      const { examId, subjectId } = req.params;
      // Determine target chapter IDs
      let chapterIds = [];
      const qsCh = String(req.query.chapters || "").trim();
      if (qsCh) {
        chapterIds = qsCh
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
      if (!chapterIds.length) {
        const data = await gmFetch(
          req,
          GM_BASE.subject_chapters(examId, subjectId),
          { limit: 10000 }
        );
        chapterIds = (data?.data?.chapters?.data || [])
          .map((c) => c?._id)
          .filter((x) => x);
      }

      const out = {};
      // Optional fields control (year,diff,text). If text omitted, exclude qText.
      const fields = new Set(
        String(req.query.fields || "year,diff,text")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
      if (USE_LOCAL_PYQS) {
        for (const chId of chapterIds) {
          try {
            const rows = pyqsDb
              .prepare(
                "SELECT data_json FROM questions WHERE examId = ? AND subjectId = ? AND chapterId = ? ORDER BY idx ASC"
              )
              .all(String(examId), String(subjectId), String(chId));
            const arr = rows.map((r) => {
              const q = absolutizeQuestion(safeParseJSON(r.data_json, {}), req);
              const base = {
                diffuculty: q.diffuculty,
                pyqInfo: q.pyqInfo,
                qText: q.qText,
              };
              if (!fields.has("text")) {
                const { qText, ...rest } = base;
                return rest;
              }
              return base;
            });
            out[String(chId)] = arr;
          } catch {
            out[String(chId)] = [];
          }
        }
      } else {
        const CONC = 4;
        for (let i = 0; i < chapterIds.length; i += CONC) {
          const chunk = chapterIds.slice(i, i + CONC);
          await Promise.all(
            chunk.map(async (chId) => {
              try {
                const data = await gmFetch(
                  req,
                  GM_BASE.questions(examId, subjectId, chId),
                  { limit: 10000, hideOutOfSyllabus: "false" }
                );
                const arr = (data?.data?.questions || []).map((q) => {
                  const base = gmToMeta(q);
                  if (!fields.has("text")) {
                    const { qText, ...rest } = base;
                    return rest;
                  }
                  return base;
                });
                out[String(chId)] = arr;
              } catch (e) {
                out[String(chId)] = [];
              }
            })
          );
        }
      }
      return res.json(out);
    } catch (e) {
      const code = e.status || 500;
      return res.status(code).json({ error: String(e.message || e) });
    }
  }
);

// Questions bundle (combine questions + state + overlays)
app.get(
  "/api/pyqs/questions-bundle/:examId/:subjectId/:chapterId",
  auth,
  async (req, res) => {
    try {
      const { examId, subjectId, chapterId } = req.params;
      const full = String(req.query.full || "0") === "1";
      const includeState = String(req.query.state || "1") === "1";
      const includeOverlays = String(req.query.overlays || "1") === "1";
      let qList;
      if (USE_LOCAL_PYQS) {
        const rows = pyqsDb
          .prepare(
            "SELECT data_json FROM questions WHERE examId = ? AND subjectId = ? AND chapterId = ? ORDER BY idx ASC"
          )
          .all(String(examId), String(subjectId), String(chapterId));
        const fullList = rows.map((r) =>
          absolutizeQuestion(safeParseJSON(r.data_json, {}), req)
        );
        qList = full
          ? fullList
          : fullList.map((q) => ({
              diffuculty: q?.diffuculty,
              pyqInfo: q?.pyqInfo || "",
              qText: q?.qText || "",
            }));
      } else {
        const questions = await gmFetch(
          req,
          GM_BASE.questions(examId, subjectId, chapterId),
          { limit: 10000, hideOutOfSyllabus: "false" }
        );
        qList = (questions?.data?.questions || []).map((q) =>
          full
            ? {
                type: q?.type,
                diffuculty: q?.level,
                pyqInfo:
                  (Array.isArray(q?.previousYearPapers) &&
                    q.previousYearPapers[0]?.title) ||
                  "",
                qText: replaceMathMLWithLatex(q?.question?.text || ""),
                qImage: q?.question?.image || "",
                options: (Array.isArray(q?.options) ? q.options : []).map(
                  (o) => ({ oText: replaceMathMLWithLatex(o?.text || ""), oImage: o?.image || "" })
                ),
                correctAnswer:
                  q?.type === "numerical"
                    ? q?.correctValue
                    : (Array.isArray(q?.options) ? q.options : []).reduce(
                        (acc, o, i) => {
                          if (o?.isCorrect) {
                            const letters = ["A", "B", "C", "D"];
                            acc.push(letters[i] || String(i + 1));
                          }
                          return acc;
                        },
                        []
                      ),
                solution: {
                  sText: replaceMathMLWithLatex(q?.solution?.text || ""),
                  sImage: q?.solution?.image || "",
                },
              }
            : gmToMeta(q)
        );
      }
      const out = { questions: qList };
      if (includeState) {
        const row = db
          .prepare(
            "SELECT state FROM pyqs_states WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?"
          )
          .get(
            req.userId,
            String(examId),
            String(subjectId),
            String(chapterId)
          );
        out.state = row ? safeParseJSON(row.state, []) : [];
      }
      if (includeOverlays) {
        out.bookmarks = db
          .prepare(
            "SELECT questionIndex, tagId FROM pyqs_bookmarks WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?"
          )
          .all(
            req.userId,
            String(examId),
            String(subjectId),
            String(chapterId)
          );
        out.marks = db
          .prepare(
            "SELECT questionIndex, color FROM pyqs_question_marks WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?"
          )
          .all(
            req.userId,
            String(examId),
            String(subjectId),
            String(chapterId)
          );
      }
      res.json(out);
    } catch (e) {
      const code = e.status || 500;
      return res.status(code).json({ error: String(e.message || e) });
    }
  }
);

// Search within chapters for text (server-side)
app.post("/api/pyqs/search/:examId/:subjectId", auth, async (req, res) => {
  try {
    const { examId, subjectId } = req.params;
    const { chapters = [], q = "" } = req.body || {};
    const ids =
      Array.isArray(chapters) && chapters.length
        ? chapters.map(String)
        : (await getSubjectChaptersCached(req, examId, subjectId)).map((c) =>
            String(c.id)
          );
    const needle = String(q || "")
      .trim()
      .toLowerCase();
    if (!needle) return res.json({});
    const metaMap = await getSubjectMetaPartial(req, examId, subjectId, ids);
    const out = {};
    for (const id of ids) {
      const arr = metaMap[id] || [];
      const hits = [];
      for (let i = 0; i < arr.length; i++) {
        const t = String(arr[i]?.qText || "").toLowerCase();
        if (t.includes(needle)) hits.push(i);
      }
      out[id] = hits;
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "search failed" });
  }
});

// GET chapter progress for all chapters of a subject (protected)
// Computes counts under saved per-chapter filters for the user
// Response shape: { [chapterId]: { total, green, red, grey } }
app.get("/api/pyqs/progress/:examId/:subjectId", auth, async (req, res) => {
  try {
    const { examId, subjectId } = req.params;
    // Load chapter list (cached) with totals
    const chList = await getSubjectChaptersCached(req, examId, subjectId);
    let chapters = chList.map((c) => c.id);
    // Optional chapters param to scope
    const qsCh = String(req.query.chapters || "").trim();
    if (qsCh) {
      const only = new Set(
        qsCh
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
      chapters = chapters.filter((id) => only.has(String(id)));
    }
    const totalsById = Object.fromEntries(
      chList.map((c) => [String(c.id), Number(c.total || 0)])
    );

    // Load prefs + states for this user in a single query each
    const prefRows = db
      .prepare(
        "SELECT chapterId, prefs FROM pyqs_prefs WHERE userId = ? AND examId = ? AND subjectId = ?"
      )
      .all(req.userId, String(examId), String(subjectId));
    const stateRows = db
      .prepare(
        "SELECT chapterId, state FROM pyqs_states WHERE userId = ? AND examId = ? AND subjectId = ?"
      )
      .all(req.userId, String(examId), String(subjectId));
    const prefsMap = {};
    for (const r of prefRows) {
      const obj = safeParseJSON(r.prefs, {});
      if (obj && typeof obj === "object") prefsMap[String(r.chapterId)] = obj;
    }
    const normalizeStates = (raw) => {
      if (Array.isArray(raw)) return raw;
      const out = [];
      if (raw && typeof raw === "object") {
        for (const k of Object.keys(raw)) {
          const idx = Number(k);
          if (!Number.isNaN(idx)) out[idx] = raw[k];
        }
      }
      return out;
    };
    const statesMap = {};
    for (const r of stateRows) {
      statesMap[String(r.chapterId)] = normalizeStates(
        safeParseJSON(r.state, [])
      );
    }

    // Determine which chapters actually need meta (content filters present)
    const needsMeta = new Set();
    for (const chId of chapters) {
      const f = prefsMap[String(chId)] || {};
      const activeDiffs = Array.isArray(f.diff)
        ? f.diff.filter(Boolean)
        : f.diff
        ? [f.diff]
        : [];
      if (
        (f.q && String(f.q).trim()) ||
        (Array.isArray(f.years) && f.years.length) ||
        activeDiffs.some((v) => String(v).trim())
      ) {
        needsMeta.add(String(chId));
      }
    }
    // Fetch meta only for chapters that need it (cached by subject)
    const metaMap = needsMeta.size
      ? await getSubjectMetaPartial(
          req,
          examId,
          subjectId,
          Array.from(needsMeta)
        )
      : {};

    // Helpers for filtering and status
    const parseYear = (pyqInfo) => {
      try {
        const m = String(pyqInfo || "").match(/(19|20)\d{2}/);
        return m ? Number(m[0]) : null;
      } catch {
        return null;
      }
    };
    const normDiff = (d) => {
      const s = String(d || "").toLowerCase();
      if (s.startsWith("1") || s.startsWith("e")) return "easy";
      if (s.startsWith("2") || s.startsWith("m")) return "medium";
      if (s.startsWith("3") || s.startsWith("h")) return "hard";
      return "";
    };
    const statusFromState = (st) => {
      if (!st) return "not-started";
      if (st.isAnswerEvaluated) {
        if (st.evalStatus === "correct") return "correct";
        if (st.evalStatus === "partial") return "partial";
        if (st.evalStatus === "incorrect") return "incorrect";
        return "completed";
      }
      if (st.isAnswerPicked) return "in-progress";
      return "not-started";
    };

    // Compute progress counts per chapter under saved filters
    const out = {};
    for (const chId of chapters) {
      const cid = String(chId);
      const defaults = {
        q: "",
        years: [],
        status: [],
        diff: [],
        sort: "index",
      };
      const f = Object.assign({}, defaults, prefsMap[cid] || {});
      const activeDiffs = Array.isArray(f.diff)
        ? f.diff.filter(Boolean).map((v) => String(v))
        : f.diff
        ? [String(f.diff)]
        : [];
      const activeStatuses = Array.isArray(f.status)
        ? f.status.filter(Boolean).map((v) => String(v))
        : f.status
        ? [String(f.status)]
        : [];
      const stArr = Array.isArray(statesMap[cid]) ? statesMap[cid] : [];

      const requiresMeta =
        (f.q && String(f.q).trim()) ||
        (Array.isArray(f.years) && f.years.length) ||
        activeDiffs.some((v) => String(v).trim());
      let total = 0,
        green = 0,
        red = 0,
        grey = 0;

      if (!requiresMeta) {
        const totalQs = Math.max(0, Number(totalsById[cid] || 0));
        // Aggregate state counts without iterating over all indices
        let correct = 0,
          incorrect = 0,
          partial = 0,
          inProgress = 0,
          evaluated = 0;
        for (let i = 0; i < stArr.length; i++) {
          const st = stArr[i];
          if (!st) continue;
          if (st.isAnswerEvaluated) {
            evaluated++;
            if (st.evalStatus === "correct") correct++;
            else if (st.evalStatus === "incorrect") incorrect++;
            else if (st.evalStatus === "partial") partial++;
          } else if (st.isAnswerPicked) {
            inProgress++;
          }
        }
        if (!activeStatuses.length) {
          green = correct;
          red = incorrect + partial;
          grey = Math.max(0, totalQs - green - red);
          total = totalQs;
        } else {
          const statusSet = new Set(activeStatuses);
          if (statusSet.has("completed") || statusSet.has("correct"))
            green += correct;
          if (statusSet.has("completed") || statusSet.has("incorrect"))
            red += incorrect;
          if (statusSet.has("completed") || statusSet.has("partial"))
            red += partial;
          if (statusSet.has("in-progress")) grey += inProgress;
          if (statusSet.has("not-started"))
            grey += Math.max(0, totalQs - evaluated - inProgress);
          total = green + red + grey;
        }
      } else {
        const meta = Array.isArray(metaMap[cid]) ? metaMap[cid] : [];
        let mapped = meta.map((q, i) => ({ q, i }));
        if (f.q) {
          const qq = String(f.q).trim().toLowerCase();
          mapped = mapped.filter((o) =>
            (o.q.qText || "").toLowerCase().includes(qq)
          );
        }
        if (Array.isArray(f.years) && f.years.length) {
          const set = new Set(f.years);
          mapped = mapped.filter((o) => {
            const y = parseYear(o.q.pyqInfo);
            return y && set.has(y);
          });
        }
        if (activeDiffs.length) {
          mapped = mapped.filter((o) =>
            activeDiffs.includes(normDiff(o.q.diffuculty))
          );
        }
        if (activeStatuses.length) {
          mapped = mapped.filter((o) => {
            const s = statusFromState(stArr[o.i]);
            return (
              activeStatuses.includes(s) ||
              (activeStatuses.includes("completed") &&
                stArr[o.i]?.isAnswerEvaluated)
            );
          });
        }
        total = mapped.length;
        for (const o of mapped) {
          const s = statusFromState(stArr[o.i]);
          if (s === "correct") green++;
          else if (s === "incorrect" || s === "partial") red++;
          else grey++;
        }
      }
      out[cid] = { total, green, red, grey };
    }

    return res.json(out);
  } catch (e) {
    console.error("pyqs progress:", e);
    const code = e.status || 500;
    return res.status(code).json({ error: String(e.message || e) });
  }
});

// ---------- PYQs icon proxy (public) ----------
app.get("/api/pyqs/icon", async (req, res) => {
  try {
    const src = String(req.query.src || "").trim();
    if (!src) return res.status(400).json({ error: "src is required" });
    let u;
    try {
      u = new URL(src);
    } catch {
      return res.status(400).json({ error: "invalid src" });
    }
    if (USE_LOCAL_PYQS) {
      // Attempt to map remote chapter icon src to local cached asset under /pyqs-assets/icons/chapters
      const m = String(u.pathname || "").match(/\/icons\/exam\/(.+)$/);
      const iconName = m ? m[1] : "";
      if (iconName) {
        try {
          const dir = path.join(pyqsAssetsDir, "icons", "chapters");
          const files = fs.readdirSync(dir);
          const f = files.find(
            (fn) => fn === iconName || fn.startsWith(iconName + ".")
          );
          if (f) {
            const abs = path.join(dir, f);
            res.set("Cache-Control", "public, max-age=31536000, immutable");
            res.removeHeader("Pragma");
            res.removeHeader("Expires");
            return res.sendFile(abs);
          }
        } catch {}
      }
      // Fallback to remote fetch if not found locally
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return res.status(400).json({ error: "unsupported scheme" });
    }
    const rel = await cacheIcon(src);
    const file = rel.split("/").pop();
    const abs = path.join(iconsDir, file);
    // Serve directly with long cache; override global no-store
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.removeHeader("Pragma");
    res.removeHeader("Expires");
    return res.sendFile(abs);
  } catch (e) {
    return res.status(500).json({ error: "icon fetch failed" });
  }
});

// ---------- PYQs per-user state (protected) ----------
// GET state
app.get("/api/pyqs/state/:examId/:subjectId/:chapterId", auth, (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    const row = db
      .prepare(
        "SELECT state FROM pyqs_states WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?"
      )
      .get(req.userId, String(examId), String(subjectId), String(chapterId));
    const state = row ? safeParseJSON(row.state, []) : [];
    res.json(Array.isArray(state) ? state : []);
  } catch (e) {
    console.error("pyqs get state:", e);
    res.status(500).json({ error: "Failed to get PYQs state" });
  }
});

// POST/UPSERT state
app.post("/api/pyqs/state/:examId/:subjectId/:chapterId", auth, (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    const state = req.body?.state ?? [];
    const text = JSON.stringify(state);
    db.prepare(
      `
      INSERT INTO pyqs_states (userId, examId, subjectId, chapterId, state)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(userId, examId, subjectId, chapterId)
      DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP
    `
    ).run(
      req.userId,
      String(examId),
      String(subjectId),
      String(chapterId),
      text
    );
    res.json({ success: true });
  } catch (e) {
    console.error("pyqs save state:", e);
    if (e && e.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      // Likely a stale/invalid token (user disappeared). Force re-auth on client.
      return res
        .status(401)
        .json({ error: "Invalid session. Please log in again." });
    }
    res.status(500).json({ error: "Failed to save PYQs state" });
  }
});

// Bulk get states for all chapters under a subject
app.get("/api/pyqs/state/:examId/:subjectId", auth, (req, res) => {
  try {
    const { examId, subjectId } = req.params;
    const rows = db
      .prepare(
        "SELECT chapterId, state FROM pyqs_states WHERE userId = ? AND examId = ? AND subjectId = ?"
      )
      .all(req.userId, String(examId), String(subjectId));
    const out = {};
    for (const r of rows) {
      out[String(r.chapterId)] = safeParseJSON(r.state, []);
    }
    res.json(out);
  } catch (e) {
    console.error("pyqs bulk get state:", e);
    res.status(500).json({ error: "Failed to get PYQs state (bulk)" });
  }
});

// ---------- PYQs per-user preferences (protected) ----------
// GET prefs
app.get("/api/pyqs/prefs/:examId/:subjectId/:chapterId", auth, (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    const row = db
      .prepare(
        "SELECT prefs FROM pyqs_prefs WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?"
      )
      .get(req.userId, String(examId), String(subjectId), String(chapterId));
    const prefs = row ? safeParseJSON(row.prefs, {}) : {};
    res.json(prefs && typeof prefs === "object" ? prefs : {});
  } catch (e) {
    console.error("pyqs get prefs:", e);
    res.status(500).json({ error: "Failed to get PYQs prefs" });
  }
});

// POST/UPSERT prefs
app.post("/api/pyqs/prefs/:examId/:subjectId/:chapterId", auth, (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    const prefs = req.body?.prefs ?? {};
    const text = JSON.stringify(
      prefs && typeof prefs === "object" ? prefs : {}
    );
    db.prepare(
      `
      INSERT INTO pyqs_prefs (userId, examId, subjectId, chapterId, prefs)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(userId, examId, subjectId, chapterId)
      DO UPDATE SET prefs = excluded.prefs, updated_at = CURRENT_TIMESTAMP
    `
    ).run(
      req.userId,
      String(examId),
      String(subjectId),
      String(chapterId),
      text
    );
    res.json({ success: true });
  } catch (e) {
    console.error("pyqs save prefs:", e);
    res.status(500).json({ error: "Failed to save PYQs prefs" });
  }
});

// Bulk get prefs for all chapters under a subject
app.get("/api/pyqs/prefs/:examId/:subjectId", auth, (req, res) => {
  try {
    const { examId, subjectId } = req.params;
    const rows = db
      .prepare(
        "SELECT chapterId, prefs FROM pyqs_prefs WHERE userId = ? AND examId = ? AND subjectId = ?"
      )
      .all(req.userId, String(examId), String(subjectId));
    const out = {};
    for (const r of rows) {
      const obj = safeParseJSON(r.prefs, {});
      out[String(r.chapterId)] = obj && typeof obj === "object" ? obj : {};
    }
    res.json(out);
  } catch (e) {
    console.error("pyqs bulk get prefs:", e);
    res.status(500).json({ error: "Failed to get PYQs prefs (bulk)" });
  }
});

// Sign up: create or set password for existing username without password
app.post("/signup", (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || username.trim().length < 2) {
      return res.status(400).json({ error: "Username too short" });
    }
    if (!password || String(password).length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }
    const uname = username.trim();
    const row = db
      .prepare(
        "SELECT id, username, password_hash, force_pw_reset FROM users WHERE username = ?"
      )
      .get(uname);
    const pwHash = hashPassword(password);
    let user;
    if (!row) {
      const id = nanoid();
      db.prepare(
        "INSERT INTO users (id, username, password_hash, force_pw_reset) VALUES (?, ?, ?, 0)"
      ).run(id, uname, pwHash);
      user = { id, username: uname };
    } else if (!row.password_hash) {
      db.prepare(
        "UPDATE users SET password_hash = ?, force_pw_reset = 0 WHERE id = ?"
      ).run(pwHash, row.id);
      user = { id: row.id, username: row.username };
    } else {
      return res.status(400).json({ error: "Username already exists" });
    }
    const token = signToken(user.id);
    res.json({
      success: true,
      user: { ...user, mustChangePassword: false },
      token,
    });
  } catch (e) {
    console.error("Signup failed:", e);
    res.status(500).json({ error: "Signup failed" });
  }
});

// Back-compat alias
app.post("/register", (req, res) => {
  req.url = "/signup";
  app._router.handle(req, res);
});

// Login: require password
app.post("/login", (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || username.trim().length < 2) {
      return res.status(400).json({ error: "Username too short" });
    }
    if (!password) return res.status(400).json({ error: "Password required" });
    const uname = username.trim();
    const row = db
      .prepare(
        "SELECT id, username, password_hash, force_pw_reset FROM users WHERE username = ?"
      )
      .get(uname);
    if (!row || !row.password_hash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (!verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const user = {
      id: row.id,
      username: row.username,
      mustChangePassword: !!row.force_pw_reset,
      isAdmin: !!row.is_admin,
    };
    const token = signToken(user.id);
    res.json({ success: true, user, token });
  } catch (e) {
    console.error("Login failed:", e);
    res.status(500).json({ error: "Login failed" });
  }
});

// Token-optional: returns user or null (useful for navbar)
app.get("/me", (req, res) => {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.json(null);
  try {
    const { sub } = jwt.verify(m[1], JWT_SECRET);
    const u = db
      .prepare(
        "SELECT id, username, force_pw_reset, getmarks_token, is_admin FROM users WHERE id = ?"
      )
      .get(String(sub));
    if (!u) return res.json(null);
    res.json({
      id: u.id,
      username: u.username,
      mustChangePassword: !!u.force_pw_reset,
      hasMarksAuth: !!(u.getmarks_token && String(u.getmarks_token).trim()),
      isAdmin: !!u.is_admin,
      pyqsSource: (u.pyqs_source && String(u.pyqs_source).trim()) || "auto",
    });
  } catch {
    res.json(null);
  }
});

// No-op for JWT flows (client just forgets the token)
app.post("/logout", (_req, res) => {
  res.json({ success: true });
});

// ---------- Assignment loader (from Pages) ----------
const ASSIGNMENT_CACHE_TTL_MS = 15_000;
const assignmentCache = new Map();
function invalidateAssignmentCache(assignmentId) {
  assignmentCache.delete(assignmentId);
}

function getNextAssignmentId() {
  const row = db
    .prepare("SELECT COALESCE(MAX(id), 0) AS maxId FROM assignments")
    .get();
  return Number(row?.maxId || 0) + 1;
}

function parseAssignmentWriteInput(body, { allowImplicitId = true } = {}) {
  const source = body && typeof body === "object" ? body : {};
  const rawAssignmentId =
    source.assignmentId ?? source.aID ?? source.id ?? source.assignment?.aID;
  const assignmentId =
    rawAssignmentId == null || rawAssignmentId === ""
      ? null
      : Number(rawAssignmentId);
  if (
    assignmentId != null &&
    (!Number.isInteger(assignmentId) || assignmentId <= 0)
  ) {
    return { error: "assignmentId must be a positive integer" };
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
    return { error: "assignment payload is required" };
  }

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

  const metadata = {
    title: title == null ? null : String(title).trim(),
    subject: subject == null ? null : String(subject).trim(),
    faculty: faculty == null ? null : String(faculty).trim(),
    chapter: chapter == null ? null : String(chapter).trim(),
    sourceRelPath:
      sourceRelPath == null ? null : String(sourceRelPath).trim(),
  };

  if (!metadata.title) return { error: "title is required" };
  if (!metadata.subject) return { error: "subject is required" };
  if (!metadata.chapter) return { error: "chapter is required" };
  if (!metadata.faculty) return { error: "faculty is required" };

  return {
    assignmentId:
      assignmentId != null
        ? assignmentId
        : allowImplicitId
          ? getNextAssignmentId()
          : null,
    payload,
    metadata,
  };
}

async function loadAssignment(assignmentId) {
  const cached = assignmentCache.get(assignmentId);
  if (cached && Date.now() - cached.loadedAt < ASSIGNMENT_CACHE_TTL_MS) {
    return cached.value;
  }

  const dbAssignment = loadAssignmentFromDb(db, assignmentId);
  if (dbAssignment) {
    assignmentCache.set(assignmentId, {
      loadedAt: Date.now(),
      value: dbAssignment,
    });
    return dbAssignment;
  }

  const url = `${ASSETS_BASE}/data/question_data/${assignmentId}/assignment.json`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok)
    throw new Error(`Failed to fetch assignment ${assignmentId}: ${r.status}`);
  const json = await r.json();
  assignmentCache.set(assignmentId, { loadedAt: Date.now(), value: json });
  return json;
}

// Assignment bootstrap aggregator
app.get("/api/assignment/:aID/bootstrap", (req, res) => {
  try {
    const aID = Number(req.params.aID);
    if (!Number.isFinite(aID))
      return res.status(400).json({ error: "invalid assignment id" });
    // Load assignment from static cache/Pages
    loadAssignment(aID)
      .then((assignment) => {
        const metaRow = db
          .prepare(
            `SELECT
               id AS aID,
               COALESCE(subject, '(No subject)') AS subject,
               COALESCE(faculty, '') AS faculty,
               COALESCE(chapter, '') AS chapter,
               COALESCE(title, 'Assignment ' || id) AS title,
               question_count AS totalQuestions
             FROM assignments
             WHERE id = ?`
          )
          .get(aID);
        const stateRow = db
          .prepare(
            "SELECT state FROM states WHERE userId = ? AND assignmentId = ?"
          )
          .get(req.userId, aID);
        const state = stateRow ? safeParseJSON(stateRow.state, []) : [];
        const bookmarks = db
          .prepare(
            "SELECT questionIndex, tagId FROM bookmarks WHERE userId = ? AND assignmentId = ?"
          )
          .all(req.userId, aID);
        const marks = db
          .prepare(
            "SELECT questionIndex, color FROM question_marks WHERE userId = ? AND assignmentId = ?"
          )
          .all(req.userId, aID);
        const tags = db
          .prepare(
            "SELECT id, name, created_at FROM bookmark_tags WHERE userId = ? ORDER BY name = 'Doubt' DESC, name ASC"
          )
          .all(req.userId);
        res.json({
          assignment,
          meta:
            metaRow || {
              aID: aID,
              subject: "(No subject)",
              faculty: "",
              chapter: "",
              title: `Assignment ${aID}`,
              totalQuestions: Array.isArray(assignment?.questions)
                ? assignment.questions.length
                : Array.isArray(assignment)
                  ? assignment.length
                  : 0,
            },
          state,
          bookmarks,
          marks,
          tags,
        });
      })
      .catch((e) => {
        res.status(500).json({ error: "Failed to load assignment" });
      });
  } catch (e) {
    res.status(500).json({ error: "Failed to bootstrap assignment" });
  }
});

app.post("/api/internal/assignments/sync", assignmentSyncOnly, (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const assignments = Array.isArray(body.assignments) ? body.assignments : [];
    if (!assignments.length) {
      return res
        .status(400)
        .json({ error: "assignments must be a non-empty array" });
    }

    const summary = syncAssignmentsToDb(db, assignments, {
      onAssignment(result) {
        invalidateAssignmentCache(result.assignmentId);
      },
    });

    res.json({
      success: true,
      source: body.source == null ? null : String(body.source),
      commitSha: body.commitSha == null ? null : String(body.commitSha),
      generatedAt: body.generatedAt == null ? null : String(body.generatedAt),
      ...summary,
    });
  } catch (e) {
    console.error("assignment sync api:", e);
    const message = e?.message || "Failed to sync assignments";
    const status =
      /assignmentId must be a non-negative integer|assignment payload is required/i.test(
        message
      )
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

// ---------- Protected routes (require Bearer token) ----------
app.use(auth);

app.get("/api/admin/assignments/next-id", adminOnly, (_req, res) => {
  try {
    res.json({ assignmentId: getNextAssignmentId() });
  } catch (e) {
    console.error("next assignment id:", e);
    res.status(500).json({ error: "Failed to generate assignment id" });
  }
});

app.post("/api/admin/assignments", adminOnly, (req, res) => {
  try {
    const parsed = parseAssignmentWriteInput(req.body, {
      allowImplicitId: true,
    });
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const { assignmentId, payload, metadata } = parsed;
    const existed = !!db
      .prepare("SELECT 1 FROM assignments WHERE id = ?")
      .get(assignmentId);

    const result = upsertAssignmentInDb(db, assignmentId, payload, metadata);
    invalidateAssignmentCache(assignmentId);

    const assignment = loadAssignmentFromDb(db, assignmentId);
    const meta = db
      .prepare(
        `SELECT
           id AS aID,
           COALESCE(subject, '(No subject)') AS subject,
           COALESCE(faculty, '') AS faculty,
           COALESCE(chapter, '') AS chapter,
           COALESCE(title, 'Assignment ' || id) AS title,
           question_count AS totalQuestions
         FROM assignments
         WHERE id = ?`
      )
      .get(assignmentId);

    res.status(existed ? 200 : 201).json({
      success: true,
      created: !existed,
      assignmentId,
      result,
      assignment,
      meta,
    });
  } catch (e) {
    console.error("upsert assignment:", e);
    res.status(500).json({ error: "Failed to save assignment" });
  }
});

app.put("/api/admin/assignments/:aID", adminOnly, (req, res) => {
  try {
    const routeAssignmentId = Number(req.params.aID);
    if (!Number.isInteger(routeAssignmentId) || routeAssignmentId <= 0) {
      return res.status(400).json({ error: "invalid assignment id" });
    }

    const parsed = parseAssignmentWriteInput(
      { ...(req.body || {}), assignmentId: routeAssignmentId },
      { allowImplicitId: false }
    );
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const existed = !!db
      .prepare("SELECT 1 FROM assignments WHERE id = ?")
      .get(routeAssignmentId);
    if (!existed) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    const result = upsertAssignmentInDb(
      db,
      routeAssignmentId,
      parsed.payload,
      parsed.metadata
    );
    invalidateAssignmentCache(routeAssignmentId);

    const assignment = loadAssignmentFromDb(db, routeAssignmentId);
    const meta = db
      .prepare(
        `SELECT
           id AS aID,
           COALESCE(subject, '(No subject)') AS subject,
           COALESCE(faculty, '') AS faculty,
           COALESCE(chapter, '') AS chapter,
           COALESCE(title, 'Assignment ' || id) AS title,
           question_count AS totalQuestions
         FROM assignments
         WHERE id = ?`
      )
      .get(routeAssignmentId);

    res.json({
      success: true,
      created: false,
      assignmentId: routeAssignmentId,
      result,
      assignment,
      meta,
    });
  } catch (e) {
    console.error("update assignment:", e);
    res.status(500).json({ error: "Failed to update assignment" });
  }
});

app.get("/api/users", (req, res) => {
  try {
    const rows = db
      .prepare(
        "SELECT id, username FROM users WHERE id <> ? ORDER BY username COLLATE NOCASE ASC"
      )
      .all(req.userId);
    res.json(rows.map((u) => ({ id: u.id, username: u.username })));
  } catch (e) {
    console.error("list users:", e);
    res.status(500).json({ error: "Failed to list users" });
  }
});

// Tests
app.get("/api/tests", (req, res) => {
  try {
    const currentUser = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(req.userId);
    const rows = db
      .prepare(
        `SELECT
           t.id AS testId,
           t.userId,
           t.title,
           t.description,
           t.share_with_json,
           t.archived_at,
           u.username AS creator,
           t.created_at AS createdAt,
           t.score,
           t.max_score AS maxScore,
           t.attempted_count AS attempted,
           t.total_questions AS totalQuestions,
           t.status,
           CASE WHEN st.testId IS NULL THEN 0 ELSE 1 END AS starred
         FROM tests t
         LEFT JOIN users u ON u.id = t.userId
         LEFT JOIN starred_tests st ON st.userId = ? AND st.testId = t.id
         LEFT JOIN unlisted_tests ut ON ut.userId = ? AND ut.testId = t.id
         WHERE t.archived_at IS NULL AND ut.testId IS NULL
         ORDER BY datetime(t.created_at) DESC, t.id DESC`
      )
      .all(req.userId, req.userId)
      .filter((row) => userCanAccessTestRow(req.userId, currentUser?.username, row));
    const questionRows = db
      .prepare(
        `SELECT testId, question_key FROM test_questions
         WHERE testId IN (${rows.map(() => "?").join(",") || "NULL"})
         ORDER BY testId, order_index`
      )
      .all(...rows.map((row) => row.testId));
    const keysByTest = new Map();
    questionRows.forEach((row) => {
      if (!keysByTest.has(row.testId)) keysByTest.set(row.testId, []);
      keysByTest.get(row.testId).push(row.question_key);
    });
    const attemptRows = rows.length
      ? db
          .prepare(
            `SELECT testId, status, score, max_score AS maxScore, attempted_count AS attempted,
                    total_questions AS totalQuestions, submitted_at AS submittedAt, started_at AS startedAt
             FROM test_attempts
             WHERE userId = ? AND testId IN (${rows.map(() => "?").join(",")})
             ORDER BY datetime(COALESCE(submitted_at, started_at)) DESC, id DESC`
          )
          .all(req.userId, ...rows.map((row) => row.testId))
      : [];
    const attemptsByTest = new Map();
    attemptRows.forEach((attempt) => {
      if (!attemptsByTest.has(attempt.testId)) attemptsByTest.set(attempt.testId, []);
      attemptsByTest.get(attempt.testId).push(attempt);
    });
    const rankRows = rows.length
      ? db
          .prepare(
            `SELECT testId, userId, status, score, submitted_at AS submittedAt, id
             FROM test_attempts
             WHERE testId IN (${rows.map(() => "?").join(",")})
               AND (submitted_at IS NOT NULL OR status IN ('submitted', 'completed', 'attempted', 'finished'))
             ORDER BY testId, userId, score DESC, datetime(submitted_at) DESC, id DESC`
          )
          .all(...rows.map((row) => row.testId))
      : [];
    const bestByTestUser = new Map();
    rankRows.forEach((attempt) => {
      const key = `${attempt.testId}:${attempt.userId}`;
      const prev = bestByTestUser.get(key);
      if (!prev || Number(attempt.score || 0) > Number(prev.score || 0)) {
        bestByTestUser.set(key, attempt);
      }
    });
    const rankByTestForCurrentUser = new Map();
    const leaderboardByTest = new Map();
    Array.from(bestByTestUser.values()).forEach((attempt) => {
      const testKey = String(attempt.testId || "");
      if (!leaderboardByTest.has(testKey)) leaderboardByTest.set(testKey, []);
      leaderboardByTest.get(testKey).push(attempt);
    });
    leaderboardByTest.forEach((attempts, testId) => {
      attempts.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      attempts.forEach((attempt, index) => {
        const prev = attempts[index - 1];
        const rank = prev && Number(prev.score || 0) === Number(attempt.score || 0)
          ? prev.rank
          : index + 1;
        attempt.rank = rank;
        if (String(attempt.userId || "") === String(req.userId)) {
          rankByTestForCurrentUser.set(String(testId || ""), rank);
        }
      });
    });
    const summarizeForCurrentUser = (row) => {
      const attempts = attemptsByTest.get(row.testId) || attemptsByTest.get(String(row.testId || "")) || [];
      const rank = rankByTestForCurrentUser.get(String(row.testId || "")) || null;
      const latest = attempts[0] || null;
      const submitted = attempts.filter((attempt) =>
        ["submitted", "completed", "attempted", "finished"].includes(
          String(attempt.status || "").toLowerCase()
        ) || attempt.submittedAt
      );
      const best = submitted.reduce((winner, attempt) => {
        if (!winner) return attempt;
        return Number(attempt.score || 0) > Number(winner.score || 0) ? attempt : winner;
      }, null);
      const latestIsPaused =
        latest &&
        !(
          ["submitted", "completed", "attempted", "finished"].includes(
            String(latest.status || "").toLowerCase()
          ) || latest.submittedAt
        );
      if (latestIsPaused) {
        return {
          status: "paused",
          attempted: Number(latest.attempted || 0),
          totalQuestions: Number(latest.totalQuestions || row.totalQuestions || 0),
          score: Number(best?.score ?? row.score ?? 0),
          maxScore: Number(best?.maxScore ?? row.maxScore ?? 0),
          rank,
        };
      }
      if (best) {
        return {
          status: "attempted",
          attempted: Number(best.attempted || 0),
          totalQuestions: Number(best.totalQuestions || row.totalQuestions || 0),
          score: Number(best.score || 0),
          maxScore: Number(best.maxScore || row.maxScore || 0),
          rank,
        };
      }
      return {
        status: "unattempted",
        attempted: 0,
        totalQuestions: Number(row.totalQuestions || 0),
        score: 0,
        maxScore: Number(row.maxScore || 0),
        rank: null,
      };
    };
    res.json(
      rows.map((row) => {
        const summary = summarizeForCurrentUser(row);
        return {
          ...row,
          ...summary,
          userId: undefined,
          share_with_json: undefined,
          starred: !!row.starred,
          questionKeys: keysByTest.get(row.testId) || [],
        };
      })
    );
  } catch (e) {
    console.error("list tests:", e);
    res.status(500).json({ error: "Failed to load tests" });
  }
});

app.post("/api/tests", async (req, res) => {
  try {
    const draft = req.body || {};
    const title = String(draft.testName || draft.title || "").trim();
    if (!title) return res.status(400).json({ error: "Test name is required" });

    const generated = await generateTestQuestions(req, draft);
    const shareWith = Array.isArray(draft.shareWith)
      ? draft.shareWith.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const reusePolicy = normalizeTestReusePolicy(draft.questionReusePolicy);
    const timeLimitSeconds = Math.max(
      0,
      Math.round(
        Number(
          draft.timeLimitSeconds ??
            draft.testBlueprint?.timeLimitSeconds ??
            Number(draft.testBlueprint?.timeLimitMinutes || 0) * 60
        ) || 0
      )
    );
    const maxScore = generated.questions.reduce(
      (sum, q) => sum + Number(q.positiveMarks || 0),
      0
    );

    const insert = db.transaction(() => {
      const generatedTestId = TESTS_USE_TEXT_IDS ? nanoid() : "";
      const columns = [];
      const values = [];
      const addValue = (column, value) => {
        if (!TESTS_COLUMNS.has(column)) return;
        columns.push(column);
        values.push(value);
      };
      if (TESTS_USE_TEXT_IDS) addValue("id", generatedTestId);
      addValue("ownerId", req.userId);
      addValue("userId", req.userId);
      addValue("name", title);
      addValue("title", title);
      addValue("mode", "generated");
      addValue("description", String(draft.testDescription || draft.description || "").trim());
      addValue("share_with_json", JSON.stringify(shareWith));
      addValue("config_json", JSON.stringify(draft));
      addValue("reuse_policy_json", JSON.stringify(reusePolicy));
      addValue("time_limit_sec", timeLimitSeconds || null);
      addValue("status", "unattempted");
      addValue("score", 0);
      addValue("max_score", maxScore);
      addValue("attempted_count", 0);
      addValue("total_questions", generated.questions.length);
      const placeholders = columns.map(() => "?").join(", ");
      const insertSql = `INSERT INTO tests (${columns.join(", ")}) VALUES (${placeholders})`;
      const info = db.prepare(insertSql).run(...values);
      const testId = TESTS_USE_TEXT_IDS ? generatedTestId : String(info.lastInsertRowid);
      generated.questions.forEach((question, index) => {
        insertGeneratedTestQuestion(testId, question, index);
      });
      return testId;
    });

    const testId = insert();
    const row = db
      .prepare(
        `SELECT id AS testId, title, description, created_at AS createdAt,
                score, max_score AS maxScore, attempted_count AS attempted,
                total_questions AS totalQuestions, status
           FROM tests WHERE id = ? AND userId = ?`
      )
      .get(testId, req.userId);
    res.status(201).json({
      ...row,
      questionKeys: generated.questions.map((q) => q.questionKey),
      generation: generated.summary,
    });
  } catch (e) {
    console.error("create test:", e);
    res.status(e.status || 500).json({ error: e.message || "Failed to create test" });
  }
});

app.post("/api/tests/join", (req, res) => {
  try {
    const testId = normalizeTestId(req.body?.testId);
    if (!testId) {
      return res.status(400).json({ error: "Invalid test id" });
    }
    const row = db
      .prepare(
        "SELECT id, ownerId, userId, archived_at, share_with_json, config_json FROM tests WHERE id = ?"
      )
      .get(testId);
    if (!row || row.archived_at) {
      return res.status(404).json({ error: "Test not found" });
    }
    const currentUser = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(req.userId);
    const shareWith = mergeShareWithUsername(row.share_with_json, currentUser?.username);
    const configValue = safeParseJSON(row.config_json, {});
    const config =
      configValue && typeof configValue === "object" && !Array.isArray(configValue)
        ? configValue
        : {};
    config.shareWith = mergeShareWithUsername(config.shareWith || [], currentUser?.username);
    db.transaction(() => {
      db.prepare(
        `INSERT INTO test_access (userId, testId) VALUES (?, ?)
         ON CONFLICT(userId, testId) DO NOTHING`
      ).run(req.userId, testId);
      db.prepare("DELETE FROM unlisted_tests WHERE userId = ? AND testId = ?").run(
        req.userId,
        testId
      );
      if (TESTS_COLUMNS.has("share_with_json") || TESTS_COLUMNS.has("config_json")) {
        const setParts = [];
        const values = [];
        if (TESTS_COLUMNS.has("share_with_json")) {
          setParts.push("share_with_json = ?");
          values.push(JSON.stringify(shareWith));
        }
        if (TESTS_COLUMNS.has("config_json")) {
          setParts.push("config_json = ?");
          values.push(JSON.stringify(config));
        }
        if (TESTS_COLUMNS.has("updated_at")) setParts.push("updated_at = CURRENT_TIMESTAMP");
        if (setParts.length) {
          db.prepare(`UPDATE tests SET ${setParts.join(", ")} WHERE id = ?`).run(
            ...values,
            testId
          );
        }
      }
    })();
    res.json({ success: true, testId, shareWith });
  } catch (e) {
    console.error("join test:", e);
    res.status(500).json({ error: "Failed to add test" });
  }
});

app.get("/api/tests/starred", (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT testId FROM starred_tests
         WHERE userId = ?
         ORDER BY datetime(created_at) DESC`
      )
      .all(req.userId);
    res.json(rows.map((row) => String(row.testId)));
  } catch (e) {
    console.error("list starred tests:", e);
    res.status(500).json({ error: "Failed to load starred tests" });
  }
});

app.post("/api/tests/starred/:testId", (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    if (!testId) {
      return res.status(400).json({ error: "Invalid testId" });
    }
    const row = db
      .prepare("SELECT id FROM tests WHERE id = ? AND userId = ?")
      .get(testId, req.userId);
    if (!row && !userCanAccessTest(req.userId, testId)) {
      return res.status(404).json({ error: "Test not found" });
    }
    db.prepare(
      `INSERT INTO starred_tests (userId, testId) VALUES (?, ?)
       ON CONFLICT(userId, testId) DO NOTHING`
    ).run(req.userId, testId);
    res.json({ success: true });
  } catch (e) {
    console.error("star test:", e);
    res.status(500).json({ error: "Failed to star test" });
  }
});

app.delete("/api/tests/starred/:testId", (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    if (!testId) {
      return res.status(400).json({ error: "Invalid testId" });
    }
    db.prepare("DELETE FROM starred_tests WHERE userId = ? AND testId = ?").run(
      req.userId,
      testId
    );
    res.json({ success: true });
  } catch (e) {
    console.error("unstar test:", e);
    res.status(500).json({ error: "Failed to unstar test" });
  }
});

app.patch("/api/tests/:testId/archive", (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    if (!testId) {
      return res.status(400).json({ error: "Invalid testId" });
    }
    const row = db
      .prepare("SELECT userId FROM tests WHERE id = ?")
      .get(testId);
    if (!row) return res.status(404).json({ error: "Test not found" });
    if (String(row.userId) !== String(req.userId)) {
      return res.status(403).json({ error: "Only the creator can archive this test" });
    }
    const archived = req.body?.archived !== false;
    db.prepare(
      `UPDATE tests
       SET archived_at = ${archived ? "CURRENT_TIMESTAMP" : "NULL"},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(testId);
    res.json({ success: true, archived });
  } catch (e) {
    console.error("archive test:", e);
    res.status(500).json({ error: "Failed to archive test" });
  }
});

app.delete("/api/tests/:testId", (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    if (!testId) {
      return res.status(400).json({ error: "Invalid testId" });
    }
    const row = db
      .prepare("SELECT userId FROM tests WHERE id = ?")
      .get(testId);
    if (!row) return res.status(404).json({ error: "Test not found" });
    if (String(row.userId) !== String(req.userId)) {
      return res.status(403).json({ error: "Only the creator can delete this test" });
    }
    db.prepare("DELETE FROM tests WHERE id = ?").run(testId);
    res.json({ success: true });
  } catch (e) {
    console.error("delete test:", e);
    res.status(500).json({ error: "Failed to delete test" });
  }
});

app.post("/api/tests/:testId/unlist", (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    if (!testId) {
      return res.status(400).json({ error: "Invalid testId" });
    }
    if (!userCanAccessTest(req.userId, testId, { includeArchived: true })) {
      return res.status(404).json({ error: "Test not found" });
    }
    db.prepare(
      `INSERT INTO unlisted_tests (userId, testId) VALUES (?, ?)
       ON CONFLICT(userId, testId) DO NOTHING`
    ).run(req.userId, testId);
    db.prepare("DELETE FROM starred_tests WHERE userId = ? AND testId = ?").run(
      req.userId,
      testId
    );
    res.json({ success: true });
  } catch (e) {
    console.error("unlist test:", e);
    res.status(500).json({ error: "Failed to unlist test" });
  }
});

app.patch("/api/tests/:testId/share", (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    if (!testId) {
      return res.status(400).json({ error: "Invalid testId" });
    }
    const row = db
      .prepare("SELECT ownerId, userId, share_with_json, config_json FROM tests WHERE id = ?")
      .get(testId);
    if (!row) return res.status(404).json({ error: "Test not found" });
    const creatorId = row.userId || row.ownerId;
    if (String(creatorId) !== String(req.userId)) {
      return res.status(403).json({ error: "Only the creator can update sharing" });
    }
    const previousShareWith = new Set(
      safeParseJSON(row.share_with_json, [])
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean)
    );
    const usernames = Array.isArray(req.body?.shareWith)
      ? req.body.shareWith.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const validRows = usernames.length
      ? db
          .prepare(
            `SELECT id, username FROM users
             WHERE LOWER(username) IN (${usernames.map(() => "LOWER(?)").join(",")})
             ORDER BY username COLLATE NOCASE ASC`
          )
          .all(...usernames)
      : [];
    const shareWith = Array.from(new Set(validRows.map((user) => user.username)));
    const nextShareWith = new Set(shareWith.map((item) => item.toLowerCase()));
    const addedUsernames = Array.from(nextShareWith).filter(
      (username) => !previousShareWith.has(username)
    );
    const addedRows = addedUsernames.length
      ? validRows.filter((user) => addedUsernames.includes(String(user.username || "").toLowerCase()))
      : [];
    const removedUsernames = Array.from(previousShareWith).filter(
      (username) => !nextShareWith.has(username)
    );
    const removedRows = removedUsernames.length
      ? db
          .prepare(
            `SELECT id, username FROM users
             WHERE LOWER(username) IN (${removedUsernames.map(() => "LOWER(?)").join(",")})`
          )
          .all(...removedUsernames)
      : [];
    const configValue = safeParseJSON(row.config_json, {});
    const config =
      configValue && typeof configValue === "object" && !Array.isArray(configValue)
        ? configValue
        : {};
    config.shareWith = shareWith;
    db.transaction(() => {
      db.prepare(
        `UPDATE tests
         SET share_with_json = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(JSON.stringify(shareWith), JSON.stringify(config), testId);
      const grantVisibility = db.prepare(
        "DELETE FROM unlisted_tests WHERE userId = ? AND testId = ?"
      );
      validRows.forEach((user) => {
        grantVisibility.run(user.id, testId);
      });
      const revokeAccess = db.prepare(
        "DELETE FROM test_access WHERE userId = ? AND testId = ?"
      );
      const unstar = db.prepare(
        "DELETE FROM starred_tests WHERE userId = ? AND testId = ?"
      );
      removedRows.forEach((user) => {
        if (String(user.id) === String(creatorId)) return;
        revokeAccess.run(user.id, testId);
        unstar.run(user.id, testId);
      });
      const creator = db
        .prepare("SELECT username FROM users WHERE id = ?")
        .get(creatorId);
      const titleRow = db
        .prepare("SELECT title, name FROM tests WHERE id = ?")
        .get(testId);
      const testTitle = titleRow?.title || titleRow?.name || "a test";
      addedRows.forEach((user) => {
        if (String(user.id) === String(creatorId)) return;
        createNotification({
          userId: user.id,
          title: "Test shared with you",
          body: `${creator?.username || "A user"} shared **${testTitle}** with you.`,
          meta: {
            type: "test_shared",
            testId,
            testTitle,
            sharedBy: creator?.username || "",
          },
        });
      });
      removedRows.forEach((user) => {
        if (String(user.id) === String(creatorId)) return;
        createNotification({
          userId: user.id,
          title: "Test sharing removed",
          body: `${creator?.username || "A user"} removed your access to **${testTitle}**.`,
          meta: {
            type: "test_unshared",
            testId,
            testTitle,
            unsharedBy: creator?.username || "",
          },
        });
      });
    })();
    res.json({ success: true, shareWith });
  } catch (e) {
    console.error("update test sharing:", e);
    res.status(500).json({ error: "Failed to update sharing" });
  }
});

app.get("/api/tests/:testId/overview", (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    if (!testId) {
      return res.status(400).json({ error: "Invalid testId" });
    }
    if (!userCanAccessTest(req.userId, testId)) {
      return res.status(404).json({ error: "Test not found" });
    }
    const test = db
      .prepare(
        `SELECT
           t.id AS testId,
           t.title,
           t.description,
           t.config_json,
           t.reuse_policy_json,
           t.share_with_json,
           t.userId,
           t.archived_at AS archivedAt,
           u.username AS creator,
           t.created_at AS createdAt,
           t.total_questions AS totalQuestions,
           t.max_score AS maxScore,
           t.status
         FROM tests t
         LEFT JOIN users u ON u.id = t.userId
         WHERE t.id = ?`
      )
      .get(testId);
    const attempts = db
      .prepare(
        `SELECT
           a.id AS attemptId,
           a.testId,
           a.userId,
           COALESCE(u.username, '') AS username,
           a.score,
           a.max_score AS maxScore,
           a.attempted_count AS attempted,
           a.total_questions AS totalQuestions,
           a.status,
           a.state_json,
           a.started_at AS startedAt,
           a.submitted_at AS submittedAt
         FROM test_attempts a
         LEFT JOIN users u ON u.id = a.userId
         WHERE a.testId = ?
         ORDER BY datetime(COALESCE(a.submitted_at, a.started_at)) DESC, a.id DESC`
      )
      .all(testId);
    const isCompletedAttempt = (attempt) =>
      String(attempt.status || "").toLowerCase() === "submitted" || attempt.submittedAt;
    const completedAttempts = attempts.filter(isCompletedAttempt);
    const bestByUser = new Map();
    completedAttempts.forEach((attempt) => {
      const prev = bestByUser.get(attempt.userId);
      const score = Number(attempt.score || 0);
      const prevScore = Number(prev?.score || 0);
      const newer =
        String(attempt.submittedAt || "") > String(prev?.submittedAt || "");
      if (!prev || score > prevScore || (score === prevScore && newer)) {
        bestByUser.set(attempt.userId, attempt);
      }
    });
    const leaderboard = Array.from(bestByUser.values())
      .sort((a, b) => {
        const byScore = Number(b.score || 0) - Number(a.score || 0);
        if (byScore) return byScore;
        return String(a.submittedAt || "").localeCompare(String(b.submittedAt || ""));
      })
      .map((attempt, index, arr) => {
        const prev = arr[index - 1];
        const rank =
          prev && Number(prev.score || 0) === Number(attempt.score || 0)
            ? prev.rank
            : index + 1;
        attempt.rank = rank;
        return attempt;
    });
    const leaderboardWithoutUser = new Map();
    completedAttempts.forEach((attempt) => {
      const prev = leaderboardWithoutUser.get(attempt.userId);
      const score = Number(attempt.score || 0);
      const prevScore = Number(prev?.score || 0);
      if (!prev || score > prevScore) leaderboardWithoutUser.set(attempt.userId, attempt);
    });
    const enrichedAttempts = attempts.map((attempt) => {
      const meta = safeParseJSON(attempt.state_json, {});
      const competitors = Array.from(leaderboardWithoutUser.values()).filter(
        (row) => String(row.userId) !== String(attempt.userId)
      );
      const candidateRankList = competitors.concat([attempt]).sort((a, b) => {
        const byScore = Number(b.score || 0) - Number(a.score || 0);
        if (byScore) return byScore;
        return String(a.submittedAt || "").localeCompare(String(b.submittedAt || ""));
      });
      let rankIfCounted = candidateRankList.length;
      for (let i = 0; i < candidateRankList.length; i += 1) {
        const prev = candidateRankList[i - 1];
        const rank =
          prev && Number(prev.score || 0) === Number(candidateRankList[i].score || 0)
            ? prev.rankIfCounted
            : i + 1;
        candidateRankList[i].rankIfCounted = rank;
        if (candidateRankList[i] === attempt) rankIfCounted = rank;
      }
      return {
        ...attempt,
        state_json: undefined,
        rankIfCounted,
        canDelete:
          String(attempt.userId || "") === String(req.userId) ||
          String(test?.userId || "") === String(req.userId),
        canReview:
          String(attempt.userId || "") === String(req.userId) ||
          String(test?.userId || "") === String(req.userId),
        positiveScore: Number(meta.positiveScore ?? meta.positiveMarks ?? attempt.score ?? 0),
        negativeScore: Number(meta.negativeScore ?? meta.negativeMarks ?? 0),
        partialScore: Number(meta.partialScore ?? meta.partialMarks ?? 0),
        subjectBreakdown: Array.isArray(meta.subjectBreakdown)
          ? meta.subjectBreakdown
          : Array.isArray(meta.subjects)
          ? meta.subjects
          : [],
      };
    });
    const currentUserAttempts = enrichedAttempts.filter(
      (attempt) => String(attempt.userId || "") === String(req.userId)
    );
    const currentUserCompletedAttempts = currentUserAttempts.filter(isCompletedAttempt);
    const currentUserBestScore = currentUserCompletedAttempts.length
      ? Math.max(...currentUserCompletedAttempts.map((attempt) => Number(attempt.score || 0)))
      : null;
    res.json({
      test,
      config: safeParseJSON(test?.config_json, {}),
      questionReusePolicy: safeParseJSON(test?.reuse_policy_json, {}),
      shareWith: safeParseJSON(test?.share_with_json, []),
      permissions: {
        isCreator: String(test?.userId || "") === String(req.userId),
        currentUserId: String(req.userId || ""),
      },
      latestAttempt: currentUserAttempts[0] || null,
      attempts: currentUserAttempts.map((attempt) => ({
        ...attempt,
        isBestAttempt:
          currentUserBestScore != null &&
          isCompletedAttempt(attempt) &&
          Number(attempt.score || 0) === currentUserBestScore,
      })),
      leaderboard,
    });
  } catch (e) {
    console.error("test overview:", e);
    res.status(500).json({ error: "Failed to load test overview" });
  }
});

app.get("/api/tests/:testId", (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    if (!testId) {
      return res.status(400).json({ error: "Invalid testId" });
    }
    const row = db
      .prepare(
        `SELECT
           t.id AS testId,
           t.title,
           t.description,
           t.share_with_json,
           t.config_json,
           t.reuse_policy_json,
           u.username AS creator,
           t.created_at AS createdAt,
           t.score,
           t.max_score AS maxScore,
           t.attempted_count AS attempted,
           t.total_questions AS totalQuestions,
           t.status
         FROM tests t
         LEFT JOIN users u ON u.id = t.userId
         WHERE t.id = ?`
      )
      .get(testId);
    if (!row || !userCanAccessTest(req.userId, testId)) {
      return res.status(404).json({ error: "Test not found" });
    }
    const questions = db
      .prepare(
        `SELECT
           order_index AS orderIndex,
           section_id AS sectionId,
           section_name AS sectionName,
           question_type AS questionType,
           subject_key AS subjectKey,
           subject_name AS subjectName,
           kind,
           source_id AS sourceId,
           assignmentId,
           examId,
           subjectId,
           chapterId,
           questionIndex,
           question_key AS questionKey,
           positive_marks AS positiveMarks,
           negative_marks AS negativeMarks,
           payload_json
         FROM test_questions
         WHERE testId = ?
         ORDER BY order_index ASC`
      )
      .all(testId)
      .map((question) => ({
        ...question,
        payload: safeParseJSON(question.payload_json, {}),
        payload_json: undefined,
      }));
    res.json({
      testId: row.testId,
      title: row.title,
      description: row.description || "",
      creator: row.creator || "",
      createdAt: row.createdAt,
      score: row.score,
      maxScore: row.maxScore,
      attempted: row.attempted,
      totalQuestions: row.totalQuestions,
      status: row.status,
      shareWith: safeParseJSON(row.share_with_json, []),
      config: safeParseJSON(row.config_json, {}),
      questionReusePolicy: safeParseJSON(row.reuse_policy_json, {}),
      questionKeys: questions.map((question) => question.questionKey),
      questions,
    });
  } catch (e) {
    console.error("get test:", e);
    res.status(500).json({ error: "Failed to load test" });
  }
});

app.post("/api/tests/:testId/attempts", async (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    if (!testId || !userCanAccessTest(req.userId, testId)) {
      return res.status(404).json({ error: "Test not found" });
    }
    const active = db
      .prepare(
        `SELECT id FROM test_attempts
         WHERE testId = ? AND userId = ? AND status = 'paused'
         ORDER BY datetime(started_at) DESC, id DESC LIMIT 1`
      )
      .get(testId, req.userId);
    const attemptId = active?.id || await createTestAttempt(req, req.userId, testId);
    res
      .status(active ? 200 : 201)
      .json(await buildTestAttemptPayload(req, req.userId, testId, attemptId, "take"));
  } catch (e) {
    console.error("start test attempt:", e);
    res.status(500).json({ error: "Failed to start test attempt" });
  }
});

app.get("/api/tests/:testId/attempts/:attemptId", async (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    const attemptId = normalizeTestId(req.params.attemptId);
    const payload = await buildTestAttemptPayload(req, req.userId, testId, attemptId, "take");
    if (!payload) return res.status(404).json({ error: "Attempt not found" });
    res.json(payload);
  } catch (e) {
    console.error("get test attempt:", e);
    res.status(500).json({ error: "Failed to load test attempt" });
  }
});

app.get("/api/tests/:testId/attempts/:attemptId/review", async (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    const attemptId = normalizeTestId(req.params.attemptId);
    const payload = await buildTestAttemptPayload(req, req.userId, testId, attemptId, "review");
    if (!payload) return res.status(404).json({ error: "Attempt not found" });
    res.json(payload);
  } catch (e) {
    console.error("review test attempt:", e);
    res.status(500).json({ error: "Failed to load test review" });
  }
});

app.delete("/api/tests/:testId/attempts/:attemptId", (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    const attemptId = normalizeTestId(req.params.attemptId);
    if (!testId || !attemptId || !userCanAccessTest(req.userId, testId)) {
      return res.status(404).json({ error: "Attempt not found" });
    }
    const test = db.prepare("SELECT userId FROM tests WHERE id = ?").get(testId);
    const attempt = db
      .prepare("SELECT * FROM test_attempts WHERE id = ? AND testId = ?")
      .get(attemptId, testId);
    if (!test || !attempt) return res.status(404).json({ error: "Attempt not found" });
    const canDelete =
      String(attempt.userId || "") === String(req.userId) ||
      String(test.userId || "") === String(req.userId);
    if (!canDelete) {
      return res.status(403).json({ error: "You can only delete your own attempts" });
    }
    db.prepare("DELETE FROM test_attempts WHERE id = ? AND testId = ?").run(attemptId, testId);
    refreshTestSummaryFromAttempts(testId);
    res.json({ success: true });
  } catch (e) {
    console.error("delete test attempt:", e);
    res.status(500).json({ error: "Failed to delete attempt" });
  }
});

app.post("/api/tests/:testId/attempts/:attemptId/save", async (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    const attemptId = normalizeTestId(req.params.attemptId);
    const row = getOwnedAttempt(req.userId, testId, attemptId);
    if (!row) return res.status(404).json({ error: "Attempt not found" });
    if (row.status === "submitted") return res.json({ success: true, submitted: true });
    const questions = await getResolvedTestQuestions(req, testId, row);
    const state = Array.isArray(req.body?.state) ? req.body.state : [];
    const meta = safeParseJSON(row.state_json, {});
    meta.state = state;
    meta.elapsedSeconds = Math.max(0, Number(req.body?.elapsedSeconds || meta.elapsedSeconds || 0));
    meta.remainingSeconds =
      req.body?.remainingSeconds == null
        ? meta.remainingSeconds
        : Math.max(0, Number(req.body.remainingSeconds || 0));
    meta.subjectProgress = buildSubjectProgress(questions, state);
    meta.subjectBreakdown = meta.subjectProgress;
    const attempted = countAttemptedTestAnswers(state);
    updateTestAttemptRow(attemptId, {
      state_json: JSON.stringify(meta),
      status: "paused",
      attempted_count: attempted,
      total_questions: questions.length,
      submitted_at: null,
    });
    updateTestSummary(testId, { status: "paused", attempted, totalQuestions: questions.length });
    res.json({ success: true });
  } catch (e) {
    console.error("save test attempt:", e);
    res.status(500).json({ error: "Failed to save attempt" });
  }
});

app.post("/api/tests/:testId/attempts/:attemptId/submit", async (req, res) => {
  try {
    const testId = normalizeTestId(req.params.testId);
    const attemptId = normalizeTestId(req.params.attemptId);
    const row = getOwnedAttempt(req.userId, testId, attemptId);
    if (!row) return res.status(404).json({ error: "Attempt not found" });
    const questions = await getResolvedTestQuestions(req, testId, row);
    const state = Array.isArray(req.body?.state)
      ? req.body.state
      : safeParseJSON(row.state_json, {}).state || [];
    const result = scoreTestAttempt(questions, state);
    const meta = {
      ...safeParseJSON(row.state_json, {}),
      state,
      elapsedSeconds: Math.max(0, Number(req.body?.elapsedSeconds || 0)),
      remainingSeconds:
        req.body?.remainingSeconds == null ? undefined : Math.max(0, Number(req.body.remainingSeconds || 0)),
      ...result.meta,
    };
    updateTestAttemptRow(attemptId, {
      state_json: JSON.stringify(meta),
      status: "submitted",
      score: result.score,
      max_score: result.maxScore,
      maxScore: result.maxScore,
      attempted_count: result.attempted,
      total_questions: questions.length,
      submitted_at: "CURRENT_TIMESTAMP",
    });
    updateTestSummary(testId, {
      status: "attempted",
      score: result.score,
      maxScore: result.maxScore,
      attempted: result.attempted,
      totalQuestions: questions.length,
    });
    res.json({ success: true, attemptId, score: result.score, maxScore: result.maxScore });
  } catch (e) {
    console.error("submit test attempt:", e);
    res.status(500).json({ error: "Failed to submit attempt" });
  }
});

// Report a question (assignment or PYQs)
app.post("/api/report", async (req, res) => {
  try {
    const {
      kind,
      assignmentId,
      examId,
      subjectId,
      chapterId,
      questionIndex,
      reason,
      message = "",
      meta = {},
    } = req.body || {};

    const k = String(kind || "").toLowerCase();
    if (k !== "assignment" && k !== "pyqs")
      return res.status(400).json({ error: "Invalid kind" });

    const qIdx = Number(questionIndex);
    if (!Number.isFinite(qIdx) || qIdx < 0)
      return res.status(400).json({ error: "Invalid questionIndex" });

    const r = String(reason || "").trim();
    if (!r) return res.status(400).json({ error: "Reason is required" });

    const msg = String(message || "").trim();
    if (!msg)
      return res.status(400).json({ error: "Report details are required" });

    // Validate identifiers by kind
    let aId = null,
      ex = null,
      su = null,
      ch = null;
    if (k === "assignment") {
      const n = Number(assignmentId);
      if (!Number.isFinite(n))
        return res.status(400).json({ error: "assignmentId required" });
      aId = n;
    } else {
      ex = String(examId || "").trim();
      su = String(subjectId || "").trim();
      ch = String(chapterId || "").trim();
      if (!ex || !su || !ch)
        return res
          .status(400)
          .json({ error: "examId, subjectId, chapterId are required" });
    }

    // Check if reports are blocked for this question
    const blocked = (() => {
      try {
        if (k === "assignment") {
          const r = db
            .prepare(
              "SELECT 1 FROM question_report_blocks WHERE kind = 'assignment' AND assignmentId = ? AND questionIndex = ?"
            )
            .get(aId, qIdx);
          return !!r;
        } else {
          const r = db
            .prepare(
              "SELECT 1 FROM question_report_blocks WHERE kind = 'pyqs' AND examId = ? AND subjectId = ? AND chapterId = ? AND questionIndex = ?"
            )
            .get(ex, su, ch, qIdx);
          return !!r;
        }
      } catch {
        return false;
      }
    })();
    if (blocked)
      return res
        .status(403)
        .json({ error: "Reports disabled for this question" });

    const id = nanoid();
    const metaJson = JSON.stringify(meta || {});
    db.prepare(
      `INSERT INTO question_reports (id, userId, kind, assignmentId, examId, subjectId, chapterId, questionIndex, reason, message, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.userId, k, aId, ex, su, ch, qIdx, r, msg, metaJson);

    // Optional forwarding to webhook (best-effort)
    (async () => {
      try {
        if (!REPORTS_WEBHOOK_URL) return;
        const payload = {
          id,
          userId: req.userId,
          kind: k,
          assignmentId: aId,
          examId: ex,
          subjectId: su,
          chapterId: ch,
          questionIndex: qIdx,
          reason: r,
          message: msg,
          meta: meta || {},
          created_at: new Date().toISOString(),
        };
        await fetch(REPORTS_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(() => {});
      } catch {}
    })();

    res.json({ success: true, id });
  } catch (e) {
    console.error("report create:", e);
    res.status(500).json({ error: "Failed to submit report" });
  }
});

// ---------- Notifications (per-user) ----------
// List notifications for current user (newest first)
app.get("/api/notifications", (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, title, body_md, meta, created_at, read_at
         FROM notifications WHERE userId = ?
         ORDER BY datetime(created_at) DESC, id DESC`
      )
      .all(req.userId);
    const out = rows.map((r) => ({
      id: r.id,
      title: r.title,
      body_md: r.body_md,
      meta: (() => {
        try { return r.meta ? JSON.parse(r.meta) : null; } catch { return null; }
      })(),
      created_at: r.created_at,
      read_at: r.read_at || null,
    }));
    res.json(out);
  } catch (e) {
    console.error("list notifications:", e);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

// Unread count for badge
app.get("/api/notifications/unread-count", (req, res) => {
  try {
    const row = db
      .prepare(
        "SELECT COUNT(1) AS c FROM notifications WHERE userId = ? AND read_at IS NULL"
      )
      .get(req.userId);
    res.json({ count: Number(row?.c || 0) });
  } catch (e) {
    res.status(500).json({ error: "Failed to count" });
  }
});

// Mark one notification read
app.patch("/api/notifications/:id/read", (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "id required" });
    const r = db
      .prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?")
      .run(id, req.userId);
    if (!r.changes) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to update" });
  }
});

// Mark all read
app.post("/api/notifications/mark-all-read", (req, res) => {
  try {
    db.prepare(
      "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE userId = ? AND read_at IS NULL"
    ).run(req.userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to update" });
  }
});

// Check if a question is currently blocked from receiving reports
app.get("/api/report/blocked", (req, res) => {
  try {
    const kind = String(req.query.kind || "").toLowerCase();
    const questionIndex = Number(req.query.questionIndex);
    if (!Number.isFinite(questionIndex))
      return res.status(400).json({ error: "Invalid questionIndex" });
    if (kind === "assignment") {
      const assignmentId = Number(req.query.assignmentId);
      if (!Number.isFinite(assignmentId))
        return res.status(400).json({ error: "assignmentId required" });
      const row = db
        .prepare(
          "SELECT 1 FROM question_report_blocks WHERE kind = 'assignment' AND assignmentId = ? AND questionIndex = ?"
        )
        .get(assignmentId, questionIndex);
      return res.json({ blocked: !!row });
    } else if (kind === "pyqs") {
      const ex = String(req.query.examId || "").trim();
      const su = String(req.query.subjectId || "").trim();
      const ch = String(req.query.chapterId || "").trim();
      if (!ex || !su || !ch)
        return res
          .status(400)
          .json({ error: "examId, subjectId, chapterId required" });
      const row = db
        .prepare(
          "SELECT 1 FROM question_report_blocks WHERE kind = 'pyqs' AND examId = ? AND subjectId = ? AND chapterId = ? AND questionIndex = ?"
        )
        .get(ex, su, ch, questionIndex);
      return res.json({ blocked: !!row });
    } else {
      return res.status(400).json({ error: "Invalid kind" });
    }
  } catch (e) {
    res.status(500).json({ error: "check failed" });
  }
});

// ---------- Admin APIs ----------
app.get("/api/admin/reports", adminOnly, (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT 
           qr.id, qr.userId, COALESCE(u.username, '') AS reporter,
           qr.kind, qr.assignmentId, qr.examId, qr.subjectId, qr.chapterId, qr.questionIndex,
           qr.reason, qr.message, qr.status, qr.meta, qr.admin_notes, qr.created_at
         FROM question_reports qr
         LEFT JOIN users u ON u.id = qr.userId
         ORDER BY qr.created_at DESC`
      )
      .all();
    const isBlocked = (r) => {
      try {
        if (r.kind === "assignment") {
          const x = db
            .prepare(
              "SELECT 1 FROM question_report_blocks WHERE kind = 'assignment' AND assignmentId = ? AND questionIndex = ?"
            )
            .get(r.assignmentId, r.questionIndex);
          return !!x;
        } else {
          const x = db
            .prepare(
              "SELECT 1 FROM question_report_blocks WHERE kind = 'pyqs' AND examId = ? AND subjectId = ? AND chapterId = ? AND questionIndex = ?"
            )
            .get(r.examId, r.subjectId, r.chapterId, r.questionIndex);
          return !!x;
        }
      } catch {
        return false;
      }
    };
    const out = rows.map((r) => ({
      ...r,
      username: r.reporter || "",
      blocked: isBlocked(r),
      meta: (() => {
        try {
          return r.meta ? JSON.parse(r.meta) : {};
        } catch {
          return {};
        }
      })(),
      notes: r.admin_notes || "",
    }));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "Failed to list reports" });
  }
});

app.patch("/api/admin/reports/:id", adminOnly, (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const status =
      req.body?.status != null ? String(req.body.status).toLowerCase() : null;
    const notes = req.body?.notes != null ? String(req.body.notes) : null;
    if (!id) return res.status(400).json({ error: "id required" });
    if (status != null && !["open", "wip", "closed"].includes(status))
      return res.status(400).json({ error: "invalid status" });
    let setParts = [];
    const args = [];
    if (status != null) {
      setParts.push("status = ?");
      args.push(status);
    }
    if (notes != null) {
      setParts.push("admin_notes = ?");
      args.push(notes);
    }
    if (!setParts.length) return res.status(400).json({ error: "no changes" });
    args.push(id);
    const sql = `UPDATE question_reports SET ${setParts.join(
      ", "
    )} WHERE id = ?`;
    const r = db.prepare(sql).run(...args);
    if (r.changes === 0) return res.status(404).json({ error: "not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to update status" });
  }
});

// List users (for targeting notifications)
app.get("/api/admin/users", adminOnly, (req, res) => {
  try {
    const rows = db
      .prepare("SELECT id, username FROM users ORDER BY username COLLATE NOCASE ASC")
      .all();
    res.json(rows.map((u) => ({ id: u.id, username: u.username })));
  } catch (e) {
    res.status(500).json({ error: "Failed to list users" });
  }
});

// Send notifications (to list of users or broadcast)
// Body: { title, body, userIds?: string[], all?: boolean, meta?: object }
app.post("/api/admin/notifications", adminOnly, (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || req.body?.body_md || "").trim();
    const meta = req.body?.meta || null;
    const all = !!req.body?.all;
    let userIds = Array.isArray(req.body?.userIds)
      ? req.body.userIds.map((x) => String(x)).filter(Boolean)
      : [];
    if (!title) return res.status(400).json({ error: "title required" });
    if (!body) return res.status(400).json({ error: "body required" });

    if (all) {
      const rows = db.prepare("SELECT id FROM users").all();
      userIds = rows.map((r) => r.id);
    }
    // De-duplicate
    userIds = Array.from(new Set(userIds));
    if (!userIds.length)
      return res.status(400).json({ error: "no recipients" });

    const metaJson = meta ? JSON.stringify(meta) : null;
    const insert = db.prepare(
      "INSERT INTO notifications (id, userId, title, body_md, meta) VALUES (?, ?, ?, ?, ?)"
    );
    const tx = db.transaction((list) => {
      for (const uid of list) {
        insert.run(nanoid(), uid, title, body, metaJson);
      }
    });
    tx(userIds);
    res.json({ success: true, count: userIds.length });
  } catch (e) {
    console.error("admin send notifications:", e);
    res.status(500).json({ error: "Failed to send notifications" });
  }
});

app.post("/api/admin/blocks", adminOnly, (req, res) => {
  try {
    const { kind, assignmentId, examId, subjectId, chapterId, questionIndex } =
      req.body || {};
    const k = String(kind || "").toLowerCase();
    const qIdx = Number(questionIndex);
    if (!Number.isFinite(qIdx))
      return res.status(400).json({ error: "Invalid questionIndex" });
    if (k === "assignment") {
      const aId = Number(assignmentId);
      if (!Number.isFinite(aId))
        return res.status(400).json({ error: "assignmentId required" });
      db.prepare(
        "INSERT OR IGNORE INTO question_report_blocks (kind, assignmentId, examId, subjectId, chapterId, questionIndex) VALUES ('assignment', ?, NULL, NULL, NULL, ?)"
      ).run(aId, qIdx);
      return res.json({ success: true });
    } else if (k === "pyqs") {
      const ex = String(examId || "").trim();
      const su = String(subjectId || "").trim();
      const ch = String(chapterId || "").trim();
      if (!ex || !su || !ch)
        return res
          .status(400)
          .json({ error: "examId, subjectId, chapterId required" });
      db.prepare(
        "INSERT OR IGNORE INTO question_report_blocks (kind, assignmentId, examId, subjectId, chapterId, questionIndex) VALUES ('pyqs', NULL, ?, ?, ?, ?)"
      ).run(ex, su, ch, qIdx);
      return res.json({ success: true });
    }
    return res.status(400).json({ error: "Invalid kind" });
  } catch (e) {
    res.status(500).json({ error: "Failed to block" });
  }
});

app.delete("/api/admin/blocks", adminOnly, (req, res) => {
  try {
    const { kind, assignmentId, examId, subjectId, chapterId, questionIndex } =
      req.body || {};
    const k = String(kind || "").toLowerCase();
    const qIdx = Number(questionIndex);
    if (!Number.isFinite(qIdx))
      return res.status(400).json({ error: "Invalid questionIndex" });
    if (k === "assignment") {
      const aId = Number(assignmentId);
      if (!Number.isFinite(aId))
        return res.status(400).json({ error: "assignmentId required" });
      db.prepare(
        "DELETE FROM question_report_blocks WHERE kind = 'assignment' AND assignmentId = ? AND questionIndex = ?"
      ).run(aId, qIdx);
      return res.json({ success: true });
    } else if (k === "pyqs") {
      const ex = String(examId || "").trim();
      const su = String(subjectId || "").trim();
      const ch = String(chapterId || "").trim();
      if (!ex || !su || !ch)
        return res
          .status(400)
          .json({ error: "examId, subjectId, chapterId required" });
      db.prepare(
        "DELETE FROM question_report_blocks WHERE kind = 'pyqs' AND examId = ? AND subjectId = ? AND chapterId = ? AND questionIndex = ?"
      ).run(ex, su, ch, qIdx);
      return res.json({ success: true });
    }
    return res.status(400).json({ error: "Invalid kind" });
  } catch (e) {
    res.status(500).json({ error: "Failed to unblock" });
  }
});

// Bookmark tags
app.get("/api/bookmark-tags", (req, res) => {
  try {
    const tags = db
      .prepare(
        `
      SELECT id, name, created_at
      FROM bookmark_tags
      WHERE userId = ?
      ORDER BY name = 'Doubt' DESC, name ASC
    `
      )
      .all(req.userId);
    res.json(tags);
  } catch (e) {
    console.error("get tags:", e);
    res.status(500).json({ error: "Failed to get bookmark tags" });
  }
});

app.post("/api/bookmark-tags", (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim())
      return res.status(400).json({ error: "Tag name is required" });
    const tagId = nanoid();
    db.prepare(
      "INSERT INTO bookmark_tags (id, userId, name) VALUES (?, ?, ?)"
    ).run(tagId, req.userId, name.trim());
    const newTag = db
      .prepare("SELECT id, name, created_at FROM bookmark_tags WHERE id = ?")
      .get(tagId);
    res.json(newTag);
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE")
      return res.status(400).json({ error: "Tag name already exists" });
    console.error("create tag:", e);
    res.status(500).json({ error: "Failed to create bookmark tag" });
  }
});

app.delete("/api/bookmark-tags/:tagId", (req, res) => {
  try {
    const { tagId } = req.params;
    if (!tagId) return res.status(400).json({ error: "tagId is required" });
    // Ensure tag belongs to the user
    const tag = db
      .prepare("SELECT id FROM bookmark_tags WHERE id = ? AND userId = ?")
      .get(tagId, req.userId);
    if (!tag) return res.status(404).json({ error: "Tag not found" });
    // Delete tag (bookmarks referencing it will cascade-delete)
    db.prepare("DELETE FROM bookmark_tags WHERE id = ? AND userId = ?").run(
      tagId,
      req.userId
    );
    res.json({ success: true });
  } catch (e) {
    console.error("delete tag:", e);
    res.status(500).json({ error: "Failed to delete bookmark tag" });
  }
});

// Bookmarks
app.post("/api/bookmarks", (req, res) => {
  try {
    const { assignmentId, questionIndex, tagId } = req.body || {};
    if (!assignmentId || questionIndex === undefined || !tagId) {
      return res
        .status(400)
        .json({ error: "assignmentId, questionIndex, and tagId are required" });
    }
    const id = nanoid();
    db.prepare(
      `
      INSERT INTO bookmarks (id, userId, assignmentId, questionIndex, tagId)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(id, req.userId, assignmentId, questionIndex, tagId);
    res.json({ success: true, id });
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE")
      return res
        .status(400)
        .json({ error: "Question already bookmarked with this tag" });
    console.error("add bookmark:", e);
    res.status(500).json({ error: "Failed to add bookmark" });
  }
});

// ---- PYQs Filters bulk save ----
app.post("/api/pyqs/prefs/bulk", (req, res) => {
  try {
    const { examId, subjectId, chapters } = req.body || {};
    if (!examId || !subjectId || !chapters || typeof chapters !== "object") {
      return res
        .status(400)
        .json({ error: "examId, subjectId and chapters map are required" });
    }
    const stmt = db.prepare(`
      INSERT INTO pyqs_prefs (userId, examId, subjectId, chapterId, prefs)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(userId, examId, subjectId, chapterId)
      DO UPDATE SET prefs = excluded.prefs, updated_at = CURRENT_TIMESTAMP
    `);
    const tx = db.transaction((entries) => {
      for (const [chapterId, prefs] of entries) {
        const text = JSON.stringify(
          prefs && typeof prefs === "object" ? prefs : {}
        );
        stmt.run(
          req.userId,
          String(examId),
          String(subjectId),
          String(chapterId),
          text
        );
      }
    });
    tx(Object.entries(chapters));
    res.json({ success: true });
  } catch (e) {
    console.error("prefs bulk:", e);
    res.status(500).json({ error: "Failed to save prefs (bulk)" });
  }
});

// ---- PYQs State bulk upsert ----
app.post("/api/pyqs/state/bulk", (req, res) => {
  try {
    const { examId, subjectId, items } = req.body || {};
    if (!examId || !subjectId || !Array.isArray(items))
      return res
        .status(400)
        .json({ error: "examId, subjectId, items[] are required" });
    const stmt = db.prepare(`
      INSERT INTO pyqs_states (userId, examId, subjectId, chapterId, state)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(userId, examId, subjectId, chapterId)
      DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP
    `);
    const tx = db.transaction((arr) => {
      for (const it of arr) {
        const text = JSON.stringify(Array.isArray(it?.state) ? it.state : []);
        stmt.run(
          req.userId,
          String(examId),
          String(subjectId),
          String(it.chapterId),
          text
        );
      }
    });
    tx(items);
    res.json({ success: true });
  } catch (e) {
    console.error("state bulk:", e);
    res.status(500).json({ error: "Failed to save state (bulk)" });
  }
});

// ---- PYQs Overlays (bookmarks + marks + tags) ----
app.get("/api/pyqs/overlays/:examId/:subjectId", (req, res) => {
  try {
    const { examId, subjectId } = req.params;
    const bookmarks = db
      .prepare(
        `
      SELECT chapterId, questionIndex, tagId FROM pyqs_bookmarks
      WHERE userId = ? AND examId = ? AND subjectId = ?
    `
      )
      .all(req.userId, String(examId), String(subjectId));
    const marks = db
      .prepare(
        `
      SELECT chapterId, questionIndex, color FROM pyqs_question_marks
      WHERE userId = ? AND examId = ? AND subjectId = ?
    `
      )
      .all(req.userId, String(examId), String(subjectId));
    const tags = db
      .prepare(
        `SELECT id, name, created_at FROM bookmark_tags WHERE userId = ? ORDER BY name = 'Doubt' DESC, name ASC`
      )
      .all(req.userId);
    res.json({ bookmarks, marks, tags });
  } catch (e) {
    console.error("overlays get:", e);
    res.status(500).json({ error: "Failed to load overlays" });
  }
});

app.post("/api/pyqs/overlays/bulk", (req, res) => {
  try {
    const {
      examId,
      subjectId,
      addBookmarks = [],
      removeBookmarks = [],
      setMarks = [],
      removeMarks = [],
    } = req.body || {};
    if (!examId || !subjectId)
      return res.status(400).json({ error: "examId and subjectId required" });
    const addBm = db.prepare(
      `INSERT OR IGNORE INTO pyqs_bookmarks (userId, examId, subjectId, chapterId, questionIndex, tagId) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const delBm = db.prepare(
      `DELETE FROM pyqs_bookmarks WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ? AND questionIndex = ? AND tagId = ?`
    );
    const setMk =
      db.prepare(`INSERT INTO pyqs_question_marks (userId, examId, subjectId, chapterId, questionIndex, color) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId, examId, subjectId, chapterId, questionIndex)
      DO UPDATE SET color = excluded.color, updated_at = CURRENT_TIMESTAMP`);
    const delMk = db.prepare(
      `DELETE FROM pyqs_question_marks WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ? AND questionIndex = ?`
    );
    const tx = db.transaction(() => {
      for (const b of addBookmarks)
        addBm.run(
          req.userId,
          String(examId),
          String(subjectId),
          String(b.chapterId),
          Number(b.questionIndex),
          String(b.tagId)
        );
      for (const b of removeBookmarks)
        delBm.run(
          req.userId,
          String(examId),
          String(subjectId),
          String(b.chapterId),
          Number(b.questionIndex),
          String(b.tagId)
        );
      for (const m of setMarks)
        setMk.run(
          req.userId,
          String(examId),
          String(subjectId),
          String(m.chapterId),
          Number(m.questionIndex),
          String(m.color || "")
        );
      for (const m of removeMarks)
        delMk.run(
          req.userId,
          String(examId),
          String(subjectId),
          String(m.chapterId),
          Number(m.questionIndex)
        );
    });
    tx();
    res.json({ success: true });
  } catch (e) {
    console.error("overlays bulk:", e);
    res.status(500).json({ error: "Failed to update overlays" });
  }
});

// ---- PYQs Starred unified ----
app.get("/api/pyqs/starred", (req, res) => {
  try {
    const ex = db
      .prepare(
        "SELECT examId FROM starred_pyqs WHERE userId = ? AND kind = 'exam'"
      )
      .all(req.userId)
      .map((r) => r.examId);
    const ch = db
      .prepare(
        "SELECT examId, subjectId, chapterId FROM starred_pyqs WHERE userId = ? AND kind = 'chapter'"
      )
      .all(req.userId);
    res.json({ exams: ex, chapters: ch });
  } catch (e) {
    res.status(500).json({ error: "Failed to load starred" });
  }
});

app.post("/api/pyqs/starred/bulk", (req, res) => {
  try {
    const {
      examsAdd = [],
      examsRemove = [],
      chaptersAdd = [],
      chaptersRemove = [],
    } = req.body || {};
    const add = db.prepare(
      `INSERT OR IGNORE INTO starred_pyqs (userId, kind, examId, subjectId, chapterId) VALUES (?, ?, ?, ?, ?)`
    );
    const del = db.prepare(
      `DELETE FROM starred_pyqs WHERE userId = ? AND kind = ? AND examId = ? AND subjectId IS ? AND chapterId IS ?`
    );
    const delChapter = db.prepare(
      `DELETE FROM starred_pyqs WHERE userId = ? AND kind = 'chapter' AND examId = ? AND subjectId = ? AND chapterId = ?`
    );
    const tx = db.transaction(() => {
      for (const id of examsAdd)
        add.run(req.userId, "exam", String(id), null, null);
      for (const id of examsRemove)
        del.run(req.userId, "exam", String(id), null, null);
      for (const it of chaptersAdd)
        add.run(
          req.userId,
          "chapter",
          String(it.examId),
          String(it.subjectId),
          String(it.chapterId)
        );
      for (const it of chaptersRemove)
        delChapter.run(
          req.userId,
          String(it.examId),
          String(it.subjectId),
          String(it.chapterId)
        );
    });
    tx();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to update starred" });
  }
});

// PYQs Bookmarks
// Add bookmark for a PYQs question
app.post("/api/pyqs/bookmarks", (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
    const { examId, subjectId, chapterId, questionIndex, tagId } =
      req.body || {};
    if (
      !examId ||
      !subjectId ||
      !chapterId ||
      questionIndex === undefined ||
      questionIndex === null ||
      !tagId
    ) {
      return res.status(400).json({
        error:
          "examId, subjectId, chapterId, questionIndex, and tagId are required",
      });
    }
    const idx = Number(questionIndex);
    if (!Number.isFinite(idx) || idx < 0)
      return res.status(400).json({ error: "Invalid questionIndex" });
    // Insert; uniqueness enforced by PK
    try {
      db.prepare(
        `
        INSERT INTO pyqs_bookmarks (userId, examId, subjectId, chapterId, questionIndex, tagId)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        req.userId,
        String(examId),
        String(subjectId),
        String(chapterId),
        idx,
        String(tagId)
      );
    } catch (e) {
      if (e && e.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
        return res
          .status(400)
          .json({ error: "Question already bookmarked with this tag" });
      }
      throw e;
    }
    res.json({ success: true });
  } catch (e) {
    console.error("pyqs add bookmark:", e);
    res.status(500).json({ error: "Failed to add PYQs bookmark" });
  }
});

// Remove bookmark for a PYQs question
app.delete(
  "/api/pyqs/bookmarks/:examId/:subjectId/:chapterId/:questionIndex/:tagId",
  (req, res) => {
    try {
      if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
      const { examId, subjectId, chapterId, questionIndex, tagId } = req.params;
      db.prepare(
        `
        DELETE FROM pyqs_bookmarks
        WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?
              AND questionIndex = ? AND tagId = ?
      `
      ).run(
        req.userId,
        String(examId),
        String(subjectId),
        String(chapterId),
        Number(questionIndex),
        String(tagId)
      );
      res.json({ success: true });
    } catch (e) {
      console.error("pyqs remove bookmark:", e);
      res.status(500).json({ error: "Failed to remove PYQs bookmark" });
    }
  }
);

// List all PYQs bookmarks for the current user
app.get("/api/pyqs/bookmarks", (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
    const rows = db
      .prepare(
        `
        SELECT p.examId, p.subjectId, p.chapterId, p.questionIndex, p.created_at,
               bt.id AS tagId, bt.name AS tagName
        FROM pyqs_bookmarks p
        JOIN bookmark_tags bt ON p.tagId = bt.id
        WHERE p.userId = ?
        ORDER BY bt.name = 'Doubt' DESC, bt.name ASC, p.created_at DESC
      `
      )
      .all(req.userId);
    res.json(rows);
  } catch (e) {
    console.error("pyqs list bookmarks:", e);
    res.status(500).json({ error: "Failed to get PYQs bookmarks" });
  }
});

// List bookmarks for a specific PYQs question (for the button state UI)
app.get(
  "/api/pyqs/bookmarks/:examId/:subjectId/:chapterId/:questionIndex",
  (req, res) => {
    try {
      if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
      const { examId, subjectId, chapterId, questionIndex } = req.params;
      const rows = db
        .prepare(
          `
          SELECT p.tagId, bt.name AS tagName
          FROM pyqs_bookmarks p
          JOIN bookmark_tags bt ON p.tagId = bt.id
          WHERE p.userId = ? AND p.examId = ? AND p.subjectId = ? AND p.chapterId = ? AND p.questionIndex = ?
        `
        )
        .all(
          req.userId,
          String(examId),
          String(subjectId),
          String(chapterId),
          Number(questionIndex)
        );
      res.json(rows);
    } catch (e) {
      console.error("pyqs check bookmark:", e);
      res.status(500).json({ error: "Failed to check PYQs bookmarks" });
    }
  }
);

app.delete("/api/bookmarks/:assignmentId/:questionIndex/:tagId", (req, res) => {
  try {
    const { assignmentId, questionIndex, tagId } = req.params;
    db.prepare(
      `
      DELETE FROM bookmarks
      WHERE userId = ? AND assignmentId = ? AND questionIndex = ? AND tagId = ?
    `
    ).run(req.userId, assignmentId, questionIndex, tagId);
    res.json({ success: true });
  } catch (e) {
    console.error("remove bookmark:", e);
    res.status(500).json({ error: "Failed to remove bookmark" });
  }
});

app.get("/api/bookmarks", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT b.id, b.assignmentId, b.questionIndex, b.created_at,
             bt.id as tagId, bt.name as tagName
      FROM bookmarks b
      JOIN bookmark_tags bt ON b.tagId = bt.id
      WHERE b.userId = ?
      ORDER BY bt.name = 'Doubt' DESC, bt.name ASC, b.created_at DESC
    `
      )
      .all(req.userId);
    res.json(rows);
  } catch (e) {
    console.error("list bookmarks:", e);
    res.status(500).json({ error: "Failed to get bookmarks" });
  }
});

app.get("/api/bookmarks/:assignmentId/:questionIndex", (req, res) => {
  try {
    const { assignmentId, questionIndex } = req.params;
    const rows = db
      .prepare(
        `
      SELECT b.tagId, bt.name as tagName
      FROM bookmarks b
      JOIN bookmark_tags bt ON b.tagId = bt.id
      WHERE b.userId = ? AND b.assignmentId = ? AND b.questionIndex = ?
    `
      )
      .all(req.userId, assignmentId, questionIndex);
    res.json(rows);
  } catch (e) {
    console.error("check bookmark:", e);
    res.status(500).json({ error: "Failed to check bookmarks" });
  }
});

// Question color marks
app.get("/api/question-marks", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT assignmentId, questionIndex, color
      FROM question_marks
      WHERE userId = ?
      ORDER BY created_at DESC
    `
      )
      .all(req.userId);
    res.json(rows);
  } catch (e) {
    console.error("list question-marks:", e);
    res.status(500).json({ error: "Failed to get question marks" });
  }
});

app.get("/api/question-marks/:assignmentId/:questionIndex", (req, res) => {
  try {
    const { assignmentId, questionIndex } = req.params;
    const row = db
      .prepare(
        `
      SELECT color
      FROM question_marks
      WHERE userId = ? AND assignmentId = ? AND questionIndex = ?
    `
      )
      .get(req.userId, assignmentId, questionIndex);
    if (!row) return res.status(200).json({});
    res.json(row);
  } catch (e) {
    console.error("get question-mark:", e);
    res.status(500).json({ error: "Failed to get question mark" });
  }
});

app.post("/api/question-marks", (req, res) => {
  try {
    const { assignmentId, questionIndex, color } = req.body || {};
    if (
      assignmentId == null ||
      questionIndex == null ||
      !color ||
      typeof color !== "string"
    ) {
      return res
        .status(400)
        .json({ error: "assignmentId, questionIndex and color are required" });
    }
    // simple sanitize: trim and limit length
    const c = String(color).trim().slice(0, 32);
    // Upsert: try update first
    const upd = db
      .prepare(
        `
      UPDATE question_marks
      SET color = ?, updated_at = CURRENT_TIMESTAMP
      WHERE userId = ? AND assignmentId = ? AND questionIndex = ?
    `
      )
      .run(c, req.userId, assignmentId, questionIndex);
    if (upd.changes === 0) {
      db.prepare(
        `
        INSERT INTO question_marks (userId, assignmentId, questionIndex, color)
        VALUES (?, ?, ?, ?)
      `
      ).run(req.userId, assignmentId, questionIndex, c);
    }
    res.json({ success: true });
  } catch (e) {
    console.error("set question-mark:", e);
    res.status(500).json({ error: "Failed to set question mark" });
  }
});

app.delete("/api/question-marks/:assignmentId/:questionIndex", (req, res) => {
  try {
    const { assignmentId, questionIndex } = req.params;
    db.prepare(
      `
      DELETE FROM question_marks
      WHERE userId = ? AND assignmentId = ? AND questionIndex = ?
    `
    ).run(req.userId, assignmentId, questionIndex);
    res.json({ success: true });
  } catch (e) {
    console.error("delete question-mark:", e);
    res.status(500).json({ error: "Failed to delete question mark" });
  }
});

// PYQs: starred resources (protected)
app.get("/api/pyqs/starred/exams", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT examId FROM starred_pyqs
      WHERE userId = ? AND kind = 'exam' AND examId IS NOT NULL
      ORDER BY created_at DESC
    `
      )
      .all(req.userId);
    res.json(rows.map((r) => String(r.examId)));
  } catch (e) {
    console.error("pyqs starred exams list:", e);
    res.status(500).json({ error: "Failed to get starred exams" });
  }
});
app.post("/api/pyqs/starred/exams/:examId", (req, res) => {
  try {
    const { examId } = req.params;
    if (!examId) return res.status(400).json({ error: "examId required" });
    db.prepare(
      `
      INSERT INTO starred_pyqs (userId, kind, examId)
      VALUES (?, 'exam', ?)
      ON CONFLICT(userId, kind, examId, subjectId, chapterId) DO NOTHING
    `
    ).run(req.userId, String(examId));
    res.json({ success: true });
  } catch (e) {
    console.error("pyqs star exam:", e);
    res.status(500).json({ error: "Failed to star exam" });
  }
});
app.delete("/api/pyqs/starred/exams/:examId", (req, res) => {
  try {
    const { examId } = req.params;
    db.prepare(
      `
      DELETE FROM starred_pyqs WHERE userId = ? AND kind = 'exam' AND examId = ?
    `
    ).run(req.userId, String(examId));
    res.json({ success: true });
  } catch (e) {
    console.error("pyqs unstar exam:", e);
    res.status(500).json({ error: "Failed to unstar exam" });
  }
});

app.get("/api/pyqs/starred/chapters", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT examId, subjectId, chapterId
      FROM starred_pyqs
      WHERE userId = ? AND kind = 'chapter' AND examId IS NOT NULL AND subjectId IS NOT NULL AND chapterId IS NOT NULL
      ORDER BY created_at DESC
    `
      )
      .all(req.userId);
    res.json(
      rows.map((r) => ({
        examId: String(r.examId),
        subjectId: String(r.subjectId),
        chapterId: String(r.chapterId),
      }))
    );
  } catch (e) {
    console.error("pyqs starred chapters list:", e);
    res.status(500).json({ error: "Failed to get starred chapters" });
  }
});
app.post(
  "/api/pyqs/starred/chapters/:examId/:subjectId/:chapterId",
  (req, res) => {
    try {
      const { examId, subjectId, chapterId } = req.params;
      if (!examId || !subjectId || !chapterId)
        return res
          .status(400)
          .json({ error: "examId, subjectId, chapterId required" });
      db.prepare(
        `
      INSERT INTO starred_pyqs (userId, kind, examId, subjectId, chapterId)
      VALUES (?, 'chapter', ?, ?, ?)
      ON CONFLICT(userId, kind, examId, subjectId, chapterId) DO NOTHING
    `
      ).run(req.userId, String(examId), String(subjectId), String(chapterId));
      res.json({ success: true });
    } catch (e) {
      console.error("pyqs star chapter:", e);
      res.status(500).json({ error: "Failed to star chapter" });
    }
  }
);
app.delete(
  "/api/pyqs/starred/chapters/:examId/:subjectId/:chapterId",
  (req, res) => {
    try {
      const { examId, subjectId, chapterId } = req.params;
      db.prepare(
        `
      DELETE FROM starred_pyqs
      WHERE userId = ? AND kind = 'chapter' AND examId = ? AND subjectId = ? AND chapterId = ?
    `
      ).run(req.userId, String(examId), String(subjectId), String(chapterId));
      res.json({ success: true });
    } catch (e) {
      console.error("pyqs unstar chapter:", e);
      res.status(500).json({ error: "Failed to unstar chapter" });
    }
  }
);
// Starred assignments
app.get("/api/starred", (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT assignmentId FROM starred_assignments WHERE userId = ? ORDER BY created_at DESC`
      )
      .all(req.userId);
    res.json(rows.map((r) => Number(r.assignmentId)));
  } catch (e) {
    console.error("list starred:", e);
    res.status(500).json({ error: "Failed to get starred assignments" });
  }
});

app.post("/api/starred/:assignmentId", (req, res) => {
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isFinite(assignmentId)) {
      return res.status(400).json({ error: "Invalid assignmentId" });
    }
    db.prepare(
      `INSERT INTO starred_assignments (userId, assignmentId) VALUES (?, ?)
       ON CONFLICT(userId, assignmentId) DO NOTHING`
    ).run(req.userId, assignmentId);
    res.json({ success: true });
  } catch (e) {
    console.error("star assignment:", e);
    res.status(500).json({ error: "Failed to star assignment" });
  }
});

app.delete("/api/starred/:assignmentId", (req, res) => {
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isFinite(assignmentId)) {
      return res.status(400).json({ error: "Invalid assignmentId" });
    }
    db.prepare(
      `DELETE FROM starred_assignments WHERE userId = ? AND assignmentId = ?`
    ).run(req.userId, assignmentId);
    res.json({ success: true });
  } catch (e) {
    console.error("unstar assignment:", e);
    res.status(500).json({ error: "Failed to unstar assignment" });
  }
});

// State & scores
app.get("/api/state/:assignmentId", auth, (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const row = db
    .prepare("SELECT state FROM states WHERE userId = ? AND assignmentId = ?")
    .get(req.userId, assignmentId);
  const state = row ? JSON.parse(row.state) : [];
  res.json(Array.isArray(state) ? state : []);
});

app.post("/api/state/:assignmentId", auth, async (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const state = req.body?.state ?? [];

  const stateText = JSON.stringify(state);
  try {
    db.prepare(
      `
    INSERT INTO states (userId, assignmentId, state)
    VALUES (?, ?, ?)
    ON CONFLICT(userId, assignmentId) DO UPDATE SET state = excluded.state
  `
    ).run(req.userId, assignmentId, stateText);
  } catch (e) {
    if (e && e.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return res
        .status(401)
        .json({ error: "Invalid session. Please log in again." });
    }
    throw e;
  }

  try {
    const { score, maxScore } = await computeAssignmentScore(
      assignmentId,
      state
    );
    db.prepare(
      `
      INSERT INTO assignment_scores (userId, assignmentId, score, maxScore)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(userId, assignmentId) DO UPDATE SET score = excluded.score, maxScore = excluded.maxScore
    `
    ).run(req.userId, assignmentId, score, maxScore);
  } catch (e) {
    console.warn("Score computation failed:", e);
  }

  res.json({ success: true });
});

app.get("/api/scores", async (req, res) => {
  const scoreRows = db
    .prepare(
      "SELECT assignmentId, score, maxScore FROM assignment_scores WHERE userId = ?"
    )
    .all(req.userId);
  const stateRows = db
    .prepare("SELECT assignmentId, state FROM states WHERE userId = ?")
    .all(req.userId);

  const scoresMap = new Map();
  for (const r of scoreRows)
    scoresMap.set(r.assignmentId, { score: r.score, maxScore: r.maxScore });

  const result = {};
  const seen = new Set();

  for (const { assignmentId, state } of stateRows) {
    const parsed = safeParseJSON(state, []);
    const { attempted, totalQuestions } = await computeAttempted(
      assignmentId,
      parsed
    );
    const base = scoresMap.get(assignmentId) || {
      score: 0,
      maxScore: totalQuestions * 4,
    };
    result[assignmentId] = { ...base, attempted, totalQuestions };
    seen.add(assignmentId);
  }
  for (const [assignmentId, base] of scoresMap.entries()) {
    if (seen.has(assignmentId)) continue;
    const { attempted, totalQuestions } = await computeAttempted(
      assignmentId,
      []
    );
    result[assignmentId] = { ...base, attempted, totalQuestions };
  }
  res.json(result);
});

// Delete account (cascade via FKs)
app.delete("/account", (req, res) => {
  try {
    // 1) Remove all uploaded images owned by this user (filenames prefixed with `${userId}-`)
    try {
      const prefix = `${req.userId}-`;
      const files = fs.readdirSync(uploadsDir);
      for (const f of files) {
        try {
          if (typeof f === "string" && f.startsWith(prefix)) {
            const p = path.join(uploadsDir, f);
            if (fs.existsSync(p)) fs.unlinkSync(p);
          }
        } catch (e) {
          console.warn("Failed to delete user image", f, e?.message || e);
        }
      }
    } catch (e) {
      console.warn("Error while cleaning user images:", e?.message || e);
    }

    // 2) Delete the user (cascades DB rows via FKs)
    db.prepare("DELETE FROM users WHERE id = ?").run(req.userId);
    res.json({ success: true });
  } catch (e) {
    console.error("delete account:", e);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

// Change password
app.patch("/account/password", (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }
    const row = db
      .prepare(
        "SELECT id, password_hash, force_pw_reset FROM users WHERE id = ?"
      )
      .get(req.userId);
    if (!row) return res.status(400).json({ error: "User not found" });
    const isForced = !!row.force_pw_reset;
    if (!isForced) {
      // Normal change: require current password verification
      if (!row.password_hash)
        return res.status(400).json({ error: "No password set" });
      if (!verifyPassword(String(currentPassword || ""), row.password_hash)) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
    }
    const newHash = hashPassword(newPassword);
    db.prepare(
      "UPDATE users SET password_hash = ?, force_pw_reset = 0 WHERE id = ?"
    ).run(newHash, req.userId);
    res.json({ success: true, forced: isForced });
  } catch (e) {
    console.error("change password:", e);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// Configure/clear Marks App authentication token (GetMarks)
app.get("/account/marks-auth", auth, (req, res) => {
  try {
    const row = db
      .prepare("SELECT getmarks_token FROM users WHERE id = ?")
      .get(req.userId);
    const has = !!(row?.getmarks_token && String(row.getmarks_token).trim());
    res.json({ hasToken: has });
  } catch (e) {
    console.error("get marks-auth:", e);
    res.status(500).json({ error: "Failed to load marks auth" });
  }
});

app.patch("/account/marks-auth", auth, async (req, res) => {
  try {
    const token = String(req.body?.bearerToken || req.body?.token || "").trim();
    if (!token) return res.status(400).json({ error: "Token is required" });

    // Validate token against GetMarks API before saving
    try {
      await gmFetchWithToken(GM_BASE.dashboard, { limit: 1 }, token);
    } catch (e) {
      const code = e?.status || 401;
      return res.status(code).json({ error: "Invalid Marks token" });
    }

    db.prepare("UPDATE users SET getmarks_token = ? WHERE id = ?").run(
      token,
      req.userId
    );
    res.json({ success: true, validated: true });
  } catch (e) {
    console.error("set marks-auth:", e);
    res.status(500).json({ error: "Failed to save marks auth" });
  }
});

app.delete("/account/marks-auth", auth, (req, res) => {
  try {
    db.prepare("UPDATE users SET getmarks_token = NULL WHERE id = ?").run(
      req.userId
    );
    res.json({ success: true });
  } catch (e) {
    console.error("clear marks-auth:", e);
    res.status(500).json({ error: "Failed to clear marks auth" });
  }
});

// ---------- Scoring helpers ----------
function getAssignmentQuestionsList(assignment) {
  if (Array.isArray(assignment)) return assignment;
  if (assignment && Array.isArray(assignment.questions)) return assignment.questions;
  if (assignment && Array.isArray(assignment.data)) return assignment.data;
  return [];
}

async function generateTestQuestions(req, draft) {
  const blueprint = normalizeTestBlueprintForGeneration(draft.testBlueprint);
  const sourceSelections =
    draft.sourceSelections && typeof draft.sourceSelections === "object"
      ? draft.sourceSelections
      : {};
  const selected = Object.entries(sourceSelections)
    .filter(([, state]) => state?.selected && !state?.filters?.matchNone)
    .map(([sourceId, state]) => ({
      sourceId: String(sourceId),
      filters: state?.filters || {},
    }));
  if (!selected.length) {
    const err = new Error("Select at least one question source");
    err.status = 400;
    throw err;
  }

  const reuseFilter = buildBackendReuseFilter(
    req.userId,
    normalizeTestReusePolicy(draft.questionReusePolicy)
  );
  const subjects = new Map();
  for (const selection of selected) {
    const candidates = await loadTestSourceCandidates(req, selection, reuseFilter);
    for (const candidate of candidates) {
      const subjectKey = normalizeTestSubjectName(candidate.subjectName);
      if (!subjects.has(subjectKey)) {
        subjects.set(subjectKey, {
          key: subjectKey,
          name: candidate.subjectName || "Unknown Subject",
          candidates: [],
        });
      }
      subjects.get(subjectKey).candidates.push(candidate);
    }
  }

  const output = [];
  const byType = new Map();
  for (const subject of subjects.values()) {
    const typeMap = new Map();
    subject.candidates.forEach((candidate) => {
      if (!typeMap.has(candidate.questionType)) typeMap.set(candidate.questionType, []);
      typeMap.get(candidate.questionType).push(candidate);
    });
    byType.set(subject.key, typeMap);
  }

  for (const section of blueprint.sections) {
    for (const subject of subjects.values()) {
      const pool = byType.get(subject.key)?.get(section.type) || [];
      const picked = shuffleForTest(pool).slice(0, section.questionCount);
      picked.forEach((candidate) => {
        output.push({
          ...candidate,
          sectionId: section.id,
          sectionName: section.name,
          positiveMarks: section.positiveMarks,
          negativeMarks: section.negativeMarks,
        });
      });
    }
  }

  return {
    questions: output,
    summary: {
      subjects: Array.from(subjects.values()).map((subject) => ({
        key: subject.key,
        name: subject.name,
        totalCandidates: subject.candidates.length,
      })),
      generatedQuestions: output.length,
    },
  };
}

function normalizeTestBlueprintForGeneration(value) {
  const sections = Array.isArray(value?.sections) ? value.sections : [];
  return {
    sections: sections
      .map((section, index) => ({
        id: String(section?.id || `section_${index + 1}`),
        name: String(section?.name || `Section ${index + 1}`),
        type: normalizeGeneratedQuestionType(section?.type),
        questionCount: Math.max(0, Math.floor(Number(section?.questionCount) || 0)),
        positiveMarks: Number(section?.positiveMarks ?? 4) || 0,
        negativeMarks: Number(section?.negativeMarks ?? 0) || 0,
      }))
      .filter((section) => section.questionCount > 0 && section.type),
  };
}

async function loadTestSourceCandidates(req, selection, reuseFilter) {
  if (selection.sourceId.includes("::")) {
    return loadPyqTestCandidates(req, selection, reuseFilter);
  }
  return loadAssignmentTestCandidates(req, selection, reuseFilter);
}

async function loadAssignmentTestCandidates(req, selection, reuseFilter) {
  const assignmentId = Number(selection.sourceId);
  if (!Number.isFinite(assignmentId)) return [];
  const assignment = await loadAssignment(assignmentId);
  const questions = getAssignmentQuestionsList(assignment);
  const meta =
    db
      .prepare(
        `SELECT COALESCE(subject, '(No subject)') AS subject,
                COALESCE(title, 'Assignment ' || id) AS title
           FROM assignments WHERE id = ?`
      )
      .get(assignmentId) || {};
  const bookmarks = db
    .prepare(
      "SELECT questionIndex, tagId FROM bookmarks WHERE userId = ? AND assignmentId = ?"
    )
    .all(req.userId, assignmentId);
  const marks = db
    .prepare(
      "SELECT questionIndex, color FROM question_marks WHERE userId = ? AND assignmentId = ?"
    )
    .all(req.userId, assignmentId);

  return questions
    .map((question, index) =>
      buildTestCandidate({
        kind: "assignment",
        sourceId: String(assignmentId),
        subjectName: meta.subject || "Unknown Subject",
        sourceTitle: meta.title || `Assignment ${assignmentId}`,
        question,
        index,
        assignmentId,
      })
    )
    .filter(
      (candidate) =>
        candidate &&
        !reuseFilter.blockedKeys.has(candidate.questionKey) &&
        testCandidateMatchesFilters(candidate, selection.filters, {
          kind: "assignment",
          bookmarks,
          marks,
        })
    );
}

async function loadPyqTestCandidates(req, selection, reuseFilter) {
  const [examId, subjectId, chapterId] = selection.sourceId.split("::");
  if (!examId || !subjectId || !chapterId) return [];
  const questions = await loadPyqQuestionListForTest(req, examId, subjectId, chapterId);
  const subjectName = await getPyqSubjectNameForTest(req, examId, subjectId);
  const bookmarks = db
    .prepare(
      "SELECT questionIndex, tagId FROM pyqs_bookmarks WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?"
    )
    .all(req.userId, String(examId), String(subjectId), String(chapterId));
  const marks = db
    .prepare(
      "SELECT questionIndex, color FROM pyqs_question_marks WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?"
    )
    .all(req.userId, String(examId), String(subjectId), String(chapterId));
  const stateRow = db
    .prepare(
      "SELECT state FROM pyqs_states WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?"
    )
    .get(req.userId, String(examId), String(subjectId), String(chapterId));
  const state = stateRow ? safeParseJSON(stateRow.state, []) : [];

  return questions
    .map((question, index) =>
      buildTestCandidate({
        kind: "pyq",
        sourceId: selection.sourceId,
        subjectName,
        sourceTitle: `PYQ ${chapterId}`,
        question,
        index,
        examId,
        subjectId,
        chapterId,
      })
    )
    .filter(
      (candidate) =>
        candidate &&
        !reuseFilter.blockedKeys.has(candidate.questionKey) &&
        testCandidateMatchesFilters(candidate, selection.filters, {
          kind: "pyq",
          bookmarks,
          marks,
          state,
        })
    );
}

async function loadPyqQuestionListForTest(req, examId, subjectId, chapterId) {
  if (USE_LOCAL_PYQS) {
    const rows = pyqsDb
      .prepare(
        "SELECT data_json FROM questions WHERE examId = ? AND subjectId = ? AND chapterId = ? ORDER BY idx ASC"
      )
      .all(String(examId), String(subjectId), String(chapterId));
    return rows.map((r) => absolutizeQuestion(safeParseJSON(r.data_json, {}), req));
  }
  const data = await gmFetch(req, GM_BASE.questions(examId, subjectId, chapterId), {
    limit: 10000,
    hideOutOfSyllabus: "false",
  });
  return (data?.data?.questions || []).map((q) => ({
    type: q?.type,
    diffuculty: q?.level,
    pyqInfo:
      (Array.isArray(q?.previousYearPapers) && q.previousYearPapers[0]?.title) ||
      "",
    qText: replaceMathMLWithLatex(q?.question?.text || ""),
    qImage: q?.question?.image || "",
    options: (Array.isArray(q?.options) ? q.options : []).map((o) => ({
      oText: replaceMathMLWithLatex(o?.text || ""),
      oImage: o?.image || "",
    })),
    correctAnswer:
      q?.type === "numerical"
        ? q?.correctValue
        : (Array.isArray(q?.options) ? q.options : []).reduce((acc, o, i) => {
            if (o?.isCorrect) acc.push(["A", "B", "C", "D"][i] || String(i + 1));
            return acc;
          }, []),
    solution: {
      sText: replaceMathMLWithLatex(q?.solution?.text || ""),
      sImage: q?.solution?.image || "",
    },
  }));
}

async function getPyqSubjectNameForTest(req, examId, subjectId) {
  if (USE_LOCAL_PYQS) {
    const row = pyqsDb
      .prepare("SELECT name FROM subjects WHERE examId = ? AND id = ?")
      .get(String(examId), String(subjectId));
    if (row?.name) return String(row.name);
  }
  try {
    const data = await gmFetch(req, GM_BASE.exam_subjects(examId), { limit: 10000 });
    const subjects = data?.data?.subjects?.data || data?.data?.subjects || [];
    const found = subjects.find(
      (subject) => String(subject?._id || subject?.id) === String(subjectId)
    );
    return String(found?.title || found?.name || subjectId);
  } catch {
    return String(subjectId);
  }
}

function assignmentSyncOnly(req, res, next) {
  if (!ASSIGNMENT_SYNC_SECRET) {
    return res.status(503).json({ error: "Assignment sync is not configured" });
  }
  const headerSecret = req.get("x-assignment-sync-secret");
  const authHeader = req.headers.authorization || "";
  const bearerSecret = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const providedSecret = headerSecret || bearerSecret;
  if (!providedSecret || !secretsMatch(providedSecret, ASSIGNMENT_SYNC_SECRET)) {
    return res.status(401).json({ error: "Invalid assignment sync secret" });
  }
  return next();
}

function buildTestCandidate({
  kind,
  sourceId,
  subjectName,
  sourceTitle,
  question,
  index,
  assignmentId = null,
  examId = null,
  subjectId = null,
  chapterId = null,
}) {
  const questionType = normalizeGeneratedQuestionType(question?.qType || question?.type);
  if (!questionType) return null;
  const questionKey = buildGeneratedQuestionKey({
    kind,
    sourceId,
    question,
    index,
  });
  return {
    kind,
    sourceId,
    subjectKey: normalizeTestSubjectName(subjectName),
    subjectName,
    sourceTitle,
    assignmentId,
    examId: examId == null ? null : String(examId),
    subjectId: subjectId == null ? null : String(subjectId),
    chapterId: chapterId == null ? null : String(chapterId),
    questionIndex: index,
    questionKey,
    questionType,
    positiveMarks: 0,
    negativeMarks: 0,
    payload: question,
  };
}

function buildGeneratedQuestionKey({ kind, sourceId, question, index }) {
  const explicit =
    question?.questionKey ||
    question?.key ||
    question?.sourceQuestionKey ||
    question?.generatedQuestionKey;
  if (explicit) return String(explicit);
  const questionId = question?.questionId ?? question?.qid ?? question?.id ?? question?._id;
  if (questionId != null) return `${kind}:${sourceId}:${questionId}`;
  return `${kind}:${sourceId}:${index}`;
}

function testCandidateMatchesFilters(candidate, filters, context) {
  if (!filters || filters.matchNone) return !filters?.matchNone;
  const bookmarkTags = new Set((filters.bookmarkTagIds || []).map(String));
  const bookmarksByIndex = groupTestBookmarksByQuestionIndex(context.bookmarks || []);
  if (bookmarkTags.size) {
    const tags = bookmarksByIndex.get(candidate.questionIndex) || new Set();
    if (!Array.from(bookmarkTags).some((tagId) => tags.has(tagId))) return false;
  }
  const colors = new Set((filters.colors || []).map((c) => String(c).toLowerCase()));
  if (colors.size) {
    const mark = (context.marks || []).find(
      (row) => Number(row.questionIndex) === candidate.questionIndex
    );
    const color = String(mark?.color || "none").toLowerCase();
    if (!colors.has(color)) return false;
  }
  if (context.kind === "assignment") {
    return true;
  }

  const question = candidate.payload || {};
  const qSearchTerms = String(filters.q || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (
    qSearchTerms.length &&
    !qSearchTerms.every((term) =>
      String(question.qText || "").toLowerCase().includes(term)
    )
  ) {
    return false;
  }
  const years = new Set((filters.years || []).map(Number));
  if (years.size) {
    const m = String(question.pyqInfo || "").match(/(19|20)\d{2}/);
    const year = m ? Number(m[0]) : null;
    if (!years.has(year)) return false;
  }
  const diffs = new Set((filters.diff || []).map(String));
  if (diffs.size && !diffs.has(normalizeTestDiff(question.diffuculty))) {
    return false;
  }
  const statuses = new Set((filters.status || []).map(String));
  if (statuses.size) {
    const status = getTestPyqStatus(context.state?.[candidate.questionIndex]);
    const completed =
      status === "correct" || status === "partial" || status === "incorrect";
    if (!statuses.has(status) && !(statuses.has("completed") && completed)) {
      return false;
    }
  }
  return true;
}

function buildBackendReuseFilter(userId, policy) {
  const selectedIds = new Set((policy.testIds || []).map(String));
  const rows = db
    .prepare(
      `SELECT tq.testId, tq.question_key
         FROM test_questions tq
         JOIN tests t ON t.id = tq.testId
        WHERE t.userId = ?`
    )
    .all(userId);
  const allKeys = new Set();
  const selectedKeys = new Set();
  rows.forEach((row) => {
    allKeys.add(String(row.question_key));
    if (selectedIds.has(String(row.testId))) selectedKeys.add(String(row.question_key));
  });
  if (policy.mode === "whitelist") {
    return {
      blockedKeys: new Set(
        Array.from(allKeys).filter((key) => !selectedKeys.has(key))
      ),
    };
  }
  return { blockedKeys: selectedKeys };
}

function normalizeTestReusePolicy(value) {
  const mode = value?.mode === "whitelist" ? "whitelist" : "blacklist";
  const testIds = Array.isArray(value?.testIds)
    ? value.testIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  return { mode, testIds };
}

function insertGeneratedTestQuestion(testId, question, index) {
  const columns = [];
  const values = [];
  const addValue = (column, value) => {
    if (!TEST_QUESTIONS_COLUMNS.has(column)) return;
    columns.push(column);
    values.push(value);
  };
  const isPyq = question.kind === "pyq";
  const sourceParts = String(question.sourceId || "").split("::");
  const examId = String(question.examId ?? (isPyq ? sourceParts[0] : "assignment"));
  const subjectId = String(question.subjectId ?? (isPyq ? sourceParts[1] : question.subjectKey || "assignment"));
  const chapterId = String(question.chapterId ?? (isPyq ? sourceParts[2] : question.assignmentId ?? question.sourceId ?? ""));
  if (TEST_QUESTIONS_USE_TEXT_IDS) addValue("id", nanoid());
  addValue("test_id", testId);
  addValue("testId", testId);
  addValue("order_index", index);
  addValue("section_id", question.sectionId);
  addValue("section_name", question.sectionName);
  addValue("question_type", question.questionType);
  addValue("q_type", question.questionType);
  addValue("subject_key", question.subjectKey);
  addValue("subject_name", question.subjectName);
  addValue("kind", question.kind);
  addValue("source_id", question.sourceId);
  addValue("assignmentId", question.assignmentId);
  addValue("exam_id", examId);
  addValue("examId", question.examId);
  addValue("subject_id", subjectId);
  addValue("subjectId", question.subjectId);
  addValue("chapter_id", chapterId);
  addValue("chapterId", question.chapterId);
  addValue("question_index", question.questionIndex);
  addValue("questionIndex", question.questionIndex);
  addValue("question_key", question.questionKey);
  addValue("positive_marks", question.positiveMarks);
  addValue("negative_marks", question.negativeMarks);
  addValue("payload_json", JSON.stringify(question.payload || {}));
  addValue("tags_json", "[]");
  const placeholders = columns.map(() => "?").join(", ");
  db.prepare(
    `INSERT INTO test_questions (${columns.join(", ")}) VALUES (${placeholders})`
  ).run(...values);
}

function normalizeGeneratedQuestionType(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("passage")) return "";
  if (raw.includes("num")) return "numerical";
  if (raw.includes("multi") || raw.includes("mmcq")) return "multiple";
  if (raw.includes("single") || raw.includes("smcq") || raw.includes("mcq")) {
    return "single";
  }
  return "single";
}

function normalizeTestSubjectName(value) {
  return String(value || "Unknown Subject")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function groupTestBookmarksByQuestionIndex(bookmarks) {
  const grouped = new Map();
  (bookmarks || []).forEach((bookmark) => {
    const index = Number(bookmark.questionIndex);
    if (!grouped.has(index)) grouped.set(index, new Set());
    grouped.get(index).add(String(bookmark.tagId));
  });
  return grouped;
}

function normalizeTestDiff(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "1" || raw.includes("easy")) return "easy";
  if (raw === "2" || raw.includes("moderate") || raw.includes("medium")) {
    return "medium";
  }
  if (raw === "3" || raw.includes("hard")) return "hard";
  return raw;
}

function getTestPyqStatus(questionState) {
  if (!questionState || typeof questionState !== "object") return "not-started";
  const hasAnswer =
    questionState.pickedAnswer ||
    (Array.isArray(questionState.pickedAnswers) && questionState.pickedAnswers.length) ||
    questionState.pickedNumerical !== undefined;
  if (!questionState.evaluated) return hasAnswer ? "in-progress" : "not-started";
  if (questionState.correct) return "correct";
  if (questionState.partial) return "partial";
  return "incorrect";
}

function shuffleForTest(items) {
  const arr = Array.isArray(items) ? items.slice() : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeTestId(value) {
  return String(value ?? "").trim();
}

function getTestQuestionRows(testId) {
  const hasSnakeTestId = TEST_QUESTIONS_COLUMNS.has("test_id");
  const hasCamelTestId = TEST_QUESTIONS_COLUMNS.has("testId");
  const where = hasSnakeTestId && hasCamelTestId
    ? "WHERE testId = ? OR test_id = ?"
    : hasSnakeTestId
    ? "WHERE test_id = ?"
    : "WHERE testId = ?";
  const args = hasSnakeTestId && hasCamelTestId ? [testId, testId] : [testId];
  return db
    .prepare(
      `SELECT
         order_index AS orderIndex,
         section_id AS sectionId,
         section_name AS sectionName,
         question_type AS questionType,
         subject_key AS subjectKey,
         subject_name AS subjectName,
         kind,
         source_id AS sourceId,
         assignmentId,
         exam_id AS exam_id,
         examId,
         subject_id AS subject_id,
         subjectId,
         chapter_id AS chapter_id,
         chapterId,
         question_index AS question_index,
         questionIndex,
         question_key AS questionKey,
         positive_marks AS positiveMarks,
         negative_marks AS negativeMarks,
         payload_json
       FROM test_questions
       ${where}
       ORDER BY order_index ASC`
    )
    .all(...args)
    .map((row, index) => {
      const payload = safeParseJSON(row.payload_json, {});
      const examId = row.examId ?? row.exam_id ?? null;
      const subjectId = row.subjectId ?? row.subject_id ?? null;
      const chapterId = row.chapterId ?? row.chapter_id ?? null;
      const questionIndex = Number(row.questionIndex ?? row.question_index ?? index);
      return {
        ...row,
        orderIndex: Number(row.orderIndex ?? index),
        examId: examId == null ? null : String(examId),
        subjectId: subjectId == null ? null : String(subjectId),
        chapterId: chapterId == null ? null : String(chapterId),
        questionIndex,
        payload,
        payload_json: undefined,
      };
    });
}

function getAssignmentQuestionList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.questions)) return payload.questions;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function resolveLiveTestQuestionPayload(req, row, caches) {
  const fallback =
    row && row.payload && typeof row.payload === "object" ? row.payload : {};
  const kind = String(row?.kind || "").toLowerCase();
  const questionIndex = Number(row?.questionIndex ?? row?.question_index ?? -1);
  if (!Number.isFinite(questionIndex) || questionIndex < 0) return fallback;
  try {
    if (kind === "assignment") {
      const assignmentId = Number(row?.assignmentId ?? row?.sourceId);
      if (!Number.isFinite(assignmentId) || assignmentId <= 0) return fallback;
      if (!caches.assignments.has(assignmentId)) {
        caches.assignments.set(assignmentId, loadAssignment(assignmentId));
      }
      const assignment = await caches.assignments.get(assignmentId);
      const question = getAssignmentQuestionList(assignment)?.[questionIndex];
      return question && typeof question === "object" ? question : fallback;
    }
    if (kind === "pyq") {
      const examId = String(row?.examId ?? row?.exam_id ?? "").trim();
      const subjectId = String(row?.subjectId ?? row?.subject_id ?? "").trim();
      const chapterId = String(row?.chapterId ?? row?.chapter_id ?? "").trim();
      if (!examId || !subjectId || !chapterId) return fallback;
      const cacheKey = `${examId}::${subjectId}::${chapterId}`;
      if (!caches.pyqs.has(cacheKey)) {
        caches.pyqs.set(cacheKey, loadPyqQuestionListForTest(req, examId, subjectId, chapterId));
      }
      const questions = await caches.pyqs.get(cacheKey);
      const question = Array.isArray(questions) ? questions[questionIndex] : null;
      return question && typeof question === "object" ? question : fallback;
    }
  } catch {}
  return fallback;
}

async function syncTestQuestionRows(req, rows) {
  const caches = { assignments: new Map(), pyqs: new Map() };
  return Promise.all(
    (Array.isArray(rows) ? rows : []).map(async (row, index) => ({
      ...row,
      orderIndex: Number(row?.orderIndex ?? index),
      questionIndex: Number(row?.questionIndex ?? row?.question_index ?? index),
      payload: await resolveLiveTestQuestionPayload(req, row, caches),
    }))
  );
}

async function getResolvedTestQuestions(req, testId, attemptRow = null) {
  const storedRows = getTestQuestionRows(testId);
  const snapshotRows = safeParseJSON(attemptRow?.questions_json, []);
  const sourceRows = Array.isArray(storedRows) && storedRows.length ? storedRows : snapshotRows;
  return syncTestQuestionRows(req, sourceRows);
}

async function createTestAttempt(req, userId, testId) {
  const test = db
    .prepare("SELECT time_limit_sec, config_json FROM tests WHERE id = ?")
    .get(testId);
  const questions = await getResolvedTestQuestions(req, testId);
  const timeLimitSec = Number(test?.time_limit_sec || 0) || Number(safeParseJSON(test?.config_json, {})?.testBlueprint?.timeLimitSeconds || 0) || null;
  const state = questions.map(() => defaultTestAttemptState());
  const meta = {
    state,
    elapsedSeconds: 0,
    remainingSeconds: timeLimitSec || null,
    subjectProgress: buildSubjectProgress(questions, state),
  };
  const columns = [];
  const values = [];
  const add = (column, value) => {
    if (!TEST_ATTEMPTS_COLUMNS.has(column)) return;
    columns.push(column);
    values.push(value);
  };
  const attemptId = TEST_ATTEMPTS_USE_TEXT_IDS ? nanoid() : "";
  if (TEST_ATTEMPTS_USE_TEXT_IDS) add("id", attemptId);
  add("testId", testId);
  add("userId", userId);
  add("questions_json", JSON.stringify(questions));
  add("state_json", JSON.stringify(meta));
  add("time_limit_sec", timeLimitSec);
  add("score", 0);
  add("maxScore", questions.reduce((sum, q) => sum + Number(q.positiveMarks || 0), 0));
  add("max_score", questions.reduce((sum, q) => sum + Number(q.positiveMarks || 0), 0));
  add("attempted_count", 0);
  add("total_questions", questions.length);
  add("status", "paused");
  const info = db
    .prepare(`INSERT INTO test_attempts (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...values);
  return TEST_ATTEMPTS_USE_TEXT_IDS ? attemptId : String(info.lastInsertRowid);
}

function getOwnedAttempt(userId, testId, attemptId) {
  return db
    .prepare("SELECT * FROM test_attempts WHERE id = ? AND testId = ? AND userId = ?")
    .get(attemptId, testId, userId);
}

function getReviewableAttempt(userId, testId, attemptId) {
  const test = db.prepare("SELECT userId FROM tests WHERE id = ?").get(testId);
  const attempt = db
    .prepare("SELECT * FROM test_attempts WHERE id = ? AND testId = ?")
    .get(attemptId, testId);
  if (!test || !attempt) return null;
  const canReview =
    String(attempt.userId || "") === String(userId) ||
    String(test.userId || "") === String(userId);
  return canReview ? attempt : null;
}

async function buildTestAttemptPayload(req, userId, testId, attemptId, mode) {
  if (!testId || !attemptId || !userCanAccessTest(userId, testId)) return null;
  const test = db
    .prepare("SELECT id AS testId, title, name, time_limit_sec, config_json FROM tests WHERE id = ?")
    .get(testId);
  const attempt =
    mode === "review"
      ? getReviewableAttempt(userId, testId, attemptId)
      : getOwnedAttempt(userId, testId, attemptId);
  if (!test || !attempt) return null;
  if (
    mode === "take" &&
    ["submitted", "completed", "attempted", "finished"].includes(String(attempt.status || "").toLowerCase())
  ) {
    return null;
  }
  const meta = safeParseJSON(attempt.state_json, {});
  const questions = await getResolvedTestQuestions(req, testId, attempt);
  return {
    test: {
      testId,
      title: test.title || test.name || "Test",
      timeLimitSeconds: Number(attempt.time_limit_sec || test.time_limit_sec || 0),
    },
    attempt: {
      attemptId,
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.max_score ?? attempt.maxScore,
      startedAt: attempt.started_at,
      submittedAt: attempt.submitted_at,
      elapsedSeconds: Number(meta.elapsedSeconds || 0),
      remainingSeconds: meta.remainingSeconds ?? null,
      state: Array.isArray(meta.state) ? meta.state : [],
      subjectProgress: meta.subjectProgress || [],
      result: meta,
    },
    questions,
  };
}

function defaultTestAttemptState() {
  return {
    isAnswerPicked: false,
    pickedAnswers: [],
    pickedAnswer: "",
    pickedNumerical: undefined,
  };
}

function updateTestAttemptRow(attemptId, values) {
  const parts = [];
  const args = [];
  Object.entries(values || {}).forEach(([column, value]) => {
    if (value === undefined) return;
    if (!TEST_ATTEMPTS_COLUMNS.has(column)) return;
    if (value === "CURRENT_TIMESTAMP" || value === null && column === "submitted_at") {
      parts.push(`${column} = ${value === "CURRENT_TIMESTAMP" ? "CURRENT_TIMESTAMP" : "NULL"}`);
    } else {
      parts.push(`${column} = ?`);
      args.push(value);
    }
  });
  if (!parts.length) return;
  args.push(attemptId);
  db.prepare(`UPDATE test_attempts SET ${parts.join(", ")} WHERE id = ?`).run(...args);
}

function updateTestSummary(testId, values) {
  const parts = [];
  const args = [];
  const add = (column, value) => {
    if (value === undefined) return;
    if (!TESTS_COLUMNS.has(column)) return;
    parts.push(`${column} = ?`);
    args.push(value);
  };
  add("status", values.status);
  add("score", values.score);
  add("max_score", values.maxScore);
  add("attempted_count", values.attempted);
  add("total_questions", values.totalQuestions);
  if (TESTS_COLUMNS.has("updated_at")) parts.push("updated_at = CURRENT_TIMESTAMP");
  if (!parts.length) return;
  args.push(testId);
  db.prepare(`UPDATE tests SET ${parts.join(", ")} WHERE id = ?`).run(...args);
}

function refreshTestSummaryFromAttempts(testId) {
  const attempts = db
    .prepare(
      `SELECT status, score, max_score AS maxScore, attempted_count AS attempted, total_questions AS totalQuestions,
              submitted_at AS submittedAt, started_at AS startedAt
       FROM test_attempts
       WHERE testId = ?
       ORDER BY datetime(COALESCE(submitted_at, started_at)) DESC, id DESC`
    )
    .all(testId);
  if (!attempts.length) {
    const questions = getTestQuestionRows(testId);
    updateTestSummary(testId, {
      status: "unattempted",
      score: 0,
      maxScore: questions.reduce((sum, question) => sum + Number(question.positiveMarks || 0), 0),
      attempted: 0,
      totalQuestions: questions.length,
    });
    return;
  }
  const latest = attempts[0];
  const submitted = attempts.filter((attempt) =>
    String(attempt.status || "").toLowerCase() === "submitted" || attempt.submittedAt
  );
  const best = submitted.reduce((winner, attempt) => {
    if (!winner) return attempt;
    return Number(attempt.score || 0) > Number(winner.score || 0) ? attempt : winner;
  }, null);
  updateTestSummary(testId, {
    status: best ? "attempted" : String(latest.status || "paused"),
    score: Number((best || latest).score || 0),
    maxScore: Number((best || latest).maxScore || 0),
    attempted: Number(latest.attempted || 0),
    totalQuestions: Number(latest.totalQuestions || getTestQuestionRows(testId).length),
  });
}

function countAttemptedTestAnswers(state) {
  return (Array.isArray(state) ? state : []).filter((s) => hasTestAnswer(s)).length;
}

function hasTestAnswer(s) {
  return !!(
    s &&
    (s.pickedAnswer ||
      (Array.isArray(s.pickedAnswers) && s.pickedAnswers.length) ||
      s.pickedNumerical !== undefined && s.pickedNumerical !== null && s.pickedNumerical !== "")
  );
}

function buildSubjectProgress(questions, state) {
  const bySubject = new Map();
  (questions || []).forEach((q, index) => {
    const key = q.subjectKey || q.subjectName || "Unknown";
    if (!bySubject.has(key)) {
      bySubject.set(key, { key, name: q.subjectName || "Unknown", attempted: 0, totalQuestions: 0 });
    }
    const row = bySubject.get(key);
    row.totalQuestions += 1;
    if (hasTestAnswer(state?.[index])) row.attempted += 1;
  });
  return Array.from(bySubject.values());
}

function scoreTestAttempt(questions, state) {
  let score = 0;
  let maxScore = 0;
  let attempted = 0;
  let positiveScore = 0;
  let negativeScore = 0;
  let partialScore = 0;
  const subjectMap = new Map();
  const rows = (questions || []).map((q, index) => {
    const st = state?.[index] || {};
    const max = Number(q.positiveMarks || 0);
    maxScore += max;
    const subjectKey = q.subjectKey || q.subjectName || "Unknown";
    if (!subjectMap.has(subjectKey)) {
      subjectMap.set(subjectKey, {
        key: subjectKey,
        name: q.subjectName || "Unknown",
        score: 0,
        maxScore: 0,
        attempted: 0,
        totalQuestions: 0,
        positiveScore: 0,
        negativeScore: 0,
        partialScore: 0,
      });
    }
    const subject = subjectMap.get(subjectKey);
    subject.maxScore += max;
    subject.totalQuestions += 1;
    const result = scoreOneTestQuestion(q, st);
    score += result.score;
    if (result.attempted) {
      attempted += 1;
      subject.attempted += 1;
    }
    if (result.score > 0 && !result.partial) {
      positiveScore += result.score;
      subject.positiveScore += result.score;
    }
    if (result.partial) {
      partialScore += result.score;
      subject.partialScore += result.score;
    }
    if (result.score < 0) {
      negativeScore += Math.abs(result.score);
      subject.negativeScore += Math.abs(result.score);
    }
    subject.score += result.score;
    return { index, ...result };
  });
  return {
    score,
    maxScore,
    attempted,
    meta: {
      positiveScore,
      negativeScore,
      partialScore,
      subjectBreakdown: Array.from(subjectMap.values()),
      questionResults: rows,
      subjectProgress: buildSubjectProgress(questions, state),
    },
  };
}

function scoreOneTestQuestion(q, st) {
  if (!hasTestAnswer(st)) return { attempted: false, score: 0, status: "unanswered" };
  const type = normalizeGeneratedQuestionType(q.questionType || q.payload?.qType || q.payload?.type);
  const positive = Number(q.positiveMarks || 0);
  const negative = Math.abs(Number(q.negativeMarks || 0));
  const correct = normalizeTestCorrectAnswer(q.payload);
  if (type === "numerical") {
    const picked = Number(st.pickedNumerical);
    const ok = Number.isFinite(picked) && Number(correct?.value) === picked;
    return { attempted: true, score: ok ? positive : -negative, status: ok ? "correct" : "incorrect" };
  }
  const picked = new Set(
    type === "multiple"
      ? (Array.isArray(st.pickedAnswers) ? st.pickedAnswers : []).map((x) => String(x).toUpperCase())
      : st.pickedAnswer
      ? [String(st.pickedAnswer).toUpperCase()]
      : []
  );
  const correctSet = new Set((correct?.values || []).map((x) => String(x).toUpperCase()));
  const wrong = Array.from(picked).some((x) => !correctSet.has(x));
  const hits = Array.from(picked).filter((x) => correctSet.has(x)).length;
  if (!wrong && hits && hits === correctSet.size && picked.size === correctSet.size) {
    return { attempted: true, score: positive, status: "correct" };
  }
  if (type === "multiple" && !wrong && hits > 0) {
    return { attempted: true, score: Number(((positive * hits) / Math.max(correctSet.size, 1)).toFixed(2)), status: "partial", partial: true };
  }
  return { attempted: true, score: -negative, status: "incorrect" };
}

function normalizeTestCorrectAnswer(question) {
  const raw = question?.qAnswer ?? question?.correctAnswer ?? question?.answer ?? question?.correctValue;
  if (Array.isArray(raw)) return { values: raw };
  if (typeof raw === "number") return { value: raw, values: [String(raw)] };
  const text = String(raw ?? "").trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) return { value: Number(text), values: [text] };
  return { values: text ? text.split(/[,\s]+/).filter(Boolean) : [] };
}

function mergeShareWithUsername(rawShareWith, username) {
  const name = String(username || "").trim();
  const shareWith = Array.isArray(rawShareWith)
    ? rawShareWith
    : safeParseJSON(rawShareWith, []);
  const output = [];
  const seen = new Set();
  const add = (value) => {
    const item = String(value || "").trim();
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return;
    seen.add(key);
    output.push(item);
  };
  (Array.isArray(shareWith) ? shareWith : []).forEach(add);
  add(name);
  return output;
}

function createNotification({ userId, title, body, meta = null }) {
  const uid = String(userId || "").trim();
  const titleText = String(title || "").trim();
  const bodyText = String(body || "").trim();
  if (!uid || !titleText || !bodyText) return false;
  db.prepare(
    "INSERT INTO notifications (id, userId, title, body_md, meta) VALUES (?, ?, ?, ?, ?)"
  ).run(nanoid(), uid, titleText, bodyText, meta ? JSON.stringify(meta) : null);
  return true;
}

function userCanAccessTest(userId, testId, options = {}) {
  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(userId);
  const row = db
    .prepare("SELECT id AS testId, userId, share_with_json, archived_at FROM tests WHERE id = ?")
    .get(testId);
  return userCanAccessTestRow(userId, user?.username, row, options);
}

function userCanAccessTestRow(userId, username, row, options = {}) {
  if (!row) return false;
  if (!options.includeArchived && row.archived_at) return false;
  if (String(row.userId) === String(userId)) return true;
  if (row.testId != null) {
    const access = db
      .prepare("SELECT 1 FROM test_access WHERE userId = ? AND testId = ?")
      .get(userId, row.testId);
    if (access) return true;
  }
  const sharedWith = safeParseJSON(row.share_with_json, []);
  return (
    !!username &&
    Array.isArray(sharedWith) &&
    sharedWith.map((item) => String(item).toLowerCase()).includes(String(username).toLowerCase())
  );
}

async function computeAssignmentScore(assignmentId, stateArray) {
  try {
    const assignment = await loadAssignment(assignmentId);
    const questions = getAssignmentQuestionsList(assignment);
    const display = questions.filter((q) => q?.qType !== "Passage");
    const maxScore = display.length * 4;
    let score = 0;
    for (let i = 0; i < display.length; i++) {
      const q = display[i];
      const st = Array.isArray(stateArray) ? stateArray[i] || {} : {};
      score += scoreQuestion(q, st);
    }
    return { score, maxScore };
  } catch {
    return { score: 0, maxScore: 0 };
  }
}

function scoreQuestion(q, st) {
  const unanswered =
    !st ||
    (!st.isAnswerPicked &&
      st.pickedNumerical === undefined &&
      (!Array.isArray(st.pickedAnswers) || st.pickedAnswers.length === 0) &&
      !st.pickedAnswer);
  if (unanswered) return 0;

  if (q.qType === "SMCQ") {
    const correct = String(q.qAnswer).trim().toUpperCase();
    const picked = String(st.pickedAnswer || "")
      .trim()
      .toUpperCase();
    return picked && picked === correct ? 4 : -1;
  }
  if (q.qType === "MMCQ") {
    const correctSet = new Set(
      (Array.isArray(q.qAnswer) ? q.qAnswer : [q.qAnswer]).map((x) =>
        String(x).trim().toUpperCase()
      )
    );
    const pickedSet = new Set(
      (Array.isArray(st.pickedAnswers) ? st.pickedAnswers : []).map((x) =>
        String(x).trim().toUpperCase()
      )
    );
    for (const p of pickedSet) if (!correctSet.has(p)) return -1;
    const hits = [...pickedSet].filter((x) => correctSet.has(x)).length;
    if (hits === correctSet.size && pickedSet.size === correctSet.size)
      return 4;
    if (hits > 0) return hits;
    return -1;
  }
  if (q.qType === "Numerical") {
    const ans = Number(q.qAnswer);
    const user = st.pickedNumerical;
    if (typeof user === "number" && !Number.isNaN(ans))
      return user === ans ? 4 : -1;
    return 0;
  }
  return 0;
}

async function computeAttempted(assignmentId, stateArray) {
  try {
    const assignment = await loadAssignment(assignmentId);
    const questions = getAssignmentQuestionsList(assignment);
    const display = questions.filter((q) => q?.qType !== "Passage");
    const totalQuestions = display.length;
    let attempted = 0;
    for (let i = 0; i < totalQuestions; i++) {
      const st = Array.isArray(stateArray) ? stateArray[i] || {} : {};
      const answered = !!(
        st.isAnswerPicked ||
        (Array.isArray(st.pickedAnswers) && st.pickedAnswers.length) ||
        st.pickedAnswer ||
        typeof st.pickedNumerical === "number"
      );
      if (answered) attempted++;
    }
    return { attempted, totalQuestions };
  } catch {
    return { attempted: 0, totalQuestions: 0 };
  }
}

function safeParseJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
// ---------- Image uploads (authenticated) ----------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    try {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
      const name = `${req.userId}-${Date.now()}-${nanoid(8)}${ext}`;
      cb(null, name);
    } catch (e) {
      cb(e);
    }
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//i.test(file.mimetype);
    if (ok) return cb(null, true);
    return cb(null, false);
  },
});

app.post("/api/upload-image", upload.single("image"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const url = `${req.protocol}://${req.get(
      "host"
    )}/uploads/${encodeURIComponent(req.file.filename)}`;
    res.json({ url });
  } catch (e) {
    console.error("upload-image:", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Delete an uploaded image by filename (must belong to the authenticated user)
app.delete("/api/upload-image/:filename", (req, res) => {
  try {
    const raw = String(req.params.filename || "");
    const fname = path.basename(raw); // prevent path traversal
    if (!fname) return res.status(400).json({ error: "Missing filename" });
    // Filenames are formatted as `${userId}-${Date.now()}-${nanoid(8)}.ext`
    // Ensure the caller owns this file
    if (!fname.startsWith(`${req.userId}-`)) {
      return res.status(403).json({ error: "Not allowed to delete this file" });
    }
    const filePath = path.join(uploadsDir, fname);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.error("delete upload:", e);
      return res.status(500).json({ error: "Failed to delete image" });
    }
    res.json({ success: true });
  } catch (e) {
    console.error("delete upload fatal:", e);
    res.status(500).json({ error: "Failed to delete image" });
  }
});

app.get(
  "/api/pyqs/question-marks/:examId/:subjectId/:chapterId",
  auth,
  (req, res) => {
    try {
      const { examId, subjectId, chapterId } = req.params;
      const rows = db
        .prepare(
          `
      SELECT questionIndex, color
      FROM pyqs_question_marks
      WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?
      ORDER BY created_at DESC
    `
        )
        .all(req.userId, String(examId), String(subjectId), String(chapterId));
      res.json(rows);
    } catch (e) {
      console.error("pyqs get question-marks:", e);
      res.status(500).json({ error: "Failed to get question marks" });
    }
  }
);

// GET color mark for a specific question
app.get(
  "/api/pyqs/question-marks/:examId/:subjectId/:chapterId/:questionIndex",
  auth,
  (req, res) => {
    try {
      const { examId, subjectId, chapterId, questionIndex } = req.params;
      const row = db
        .prepare(
          `
      SELECT color
      FROM pyqs_question_marks
      WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ? AND questionIndex = ?
    `
        )
        .get(
          req.userId,
          String(examId),
          String(subjectId),
          String(chapterId),
          questionIndex
        );
      if (!row) return res.status(200).json({});
      res.json(row);
    } catch (e) {
      console.error("pyqs get question-mark:", e);
      res.status(500).json({ error: "Failed to get question mark" });
    }
  }
);

// POST/UPSERT color mark for a question
app.post(
  "/api/pyqs/question-marks/:examId/:subjectId/:chapterId",
  auth,
  (req, res) => {
    try {
      const { examId, subjectId, chapterId } = req.params;
      const { questionIndex, color } = req.body || {};
      if (questionIndex == null || !color || typeof color !== "string") {
        return res
          .status(400)
          .json({ error: "questionIndex and color are required" });
      }
      const c = String(color).trim().slice(0, 32);
      // Upsert: try update first
      const upd = db
        .prepare(
          `
      UPDATE pyqs_question_marks
      SET color = ?, updated_at = CURRENT_TIMESTAMP
      WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ? AND questionIndex = ?
    `
        )
        .run(
          c,
          req.userId,
          String(examId),
          String(subjectId),
          String(chapterId),
          questionIndex
        );
      if (upd.changes === 0) {
        db.prepare(
          `
        INSERT INTO pyqs_question_marks (userId, examId, subjectId, chapterId, questionIndex, color)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        ).run(
          req.userId,
          String(examId),
          String(subjectId),
          String(chapterId),
          questionIndex,
          c
        );
      }
      res.json({ success: true });
    } catch (e) {
      console.error("pyqs set question-mark:", e);
      res.status(500).json({ error: "Failed to set question mark" });
    }
  }
);

// DELETE color mark for a question
app.delete(
  "/api/pyqs/question-marks/:examId/:subjectId/:chapterId/:questionIndex",
  auth,
  (req, res) => {
    try {
      const { examId, subjectId, chapterId, questionIndex } = req.params;
      db.prepare(
        `
      DELETE FROM pyqs_question_marks
      WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ? AND questionIndex = ?
    `
      ).run(
        req.userId,
        String(examId),
        String(subjectId),
        String(chapterId),
        questionIndex
      );
      res.json({ success: true });
    } catch (e) {
      console.error("pyqs delete question-mark:", e);
      res.status(500).json({ error: "Failed to delete question mark" });
    }
  }
);
