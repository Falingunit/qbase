// Migrate legacy users to real passwords derived from the old algorithm
// Usage: node scripts/migrate-legacy-passwords.js

import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'server.js').endsWith('server.js')
  ? path.join(__dirname, '..', 'db.sqlite')
  : path.join(__dirname, 'db.sqlite');

function deriveLegacyPassword(usernameRaw) {
  const s = String(usernameRaw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!s) return 'default123';
  const len = s.length;
  const firstTwo = s.slice(0, 2);
  const lastTwo = s.slice(-2);
  return `${firstTwo}${lastTwo}${len}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(password), salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

function ensureColumns(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  const hasPw = cols.some((c) => String(c.name).toLowerCase() === 'password_hash');
  if (!hasPw) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  const hasForce = cols.some((c) => String(c.name).toLowerCase() === 'force_pw_reset');
  if (!hasForce) db.exec('ALTER TABLE users ADD COLUMN force_pw_reset INTEGER DEFAULT 0');
}

function main() {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  ensureColumns(db);

  const users = db
    .prepare("SELECT id, username FROM users WHERE password_hash IS NULL OR password_hash = ''")
    .all();
  if (!users.length) {
    console.log('No legacy users found without password_hash.');
    return;
  }
  const update = db.prepare('UPDATE users SET password_hash = ?, force_pw_reset = 1 WHERE id = ?');
  let count = 0;
  const tx = db.transaction((batch) => {
    for (const u of batch) {
      const legacy = deriveLegacyPassword(u.username);
      const pwHash = hashPassword(legacy);
      update.run(pwHash, u.id);
      count++;
    }
  });
  tx(users);
  console.log(`Migrated ${count} user(s). They will be prompted to change password on next login.`);
}

main();

