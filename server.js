// server.js (SQLite version)
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// If frontend runs on the same origin, you can disable CORS. Otherwise set origin correctly.
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- SQLite setup ---
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

// --- Login route (username only) ---
app.post('/login', (req, res) => {
  const { username } = req.body || {};
  if (!username || username.trim().length < 2) {
    return res.status(400).json({ error: 'Username too short' });
  }
  const uname = username.trim();

  const getUserByName = db.prepare('SELECT id, username FROM users WHERE username = ?');
  let user = getUserByName.get(uname);
  if (!user) {
    const id = nanoid();
    db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(id, uname);
    user = { id, username: uname };
  }

  res.cookie('userId', user.id, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax'
  });
  res.json({ success: true, user });
});

// --- Who am I? ---
app.get('/me', (req, res) => {
  const userId = req.cookies.userId;
  if (!userId) return res.json(null);
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  res.json(user || null);
});

// --- Logout ---
app.post('/logout', (req, res) => {
  res.clearCookie('userId', { path: '/' });
  res.json({ success: true });
});

// --- Auth middleware ---
app.use((req, res, next) => {
  const userId = req.cookies.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in' });
  req.userId = userId;
  next();
});

// --- Delete my account ---
app.delete('/account', (req, res) => {
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
    res.clearCookie('userId', { path: '/' });
    res.json({ success: true });
  } catch (e) {
    console.error('Delete account failed:', e);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// --- Bookmark API endpoints ---

// Get all bookmark tags for user
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
    console.error('Failed to get bookmark tags:', e);
    res.status(500).json({ error: 'Failed to get bookmark tags' });
  }
});

// Create new bookmark tag
app.post('/api/bookmark-tags', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    
    const tagName = name.trim();
    const tagId = nanoid();
    
    db.prepare('INSERT INTO bookmark_tags (id, userId, name) VALUES (?, ?, ?)').run(tagId, req.userId, tagName);
    
    const newTag = db.prepare('SELECT id, name, created_at FROM bookmark_tags WHERE id = ?').get(tagId);
    res.json(newTag);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ error: 'Tag name already exists' });
    } else {
      console.error('Failed to create bookmark tag:', e);
      res.status(500).json({ error: 'Failed to create bookmark tag' });
    }
  }
});

// Add bookmark
app.post('/api/bookmarks', (req, res) => {
  try {
    const { assignmentId, questionIndex, tagId } = req.body;
    
    if (!assignmentId || questionIndex === undefined || !tagId) {
      return res.status(400).json({ error: 'assignmentId, questionIndex, and tagId are required' });
    }
    
    const bookmarkId = nanoid();
    db.prepare(`
      INSERT INTO bookmarks (id, userId, assignmentId, questionIndex, tagId) 
      VALUES (?, ?, ?, ?, ?)
    `).run(bookmarkId, req.userId, assignmentId, questionIndex, tagId);
    
    res.json({ success: true, id: bookmarkId });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ error: 'Question already bookmarked with this tag' });
    } else {
      console.error('Failed to add bookmark:', e);
      res.status(500).json({ error: 'Failed to add bookmark' });
    }
  }
});

// Remove bookmark
app.delete('/api/bookmarks/:assignmentId/:questionIndex/:tagId', (req, res) => {
  try {
    const { assignmentId, questionIndex, tagId } = req.params;
    
    db.prepare(`
      DELETE FROM bookmarks 
      WHERE userId = ? AND assignmentId = ? AND questionIndex = ? AND tagId = ?
    `).run(req.userId, assignmentId, questionIndex, tagId);
    
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to remove bookmark:', e);
    res.status(500).json({ error: 'Failed to remove bookmark' });
  }
});

// Get all bookmarks for user
app.get('/api/bookmarks', (req, res) => {
  try {
    const bookmarks = db.prepare(`
      SELECT b.id, b.assignmentId, b.questionIndex, b.created_at,
             bt.id as tagId, bt.name as tagName
      FROM bookmarks b
      JOIN bookmark_tags bt ON b.tagId = bt.id
      WHERE b.userId = ?
      ORDER BY bt.name = 'Doubt' DESC, bt.name ASC, b.created_at DESC
    `).all(req.userId);
    
    res.json(bookmarks);
  } catch (e) {
    console.error('Failed to get bookmarks:', e);
    res.status(500).json({ error: 'Failed to get bookmarks' });
  }
});

// Check if question is bookmarked
app.get('/api/bookmarks/:assignmentId/:questionIndex', (req, res) => {
  try {
    const { assignmentId, questionIndex } = req.params;
    
    const bookmarks = db.prepare(`
      SELECT b.tagId, bt.name as tagName
      FROM bookmarks b
      JOIN bookmark_tags bt ON b.tagId = bt.id
      WHERE b.userId = ? AND b.assignmentId = ? AND b.questionIndex = ?
    `).all(req.userId, assignmentId, questionIndex);
    
    res.json(bookmarks);
  } catch (e) {
    console.error('Failed to check bookmarks:', e);
    res.status(500).json({ error: 'Failed to check bookmarks' });
  }
});

// --- Load state ---
app.get('/api/state/:assignmentId', (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const row = db
    .prepare('SELECT state FROM states WHERE userId = ? AND assignmentId = ?')
    .get(req.userId, assignmentId);
  // stored as TEXT; parse to JSON
  const state = row ? JSON.parse(row.state) : [];
  res.json(Array.isArray(state) ? state : []);
});

// --- Save state ---
app.post('/api/state/:assignmentId', (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const state = req.body?.state ?? [];

  const stateText = JSON.stringify(state);
  db.prepare(`
    INSERT INTO states (userId, assignmentId, state)
    VALUES (?, ?, ?)
    ON CONFLICT(userId, assignmentId) DO UPDATE SET state = excluded.state
  `).run(req.userId, assignmentId, stateText);

  // compute and store score
  try {
    const { score, maxScore } = computeAssignmentScore(assignmentId, state);
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

// --- Scores summary for current user ---
app.get('/api/scores', (req, res) => {
  const scoreRows = db
    .prepare('SELECT assignmentId, score, maxScore FROM assignment_scores WHERE userId = ?')
    .all(req.userId);
  const stateRows = db
    .prepare('SELECT assignmentId, state FROM states WHERE userId = ?')
    .all(req.userId);

  const scoresMap = new Map();
  for (const r of scoreRows) scoresMap.set(r.assignmentId, { score: r.score, maxScore: r.maxScore });

  const result = {};
  const seen = new Set();

  // Include any assignments that have state saved
  for (const { assignmentId, state } of stateRows) {
    const parsed = safeParseJSON(state, []);
    const { attempted, totalQuestions } = computeAttempted(assignmentId, parsed);
    const base = scoresMap.get(assignmentId) || { score: 0, maxScore: totalQuestions * 4 };
    result[assignmentId] = { ...base, attempted, totalQuestions };
    seen.add(assignmentId);
  }
  // Also include assignments with score but no state row (edge case)
  for (const [assignmentId, base] of scoresMap.entries()) {
    if (seen.has(assignmentId)) continue;
    const { attempted, totalQuestions } = computeAttempted(assignmentId, []);
    result[assignmentId] = { ...base, attempted, totalQuestions };
  }
  res.json(result);
});

// --- Helpers: scoring ---
function computeAssignmentScore(assignmentId, stateArray) {
  try {
    const assignmentPath = path.join(__dirname, 'public', 'data', 'question_data', String(assignmentId), 'assignment.json');
    const raw = fs.readFileSync(assignmentPath, 'utf-8');
    const assignment = JSON.parse(raw);
    const displayQuestions = assignment.questions.filter(q => q.qType !== 'Passage');
    const maxScore = displayQuestions.length * 4;

    let score = 0;
    for (let i = 0; i < displayQuestions.length; i++) {
      const q = displayQuestions[i];
      const st = Array.isArray(stateArray) ? (stateArray[i] || {}) : {};
      score += scoreQuestion(q, st);
    }
    return { score, maxScore };
  } catch (e) {
    // If anything goes wrong, do not block saving; return neutral score
    return { score: 0, maxScore: 0 };
  }
}

function scoreQuestion(q, st) {
  // Unanswered → 0
  const isUnanswered = !st || (!st.isAnswerPicked && st.pickedNumerical === undefined && (!Array.isArray(st.pickedAnswers) || st.pickedAnswers.length === 0) && !st.pickedAnswer);
  if (isUnanswered) return 0;

  if (q.qType === 'SMCQ') {
    const correct = String(q.qAnswer).trim().toUpperCase();
    const picked = String(st.pickedAnswer || '').trim().toUpperCase();
    return picked && picked === correct ? 4 : -1;
  }
  if (q.qType === 'MMCQ') {
    const correctSet = new Set((Array.isArray(q.qAnswer) ? q.qAnswer : [q.qAnswer]).map(x => String(x).trim().toUpperCase()));
    const pickedSet = new Set((Array.isArray(st.pickedAnswers) ? st.pickedAnswers : []).map(x => String(x).trim().toUpperCase()));
    // any wrong option picked → incorrect
    for (const p of pickedSet) {
      if (!correctSet.has(p)) return -1;
    }
    const intersection = [...pickedSet].filter(x => correctSet.has(x)).length;
    if (intersection === correctSet.size && pickedSet.size === correctSet.size) return 4;
    if (intersection > 0) return intersection; // partial credit as number of correct options picked
    return -1; // picked something but none correct
  }
  if (q.qType === 'Numerical') {
    const ans = Number(q.qAnswer);
    const user = st.pickedNumerical;
    if (typeof user === 'number' && !Number.isNaN(ans)) {
      return user === ans ? 4 : -1;
    }
    return 0; // no answer
  }
  return 0;
}

function computeAttempted(assignmentId, stateArray) {
  try {
    const assignmentPath = path.join(__dirname, 'public', 'data', 'question_data', String(assignmentId), 'assignment.json');
    const raw = fs.readFileSync(assignmentPath, 'utf-8');
    const assignment = JSON.parse(raw);
    const displayQuestions = assignment.questions.filter(q => q.qType !== 'Passage');
    const totalQuestions = displayQuestions.length;
    let attempted = 0;
    for (let i = 0; i < totalQuestions; i++) {
      const st = Array.isArray(stateArray) ? (stateArray[i] || {}) : {};
      const answered = !!(st.isAnswerPicked || (Array.isArray(st.pickedAnswers) && st.pickedAnswers.length) || st.pickedAnswer || (typeof st.pickedNumerical === 'number'));
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

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
