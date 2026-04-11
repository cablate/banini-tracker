import { splitMessage } from './format.js';
import type { Notifier, ReportData } from './types.js';

const API_BASE = 'https://api.line.me/v2/bot/message/push';
const MAX_LEN = 5000;

export interface LineConfig {
  channelAccessToken: string;
  to: string; // userId or groupId
}

async function sendMessage(config: LineConfig, text: string): Promise<void> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.channelAccessToken}`,
    },
    body: JSON.stringify({
      to: config.to,
      messages: [{ type: 'text', text }],
    }),
  });

  if (!res.ok) {
    const respBody = await res.text().catch(() => '');
    throw new Error(`LINE 發送失敗: ${res.status} ${respBody.slice(0, 200)}`);
  }
}

function formatReport(report: ReportData): string {
  const { analysis, postCount, posts } = report;
  const lines: string[] = [];

  if (report.isFallback) {
    lines.push('[ 巴逆逆貼文速報 ]（LLM 分析失敗）');
    lines.push('');
    for (const p of posts) {
      const todayTag = p.isToday ? ' [今天]' : '';
      const preview = p.text.replace(/\n/g, ' ').slice(0, 80);
      lines.push(`FB${todayTag} ${p.timestamp}｜${preview}${p.text.length > 80 ? '…' : ''}`);
      if (p.url) lines.push(`  ${p.url}`);
    }
    lines.push('\nLLM 服務暫時無法使用，僅列出原始貼文');
    return lines.join('\n');
  }

  lines.push('[ 巴逆逆反指標速報 ]');
  lines.push(`來源：FB ${postCount.fb} 篇`);
  lines.push('');

  lines.push('[ 她的動態 ]');
  for (const p of posts) {
    const todayTag = p.isToday ? ' [今天]' : '';
    const preview = p.text.replace(/\n/g, ' ').slice(0, 50);
    lines.push(`FB${todayTag} ${p.timestamp}｜${preview}${p.text.length > 50 ? '…' : ''}`);
    if (p.url) lines.push(`  ${p.url}`);
  }

  lines.push('');
  lines.push(analysis.summary);

  if (analysis.hasInvestmentContent) {
    if (analysis.mentionedTargets?.length) {
      lines.push('');
      lines.push('[ 提及標的 ]');
      for (const t of analysis.mentionedTargets) {
        const arrow = t.reverseView.includes('漲') || t.reverseView.includes('彈') ? '↑'
          : t.reverseView.includes('跌') ? '↓' : '→';
        lines.push(`${arrow} ${t.name}（${t.type}）`);
        lines.push(`  她：${t.herAction} → 反指標：${t.reverseView} [${t.confidence}]`);
        if (t.reasoning) lines.push(`  ${t.reasoning}`);
      }
    }
    if (analysis.chainAnalysis) {
      lines.push('');
      lines.push(`[ 連鎖推導 ]\n${analysis.chainAnalysis}`);
    }
    if (analysis.actionableSuggestion) {
      lines.push('');
      lines.push(`[ 建議方向 ]\n${analysis.actionableSuggestion}`);
    }
    if (analysis.moodScore) {
      lines.push(`\n冥燈指數：${analysis.moodScore}/10`);
    }
  } else {
    lines.push('\n（本批貼文與投資無關）');
  }

  lines.push('\n僅供娛樂參考，不構成投資建議');
  return lines.join('\n');
}

export function createLineNotifier(config: LineConfig): Notifier {
  return {
    name: 'LINE',
    async send(report: ReportData): Promise<void> {
      const text = formatReport(report);
      const chunks = splitMessage(text, MAX_LEN);
      for (const chunk of chunks) {
        await sendMessage(config, chunk);
      }
    },
  };
}
