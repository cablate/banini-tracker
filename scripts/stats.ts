import { resolve } from 'node:path';
import { formatStatsTable, readStats } from '../src/stats.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const pathArg = args.find((arg) => !arg.startsWith('--'));
const dbPath = resolve(pathArg ?? 'data/banini-public.db');
const summary = readStats(dbPath);

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(formatStatsTable(summary));
}
