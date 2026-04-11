import { escapeHtml, splitMessage } from './format.js';
import type { Notifier, ReportData } from './types.js';

const API_BASE = 'https://api.telegram.org/bot';
const MAX_LEN = 4096;

export interface TelegramConfig {
  botToken: string;
  channelId: string;
}

async function sendMessage(config: TelegramConfig, text: string, parseMode: 'HTML' | 'Markdown' | '' = 'HTML'): Promise<void> {
  const url = `${API_BASE}${config.botToken}/sendMessage`;
  const body: Record<string, any> = {
    chat_id: config.channelId,
    text,
    disable_web_page_preview: true,
  };
  if (parseMode) body.parse_mode = parseMode;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const respBody = await res.text().catch(() => '');
    throw new Error(`Telegram 發送失敗: ${res.status} ${respBody.slice(0, 200)}`);
  }
}

function formatReport(report: ReportData): string {
  const { analysis, postCount, posts } = report;
  const lines: string[] = [];

  if (report.isFallback) {
    lines.push('<b>巴逆逆貼文速報</b>（LLM 分析失敗）');
    lines.push('');
    for (const p of posts) {
      const todayTag = p.isToday ? ' [今天]' : '';
      const preview = escapeHtml(p.text.replace(/\n/g, ' ').slice(0, 80));
      const link = p.url ? ` <a href="${p.url}">原文</a>` : '';
      lines.push(`FB${todayTag} ${p.timestamp}｜${preview}${p.text.length > 80 ? '…' : ''}${link}`);
    }
    lines.push('\n<i>LLM 服務暫時無法使用，僅列出原始貼文</i>');
    return lines.join('\n');
  }

  lines.push('<b>巴逆逆反指標速報</b>');
  lines.push(`來源：FB ${postCount.fb} 篇`);
  lines.push('');

  lines.push('<b>她的動態</b>');
  for (const p of posts) {
    const todayTag = p.isToday ? ' [今天]' : '';
    const preview = escapeHtml(p.text.replace(/\n/g, ' ').slice(0, 50));
    const link = p.url ? ` <a href="${p.url}">原文</a>` : '';
    lines.push(`FB${todayTag} ${p.timestamp}｜${preview}${p.text.length > 50 ? '…' : ''}${link}`);
  }

  lines.push('');
  lines.push(escapeHtml(analysis.summary));

  if (analysis.hasInvestmentContent) {
    if (analysis.mentionedTargets?.length) {
      lines.push('');
      lines.push('<b>提及標的</b>');
      for (const t of analysis.mentionedTargets) {
        const arrow = t.reverseView.includes('漲') || t.reverseView.includes('彈') ? '↑'
          : t.reverseView.includes('跌') ? '↓' : '→';
        lines.push(`${arrow} <b>${escapeHtml(t.name)}</b>（${escapeHtml(t.type)}）`);
        lines.push(`  她：${escapeHtml(t.herAction)} → 反指標：${escapeHtml(t.reverseView)} [${escapeHtml(t.confidence)}]`);
        if (t.reasoning) lines.push(`  ${escapeHtml(t.reasoning)}`);
      }
    }
    if (analysis.chainAnalysis) {
      lines.push('');
      lines.push(`<b>連鎖推導</b>\n${escapeHtml(analysis.chainAnalysis)}`);
    }
    if (analysis.actionableSuggestion) {
      lines.push('');
      lines.push(`<b>建議方向</b>\n${escapeHtml(analysis.actionableSuggestion)}`);
    }
    if (analysis.moodScore) {
      lines.push(`\n冥燈指數：${analysis.moodScore}/10`);
    }
  } else {
    lines.push('\n（本批貼文與投資無關）');
  }

  lines.push('\n<i>僅供娛樂參考，不構成投資建議</i>');
  return lines.join('\n');
}

export function createTelegramNotifier(config: TelegramConfig): Notifier {
  return {
    name: 'Telegram',
    async send(report: ReportData): Promise<void> {
      const text = formatReport(report);
      const chunks = splitMessage(text, MAX_LEN);
      for (const chunk of chunks) {
        await sendMessage(config, chunk);
      }
    },
  };
}

// CLI 用（直接傳參數發送純文字）
export async function sendTelegramDirect(
  botToken: string, channelId: string, text: string, parseMode: 'HTML' | 'Markdown' | '' = 'HTML',
): Promise<void> {
  return sendMessage({ botToken, channelId }, text, parseMode);
}
