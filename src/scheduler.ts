import cron from 'node-cron';
import { run } from './pipeline.js';
import { updateTracking } from './tracker.js';
import type { Persona } from './persona.js';

export function startScheduler(activePersona: Persona): void {
  // 早晨補漏：每天 08:00
  cron.schedule('0 8 * * *', () => {
    run({ maxPosts: 3, isDryRun: false, label: '早晨' }, activePersona)
      .catch((err) => console.error('[早晨] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  // 盤中：週一到五 09:00-13:30，每 30 分鐘
  cron.schedule('7,37 9-12 * * 1-5', () => {
    run({ maxPosts: 1, isDryRun: false, label: '盤中' }, activePersona)
      .catch((err) => console.error('[盤中] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  cron.schedule('7 13 * * 1-5', () => {
    run({ maxPosts: 1, isDryRun: false, label: '盤中' }, activePersona)
      .catch((err) => console.error('[盤中] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  // 追蹤更新：週一到五 15:00（收盤後更新預測追蹤）
  cron.schedule('0 15 * * 1-5', () => {
    updateTracking(activePersona.analysis.trackingDays)
      .catch((err) => console.error('[追蹤更新] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  // 盤後：每天晚上 23:03
  cron.schedule('3 23 * * *', () => {
    run({ maxPosts: 3, isDryRun: false, label: '盤後' }, activePersona)
      .catch((err) => console.error('[盤後] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  console.log('=== 巴逆逆排程已啟動 ===');
  console.log('  早晨：每天 08:00（3 篇）');
  console.log('  盤中：週一~五 09:07/09:37/10:07/.../13:07（1 篇）');
  console.log('  追蹤更新：週一~五 15:00（預測追蹤判定）');
  console.log('  盤後：每天 23:03（3 篇）');
  console.log('  按 Ctrl+C 停止\n');
}
