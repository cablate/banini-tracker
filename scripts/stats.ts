import Database from 'better-sqlite3';
import { resolve } from 'node:path';

type ThresholdStats = {
  thresholdPct: number;
  hits: number;
  sample: number;
  winRate: number;
};

type DirectionStats = {
  reverseView: string;
  label: string;
  hits: number;
  sample: number;
  winRate: number;
};

type PredictionRange = {
  id: number;
  reverse_view: string;
  min_low: number;
  max_high: number;
};

type StatsSummary = {
  generatedAt: string;
  dbPath: string;
  totalPredictions: number;
  trackedSamples: number;
  symbolCount: number;
  period: {
    minCreatedAt: string | null;
    maxCreatedAt: string | null;
  };
  thresholds: ThresholdStats[];
  directions: DirectionStats[];
};

const thresholds = [1, 3, 5];

function isHit(row: PredictionRange, thresholdPct: number): boolean {
  if (row.reverse_view === '空') {
    return row.min_low <= -thresholdPct;
  }
  if (row.reverse_view === '多') {
    return row.max_high >= thresholdPct;
  }
  return false;
}

function pct(hits: number, sample: number): number {
  return sample === 0 ? 0 : Number(((hits / sample) * 100).toFixed(1));
}

function readStats(dbPath: string): StatsSummary {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const meta = db
      .prepare(
        `
        SELECT
          COUNT(*) AS totalPredictions,
          COUNT(DISTINCT symbol_name) AS symbolCount,
          MIN(created_at) AS minCreatedAt,
          MAX(created_at) AS maxCreatedAt
        FROM predictions
        `,
      )
      .get() as {
      totalPredictions: number;
      symbolCount: number;
      minCreatedAt: string | null;
      maxCreatedAt: string | null;
    };

    const rows = db
      .prepare(
        `
        SELECT
          p.id,
          p.reverse_view,
          MIN(s.change_pct_low) AS min_low,
          MAX(s.change_pct_high) AS max_high
        FROM predictions p
        JOIN price_snapshots s ON s.prediction_id = p.id
        WHERE p.base_price IS NOT NULL
        GROUP BY p.id
        `,
      )
      .all() as PredictionRange[];

    const thresholdStats = thresholds.map((thresholdPct) => {
      const hits = rows.filter((row) => isHit(row, thresholdPct)).length;
      return {
        thresholdPct,
        hits,
        sample: rows.length,
        winRate: pct(hits, rows.length),
      };
    });

    const directions = [
      { reverseView: '多', label: '反向做多（她看空）' },
      { reverseView: '空', label: '反向做空（她看多/買入）' },
    ].map(({ reverseView, label }) => {
      const directionRows = rows.filter((row) => row.reverse_view === reverseView);
      const hits = directionRows.filter((row) => isHit(row, 1)).length;
      return {
        reverseView,
        label,
        hits,
        sample: directionRows.length,
        winRate: pct(hits, directionRows.length),
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      dbPath,
      totalPredictions: meta.totalPredictions,
      trackedSamples: rows.length,
      symbolCount: meta.symbolCount,
      period: {
        minCreatedAt: meta.minCreatedAt,
        maxCreatedAt: meta.maxCreatedAt,
      },
      thresholds: thresholdStats,
      directions,
    };
  } finally {
    db.close();
  }
}

function formatTable(summary: StatsSummary): string {
  const lines = [
    `資料庫: ${summary.dbPath}`,
    `涵蓋期間: ${summary.period.minCreatedAt ?? '-'} ~ ${summary.period.maxCreatedAt ?? '-'}`,
    `總預測數: ${summary.totalPredictions}`,
    `有效樣本: ${summary.trackedSamples}`,
    `標的數: ${summary.symbolCount}`,
    '',
    '門檻勝率',
    '| 判定門檻 | 命中 / 樣本 | 反指標勝率 |',
    '|---|---:|---:|',
    ...summary.thresholds.map(
      (item) => `| ±${item.thresholdPct}% | ${item.hits} / ${item.sample} | ${item.winRate.toFixed(1)}% |`,
    ),
    '',
    '分方向勝率（±1%）',
    '| 方向 | 命中 / 樣本 | 勝率 |',
    '|---|---:|---:|',
    ...summary.directions.map((item) => `| ${item.label} | ${item.hits} / ${item.sample} | ${item.winRate.toFixed(1)}% |`),
  ];

  return `${lines.join('\n')}\n`;
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const pathArg = args.find((arg) => !arg.startsWith('--'));
const dbPath = resolve(pathArg ?? 'data/banini-public.db');
const summary = readStats(dbPath);

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(formatTable(summary));
}
