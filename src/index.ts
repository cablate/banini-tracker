/**
 * 巴逆逆（8zz）反指標追蹤器
 *
 *   npm run dev              # 單次執行：Threads + Facebook（各 3 篇）
 *   npm run dry              # 只抓取，不呼叫 LLM
 *   npm run market           # 單次盤中模式：FB only, 1 篇
 *   npm run evening          # 單次盤後模式：Threads + FB, 各 3 篇
 *   npm run cron             # 常駐排程：盤中每 30 分 + 盤後 23:00
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import cron from 'node-cron';
import { fetchThreadsPosts, type ThreadsPost } from './threads.js';
import { fetchFacebookPosts, type FacebookPost } from './facebook.js';
import { analyzePosts } from './analyze.js';
import { sendTelegramMessageWithConfig, formatReport, formatFallbackReport } from './telegram.js';
import { filterNewPosts as filterNew, markPostsSeen } from './seen.js';
import { withRetry } from './retry.js';

// ── Config ──────────────────────────────────────────────────
const THREADS_USERNAME = 'banini31';
const FB_PAGE_URL = 'https://www.facebook.com/DieWithoutBang/';
const DATA_DIR = join(process.cwd(), 'data');

const isCronMode = process.argv.includes('--cron');

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (!val) throw new Error(`Missing env: ${key}`);
  return val;
}

// ── 統一貼文格式 ────────────────────────────────────────────
interface UnifiedPost {
  id: string;
  source: 'threads' | 'facebook';
  text: string;
  timestamp: string;
  likeCount: number;
  replyCount: number;
  url: string;
  mediaType: string;
  mediaUrl: string;
  ocrText: string;
}

function fromThreads(p: ThreadsPost): UnifiedPost {
  return {
    id: p.id,
    source: 'threads',
    text: p.text,
    timestamp: p.timestamp,
    likeCount: p.likeCount,
    replyCount: p.replyCount,
    url: p.url,
    mediaType: p.mediaType,
    mediaUrl: p.mediaUrl,
    ocrText: p.ocrText,
  };
}

function fromFacebook(p: FacebookPost): UnifiedPost {
  return {
    id: p.id,
    source: 'facebook',
    text: p.text,
    ocrText: p.ocrText,
    timestamp: p.timestamp,
    likeCount: p.likeCount,
    replyCount: p.commentCount,
    url: p.url,
    mediaType: p.mediaType,
    mediaUrl: p.mediaUrl,
  };
}

// ── 執行鎖（防止排程重疊）────────────────────────────────
let running = false;

// ── 執行邏輯 ──────────────────────────────────────────────
interface RunOptions {
  fbOnly: boolean;
  threadsOnly: boolean;
  maxPosts: number;
  isDryRun: boolean;
  label: string;
}

async function run(opts: RunOptions) {
  if (running) {
    console.log(`[${opts.label}] 上一次還在跑，跳過本次排程`);
    return;
  }
  running = true;
  try {
    await runInner(opts);
  } finally {
    running = false;
  }
}

async function runInner(opts: RunOptions) {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  console.log(`\n=== 巴逆逆反指標追蹤器 [${opts.label}] ${now} ===\n`);

  const apifyToken = env('APIFY_TOKEN');
  const allPosts: UnifiedPost[] = [];

  // 1. 抓取 Threads（含 retry）
  if (!opts.fbOnly) {
    try {
      const threadsPosts = await withRetry(
        () => fetchThreadsPosts(THREADS_USERNAME, apifyToken, opts.maxPosts),
        { label: 'Threads', maxRetries: 2, baseDelayMs: 5000 },
      );
      allPosts.push(...threadsPosts.map(fromThreads));
    } catch (err) {
      console.error(`[Threads] 抓取失敗: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 2. 抓取 Facebook（含 retry）
  if (!opts.threadsOnly) {
    try {
      const fbPosts = await withRetry(
        () => fetchFacebookPosts(FB_PAGE_URL, apifyToken, opts.maxPosts),
        { label: 'Facebook', maxRetries: 2, baseDelayMs: 5000 },
      );
      allPosts.push(...fbPosts.map(fromFacebook));
    } catch (err) {
      console.error(`[Facebook] 抓取失敗: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (allPosts.length === 0) {
    console.log('沒有抓到任何貼文，結束');
    return;
  }

  // 3. 去重（共用 ~/.banini-tracker/seen.json）
  const newPosts = filterNew(allPosts);

  if (newPosts.length === 0) {
    console.log('沒有新貼文，結束');
    return;
  }

  // 按時間從新到舊排序
  newPosts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // 標記當天貼文
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }); // YYYY-MM-DD
  const isToday = (ts: string) => {
    const postDate = new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    return postDate === todayStr;
  };

  const threadCount = newPosts.filter((p) => p.source === 'threads').length;
  const fbCount = newPosts.filter((p) => p.source === 'facebook').length;
  const todayCount = newPosts.filter((p) => isToday(p.timestamp)).length;
  console.log(`發現 ${newPosts.length} 篇新貼文（Threads: ${threadCount}, FB: ${fbCount}, 今日: ${todayCount}）\n`);

  markPostsSeen(newPosts.map((p) => p.id));

  // 4. 印出貼文
  for (const p of newPosts) {
    const tag = p.source === 'threads' ? 'TH' : 'FB';
    const todayTag = isToday(p.timestamp) ? ' [今天]' : '';
    const localTime = new Date(p.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    console.log(`--- [${tag}]${todayTag} ${localTime} [${p.mediaType}] ---`);
    console.log(p.text || '（無文字，可能是純圖片）');
    if (p.mediaUrl) console.log(`媒體: ${p.mediaUrl}`);
    console.log(`讚: ${p.likeCount} | 回覆: ${p.replyCount} | ${p.url}\n`);
  }

  if (opts.isDryRun) {
    console.log('[Dry Run] 跳過 AI 分析');
    return;
  }

  // 5. AI 分析
  const textsForAnalysis = newPosts
    .filter((p) => p.text.trim().length > 0 || p.ocrText.trim().length > 0)
    .map((p) => {
      const tag = p.source === 'threads' ? 'Threads' : 'Facebook';
      const localTime = new Date(p.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      let content = `[${tag}] ${p.text}`;
      if (p.ocrText) content += `\n[圖片 OCR] ${p.ocrText}`;
      return { text: content, timestamp: localTime, isToday: isToday(p.timestamp) };
    });

  if (textsForAnalysis.length === 0) {
    console.log('所有新貼文都是純圖片，跳過分析');
    return;
  }

  let analysis: Awaited<ReturnType<typeof analyzePosts>>;
  let llmFailed = false;
  try {
    analysis = await withRetry(
      () => analyzePosts(textsForAnalysis, {
        baseUrl: env('LLM_BASE_URL', 'https://api.deepinfra.com/v1/openai'),
        apiKey: env('LLM_API_KEY'),
        model: env('LLM_MODEL', 'MiniMaxAI/MiniMax-M2.5'),
      }),
      { label: 'LLM', maxRetries: 3, baseDelayMs: 5000 },
    );
  } catch (err) {
    console.error(`[LLM] 分析失敗，將推送純貼文摘要: ${err instanceof Error ? err.message : err}`);
    llmFailed = true;
    analysis = { hasInvestmentContent: false, summary: '（LLM 分析失敗，以下為原始貼文）' };
  }

  // 6. 輸出結果
  console.log('========================================');
  console.log('  巴逆逆反指標分析報告');
  console.log('========================================\n');
  console.log(`摘要: ${analysis.summary}`);

  if (analysis.hasInvestmentContent) {
    if (analysis.mentionedTargets?.length) {
      console.log('\n提及標的:');
      for (const t of analysis.mentionedTargets) {
        const arrow = t.reverseView.includes('漲') || t.reverseView.includes('彈') ? '↑' : t.reverseView.includes('跌') ? '↓' : '→';
        console.log(`  ${arrow} ${t.name}（${t.type}）`);
        console.log(`    她的操作: ${t.herAction} → 反指標: ${t.reverseView} [${t.confidence}]`);
        if (t.reasoning) console.log(`    原因: ${t.reasoning}`);
      }
    }
    if (analysis.chainAnalysis) console.log(`\n連鎖推導: ${analysis.chainAnalysis}`);
    if (analysis.actionableSuggestion) console.log(`建議方向: ${analysis.actionableSuggestion}`);
    if (analysis.moodScore) console.log(`\n冥燈指數: ${analysis.moodScore}/10（越高=她越篤定=反指標越強）`);
  } else {
    console.log('（本批貼文與投資無關）');
  }

  console.log('\n--- 僅供娛樂參考，不構成投資建議 ---\n');

  // 7. Telegram 通知
  const tgToken = process.env.TG_BOT_TOKEN;
  const tgChannelId = process.env.TG_CHANNEL_ID;

  if (tgToken && tgChannelId) {
    try {
      const postSummaries = newPosts.map((p) => ({
        source: p.source,
        timestamp: new Date(p.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
        isToday: isToday(p.timestamp),
        text: p.text.slice(0, 60),
        url: p.url,
      }));
      const msg = llmFailed
        ? formatFallbackReport(postSummaries)
        : formatReport(analysis, { threads: threadCount, fb: fbCount }, postSummaries);
      await withRetry(
        () => sendTelegramMessageWithConfig({ botToken: tgToken, channelId: tgChannelId }, msg),
        { label: 'Telegram', maxRetries: 3, baseDelayMs: 3000 },
      );
      console.log('[Telegram] 通知已發送');
    } catch (err) {
      console.error(`[Telegram] 發送失敗（已重試 3 次）: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    console.log('[Telegram] 未設定 TG_BOT_TOKEN / TG_CHANNEL_ID，跳過通知');
  }

  // 8. 存檔
  mkdirSync(DATA_DIR, { recursive: true });
  const outFile = join(DATA_DIR, `report-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`);
  writeFileSync(outFile, JSON.stringify({ timestamp: new Date().toISOString(), posts: newPosts, analysis }, null, 2), 'utf-8');
  console.log(`結果已存檔: ${outFile}`);
}

// ── 入口 ────────────────────────────────────────────────────
if (isCronMode) {
  // 盤中：週一到五 09:00-13:30，每 30 分鐘，FB only 抓 1 篇
  // cron 不支援半小時結束，用 9:00-13:00 每 30 分 + 13:30 單獨一個
  cron.schedule('7,37 9-12 * * 1-5', () => {
    run({ fbOnly: true, threadsOnly: false, maxPosts: 1, isDryRun: false, label: '盤中' })
      .catch((err) => console.error('[盤中] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  cron.schedule('7 13 * * 1-5', () => {
    run({ fbOnly: true, threadsOnly: false, maxPosts: 1, isDryRun: false, label: '盤中' })
      .catch((err) => console.error('[盤中] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  // 盤後：每天晚上 23:00，Threads + FB 各 3 篇
  cron.schedule('3 23 * * *', () => {
    run({ fbOnly: false, threadsOnly: false, maxPosts: 3, isDryRun: false, label: '盤後' })
      .catch((err) => console.error('[盤後] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  console.log('=== 巴逆逆排程已啟動 ===');
  console.log('  盤中：週一~五 09:07/09:37/10:07/.../13:07（FB only, 1 篇）');
  console.log('  盤後：每天 23:03（Threads + FB, 各 3 篇）');
  console.log('  按 Ctrl+C 停止\n');

} else {
  // 單次執行模式
  const isDryRun = process.argv.includes('--dry');
  const threadsOnly = process.argv.includes('--threads-only');
  const fbOnly = process.argv.includes('--fb-only');
  const maxPostsArg = process.argv.find((a) => a.startsWith('--max-posts='));
  const maxPosts = maxPostsArg ? parseInt(maxPostsArg.split('=')[1], 10) : 3;

  run({ fbOnly, threadsOnly, maxPosts, isDryRun, label: '手動' }).catch((err) => {
    console.error('執行失敗:', err);
    process.exit(1);
  });
}
