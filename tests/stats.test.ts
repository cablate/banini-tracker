import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { calculateStats, isThresholdHit } from '../src/stats.js';

function createStatsDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE predictions (
      id INTEGER PRIMARY KEY,
      post_id TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      reverse_view TEXT NOT NULL,
      base_price REAL,
      her_action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE price_snapshots (
      id INTEGER PRIMARY KEY,
      prediction_id INTEGER NOT NULL,
      change_pct_high REAL NOT NULL,
      change_pct_low REAL NOT NULL
    );
  `);

  const insertPrediction = db.prepare(`
    INSERT INTO predictions (id, post_id, symbol_name, reverse_view, base_price, her_action, created_at)
    VALUES (@id, @post_id, @symbol_name, @reverse_view, @base_price, @her_action, @created_at)
  `);
  const insertSnapshot = db.prepare(`
    INSERT INTO price_snapshots (prediction_id, change_pct_high, change_pct_low)
    VALUES (@prediction_id, @change_pct_high, @change_pct_low)
  `);

  const rows = [
    { id: 1, reverse_view: '空', high: 0.2, low: -1.0 },
    { id: 2, reverse_view: '多', high: 1.0, low: -0.2 },
    { id: 3, reverse_view: '空', high: 2.0, low: -0.99 },
    { id: 4, reverse_view: '多', high: 0.99, low: -2.0 },
  ];

  for (const row of rows) {
    insertPrediction.run({
      id: row.id,
      post_id: `p-${row.id}`,
      symbol_name: row.id % 2 === 0 ? '台積電' : '聯發科',
      reverse_view: row.reverse_view,
      base_price: 100,
      her_action: '測試操作',
      created_at: `2026-04-0${row.id}T00:00:00.000Z`,
    });
    insertSnapshot.run({
      prediction_id: row.id,
      change_pct_high: row.high,
      change_pct_low: row.low,
    });
  }

  return db;
}

describe('stats', () => {
  it('counts threshold hits for reverse short and reverse long at the boundary', () => {
    expect(isThresholdHit({ reverse_view: '空', min_low: -1.0, max_high: 0 }, 1)).toBe(true);
    expect(isThresholdHit({ reverse_view: '多', min_low: 0, max_high: 1.0 }, 1)).toBe(true);
    expect(isThresholdHit({ reverse_view: '空', min_low: -0.99, max_high: 2 }, 1)).toBe(false);
    expect(isThresholdHit({ reverse_view: '多', min_low: -2, max_high: 0.99 }, 1)).toBe(false);
  });

  it('calculates summary stats from an in-memory sqlite database', () => {
    const db = createStatsDb();

    try {
      const summary = calculateStats(db, ':memory:', 2);

      expect(summary.totalPredictions).toBe(4);
      expect(summary.trackedSamples).toBe(4);
      expect(summary.symbolCount).toBe(2);
      expect(summary.thresholds[0]).toEqual({
        thresholdPct: 1,
        hits: 2,
        sample: 4,
        winRate: 50,
      });
      expect(summary.directions).toEqual([
        {
          reverseView: '多',
          label: '反向做多（她看空）',
          hits: 1,
          sample: 2,
          winRate: 50,
        },
        {
          reverseView: '空',
          label: '反向做空（她看多/買入）',
          hits: 1,
          sample: 2,
          winRate: 50,
        },
      ]);
      expect(summary.recentPredictions).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});
