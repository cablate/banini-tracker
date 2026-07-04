import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { calculateStats } from '../src/stats.js';

type WeeklyRow = {
  id: number;
  created_at: string;
  symbol_name: string;
  her_action: string;
  reverse_view: string;
  status: string;
};

type WeeklyReport = {
  dbPath: string;
  outputPath: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  newPredictions: number;
  activeTracking: number;
  winRate: string;
  latest: WeeklyRow[];
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortDate(value: string): string {
  return value.slice(0, 10);
}

function statusLabel(status: string): string {
  if (status === 'tracking') return '追蹤中';
  if (status === 'completed') return '已完成';
  if (status === 'superseded') return '已取代';
  if (status === 'unmappable') return '無法映射';
  return status;
}

function buildReport(dbPath: string, outputPath: string): WeeklyReport {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const stats = calculateStats(db, dbPath, 3);
    const windowEnd = stats.period.maxCreatedAt ?? new Date().toISOString();
    const endMs = new Date(windowEnd).getTime();
    const windowStart = new Date(endMs - 7 * 24 * 60 * 60 * 1000).toISOString();

    const newPredictions = (db.prepare(`
      SELECT COUNT(*) AS count
      FROM predictions
      WHERE created_at >= ? AND created_at <= ?
    `).get(windowStart, windowEnd) as { count: number }).count;

    const activeTracking = (db.prepare(`
      SELECT COUNT(*) AS count
      FROM predictions
      WHERE status = 'tracking'
    `).get() as { count: number }).count;

    const latest = db.prepare(`
      SELECT id, created_at, symbol_name, her_action, reverse_view, status
      FROM predictions
      ORDER BY created_at DESC, id ASC
      LIMIT 3
    `).all() as WeeklyRow[];

    const primary = stats.thresholds.find((item) => item.thresholdPct === 1);

    return {
      dbPath,
      outputPath,
      generatedAt: new Date().toISOString(),
      windowStart,
      windowEnd,
      newPredictions,
      activeTracking,
      winRate: primary ? `${primary.winRate.toFixed(1)}% (${primary.hits}/${primary.sample})` : '-',
      latest,
    };
  } finally {
    db.close();
  }
}

function renderSvg(report: WeeklyReport): string {
  const latestLines = report.latest.map((row, index) => {
    const y = 354 + index * 42;
    const text = `${shortDate(row.created_at)} ${row.symbol_name}｜${row.her_action} → ${row.reverse_view}｜${statusLabel(row.status)}`;
    return `<text x="56" y="${y}" font-size="22" fill="#1f2937">${escapeXml(text)}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">banini-tracker weekly report</title>
  <desc id="desc">Weekly reverse-indicator report generated from the public SQLite dataset.</desc>
  <rect width="1200" height="630" fill="#f8fafc"/>
  <rect x="32" y="32" width="1136" height="566" rx="24" fill="#ffffff" stroke="#d1d5db"/>
  <text x="56" y="92" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#111827">banini-tracker 每週戰報</text>
  <text x="56" y="132" font-family="Arial, sans-serif" font-size="18" fill="#4b5563">資料週期 ${escapeXml(shortDate(report.windowStart))} - ${escapeXml(shortDate(report.windowEnd))}｜產生 ${escapeXml(shortDate(report.generatedAt))}</text>

  <g font-family="Arial, sans-serif">
    <rect x="56" y="176" width="320" height="72" rx="12" fill="#ecfeff" stroke="#a5f3fc"/>
    <text x="80" y="204" font-size="18" fill="#0f766e">本期新預測</text>
    <text x="80" y="234" font-size="32" font-weight="700" fill="#0f172a">${report.newPredictions}</text>

    <rect x="440" y="176" width="320" height="72" rx="12" fill="#fef3c7" stroke="#fde68a"/>
    <text x="464" y="204" font-size="18" fill="#92400e">追蹤中</text>
    <text x="464" y="234" font-size="32" font-weight="700" fill="#0f172a">${report.activeTracking}</text>

    <rect x="824" y="176" width="320" height="72" rx="12" fill="#eef2ff" stroke="#c7d2fe"/>
    <text x="848" y="204" font-size="18" fill="#4338ca">累計勝率（±1%）</text>
    <text x="848" y="234" font-size="32" font-weight="700" fill="#0f172a">${escapeXml(report.winRate)}</text>

    <text x="56" y="310" font-size="24" font-weight="700" fill="#111827">最新 3 筆預測</text>
    ${latestLines.join('\n    ')}
    <text x="56" y="536" font-size="18" fill="#6b7280">娛樂為主，數據為證。不構成投資建議。</text>
    <text x="56" y="568" font-size="18" fill="#6b7280">github.com/cablate/banini-tracker</text>
  </g>
</svg>
`;
}

function renderMarkdown(report: WeeklyReport): string {
  const rows = report.latest
    .map((row) => `| ${shortDate(row.created_at)} | ${row.symbol_name} | ${row.her_action} | ${row.reverse_view} | ${statusLabel(row.status)} |`)
    .join('\n');

  return [
    '## banini-tracker 每週戰報',
    '',
    `資料週期：${shortDate(report.windowStart)} - ${shortDate(report.windowEnd)}`,
    `本期新預測：${report.newPredictions}`,
    `追蹤中：${report.activeTracking}`,
    `累計勝率（±1%）：${report.winRate}`,
    '',
    '| 日期 | 標的 | 她的動作 | 反向觀點 | 狀態 |',
    '|---|---|---|---|---|',
    rows,
    '',
    `SVG：${report.outputPath}`,
  ].join('\n');
}

const args = process.argv.slice(2);
const dbPath = resolve(args.find((arg) => !arg.startsWith('--')) ?? 'data/banini-public.db');
const outputPath = resolve(args.find((arg) => arg.startsWith('--out='))?.slice('--out='.length) ?? 'assets/weekly-report.svg');
const report = buildReport(dbPath, outputPath);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, renderSvg(report), 'utf-8');
console.log(renderMarkdown(report));
