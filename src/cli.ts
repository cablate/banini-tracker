#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, saveConfig, defaultConfig, getConfigPath, getSeenFile } from './config.js';
import { fetchFacebookPosts } from './facebook.js';
import { sendTelegramMessage } from './telegram.js';
import { filterNewPosts, markPostsSeen, listSeenIds, clearSeen } from './seen.js';
import { readFileSync } from 'fs';

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
  .action((opts) => {
    const config = defaultConfig();
    if (opts.apifyToken) config.apifyToken = opts.apifyToken;
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
  .option('--no-dedup', '不做去重，抓到什麼就輸出什麼')
  .option('--mark-seen', '輸出後自動標記為已讀')
  .action(async (opts) => {
    try {
      const config = loadConfig();
      const limit = parseInt(opts.limit, 10);
      let posts: any[] = [];

      const fp = await fetchFacebookPosts(config.targets.facebookPageUrl, config.apifyToken, limit);
      posts.push(...fp);

      // 按時間從新到舊
      posts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // 去重
      if (opts.dedup !== false) {
        posts = filterNewPosts(posts);
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
      await sendTelegramMessage(config.telegram.botToken, config.telegram.channelId, text, parseMode as any);
      console.error('Telegram 訊息已發送');
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
