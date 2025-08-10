import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'db.sqlite');
const db = new Database(dbPath);

try {
  // Get all users
  const users = db.prepare('SELECT id FROM users').all();
  
  console.log(`Found ${users.length} users`);
  
  let createdCount = 0;
  for (const user of users) {
    try {
      // Check if user already has "Doubt" tag
      const existing = db.prepare('SELECT id FROM bookmark_tags WHERE userId = ? AND name = ?').get(user.id, 'Doubt');
      
      if (!existing) {
        const tagId = nanoid();
        db.prepare('INSERT INTO bookmark_tags (id, userId, name) VALUES (?, ?, ?)').run(tagId, user.id, 'Doubt');
        createdCount++;
        console.log(`Created "Doubt" tag for user ${user.id}`);
      } else {
        console.log(`User ${user.id} already has "Doubt" tag`);
      }
    } catch (e) {
      console.error(`Failed to create "Doubt" tag for user ${user.id}:`, e);
    }
  }
  
  console.log(`Successfully created ${createdCount} "Doubt" tags`);
} catch (e) {
  console.error('Script failed:', e);
} finally {
  db.close();
}
