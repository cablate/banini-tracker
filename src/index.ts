/**
 * 巴逆逆（8zz）反指標追蹤器
 *
 *   npm run dev              # 單次執行：Facebook 3 篇
 *   npm run dry              # 只抓取，不呼叫 LLM
 *   npm run market           # 單次盤中模式：FB 1 篇
 *   npm run evening          # 單次盤後模式：FB 3 篇
 *   npm run cron             # 常駐排程：盤中每 30 分 + 盤後 23:00
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import cron from 'node-cron';
import { fetchFacebookPosts, type FacebookPost } from './facebook.js';
import { analyzePosts } from './analyze.js';
import { createNotifiers, type ReportData, type PostSummary } from './notifiers/index.js';
import { filterNewPosts as filterNew, markPostsSeen } from './seen.js';
import { withRetry } from './retry.js';
import { createTranscriber, transcribeVideoPosts, type TranscriberType } from './transcribe.js';
import { recordPredictions, updateTracking } from './tracker.js';
import { getDb } from './db.js';
import { getConfig, initConfigTable, type ConfigKey } from './config-store.js';
import { startWebServer } from './web.js';

// ── Config ──────────────────────────────────────────────────
const FB_PAGE_URL = 'https://www.facebook.com/DieWithoutBang/';
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

const isCronMode = process.argv.includes('--cron');

/** Read config: DB > env > default (getConfig handles all three) */
function env(key: ConfigKey, fallback?: string): string {
  const val = getConfig(key) || fallback;
  if (!val) throw new Error(`Missing config: ${key}`);
  return val;
}

// ── 統一貼文格式 ────────────────────────────────────────────
interface UnifiedPost {
  id: string;
  source: 'facebook';
  text: string;
  timestamp: string;
  likeCount: number;
  replyCount: number;
  url: string;
  mediaType: string;
  mediaUrl: string;
  ocrText: string;
  transcriptText: string;
}

function fromFacebook(p: FacebookPost): UnifiedPost {
  return {
    id: p.id,
    source: 'facebook',
    text: p.text,
    ocrText: p.ocrText,
    transcriptText: p.captionText || '',
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
  maxPosts: number;
  isDryRun: boolean;
  label: string;
  since?: string;
  until?: string;
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

  // 啟動預檢：提前警告設定問題，避免跑完抓取才炸
  if (!opts.isDryRun && !getConfig('LLM_API_KEY')) {
    console.warn('⚠ LLM_API_KEY 未設定，AI 分析將會失敗（可用 --dry 跳過分析）');
  }
  const transcriberType = (getConfig('TRANSCRIBER') || 'noop') as TranscriberType;
  if (transcriberType === 'groq' && !getConfig('GROQ_API_KEY')) {
    console.warn('⚠ TRANSCRIBER=groq 但 GROQ_API_KEY 未設定，影片轉錄將會失敗');
  }

  const allPosts: UnifiedPost[] = [];

  // 1. 抓取 Facebook（含 retry）
  try {
    const fetchOpts = (opts.since || opts.until) ? { since: opts.since, until: opts.until } : undefined;
    const fbPosts = await withRetry(
      () => fetchFacebookPosts(FB_PAGE_URL, apifyToken, opts.maxPosts, fetchOpts),
      { label: 'Facebook', maxRetries: 2, baseDelayMs: 5000 },
    );
    allPosts.push(...fbPosts.map(fromFacebook));
  } catch (err) {
    console.error(`[Facebook] 抓取失敗: ${err instanceof Error ? err.message : err}`);
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

  // 2.5. 影片轉錄（captionText 有值則跳過 Groq）
  const transcriber = createTranscriber(transcriberType);
  if (transcriber.name !== 'noop') {
    const needsTranscribe = newPosts.filter((p) => !p.transcriptText);
    if (needsTranscribe.length > 0) {
      const transcripts = await transcribeVideoPosts(needsTranscribe, transcriber);
      for (const p of needsTranscribe) {
        const result = transcripts.get(p.id);
        if (result) p.transcriptText = result.text;
      }
    }
  }

  // 2.6. 貼文入庫
  try {
    const db = getDb();
    const upsertPost = db.prepare(`
      INSERT INTO posts (id, source, text, ocr_text, transcript_text, media_type, media_url, url, like_count, comment_count, post_timestamp, fetched_at)
      VALUES (@id, @source, @text, @ocr_text, @transcript_text, @media_type, @media_url, @url, @like_count, @comment_count, @post_timestamp, @fetched_at)
      ON CONFLICT(id) DO UPDATE SET
        transcript_text = CASE WHEN excluded.transcript_text != '' THEN excluded.transcript_text ELSE posts.transcript_text END,
        like_count = excluded.like_count,
        comment_count = excluded.comment_count
    `);
    const now = new Date().toISOString();
    const insertMany = db.transaction(() => {
      for (const p of newPosts) {
        upsertPost.run({
          id: p.id,
          source: p.source,
          text: p.text,
          ocr_text: p.ocrText,
          transcript_text: p.transcriptText,
          media_type: p.mediaType,
          media_url: p.mediaUrl,
          url: p.url,
          like_count: p.likeCount,
          comment_count: p.replyCount,
          post_timestamp: p.timestamp,
          fetched_at: now,
        });
      }
    });
    insertMany();
    console.log(`[DB] 已存入 ${newPosts.length} 篇貼文`);
  } catch (err) {
    console.error(`[DB] 貼文入庫失敗: ${err instanceof Error ? err.message : err}`);
  }

  // 按時間從新到舊排序
  newPosts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // 標記當天貼文
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }); // YYYY-MM-DD
  const isToday = (ts: string) => {
    const postDate = new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    return postDate === todayStr;
  };

  const fbCount = newPosts.length;
  const todayCount = newPosts.filter((p) => isToday(p.timestamp)).length;
  console.log(`發現 ${newPosts.length} 篇新貼文（FB: ${fbCount}, 今日: ${todayCount}）\n`);

  markPostsSeen(newPosts.map((p) => p.id));

  // 4. 印出貼文
  for (const p of newPosts) {
    const tag = 'FB';
    const todayTag = isToday(p.timestamp) ? ' [今天]' : '';
    const localTime = new Date(p.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    console.log(`--- [${tag}]${todayTag} ${localTime} [${p.mediaType}] ---`);
    console.log(p.text || '（無文字，可能是純圖片）');
    if (p.transcriptText) console.log(`[影片轉錄] ${p.transcriptText}`);
    if (p.mediaUrl) console.log(`媒體: ${p.mediaUrl}`);
    console.log(`讚: ${p.likeCount} | 回覆: ${p.replyCount} | ${p.url}\n`);
  }

  if (opts.isDryRun) {
    console.log('[Dry Run] 跳過 AI 分析');
    return;
  }

  // 5. AI 分析
  const textsForAnalysis = newPosts
    .filter((p) => p.text.trim().length > 0 || p.ocrText.trim().length > 0 || p.transcriptText.trim().length > 0)
    .map((p) => {
      const tag = 'Facebook';
      const localTime = new Date(p.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      let content = `[${tag}] ${p.text}`;
      if (p.ocrText) content += `\n[圖片 OCR] ${p.ocrText}`;
      if (p.transcriptText) content += `\n[影片轉錄] ${p.transcriptText}`;
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

  // 7. 多平台通知
  const notifiers = createNotifiers();
  if (notifiers.length > 0) {
    const postSummaries: PostSummary[] = newPosts.map((p) => ({
      source: p.source,
      timestamp: new Date(p.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      isToday: isToday(p.timestamp),
      text: p.text.slice(0, 60),
      url: p.url,
    }));
    const reportData: ReportData = {
      analysis,
      postCount: { fb: fbCount },
      posts: postSummaries,
      isFallback: llmFailed,
    };

    const results = await Promise.allSettled(
      notifiers.map((n) =>
        withRetry(() => n.send(reportData), { label: n.name, maxRetries: 3, baseDelayMs: 3000 }),
      ),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        console.log(`[${notifiers[i].name}] 通知已發送`);
      } else {
        console.error(`[${notifiers[i].name}] 發送失敗（已重試 3 次）: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      }
    }
  } else {
    console.log('[通知] 未設定任何通知管道，跳過');
  }

  // 8. 預測追蹤記錄
  if (analysis.hasInvestmentContent && !llmFailed) {
    try {
      const postInfos = newPosts.map((p) => ({
        id: p.id,
        url: p.url,
        timestamp: p.timestamp,
      }));
      const count = await recordPredictions(analysis, postInfos);
      if (count > 0) console.log(`[tracker] 已記錄 ${count} 筆預測`);
    } catch (err) {
      console.error(`[tracker] 記錄預測失敗: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 9. 存檔
  mkdirSync(DATA_DIR, { recursive: true });
  const outFile = join(DATA_DIR, `report-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`);
  writeFileSync(outFile, JSON.stringify({ timestamp: new Date().toISOString(), posts: newPosts, analysis }, null, 2), 'utf-8');
  console.log(`結果已存檔: ${outFile}`);
}

// ── 入口 ────────────────────────────────────────────────────
// 初始化 config table（確保 DB schema ready）
initConfigTable();

if (isCronMode) {
  // 啟動 Web 設定頁面
  startWebServer();
  // 早晨補漏：每天 08:00
  cron.schedule('0 8 * * *', () => {
    run({ maxPosts: 3, isDryRun: false, label: '早晨' })
      .catch((err) => console.error('[早晨] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  // 盤中：週一到五 09:00-13:30，每 30 分鐘
  cron.schedule('7,37 9-12 * * 1-5', () => {
    run({ maxPosts: 1, isDryRun: false, label: '盤中' })
      .catch((err) => console.error('[盤中] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  cron.schedule('7 13 * * 1-5', () => {
    run({ maxPosts: 1, isDryRun: false, label: '盤中' })
      .catch((err) => console.error('[盤中] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  // 追蹤更新：週一到五 15:00（收盤後更新預測追蹤）
  cron.schedule('0 15 * * 1-5', () => {
    updateTracking()
      .catch((err) => console.error('[追蹤更新] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  // 盤後：每天晚上 23:03
  cron.schedule('3 23 * * *', () => {
    run({ maxPosts: 3, isDryRun: false, label: '盤後' })
      .catch((err) => console.error('[盤後] 執行失敗:', err));
  }, { timezone: 'Asia/Taipei' });

  console.log('=== 巴逆逆排程已啟動 ===');
  console.log('  早晨：每天 08:00（3 篇）');
  console.log('  盤中：週一~五 09:07/09:37/10:07/.../13:07（1 篇）');
  console.log('  追蹤更新：週一~五 15:00（預測追蹤判定）');
  console.log('  盤後：每天 23:03（3 篇）');
  console.log('  按 Ctrl+C 停止\n');

} else {
  // 單次執行模式
  const isDryRun = process.argv.includes('--dry');
  const maxPostsArg = process.argv.find((a) => a.startsWith('--max-posts='));
  const maxPosts = maxPostsArg ? parseInt(maxPostsArg.split('=')[1], 10) : 3;

  run({ maxPosts, isDryRun, label: '手動' }).catch((err) => {
    console.error('執行失敗:', err);
    process.exit(1);
  });
}
