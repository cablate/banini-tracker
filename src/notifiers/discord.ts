import { splitMessage } from './format.js';
import type { Notifier, ReportData } from './types.js';

const API_BASE = 'https://discord.com/api/v10';
const MAX_LEN = 2000;

export interface DiscordConfig {
  botToken: string;
  channelId: string;
}

async function sendMessage(config: DiscordConfig, content: string): Promise<void> {
  const url = `${API_BASE}/channels/${config.channelId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${config.botToken}`,
    },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const respBody = await res.text().catch(() => '');
    throw new Error(`Discord 發送失敗: ${res.status} ${respBody.slice(0, 200)}`);
  }
}

function formatReport(report: ReportData): string {
  const { analysis, postCount, posts } = report;
  const lines: string[] = [];

  if (report.isFallback) {
    lines.push('**巴逆逆貼文速報**（LLM 分析失敗）');
    lines.push('');
    for (const p of posts) {
      const todayTag = p.isToday ? ' [今天]' : '';
      const preview = p.text.replace(/\n/g, ' ').slice(0, 80);
      const link = p.url ? ` [原文](${p.url})` : '';
      lines.push(`FB${todayTag} ${p.timestamp}｜${preview}${p.text.length > 80 ? '…' : ''}${link}`);
    }
    lines.push('\n*LLM 服務暫時無法使用，僅列出原始貼文*');
    return lines.join('\n');
  }

  lines.push('**巴逆逆反指標速報**');
  lines.push(`來源：FB ${postCount.fb} 篇`);
  lines.push('');

  lines.push('**她的動態**');
  for (const p of posts) {
    const todayTag = p.isToday ? ' [今天]' : '';
    const preview = p.text.replace(/\n/g, ' ').slice(0, 50);
    const link = p.url ? ` [原文](${p.url})` : '';
    lines.push(`FB${todayTag} ${p.timestamp}｜${preview}${p.text.length > 50 ? '…' : ''}${link}`);
  }

  lines.push('');
  lines.push(analysis.summary);

  if (analysis.hasInvestmentContent) {
    if (analysis.mentionedTargets?.length) {
      lines.push('');
      lines.push('**提及標的**');
      for (const t of analysis.mentionedTargets) {
        const arrow = t.reverseView.includes('漲') || t.reverseView.includes('彈') ? '↑'
          : t.reverseView.includes('跌') ? '↓' : '→';
        lines.push(`${arrow} **${t.name}**（${t.type}）`);
        lines.push(`　她：${t.herAction} → 反指標：${t.reverseView} [${t.confidence}]`);
        if (t.reasoning) lines.push(`　${t.reasoning}`);
      }
    }
    if (analysis.chainAnalysis) {
      lines.push('');
      lines.push(`**連鎖推導**\n${analysis.chainAnalysis}`);
    }
    if (analysis.actionableSuggestion) {
      lines.push('');
      lines.push(`**建議方向**\n${analysis.actionableSuggestion}`);
    }
    if (analysis.moodScore) {
      lines.push(`\n冥燈指數：${analysis.moodScore}/10`);
    }
  } else {
    lines.push('\n（本批貼文與投資無關）');
  }

  lines.push('\n*僅供娛樂參考，不構成投資建議*');
  return lines.join('\n');
}

export function createDiscordNotifier(config: DiscordConfig): Notifier {
  return {
    name: 'Discord',
    async send(report: ReportData): Promise<void> {
      const text = formatReport(report);
      const chunks = splitMessage(text, MAX_LEN);
      for (const chunk of chunks) {
        await sendMessage(config, chunk);
      }
    },
  };
}
