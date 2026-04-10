import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';

const DATA_DIR = process.env.DATA_DIR || join(homedir(), '.banini-tracker');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(DATA_DIR, { recursive: true });

  const dbPath = join(DATA_DIR, 'banini.db');
  const instance = new Database(dbPath);

  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');

  migrate(instance);

  // 只在 migrate 成功後才設值
  db = instance;

  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'facebook',
      text TEXT NOT NULL DEFAULT '',
      ocr_text TEXT NOT NULL DEFAULT '',
      transcript_text TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'text',
      media_url TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      like_count INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      post_timestamp TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT NOT NULL,
      post_url TEXT,
      symbol_name TEXT NOT NULL,
      symbol_code TEXT,
      symbol_type TEXT NOT NULL,
      her_action TEXT NOT NULL,
      reverse_view TEXT NOT NULL,
      confidence TEXT NOT NULL,
      reasoning TEXT,
      base_price REAL,
      created_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'tracking',
      completed_at TEXT,
      next_prediction_id INTEGER REFERENCES predictions(id),
      UNIQUE(post_id, symbol_name)
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      day_number INTEGER NOT NULL,
      date TEXT NOT NULL,
      open_price REAL NOT NULL,
      high_price REAL NOT NULL,
      low_price REAL NOT NULL,
      close_price REAL NOT NULL,
      change_pct_close REAL NOT NULL,
      change_pct_high REAL NOT NULL,
      change_pct_low REAL NOT NULL,
      UNIQUE(prediction_id, date)
    );
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
