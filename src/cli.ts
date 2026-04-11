#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, saveConfig, defaultConfig, getConfigPath, getSeenFile } from './config.js';
import { fetchFacebookPosts } from './facebook.js';
import { sendTelegramDirect } from './notifiers/index.js';
import { filterNewPosts, markPostsSeen, listSeenIds, clearSeen } from './seen.js';
import { readFileSync } from 'fs';
import { createTranscriber, transcribeVideoPosts, isVideoPost } from './transcribe.js';
import { getDb } from './db.js';

const program = new Command();
program
  .name('banini-tracker')
  .description('巴逆逆反指標追蹤 CLI — 抓取社群貼文、去重、推送 Telegram')
  .version('2.0.0');

// ── init ─────────────────────────────────────────────────
program
  .command('init')
  .description('初始化設定檔（互動式或帶參數）')
  .option('--apify-token <token>', 'Apify API token')
  .option('--tg-bot-token <token>', 'Telegram Bot token')
  .option('--tg-channel-id <id>', 'Telegram Channel ID')
  .option('--fb-page-url <url>', 'Facebook 粉專網址', 'https://www.facebook.com/DieWithoutBang/')
  .option('--groq-api-key <key>', 'Groq API key（影片轉錄用）')
  .action((opts) => {
    const config = defaultConfig();
    if (opts.apifyToken) config.apifyToken = opts.apifyToken;
    if (opts.groqApiKey) config.groqApiKey = opts.groqApiKey;
    if (opts.tgBotToken || opts.tgChannelId) {
      config.telegram = {
        botToken: opts.tgBotToken ?? '',
        channelId: opts.tgChannelId ?? '',
      };
    }
    config.targets.facebookPageUrl = opts.fbPageUrl;
    saveConfig(config);
    console.error(`設定已寫入: ${getConfigPath()}`);
    if (!config.apifyToken) console.error('⚠ apifyToken 尚未設定，請手動編輯設定檔');
  });

// ── config ───────────────────────────────────────────────
program
  .command('config')
  .description('顯示目前設定')
  .action(() => {
    try {
      const config = loadConfig();
      const display = {
        ...config,
        apifyToken: config.apifyToken ? config.apifyToken.slice(0, 10) + '...' : '(未設定)',
        telegram: config.telegram ? {
          botToken: config.telegram.botToken ? config.telegram.botToken.slice(0, 10) + '...' : '(未設定)',
          channelId: config.telegram.channelId || '(未設定)',
        } : '(未設定)',
      };
      console.log(JSON.stringify(display, null, 2));
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── fetch ────────────────────────────────────────────────
program
  .command('fetch')
  .description('抓取最新貼文（輸出 JSON 到 stdout）')
  .option('-s, --source <source>', '來源：fb', 'fb')
  .option('-n, --limit <n>', '每個來源抓幾篇', '3')
  .option('--since <date>', '只抓此時間之後的貼文（YYYY-MM-DD 或 ISO 時間戳或相對時間如 "2 months"）')
  .option('--until <date>', '只抓此時間之前的貼文')
  .option('--no-dedup', '不做去重，抓到什麼就輸出什麼')
  .option('--mark-seen', '輸出後自動標記為已讀')
  .option('--transcribe', '自動轉錄影片（captionText 為空時走 Groq Whisper）')
  .option('--save-db', '抓取後直接存入 SQLite')
  .action(async (opts) => {
    try {
      const config = loadConfig();
      const limit = parseInt(opts.limit, 10);
      let posts: any[] = [];

      const fetchOpts = (opts.since || opts.until) ? { since: opts.since, until: opts.until } : undefined;
      const fp = await fetchFacebookPosts(config.targets.facebookPageUrl, config.apifyToken, limit, fetchOpts);
      posts.push(...fp);

      // 按時間從新到舊
      posts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // 去重
      if (opts.dedup !== false) {
        posts = filterNewPosts(posts);
      }

      // 影片轉錄：captionText 為空的影片走 Groq
      if (opts.transcribe) {
        const groqKey = config.groqApiKey || process.env.GROQ_API_KEY;
        if (!groqKey) {
          console.error('⚠ --transcribe 需要 Groq API key，請用 init --groq-api-key 設定或設定環境變數 GROQ_API_KEY');
        } else {
          const needsTranscribe = posts.filter(
            (p: any) => isVideoPost(p.mediaType) && !p.captionText,
          );
          if (needsTranscribe.length > 0) {
            console.error(`[轉錄] ${needsTranscribe.length} 篇影片需要轉錄...`);
            if (!process.env.GROQ_API_KEY) process.env.GROQ_API_KEY = groqKey;
            const transcriber = createTranscriber('groq');
            const transcripts = await transcribeVideoPosts(needsTranscribe, transcriber);
            for (const p of needsTranscribe) {
              const result = transcripts.get(p.id);
              if (result) (p as any).captionText = result.text;
            }
          }
        }
      }

      // 存入 DB
      if (opts.saveDb && posts.length > 0) {
        const db = getDb();
        const upsert = db.prepare(`
          INSERT INTO posts (id, source, text, ocr_text, transcript_text, media_type, media_url, url, like_count, comment_count, post_timestamp, fetched_at)
          VALUES (@id, @source, @text, @ocr_text, @transcript_text, @media_type, @media_url, @url, @like_count, @comment_count, @post_timestamp, @fetched_at)
          ON CONFLICT(id) DO UPDATE SET
            transcript_text = CASE WHEN excluded.transcript_text != '' THEN excluded.transcript_text ELSE posts.transcript_text END,
            like_count = excluded.like_count,
            comment_count = excluded.comment_count
        `);
        const now = new Date().toISOString();
        db.transaction(() => {
          for (const p of posts) {
            upsert.run({
              id: p.id, source: p.source, text: p.text,
              ocr_text: (p as any).ocrText || '', transcript_text: (p as any).captionText || '',
              media_type: (p as any).mediaType, media_url: (p as any).mediaUrl, url: p.url,
              like_count: (p as any).likeCount, comment_count: (p as any).commentCount || 0,
              post_timestamp: p.timestamp, fetched_at: now,
            });
          }
        })();
        console.error(`[DB] ${posts.length} 篇已存入`);
      }

      // 標記已讀
      if (opts.markSeen && posts.length > 0) {
        markPostsSeen(posts.map((p) => p.id));
      }

      // stdout 只輸出 JSON
      console.log(JSON.stringify(posts, null, 2));
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── seen ─────────────────────────────────────────────────
const seenCmd = program
  .command('seen')
  .description('管理已讀貼文紀錄');

seenCmd
  .command('mark')
  .description('標記貼文 ID 為已讀')
  .argument('<ids...>', '一個或多個貼文 ID')
  .action((ids: string[]) => {
    markPostsSeen(ids);
    console.error(`已標記 ${ids.length} 篇為已讀`);
  });

seenCmd
  .command('list')
  .description('列出所有已讀 ID')
  .action(() => {
    console.log(JSON.stringify(listSeenIds(), null, 2));
  });

seenCmd
  .command('clear')
  .description('清空已讀紀錄')
  .action(() => {
    clearSeen();
    console.error(`已清空: ${getSeenFile()}`);
  });

// ── push ─────────────────────────────────────────────────
program
  .command('push')
  .description('推送訊息到 Telegram 頻道')
  .option('-m, --message <text>', '訊息內容（不帶則從 stdin 讀取）')
  .option('-f, --file <path>', '從檔案讀取訊息')
  .option('--parse-mode <mode>', '解析模式：HTML / Markdown / none', 'HTML')
  .action(async (opts) => {
    try {
      const config = loadConfig();
      if (!config.telegram?.botToken || !config.telegram?.channelId) {
        throw new Error('Telegram 未設定。請執行 banini-tracker init --tg-bot-token <token> --tg-channel-id <id>');
      }

      let text: string;
      if (opts.message) {
        text = opts.message;
      } else if (opts.file) {
        text = readFileSync(opts.file, 'utf-8');
      } else {
        // 從 stdin 讀取
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        text = Buffer.concat(chunks).toString('utf-8').trim();
      }

      if (!text) throw new Error('沒有訊息內容');

      const parseMode = opts.parseMode === 'none' ? '' : opts.parseMode;
      await sendTelegramDirect(config.telegram.botToken, config.telegram.channelId, text, parseMode as any);
      console.error('Telegram 訊息已發送');
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
