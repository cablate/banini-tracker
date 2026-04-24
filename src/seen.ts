/**
 * Post dedup: uses SQLite `posts` table as source of truth.
 * Replaces the old file-based seen.json which was fragile
 * (silent JSON parse failure → all posts re-processed).
 */
import { getDb } from './db.js';

export function isPostSeen(id: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM posts WHERE id = ?').get(id);
  return !!row;
}

export function filterNewPosts<T extends { id: string }>(posts: T[]): T[] {
  const db = getDb();
  const stmt = db.prepare('SELECT 1 FROM posts WHERE id = ?');
  return posts.filter((p) => !stmt.get(p.id));
}

/**
 * @deprecated Posts are now marked as seen by inserting into the `posts` table.
 * This function is kept for backward compatibility but is a no-op.
 */
export function markPostsSeen(_ids: string[]): void {
  // no-op: posts are marked seen when inserted into DB (index.ts upsert)
}

export function listSeenIds(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM posts ORDER BY fetched_at DESC LIMIT 500').all() as { id: string }[];
  return rows.map((r) => r.id);
}

export function clearSeen(): void {
  // Dangerous: clears all posts. Kept for CLI compatibility.
  const db = getDb();
  db.prepare('DELETE FROM posts').run();
}
