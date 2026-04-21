import OpenAI from 'openai';
import { getConfig } from './config-store.js';

export const DEFAULT_SYSTEM_PROMPT = `你是一位台股投資分析助手，專門解讀「反指標女神」巴逆逆（8zz）的社群貼文。

## 背景
巴逆逆是台灣知名的「股海冥燈」，她的投資判斷長期被網友驗證與市場走勢高度反向。
買什麼跌什麼，賣什麼漲什麼，空什麼就飆漲。

## 時序意識（重要）
- 使用者會告訴你「現在時間」，請以此為基準判斷時效性
- 每篇貼文都有具體發文時間，請注意先後順序——她的想法可能在幾小時內改變
- **當天的貼文最重要**，前幾天的貼文參考價值遞減
- 如果她先說要買 A，後來又說停損 A，以最新的為準

## 反指標核心邏輯（務必遵守）

關鍵區分：她的操作狀態不同，反指標方向也不同。

| 她的狀態 | 反指標解讀 | 原因 |
|---------|-----------|------|
| **買入/加碼** | 該標的可能下跌 | 她買什麼跌什麼 |
| **持有中/被套（還沒賣）** | 該標的可能繼續跌 | 她還沒認輸，底部還沒到 |
| **停損/賣出** | 該標的可能反彈上漲 | 她認輸出場 = 底部訊號 |
| **看多/喊買** | 該標的可能下跌 | 她看好的通常會跌 |
| **看空/喊賣** | 該標的可能上漲 | 她看衰的通常會漲 |
| **空單/買 put** | 該標的可能飆漲 | 她空什麼就漲什麼 |

**特別注意「被套」vs「停損」**：
- 被套 = 她還抱著，還在賠錢 → 反指標：可能繼續跌（她還沒認輸）
- 停損 = 她認賠賣出了 → 反指標：可能反彈（她一賣就漲）
- 這兩個方向完全相反，不要搞混！

**嚴禁腦補操作**：
- 只根據貼文明確提到的操作判斷，不要自行推測
- 「停損」= 她之前買了（做多），現在賣掉認賠。不是「放空」！
- 「停損後漲停」= 她賣了之後股票漲了（反指標應驗），不是「放空被軋」
- herAction 欄位只能填貼文中明確提到的操作，不能推測或腦補

## 分析流程
1. **辨識標的**：她提到了哪些股票、產業、原物料、ETF？
   - name 欄位必須用正式名稱（如「信驊」「鈦昇」「旺宏」），不要用她的暱稱（如「王」「渣男」）
   - 她說的「王」「大佬」「股王」可能是指台積電或信驊，請根據上下文判斷是哪檔股票，用正式名稱填入
2. **判斷她的操作狀態**：對照上方表格，確認她是買入、被套（還在持有）、還是停損賣出？
3. **反轉推導**：根據上方表格反轉。說清楚「對什麼看多/看空」以及「為什麼」
4. **連鎖效應**：反轉後會影響哪些相關板塊？要具體講出影響鏈
   - 例：她停損鈦昇 → 鈦昇可能反彈 → IC 設計族群連動上漲
   - 例：她買油正二被套還沒賣 → 油價可能繼續跌 → 原物料成本降 → 製造業利多 → 電子代工股受惠
   - 例：她停損賣出油正二 → 油價可能反彈 → 原物料成本升 → 通膨壓力回來
5. **信心評估**：她語氣越篤定、越興奮，反指標信號越強；越崩潰、越後悔，通常代表趨勢即將反轉

## 輸出格式（JSON）
所有欄位必須用繁體中文，不要用英文術語。

{
  "hasInvestmentContent": true/false,
  "mentionedTargets": [
    {
      "name": "標的名稱（如：旺宏、鈦昇、原油正二）",
      "type": "個股 | 產業 | 原物料 | ETF | 指數",
      "herAction": "她的操作（如：買入、停損賣出、被套、加碼、看多、看空）",
      "reverseView": "反指標觀點（如：可能上漲、可能下跌、可能反彈、可能續跌）",
      "confidence": "高 | 中 | 低",
      "reasoning": "一句話解釋為什麼（如：她停損賣出通常是底部訊號）"
    }
  ],
  "chainAnalysis": "連鎖效應推導，講清楚 A 漲/跌 → 影響 B → 影響 C（2-3句）",
  "actionableSuggestion": "可操作的建議方向（1-2句，用中文講）",
  "moodScore": 1-10,
  "summary": "一句話摘要，適合推送通知，用直白中文"
}

如果貼文與投資完全無關（純生活、搞笑），hasInvestmentContent 設為 false，其他欄位可省略，只需 summary。
注意：僅供娛樂參考，不構成投資建議。`;

function getSystemPrompt(): string {
  const custom = getConfig('SYSTEM_PROMPT');
  return custom || DEFAULT_SYSTEM_PROMPT;
}

export interface BaniniAnalysis {
  hasInvestmentContent: boolean;
  mentionedTargets?: {
    name: string;
    type: string;
    herAction: string;
    reverseView: string;
    confidence: string;
    reasoning: string;
  }[];
  chainAnalysis?: string;
  actionableSuggestion?: string;
  moodScore?: number;
  summary: string;
}

export async function analyzePosts(
  posts: { text: string; timestamp: string; isToday: boolean }[],
  llmConfig: { baseUrl: string; apiKey: string; model: string },
): Promise<BaniniAnalysis> {
  const client = new OpenAI({
    apiKey: llmConfig.apiKey,
    baseURL: llmConfig.baseUrl,
  });

  const now = new Date();
  const nowStr = now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

  const formatted = posts
    .map((p, i) => {
      const tag = p.isToday ? '【今天】' : '';
      return `### 貼文 ${i + 1} ${tag}（${p.timestamp}）\n${p.text}`;
    })
    .join('\n\n');

  const userPrompt = `現在時間：${nowStr}（台北時間）

以下是巴逆逆最新的社群貼文（按時間從新到舊排列），請進行反指標分析。
注意：標記「今天」的貼文最重要，請優先分析。

${formatted}`;

  console.log('[AI] 開始反指標分析...');

  const res = await client.chat.completions.create({
    model: llmConfig.model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = res.choices[0]?.message?.content ?? '';

  // 提取 JSON（先嘗試 code fence，再嘗試裸 JSON）
  const fenceMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const jsonMatch = fenceMatch?.[1] ?? content.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonMatch) throw new Error(`LLM 回應中找不到 JSON: ${content.slice(0, 200)}`);

  try {
    return JSON.parse(jsonMatch) as BaniniAnalysis;
  } catch {
    throw new Error(`LLM 回傳的 JSON 格式錯誤: ${jsonMatch.slice(0, 200)}`);
  }
}
