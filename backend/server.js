// server.js — JWT (no cookies) + SQLite + flexible CORS
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import multer from 'multer';

// ---------- Paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Config ----------
const isDev = process.env.NODE_ENV !== 'production';
const PORT = process.env.PORT || 3000;

// JWT
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Frontend & assets
// Your GitHub Pages site hosts the data/ folder (prod)
const FRONTEND_ORIGIN = 'https://falingunit.github.io';
const ASSETS_BASE = process.env.ASSETS_BASE || 'https://falingunit.github.io/qbase';

// For Zoom/in-app browsers, requests still come from the frontend origin.
// But we’ll also allow dev and your nip.io domain for safety.
const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://qbase.103.125.154.215.nip.io',
];

// If you want to temporarily allow everything while testing,
// set ALLOW_ALL_ORIGINS=1 in the environment.
const ALLOW_ALL = process.env.ALLOW_ALL_ORIGINS === '1';

const app = express();
app.set('trust proxy', 1);

// ---------- CORS ----------
const corsFn = cors({
  origin: (origin, cb) => {
    if (ALLOW_ALL) return cb(null, true);
    if (!origin) return cb(null, true); // allow curl/postman
    if (origin === 'null') return cb(null, true); // allow file:// pages

    let ok = false;
    try {
      const u = new URL(origin);
      const host = u.hostname;
      // Allow configured list (exact matches)
      if (ALLOWED_ORIGINS.includes(origin)) ok = true;
      // Allow any *.github.io page
      if (!ok && /\.github\.io$/i.test(host)) ok = true;
      // Allow WireGuard client host 10.0.0.3 (any scheme/port)
      if (!ok && host === '10.0.0.3') ok = true;
      // Allow local development hosts
      if (!ok && (host === 'localhost' || host === '127.0.0.1')) ok = true;
    } catch {}

    cb(ok ? null : new Error(`Origin ${origin} not allowed by CORS`), ok);
  },
});
app.use(corsFn);
// Allow Chrome Private Network Access for preflights when accessing 10.0.0.1 from 10.0.0.3
app.options('*', (req, res, next) => {
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  corsFn(req, res, next);
});

// ---------- Parsers ----------
app.use(express.json());

// ---------- Static uploads ----------
const uploadsDir = path.join(__dirname, 'uploads');
import fs from 'fs';
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}
app.use('/uploads', express.static(uploadsDir, { maxAge: '365d', etag: true }));

// ---------- Disable caching for dynamic content ----------
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ---------- SQLite ----------
const dbPath = path.join(__dirname, 'db.sqlite');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

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
`);

// --- Lightweight migration: ensure users.password_hash and force_pw_reset exist ---
try {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const hasPw = cols.some((c) => String(c.name).toLowerCase() === 'password_hash');
  if (!hasPw) {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
  }
  const hasForce = cols.some((c) => String(c.name).toLowerCase() === 'force_pw_reset');
  if (!hasForce) {
    db.exec("ALTER TABLE users ADD COLUMN force_pw_reset INTEGER DEFAULT 0");
  }
  const hasMarks = cols.some((c) => String(c.name).toLowerCase() === 'getmarks_token');
  if (!hasMarks) {
    db.exec("ALTER TABLE users ADD COLUMN getmarks_token TEXT");
  }
} catch (e) {
  console.warn('users.password_hash migration check failed:', e?.message || e);
}

// ---------- Auth helpers ----------
function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Password helpers using Node's scrypt
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(password), salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, keyHex] = stored.split(':');
  const keyBuf = Buffer.from(keyHex, 'hex');
  const test = crypto.scryptSync(String(password), salt, 64);
  if (test.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(test, keyBuf);
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.userId = String(payload.sub);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ---------- Public routes ----------
app.get('/healthz', (_req, res) => res.send('ok'));

// ---------- PYQs proxy (public) ----------
// Uses per-user token when available (from profile), otherwise falls back to server-side token.
const GETMARKS_AUTH_TOKEN = process.env.GETMARKS_AUTH_TOKEN || '';
const GM_BASE = {
  dashboard: 'https://web.getmarks.app/api/v3/dashboard/platform/web',
  exam_subjects: (examId) => `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(examId)}`,
  subject_chapters: (examId, subjectId) => `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(examId)}/subject/${encodeURIComponent(subjectId)}`,
  questions: (examId, subjectId, chapterId) => `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(examId)}/subject/${encodeURIComponent(subjectId)}/chapter/${encodeURIComponent(chapterId)}/questions`,
};

function getUserIdOptional(req) {
  try {
    const h = req?.headers?.authorization || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const { sub } = jwt.verify(m[1], JWT_SECRET);
    return String(sub || '');
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
    const e = new Error('Missing GetMarks token');
    e.status = 503;
    throw e;
  }
  const target = buildUrlWithParams(url, params);
  const r = await fetch(target, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
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
      const row = db.prepare('SELECT getmarks_token FROM users WHERE id = ?').get(uid);
      const userTok = row?.getmarks_token;
      if (userTok && String(userTok).trim()) {
        return await gmFetchWithToken(url, params, String(userTok).trim());
      }
    }
  } catch {}
  // Fallback to server token
  if (!GETMARKS_AUTH_TOKEN) {
    const e = new Error('GETMARKS_AUTH_TOKEN not configured');
    e.status = 503;
    throw e;
  }
  return await gmFetchWithToken(url, params, GETMARKS_AUTH_TOKEN);
}

// GET /api/pyqs/exams -> [{ id, name, icon }]
app.get('/api/pyqs/exams', async (req, res) => {
  try {
    const data = await gmFetch(req, GM_BASE.dashboard, { limit: 10000 });
    const items = data?.data?.items || [];
    const comp = items.find((it) => it?.componentTitle === 'ChapterwiseExams');
    const exams = (comp?.items || []).map((ex) => ({
      id: ex?.examId,
      name: ex?.title,
      icon: ex?.icon?.dark || ex?.icon?.light || '',
    })).filter((x) => x.id && x.name);
    return res.json(exams);
  } catch (e) {
    const code = e.status || 500;
    return res.status(code).json({ error: String(e.message || e) });
  }
});

// GET /api/pyqs/exams/:examId/subjects -> [{ id, name, icon }]
app.get('/api/pyqs/exams/:examId/subjects', async (req, res) => {
  try {
    const { examId } = req.params;
    const data = await gmFetch(req, GM_BASE.exam_subjects(examId), { limit: 10000 });
    const subjects = (data?.data?.subjects || []).map((s) => ({
      id: s?._id,
      name: s?.title,
      icon: s?.icon || '',
    })).filter((x) => x.id && x.name);
    return res.json(subjects);
  } catch (e) {
    const code = e.status || 500;
    return res.status(code).json({ error: String(e.message || e) });
  }
});

// GET /api/pyqs/exams/:examId/subjects/:subjectId/chapters -> [{ id, name, icon_name, total_questions }]
app.get('/api/pyqs/exams/:examId/subjects/:subjectId/chapters', async (req, res) => {
  try {
    const { examId, subjectId } = req.params;
    const data = await gmFetch(req, GM_BASE.subject_chapters(examId, subjectId), { limit: 10000 });
    const chapters = (data?.data?.chapters?.data || []).map((c) => ({
      id: c?._id,
      name: c?.title,
      icon_name: c?.icon,
      total_questions: c?.allPyqs?.totalQs ?? 0,
    })).filter((x) => x.id && x.name);
    return res.json(chapters);
  } catch (e) {
    const code = e.status || 500;
    return res.status(code).json({ error: String(e.message || e) });
  }
});

// GET /api/pyqs/exams/:examId/subjects/:subjectId/chapters/:chapterId/questions
// -> [{ type, diffuculty, pyqInfo, qText, qImage, options:[{oText,oImage}], correctAnswer, solution:{sText,sImage} }]
app.get('/api/pyqs/exams/:examId/subjects/:subjectId/chapters/:chapterId/questions', async (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    const data = await gmFetch(req, GM_BASE.questions(examId, subjectId, chapterId), { limit: 10000, hideOutOfSyllabus: 'false' });
    const questions = (data?.data?.questions || []).map((q) => {
      const opts = Array.isArray(q?.options) ? q.options : [];
      const correctLetters = [];
      if (Array.isArray(opts)) {
        const letters = ['A','B','C','D'];
        opts.forEach((o, i) => { if (o?.isCorrect) correctLetters.push(letters[i] || String(i+1)); });
      }
      return {
        type: q?.type,
        diffuculty: q?.level,
        pyqInfo: (Array.isArray(q?.previousYearPapers) && q.previousYearPapers[0]?.title) || '',
        qText: q?.question?.text || '',
        qImage: q?.question?.image || '',
        options: opts.map((o) => ({ oText: o?.text || '', oImage: o?.image || '' })),
        correctAnswer: q?.type === 'numerical' ? q?.correctValue : correctLetters,
        solution: { sText: q?.solution?.text || '', sImage: q?.solution?.image || '' },
      };
    });
    return res.json(questions);
  } catch (e) {
    const code = e.status || 500;
    return res.status(code).json({ error: String(e.message || e) });
  }
});

// ---------- PYQs per-user state (protected) ----------
// GET state
app.get('/api/pyqs/state/:examId/:subjectId/:chapterId', auth, (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    const row = db
      .prepare('SELECT state FROM pyqs_states WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?')
      .get(req.userId, String(examId), String(subjectId), String(chapterId));
    const state = row ? safeParseJSON(row.state, []) : [];
    res.json(Array.isArray(state) ? state : []);
  } catch (e) {
    console.error('pyqs get state:', e);
    res.status(500).json({ error: 'Failed to get PYQs state' });
  }
});

// POST/UPSERT state
app.post('/api/pyqs/state/:examId/:subjectId/:chapterId', auth, (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    const state = req.body?.state ?? [];
    const text = JSON.stringify(state);
    db.prepare(`
      INSERT INTO pyqs_states (userId, examId, subjectId, chapterId, state)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(userId, examId, subjectId, chapterId)
      DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP
    `).run(req.userId, String(examId), String(subjectId), String(chapterId), text);
    res.json({ success: true });
  } catch (e) {
    console.error('pyqs save state:', e);
    res.status(500).json({ error: 'Failed to save PYQs state' });
  }
});

// ---------- PYQs per-user preferences (protected) ----------
// GET prefs
app.get('/api/pyqs/prefs/:examId/:subjectId/:chapterId', auth, (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    const row = db
      .prepare('SELECT prefs FROM pyqs_prefs WHERE userId = ? AND examId = ? AND subjectId = ? AND chapterId = ?')
      .get(req.userId, String(examId), String(subjectId), String(chapterId));
    const prefs = row ? safeParseJSON(row.prefs, {}) : {};
    res.json(prefs && typeof prefs === 'object' ? prefs : {});
  } catch (e) {
    console.error('pyqs get prefs:', e);
    res.status(500).json({ error: 'Failed to get PYQs prefs' });
  }
});

// POST/UPSERT prefs
app.post('/api/pyqs/prefs/:examId/:subjectId/:chapterId', auth, (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    const prefs = req.body?.prefs ?? {};
    const text = JSON.stringify(prefs && typeof prefs === 'object' ? prefs : {});
    db.prepare(`
      INSERT INTO pyqs_prefs (userId, examId, subjectId, chapterId, prefs)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(userId, examId, subjectId, chapterId)
      DO UPDATE SET prefs = excluded.prefs, updated_at = CURRENT_TIMESTAMP
    `).run(req.userId, String(examId), String(subjectId), String(chapterId), text);
    res.json({ success: true });
  } catch (e) {
    console.error('pyqs save prefs:', e);
    res.status(500).json({ error: 'Failed to save PYQs prefs' });
  }
});

// Sign up: create or set password for existing username without password
app.post('/signup', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || username.trim().length < 2) {
      return res.status(400).json({ error: 'Username too short' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const uname = username.trim();
    const row = db.prepare('SELECT id, username, password_hash, force_pw_reset FROM users WHERE username = ?').get(uname);
    const pwHash = hashPassword(password);
    let user;
    if (!row) {
      const id = nanoid();
      db.prepare('INSERT INTO users (id, username, password_hash, force_pw_reset) VALUES (?, ?, ?, 0)').run(id, uname, pwHash);
      user = { id, username: uname };
    } else if (!row.password_hash) {
      db.prepare('UPDATE users SET password_hash = ?, force_pw_reset = 0 WHERE id = ?').run(pwHash, row.id);
      user = { id: row.id, username: row.username };
    } else {
      return res.status(400).json({ error: 'Username already exists' });
    }
    const token = signToken(user.id);
    res.json({ success: true, user: { ...user, mustChangePassword: false }, token });
  } catch (e) {
    console.error('Signup failed:', e);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Back-compat alias
app.post('/register', (req, res) => {
  req.url = '/signup';
  app._router.handle(req, res);
});

// Login: require password
app.post('/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || username.trim().length < 2) {
      return res.status(400).json({ error: 'Username too short' });
    }
    if (!password) return res.status(400).json({ error: 'Password required' });
    const uname = username.trim();
    const row = db.prepare('SELECT id, username, password_hash, force_pw_reset FROM users WHERE username = ?').get(uname);
    if (!row || !row.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = { id: row.id, username: row.username, mustChangePassword: !!row.force_pw_reset };
    const token = signToken(user.id);
    res.json({ success: true, user, token });
  } catch (e) {
    console.error('Login failed:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Token-optional: returns user or null (useful for navbar)
app.get('/me', (req, res) => {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.json(null);
  try {
    const { sub } = jwt.verify(m[1], JWT_SECRET);
    const u = db.prepare('SELECT id, username, force_pw_reset, getmarks_token FROM users WHERE id = ?').get(String(sub));
    if (!u) return res.json(null);
    res.json({ id: u.id, username: u.username, mustChangePassword: !!u.force_pw_reset, hasMarksAuth: !!(u.getmarks_token && String(u.getmarks_token).trim()) });
  } catch {
    res.json(null);
  }
});

// No-op for JWT flows (client just forgets the token)
app.post('/logout', (_req, res) => {
  res.json({ success: true });
});

// ---------- Assignment loader (from Pages) ----------
const assignmentCache = new Map();
async function loadAssignment(assignmentId) {
  if (assignmentCache.has(assignmentId)) return assignmentCache.get(assignmentId);
  const url = `${ASSETS_BASE}/data/question_data/${assignmentId}/assignment.json`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Failed to fetch assignment ${assignmentId}: ${r.status}`);
  const json = await r.json();
  assignmentCache.set(assignmentId, json);
  return json;
}

// ---------- Protected routes (require Bearer token) ----------
app.use(auth);

// Bookmark tags
app.get('/api/bookmark-tags', (req, res) => {
  try {
    const tags = db.prepare(`
      SELECT id, name, created_at
      FROM bookmark_tags
      WHERE userId = ?
      ORDER BY name = 'Doubt' DESC, name ASC
    `).all(req.userId);
    res.json(tags);
  } catch (e) {
    console.error('get tags:', e);
    res.status(500).json({ error: 'Failed to get bookmark tags' });
  }
});

app.post('/api/bookmark-tags', (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Tag name is required' });
    const tagId = nanoid();
    db.prepare('INSERT INTO bookmark_tags (id, userId, name) VALUES (?, ?, ?)').run(tagId, req.userId, name.trim());
    const newTag = db.prepare('SELECT id, name, created_at FROM bookmark_tags WHERE id = ?').get(tagId);
    res.json(newTag);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: 'Tag name already exists' });
    console.error('create tag:', e);
    res.status(500).json({ error: 'Failed to create bookmark tag' });
  }
});

app.delete('/api/bookmark-tags/:tagId', (req, res) => {
  try {
    const { tagId } = req.params;
    if (!tagId) return res.status(400).json({ error: 'tagId is required' });
    // Ensure tag belongs to the user
    const tag = db.prepare('SELECT id FROM bookmark_tags WHERE id = ? AND userId = ?').get(tagId, req.userId);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    // Delete tag (bookmarks referencing it will cascade-delete)
    db.prepare('DELETE FROM bookmark_tags WHERE id = ? AND userId = ?').run(tagId, req.userId);
    res.json({ success: true });
  } catch (e) {
    console.error('delete tag:', e);
    res.status(500).json({ error: 'Failed to delete bookmark tag' });
  }
});

// Bookmarks
app.post('/api/bookmarks', (req, res) => {
  try {
    const { assignmentId, questionIndex, tagId } = req.body || {};
    if (!assignmentId || questionIndex === undefined || !tagId) {
      return res.status(400).json({ error: 'assignmentId, questionIndex, and tagId are required' });
    }
    const id = nanoid();
    db.prepare(`
      INSERT INTO bookmarks (id, userId, assignmentId, questionIndex, tagId)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.userId, assignmentId, questionIndex, tagId);
    res.json({ success: true, id });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: 'Question already bookmarked with this tag' });
    console.error('add bookmark:', e);
    res.status(500).json({ error: 'Failed to add bookmark' });
  }
});

app.delete('/api/bookmarks/:assignmentId/:questionIndex/:tagId', (req, res) => {
  try {
    const { assignmentId, questionIndex, tagId } = req.params;
    db.prepare(`
      DELETE FROM bookmarks
      WHERE userId = ? AND assignmentId = ? AND questionIndex = ? AND tagId = ?
    `).run(req.userId, assignmentId, questionIndex, tagId);
    res.json({ success: true });
  } catch (e) {
    console.error('remove bookmark:', e);
    res.status(500).json({ error: 'Failed to remove bookmark' });
  }
});

app.get('/api/bookmarks', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT b.id, b.assignmentId, b.questionIndex, b.created_at,
             bt.id as tagId, bt.name as tagName
      FROM bookmarks b
      JOIN bookmark_tags bt ON b.tagId = bt.id
      WHERE b.userId = ?
      ORDER BY bt.name = 'Doubt' DESC, bt.name ASC, b.created_at DESC
    `).all(req.userId);
    res.json(rows);
  } catch (e) {
    console.error('list bookmarks:', e);
    res.status(500).json({ error: 'Failed to get bookmarks' });
  }
});

app.get('/api/bookmarks/:assignmentId/:questionIndex', (req, res) => {
  try {
    const { assignmentId, questionIndex } = req.params;
    const rows = db.prepare(`
      SELECT b.tagId, bt.name as tagName
      FROM bookmarks b
      JOIN bookmark_tags bt ON b.tagId = bt.id
      WHERE b.userId = ? AND b.assignmentId = ? AND b.questionIndex = ?
    `).all(req.userId, assignmentId, questionIndex);
    res.json(rows);
  } catch (e) {
    console.error('check bookmark:', e);
    res.status(500).json({ error: 'Failed to check bookmarks' });
  }
});

// Question color marks
app.get('/api/question-marks', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT assignmentId, questionIndex, color
      FROM question_marks
      WHERE userId = ?
      ORDER BY created_at DESC
    `).all(req.userId);
    res.json(rows);
  } catch (e) {
    console.error('list question-marks:', e);
    res.status(500).json({ error: 'Failed to get question marks' });
  }
});

app.get('/api/question-marks/:assignmentId/:questionIndex', (req, res) => {
  try {
    const { assignmentId, questionIndex } = req.params;
    const row = db.prepare(`
      SELECT color
      FROM question_marks
      WHERE userId = ? AND assignmentId = ? AND questionIndex = ?
    `).get(req.userId, assignmentId, questionIndex);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) {
    console.error('get question-mark:', e);
    res.status(500).json({ error: 'Failed to get question mark' });
  }
});

app.post('/api/question-marks', (req, res) => {
  try {
    const { assignmentId, questionIndex, color } = req.body || {};
    if (assignmentId == null || questionIndex == null || !color || typeof color !== 'string') {
      return res.status(400).json({ error: 'assignmentId, questionIndex and color are required' });
    }
    // simple sanitize: trim and limit length
    const c = String(color).trim().slice(0, 32);
    // Upsert: try update first
    const upd = db.prepare(`
      UPDATE question_marks
      SET color = ?, updated_at = CURRENT_TIMESTAMP
      WHERE userId = ? AND assignmentId = ? AND questionIndex = ?
    `).run(c, req.userId, assignmentId, questionIndex);
    if (upd.changes === 0) {
      db.prepare(`
        INSERT INTO question_marks (userId, assignmentId, questionIndex, color)
        VALUES (?, ?, ?, ?)
      `).run(req.userId, assignmentId, questionIndex, c);
    }
    res.json({ success: true });
  } catch (e) {
    console.error('set question-mark:', e);
    res.status(500).json({ error: 'Failed to set question mark' });
  }
});

app.delete('/api/question-marks/:assignmentId/:questionIndex', (req, res) => {
  try {
    const { assignmentId, questionIndex } = req.params;
    db.prepare(`
      DELETE FROM question_marks
      WHERE userId = ? AND assignmentId = ? AND questionIndex = ?
    `).run(req.userId, assignmentId, questionIndex);
    res.json({ success: true });
  } catch (e) {
    console.error('delete question-mark:', e);
    res.status(500).json({ error: 'Failed to delete question mark' });
  }
});


// PYQs: starred resources (protected)
app.get('/api/pyqs/starred/exams', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT examId FROM starred_pyqs
      WHERE userId = ? AND kind = 'exam' AND examId IS NOT NULL
      ORDER BY created_at DESC
    `).all(req.userId);
    res.json(rows.map(r => String(r.examId)));
  } catch (e) {
    console.error('pyqs starred exams list:', e);
    res.status(500).json({ error: 'Failed to get starred exams' });
  }
});
app.post('/api/pyqs/starred/exams/:examId', (req, res) => {
  try {
    const { examId } = req.params;
    if (!examId) return res.status(400).json({ error: 'examId required' });
    db.prepare(`
      INSERT INTO starred_pyqs (userId, kind, examId)
      VALUES (?, 'exam', ?)
      ON CONFLICT(userId, kind, examId, subjectId, chapterId) DO NOTHING
    `).run(req.userId, String(examId));
    res.json({ success: true });
  } catch (e) {
    console.error('pyqs star exam:', e);
    res.status(500).json({ error: 'Failed to star exam' });
  }
});
app.delete('/api/pyqs/starred/exams/:examId', (req, res) => {
  try {
    const { examId } = req.params;
    db.prepare(`
      DELETE FROM starred_pyqs WHERE userId = ? AND kind = 'exam' AND examId = ?
    `).run(req.userId, String(examId));
    res.json({ success: true });
  } catch (e) {
    console.error('pyqs unstar exam:', e);
    res.status(500).json({ error: 'Failed to unstar exam' });
  }
});

app.get('/api/pyqs/starred/chapters', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT examId, subjectId, chapterId
      FROM starred_pyqs
      WHERE userId = ? AND kind = 'chapter' AND examId IS NOT NULL AND subjectId IS NOT NULL AND chapterId IS NOT NULL
      ORDER BY created_at DESC
    `).all(req.userId);
    res.json(rows.map(r => ({ examId: String(r.examId), subjectId: String(r.subjectId), chapterId: String(r.chapterId) })));
  } catch (e) {
    console.error('pyqs starred chapters list:', e);
    res.status(500).json({ error: 'Failed to get starred chapters' });
  }
});
app.post('/api/pyqs/starred/chapters/:examId/:subjectId/:chapterId', (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    if (!examId || !subjectId || !chapterId) return res.status(400).json({ error: 'examId, subjectId, chapterId required' });
    db.prepare(`
      INSERT INTO starred_pyqs (userId, kind, examId, subjectId, chapterId)
      VALUES (?, 'chapter', ?, ?, ?)
      ON CONFLICT(userId, kind, examId, subjectId, chapterId) DO NOTHING
    `).run(req.userId, String(examId), String(subjectId), String(chapterId));
    res.json({ success: true });
  } catch (e) {
    console.error('pyqs star chapter:', e);
    res.status(500).json({ error: 'Failed to star chapter' });
  }
});
app.delete('/api/pyqs/starred/chapters/:examId/:subjectId/:chapterId', (req, res) => {
  try {
    const { examId, subjectId, chapterId } = req.params;
    db.prepare(`
      DELETE FROM starred_pyqs
      WHERE userId = ? AND kind = 'chapter' AND examId = ? AND subjectId = ? AND chapterId = ?
    `).run(req.userId, String(examId), String(subjectId), String(chapterId));
    res.json({ success: true });
  } catch (e) {
    console.error('pyqs unstar chapter:', e);
    res.status(500).json({ error: 'Failed to unstar chapter' });
  }
});
// Starred assignments
app.get('/api/starred', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT assignmentId FROM starred_assignments WHERE userId = ? ORDER BY created_at DESC`
      )
      .all(req.userId);
    res.json(rows.map((r) => Number(r.assignmentId)));
  } catch (e) {
    console.error('list starred:', e);
    res.status(500).json({ error: 'Failed to get starred assignments' });
  }
});

app.post('/api/starred/:assignmentId', (req, res) => {
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isFinite(assignmentId)) {
      return res.status(400).json({ error: 'Invalid assignmentId' });
    }
    db.prepare(
      `INSERT INTO starred_assignments (userId, assignmentId) VALUES (?, ?)
       ON CONFLICT(userId, assignmentId) DO NOTHING`
    ).run(req.userId, assignmentId);
    res.json({ success: true });
  } catch (e) {
    console.error('star assignment:', e);
    res.status(500).json({ error: 'Failed to star assignment' });
  }
});

app.delete('/api/starred/:assignmentId', (req, res) => {
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isFinite(assignmentId)) {
      return res.status(400).json({ error: 'Invalid assignmentId' });
    }
    db.prepare(
      `DELETE FROM starred_assignments WHERE userId = ? AND assignmentId = ?`
    ).run(req.userId, assignmentId);
    res.json({ success: true });
  } catch (e) {
    console.error('unstar assignment:', e);
    res.status(500).json({ error: 'Failed to unstar assignment' });
  }
});

// State & scores
app.get('/api/state/:assignmentId', (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const row = db.prepare('SELECT state FROM states WHERE userId = ? AND assignmentId = ?')
                .get(req.userId, assignmentId);
  const state = row ? JSON.parse(row.state) : [];
  res.json(Array.isArray(state) ? state : []);
});

app.post('/api/state/:assignmentId', async (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const state = req.body?.state ?? [];

  const stateText = JSON.stringify(state);
  db.prepare(`
    INSERT INTO states (userId, assignmentId, state)
    VALUES (?, ?, ?)
    ON CONFLICT(userId, assignmentId) DO UPDATE SET state = excluded.state
  `).run(req.userId, assignmentId, stateText);

  try {
    const { score, maxScore } = await computeAssignmentScore(assignmentId, state);
    db.prepare(`
      INSERT INTO assignment_scores (userId, assignmentId, score, maxScore)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(userId, assignmentId) DO UPDATE SET score = excluded.score, maxScore = excluded.maxScore
    `).run(req.userId, assignmentId, score, maxScore);
  } catch (e) {
    console.warn('Score computation failed:', e);
  }

  res.json({ success: true });
});

app.get('/api/scores', async (req, res) => {
  const scoreRows = db.prepare('SELECT assignmentId, score, maxScore FROM assignment_scores WHERE userId = ?')
                      .all(req.userId);
  const stateRows  = db.prepare('SELECT assignmentId, state FROM states WHERE userId = ?')
                      .all(req.userId);

  const scoresMap = new Map();
  for (const r of scoreRows) scoresMap.set(r.assignmentId, { score: r.score, maxScore: r.maxScore });

  const result = {};
  const seen = new Set();

  for (const { assignmentId, state } of stateRows) {
    const parsed = safeParseJSON(state, []);
    const { attempted, totalQuestions } = await computeAttempted(assignmentId, parsed);
    const base = scoresMap.get(assignmentId) || { score: 0, maxScore: totalQuestions * 4 };
    result[assignmentId] = { ...base, attempted, totalQuestions };
    seen.add(assignmentId);
  }
  for (const [assignmentId, base] of scoresMap.entries()) {
    if (seen.has(assignmentId)) continue;
    const { attempted, totalQuestions } = await computeAttempted(assignmentId, []);
    result[assignmentId] = { ...base, attempted, totalQuestions };
  }
  res.json(result);
});

// Delete account (cascade via FKs)
app.delete('/account', (req, res) => {
  try {
    // 1) Remove all uploaded images owned by this user (filenames prefixed with `${userId}-`)
    try {
      const prefix = `${req.userId}-`;
      const files = fs.readdirSync(uploadsDir);
      for (const f of files) {
        try {
          if (typeof f === 'string' && f.startsWith(prefix)) {
            const p = path.join(uploadsDir, f);
            if (fs.existsSync(p)) fs.unlinkSync(p);
          }
        } catch (e) {
          console.warn('Failed to delete user image', f, e?.message || e);
        }
      }
    } catch (e) {
      console.warn('Error while cleaning user images:', e?.message || e);
    }

    // 2) Delete the user (cascades DB rows via FKs)
    db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
    res.json({ success: true });
  } catch (e) {
    console.error('delete account:', e);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Change password
app.patch('/account/password', (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const row = db.prepare('SELECT id, password_hash, force_pw_reset FROM users WHERE id = ?').get(req.userId);
    if (!row) return res.status(400).json({ error: 'User not found' });
    const isForced = !!row.force_pw_reset;
    if (!isForced) {
      // Normal change: require current password verification
      if (!row.password_hash) return res.status(400).json({ error: 'No password set' });
      if (!verifyPassword(String(currentPassword || ''), row.password_hash)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }
    const newHash = hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, force_pw_reset = 0 WHERE id = ?').run(newHash, req.userId);
    res.json({ success: true, forced: isForced });
  } catch (e) {
    console.error('change password:', e);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Configure/clear Marks App authentication token (GetMarks)
app.get('/account/marks-auth', auth, (req, res) => {
  try {
    const row = db.prepare('SELECT getmarks_token FROM users WHERE id = ?').get(req.userId);
    const has = !!(row?.getmarks_token && String(row.getmarks_token).trim());
    res.json({ hasToken: has });
  } catch (e) {
    console.error('get marks-auth:', e);
    res.status(500).json({ error: 'Failed to load marks auth' });
  }
});

app.patch('/account/marks-auth', auth, (req, res) => {
  try {
    const token = String(req.body?.bearerToken || req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Token is required' });
    db.prepare('UPDATE users SET getmarks_token = ? WHERE id = ?').run(token, req.userId);
    res.json({ success: true });
  } catch (e) {
    console.error('set marks-auth:', e);
    res.status(500).json({ error: 'Failed to save marks auth' });
  }
});

app.delete('/account/marks-auth', auth, (req, res) => {
  try {
    db.prepare('UPDATE users SET getmarks_token = NULL WHERE id = ?').run(req.userId);
    res.json({ success: true });
  } catch (e) {
    console.error('clear marks-auth:', e);
    res.status(500).json({ error: 'Failed to clear marks auth' });
  }
});

// ---------- Scoring helpers ----------
async function computeAssignmentScore(assignmentId, stateArray) {
  try {
    const assignment = await loadAssignment(assignmentId);
    const display = assignment.questions.filter(q => q.qType !== 'Passage');
    const maxScore = display.length * 4;
    let score = 0;
    for (let i = 0; i < display.length; i++) {
      const q = display[i];
      const st = Array.isArray(stateArray) ? (stateArray[i] || {}) : {};
      score += scoreQuestion(q, st);
    }
    return { score, maxScore };
  } catch {
    return { score: 0, maxScore: 0 };
  }
}

function scoreQuestion(q, st) {
  const unanswered = !st || (!st.isAnswerPicked &&
    st.pickedNumerical === undefined &&
    (!Array.isArray(st.pickedAnswers) || st.pickedAnswers.length === 0) &&
    !st.pickedAnswer);
  if (unanswered) return 0;

  if (q.qType === 'SMCQ') {
    const correct = String(q.qAnswer).trim().toUpperCase();
    const picked  = String(st.pickedAnswer || '').trim().toUpperCase();
    return picked && picked === correct ? 4 : -1;
  }
  if (q.qType === 'MMCQ') {
    const correctSet = new Set((Array.isArray(q.qAnswer) ? q.qAnswer : [q.qAnswer]).map(x => String(x).trim().toUpperCase()));
    const pickedSet  = new Set((Array.isArray(st.pickedAnswers) ? st.pickedAnswers : []).map(x => String(x).trim().toUpperCase()));
    for (const p of pickedSet) if (!correctSet.has(p)) return -1;
    const hits = [...pickedSet].filter(x => correctSet.has(x)).length;
    if (hits === correctSet.size && pickedSet.size === correctSet.size) return 4;
    if (hits > 0) return hits;
    return -1;
  }
  if (q.qType === 'Numerical') {
    const ans = Number(q.qAnswer);
    const user = st.pickedNumerical;
    if (typeof user === 'number' && !Number.isNaN(ans)) return user === ans ? 4 : -1;
    return 0;
  }
  return 0;
}

async function computeAttempted(assignmentId, stateArray) {
  try {
    const assignment = await loadAssignment(assignmentId);
    const display = assignment.questions.filter(q => q.qType !== 'Passage');
    const totalQuestions = display.length;
    let attempted = 0;
    for (let i = 0; i < totalQuestions; i++) {
      const st = Array.isArray(stateArray) ? (stateArray[i] || {}) : {};
      const answered = !!(st.isAnswerPicked ||
        (Array.isArray(st.pickedAnswers) && st.pickedAnswers.length) ||
        st.pickedAnswer ||
        (typeof st.pickedNumerical === 'number'));
      if (answered) attempted++;
    }
    return { attempted, totalQuestions };
  } catch {
    return { attempted: 0, totalQuestions: 0 };
  }
}

function safeParseJSON(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
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
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
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

app.post('/api/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(req.file.filename)}`;
    res.json({ url });
  } catch (e) {
    console.error('upload-image:', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Delete an uploaded image by filename (must belong to the authenticated user)
app.delete('/api/upload-image/:filename', (req, res) => {
  try {
    const raw = String(req.params.filename || '');
    const fname = path.basename(raw); // prevent path traversal
    if (!fname) return res.status(400).json({ error: 'Missing filename' });
    // Filenames are formatted as `${userId}-${Date.now()}-${nanoid(8)}.ext`
    // Ensure the caller owns this file
    if (!fname.startsWith(`${req.userId}-`)) {
      return res.status(403).json({ error: 'Not allowed to delete this file' });
    }
    const filePath = path.join(uploadsDir, fname);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.error('delete upload:', e);
      return res.status(500).json({ error: 'Failed to delete image' });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('delete upload fatal:', e);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});
