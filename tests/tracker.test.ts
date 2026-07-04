import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { shouldCompleteTracking, supersedePreviousTrackingPrediction } from '../src/tracker.js';

function createTrackerDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol_code TEXT,
      status TEXT NOT NULL DEFAULT 'tracking',
      next_prediction_id INTEGER REFERENCES predictions(id)
    );
  `);
  return db;
}

describe('tracker', () => {
  it('supersedes the previous tracking prediction for the same symbol', () => {
    const db = createTrackerDb();

    try {
      db.prepare('INSERT INTO predictions (id, symbol_code, status) VALUES (?, ?, ?)').run(1, '2330', 'tracking');
      db.prepare('INSERT INTO predictions (id, symbol_code, status) VALUES (?, ?, ?)').run(2, '2330', 'tracking');

      const supersededId = supersedePreviousTrackingPrediction(db, '2330', 2);

      expect(supersededId).toBe(1);
      expect(db.prepare('SELECT status, next_prediction_id FROM predictions WHERE id = 1').get()).toEqual({
        status: 'superseded',
        next_prediction_id: 2,
      });
      expect(db.prepare('SELECT status, next_prediction_id FROM predictions WHERE id = 2').get()).toEqual({
        status: 'tracking',
        next_prediction_id: null,
      });
    } finally {
      db.close();
    }
  });

  it('marks tracking complete after the configured trading-day count', () => {
    expect(shouldCompleteTracking(4)).toBe(false);
    expect(shouldCompleteTracking(5)).toBe(true);
    expect(shouldCompleteTracking(6)).toBe(true);
    expect(shouldCompleteTracking(2, 3)).toBe(false);
    expect(shouldCompleteTracking(3, 3)).toBe(true);
  });
});
