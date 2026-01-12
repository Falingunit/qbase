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
// Allow Chrome Private Network Access for preflights when accessing 10.0.0.1 from 10.0.0.3
app.options("*", (req, res, next) => {
  if (req.headers["access-control-request-private-network"] === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  corsFn(req, res, next);
});

// ---------- Parsers ----------
app.use(express.json());

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
`);

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
            { q: "", years: [], status: "", diff: "", sort: "index" },
            prefsMap[cid] || {}
          );
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
          if (!f.q && !(Array.isArray(f.years) && f.years.length) && !f.diff) {
            if (!f.status) {
              green = correct;
              red = incorrect + partial;
              grey = Math.max(0, totalQs - green - red);
              total = totalQs;
            } else {
              switch (String(f.status)) {
                case "correct":
                  total = correct;
                  green = correct;
                  break;
                case "incorrect":
                  total = incorrect;
                  red = incorrect;
                  break;
                case "partial":
                  total = partial;
                  red = partial;
                  break;
                case "completed":
                  total = evaluated;
                  green = correct;
                  red = incorrect + partial;
                  break;
                case "in-progress":
                  total = inProgress;
                  grey = inProgress;
                  break;
                case "not-started":
                  total = Math.max(0, totalQs - evaluated - inProgress);
                  grey = total;
                  break;
                default:
                  total = totalQs;
                  green = correct;
                  red = incorrect + partial;
                  grey = Math.max(0, totalQs - green - red);
              }
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
      if (
        (f.q && String(f.q).trim()) ||
        (Array.isArray(f.years) && f.years.length) ||
        (f.diff && String(f.diff).trim())
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
        status: "",
        diff: "",
        sort: "index",
      };
      const f = Object.assign({}, defaults, prefsMap[cid] || {});
      const stArr = Array.isArray(statesMap[cid]) ? statesMap[cid] : [];

      const requiresMeta =
        (f.q && String(f.q).trim()) ||
        (Array.isArray(f.years) && f.years.length) ||
        (f.diff && String(f.diff).trim());
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
        if (!f.status) {
          green = correct;
          red = incorrect + partial;
          grey = Math.max(0, totalQs - green - red);
          total = totalQs;
        } else {
          switch (String(f.status)) {
            case "correct":
              total = correct;
              green = correct;
              red = 0;
              grey = 0;
              break;
            case "incorrect":
              total = incorrect;
              green = 0;
              red = incorrect;
              grey = 0;
              break;
            case "partial":
              total = partial;
              green = 0;
              red = partial;
              grey = 0;
              break;
            case "completed":
              total = evaluated;
              green = correct;
              red = incorrect + partial;
              grey = 0;
              break;
            case "in-progress":
              total = inProgress;
              green = 0;
              red = 0;
              grey = inProgress;
              break;
            case "not-started":
              total = Math.max(0, totalQs - evaluated - inProgress);
              green = 0;
              red = 0;
              grey = total;
              break;
            default:
              total = totalQs;
              green = correct;
              red = incorrect + partial;
              grey = Math.max(0, totalQs - green - red);
              break;
          }
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
        if (f.diff) {
          mapped = mapped.filter((o) => normDiff(o.q.diffuculty) === f.diff);
        }
        if (f.status) {
          mapped = mapped.filter((o) => {
            const s = statusFromState(stArr[o.i]);
            return (
              s === f.status ||
              (f.status === "completed" && stArr[o.i]?.isAnswerEvaluated)
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
const assignmentCache = new Map();
async function loadAssignment(assignmentId) {
  if (assignmentCache.has(assignmentId))
    return assignmentCache.get(assignmentId);
  const url = `${ASSETS_BASE}/data/question_data/${assignmentId}/assignment.json`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok)
    throw new Error(`Failed to fetch assignment ${assignmentId}: ${r.status}`);
  const json = await r.json();
  assignmentCache.set(assignmentId, json);
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
        const stateRow = db
          .prepare(
            "SELECT state FROM states WHERE userId = ? AND assignmentId = ?"
          )
          .get(req.userId, aID);
        const state = stateRow ? safeParseJSON(stateRow.state, {}) : {};
        const bookmarks = db
          .prepare(
            "SELECT questionIndex, tagId FROM pyqs_bookmarks WHERE userId = ? AND examId IS NULL AND subjectId IS NULL AND chapterId IS NULL AND questionIndex IS NOT NULL"
          )
          .all(req.userId);
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
        res.json({ assignment, state, bookmarks, marks, tags });
      })
      .catch((e) => {
        res.status(500).json({ error: "Failed to load assignment" });
      });
  } catch (e) {
    res.status(500).json({ error: "Failed to bootstrap assignment" });
  }
});

// ---------- Protected routes (require Bearer token) ----------
app.use(auth);

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
async function computeAssignmentScore(assignmentId, stateArray) {
  try {
    const assignment = await loadAssignment(assignmentId);
    const display = assignment.questions.filter((q) => q.qType !== "Passage");
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
    const display = assignment.questions.filter((q) => q.qType !== "Passage");
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
