import { createTelegramNotifier } from './telegram.js';
import { createDiscordNotifier } from './discord.js';
import { createLineNotifier } from './line.js';
import type { Notifier } from './types.js';
import { getConfig } from '../config-store.js';

export type { Notifier, ReportData, PostSummary, AnalysisResult } from './types.js';
export { sendTelegramDirect } from './telegram.js';

/**
 * 讀取設定，建立所有已設定的 notifier。
 * 每次呼叫都重新讀取（支援熱重載）。
 */
export function createNotifiers(): Notifier[] {
  const notifiers: Notifier[] = [];

  // Telegram
  const tgToken = getConfig('TG_BOT_TOKEN');
  const tgChannelId = getConfig('TG_CHANNEL_ID');
  if (tgToken && tgChannelId) {
    notifiers.push(createTelegramNotifier({ botToken: tgToken, channelId: tgChannelId }));
  } else if (tgToken || tgChannelId) {
    console.warn(`⚠ Telegram 設定不完整：${tgToken ? '缺少 TG_CHANNEL_ID' : '缺少 TG_BOT_TOKEN'}，通知不會啟用`);
  }

  // Discord
  const dcToken = getConfig('DISCORD_BOT_TOKEN');
  const dcChannelId = getConfig('DISCORD_CHANNEL_ID');
  if (dcToken && dcChannelId) {
    notifiers.push(createDiscordNotifier({ botToken: dcToken, channelId: dcChannelId }));
  } else if (dcToken || dcChannelId) {
    console.warn(`⚠ Discord 設定不完整：${dcToken ? '缺少 DISCORD_CHANNEL_ID' : '缺少 DISCORD_BOT_TOKEN'}，通知不會啟用`);
  }

  // LINE
  const lineToken = getConfig('LINE_CHANNEL_ACCESS_TOKEN');
  const lineTo = getConfig('LINE_TO');
  if (lineToken && lineTo) {
    notifiers.push(createLineNotifier({ channelAccessToken: lineToken, to: lineTo }));
  } else if (lineToken || lineTo) {
    console.warn(`⚠ LINE 設定不完整：${lineToken ? '缺少 LINE_TO' : '缺少 LINE_CHANNEL_ACCESS_TOKEN'}，通知不會啟用`);
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
