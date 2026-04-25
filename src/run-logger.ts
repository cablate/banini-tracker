/**
 * Run & notification logging — writes to SQLite for Web UI display.
 */
import { getDb } from './db.js';

export interface RunLog {
  id: number;
  label: string;
  started_at: string;
  ended_at: string | null;
  status: 'running' | 'ok' | 'fail' | 'skip';
  posts_found: number;
  posts_new: number;
  error_message: string | null;
  summary: string | null;
}

export function startRun(label: string): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO run_logs (label, started_at, status) VALUES (?, ?, ?)',
  ).run(label, now, 'running');
  return Number(result.lastInsertRowid);
}

export function endRun(
  runId: number,
  status: 'ok' | 'fail' | 'skip',
  details: { postsFound?: number; postsNew?: number; error?: string; summary?: string } = {},
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE run_logs SET
      ended_at = ?, status = ?,
      posts_found = ?, posts_new = ?,
      error_message = ?, summary = ?
    WHERE id = ?
  `).run(
    now, status,
    details.postsFound ?? 0, details.postsNew ?? 0,
    details.error ?? null, details.summary ?? null,
    runId,
  );
}

export function logNotification(
  runId: number,
  channel: string,
  status: 'sent' | 'failed',
  error?: string,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO notification_logs (run_id, channel, status, error_message, sent_at) VALUES (?, ?, ?, ?, ?)',
  ).run(runId, channel, status, error ?? null, now);
}

export function getRecentRuns(limit = 50): RunLog[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM run_logs ORDER BY id DESC LIMIT ?',
  ).all(limit) as RunLog[];
}

export interface NotificationLog {
  id: number;
  run_id: number;
  channel: string;
  status: string;
  error_message: string | null;
  sent_at: string;
}

export function getRecentNotifications(limit = 100): NotificationLog[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM notification_logs ORDER BY id DESC LIMIT ?',
  ).all(limit) as NotificationLog[];
}

export function getNotificationsForRun(runId: number): NotificationLog[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM notification_logs WHERE run_id = ? ORDER BY id',
  ).all(runId) as NotificationLog[];
}
