/**
 * banini-tracker runtime entrypoint.
 *
 *   npm run dev              # 單次執行：Facebook 3 篇
 *   npm run dry              # 只抓取，不呼叫 LLM
 *   npm run market           # 單次盤中模式：FB 1 篇
 *   npm run evening          # 單次盤後模式：FB 3 篇
 *   npm run cron             # 常駐排程：盤中每 30 分 + 盤後 23:00
 */
import 'dotenv/config';
import { initConfigTable } from './config-store.js';
import { getPersonaPathArg, loadPersona } from './persona.js';
import { run } from './pipeline.js';
import { startScheduler } from './scheduler.js';
import { startWebServer } from './web.js';

initConfigTable();

const activePersona = loadPersona(getPersonaPathArg());
const isCronMode = process.argv.includes('--cron');

if (isCronMode) {
  startWebServer();
  startScheduler(activePersona);
} else {
  const isDryRun = process.argv.includes('--dry');
  const maxPostsArg = process.argv.find((arg) => arg.startsWith('--max-posts='));
  const maxPosts = maxPostsArg ? parseInt(maxPostsArg.split('=')[1], 10) : 3;

  run({ maxPosts, isDryRun, label: '手動' }, activePersona).catch((err) => {
    console.error('執行失敗:', err);
    process.exit(1);
  });
}
