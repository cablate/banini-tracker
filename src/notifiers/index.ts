import { createTelegramNotifier } from './telegram.js';
import { createDiscordNotifier } from './discord.js';
import { createLineNotifier } from './line.js';
import type { Notifier } from './types.js';

export type { Notifier, ReportData, PostSummary, AnalysisResult } from './types.js';
export { sendTelegramDirect } from './telegram.js';

/**
 * 讀取環境變數，建立所有已設定的 notifier。
 * 常駐模式用：自動偵測哪些 channel 有設定。
 */
export function createNotifiers(): Notifier[] {
  const notifiers: Notifier[] = [];

  // Telegram
  const tgToken = process.env.TG_BOT_TOKEN;
  const tgChannelId = process.env.TG_CHANNEL_ID;
  if (tgToken && tgChannelId) {
    notifiers.push(createTelegramNotifier({ botToken: tgToken, channelId: tgChannelId }));
  }

  // Discord
  const dcToken = process.env.DISCORD_BOT_TOKEN;
  const dcChannelId = process.env.DISCORD_CHANNEL_ID;
  if (dcToken && dcChannelId) {
    notifiers.push(createDiscordNotifier({ botToken: dcToken, channelId: dcChannelId }));
  }

  // LINE
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const lineTo = process.env.LINE_TO;
  if (lineToken && lineTo) {
    notifiers.push(createLineNotifier({ channelAccessToken: lineToken, to: lineTo }));
  }

  return notifiers;
}

/**
 * 從 CLI config 建立 notifier（只支援已設定的 channel）。
 */
export function createNotifiersFromConfig(config: {
  telegram?: { botToken: string; channelId: string };
  discord?: { botToken: string; channelId: string };
  line?: { channelAccessToken: string; to: string };
}): Notifier[] {
  const notifiers: Notifier[] = [];

  if (config.telegram?.botToken && config.telegram?.channelId) {
    notifiers.push(createTelegramNotifier(config.telegram));
  }
  if (config.discord?.botToken && config.discord?.channelId) {
    notifiers.push(createDiscordNotifier(config.discord));
  }
  if (config.line?.channelAccessToken && config.line?.to) {
    notifiers.push(createLineNotifier(config.line));
  }

  return notifiers;
}
