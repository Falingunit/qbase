// server.js — JWT (no cookies) + SQLite + flexible CORS
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import jwt from 'jsonwebtoken';

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
// Your GitHub Pages site hosts the data/ folder
const FRONTEND_ORIGIN = 'https://falingunit.github.io';
const ASSETS_BASE = 'https://falingunit.github.io/qbase';

// For Zoom/in-app browsers, requests still come from the frontend origin.
// But we’ll also allow dev and your nip.io domain for safety.
const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  'http://localhost:3000',
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
    // allow exact matches + any *.github.io page
    const ok =
      ALLOWED_ORIGINS.includes(origin) ||
      /\.github\.io$/.test(new URL(origin).hostname);
    cb(ok ? null : new Error(`Origin ${origin} not allowed by CORS`), ok);
  },
});
app.use(corsFn);
app.options('*', corsFn);

// ---------- Parsers ----------
app.use(express.json());

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
    username TEXT UNIQUE NOT NULL
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
`);

// ---------- Auth helpers ----------
function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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

app.post('/login', (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username || username.trim().length < 2) {
      return res.status(400).json({ error: 'Username too short' });
    }
    const uname = username.trim();

    let user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(uname);
    if (!user) {
      const id = nanoid();
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(id, uname);
      user = { id, username: uname };
    }

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
    const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(String(sub));
    res.json(u || null);
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
