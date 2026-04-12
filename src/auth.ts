/**
 * Auth module: first-run setup + login + session token.
 * Password hashed with scrypt, session token in memory.
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { getDb } from './db.js';

const SCRYPT_KEYLEN = 64;

/** Ensure auth table exists */
export function initAuthTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);
}

/** Check if initial setup is done */
export function isInitialized(): boolean {
  initAuthTable();
  const db = getDb();
  const row = db.prepare('SELECT id FROM auth WHERE id = 1').get();
  return !!row;
}

/** First-run: create admin account */
export function setupAdmin(username: string, password: string): void {
  if (isInitialized()) throw new Error('already initialized');
  if (!username || !password) throw new Error('username and password required');
  if (password.length < 6) throw new Error('password must be at least 6 characters');

  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  const stored = `${salt}:${hash}`;

  const db = getDb();
  db.prepare('INSERT INTO auth (id, username, password_hash) VALUES (1, ?, ?)').run(username, stored);
}

/** Verify credentials, return session token or null */
export function login(username: string, password: string): string | null {
  initAuthTable();
  const db = getDb();
  const row = db.prepare('SELECT username, password_hash FROM auth WHERE id = 1').get() as
    | { username: string; password_hash: string }
    | undefined;

  if (!row) return null;
  if (row.username !== username) return null;

  const [salt, storedHash] = row.password_hash.split(':');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');

  const storedBuf = Buffer.from(storedHash, 'hex');
  const hashBuf = Buffer.from(hash, 'hex');
  if (!timingSafeEqual(storedBuf, hashBuf)) return null;

  const token = randomBytes(32).toString('hex');
  sessions.set(token, { username, createdAt: Date.now() });
  return token;
}

/** Validate session token */
export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  // 24h expiry
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/** Logout */
export function logout(token: string): void {
  sessions.delete(token);
}

// In-memory session store (container restart = re-login, acceptable)
const sessions = new Map<string, { username: string; createdAt: number }>();
