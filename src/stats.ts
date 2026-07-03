import Database from 'better-sqlite3';

export type ThresholdStats = {
  thresholdPct: number;
  hits: number;
  sample: number;
  winRate: number;
};

export type DirectionStats = {
  reverseView: string;
  label: string;
  hits: number;
  sample: number;
  winRate: number;
};

export type RecentPrediction = {
  id: number;
  createdAt: string;
  symbolName: string;
  herAction: string;
  reverseView: string;
  basePrice: number | null;
  maxFavorableChangePct: number | null;
};

export type StatsSummary = {
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
  recentPredictions: RecentPrediction[];
};

type PredictionRange = {
  id: number;
  reverse_view: string;
  min_low: number;
  max_high: number;
};

type RecentPredictionRow = {
  id: number;
  created_at: string;
  symbol_name: string;
  her_action: string;
  reverse_view: string;
  base_price: number | null;
  min_low: number | null;
  max_high: number | null;
};

const thresholds = [1, 3, 5];

export function isThresholdHit(row: Pick<PredictionRange, 'reverse_view' | 'min_low' | 'max_high'>, thresholdPct: number): boolean {
  if (row.reverse_view === '空') {
    return row.min_low <= -thresholdPct;
  }
  if (row.reverse_view === '多') {
    return row.max_high >= thresholdPct;
  }
  return false;
}

export function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function pct(hits: number, sample: number): number {
  return sample === 0 ? 0 : Number(((hits / sample) * 100).toFixed(1));
}

function favorableChange(row: Pick<RecentPredictionRow, 'reverse_view' | 'min_low' | 'max_high'>): number | null {
  if (row.reverse_view === '空') return row.min_low;
  if (row.reverse_view === '多') return row.max_high;
  return null;
}

export function readStats(dbPath: string, recentLimit = 10): StatsSummary {
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
      const hits = rows.filter((row) => isThresholdHit(row, thresholdPct)).length;
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
      const hits = directionRows.filter((row) => isThresholdHit(row, 1)).length;
      return {
        reverseView,
        label,
        hits,
        sample: directionRows.length,
        winRate: pct(hits, directionRows.length),
      };
    });

    const recentRows = db
      .prepare(
        `
        SELECT
          p.id,
          p.created_at,
          p.symbol_name,
          p.her_action,
          p.reverse_view,
          p.base_price,
          MIN(s.change_pct_low) AS min_low,
          MAX(s.change_pct_high) AS max_high
        FROM predictions p
        LEFT JOIN price_snapshots s ON s.prediction_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ?
        `,
      )
      .all(recentLimit) as RecentPredictionRow[];

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
      recentPredictions: recentRows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        symbolName: row.symbol_name,
        herAction: row.her_action,
        reverseView: row.reverse_view,
        basePrice: row.base_price,
        maxFavorableChangePct: favorableChange(row),
      })),
    };
  } finally {
    db.close();
  }
}

export function formatStatsTable(summary: StatsSummary): string {
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

export function formatDemo(summary: StatsSummary): string {
  const lines = [
    'banini-tracker demo',
    '公開資料集反指標回測',
    '',
    `涵蓋期間: ${summary.period.minCreatedAt ?? '-'} ~ ${summary.period.maxCreatedAt ?? '-'}`,
    `總預測數: ${summary.totalPredictions}，有效樣本: ${summary.trackedSamples}，標的數: ${summary.symbolCount}`,
    '',
    '三檔門檻勝率',
    '| 門檻 | 命中 / 樣本 | 勝率 |',
    '|---|---:|---:|',
    ...summary.thresholds.map((item) => `| ±${item.thresholdPct}% | ${item.hits} / ${item.sample} | ${item.winRate.toFixed(1)}% |`),
    '',
    '最近 10 筆預測',
    '| 日期 | 標的 | 她的動作 | 反向觀點 | 基準價 | 5 日最大有利變動 |',
    '|---|---|---|---|---:|---:|',
    ...summary.recentPredictions.map((item) => {
      const date = item.createdAt.slice(0, 10);
      const basePrice = item.basePrice === null ? '-' : item.basePrice.toFixed(2);
      return `| ${date} | ${item.symbolName} | ${item.herAction} | ${item.reverseView} | ${basePrice} | ${formatPercent(item.maxFavorableChangePct)} |`;
    }),
    '',
    '想追蹤即時貼文？',
    'npx @cablate/banini-tracker serve',
    'https://github.com/cablate/banini-tracker',
  ];

  return `${lines.join('\n')}\n`;
}
