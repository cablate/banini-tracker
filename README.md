# banini-tracker

追蹤「反指標女神」巴逆逆（8zz）的 Threads / Facebook 貼文，用 AI 進行反指標分析，推送結果到 Telegram 頻道。

## 它做什麼

1. 透過 Apify 抓取巴逆逆的最新社群貼文（Threads + Facebook）
2. 自動去重，只處理新貼文
3. 用 LLM 進行「反指標 + 總經連鎖」分析
4. 將分析結果推送到 Telegram 頻道
5. 內建排程：盤中即時追蹤 + 盤後完整分析

## 反指標邏輯

巴逆逆被稱為「股海冥燈」——買什麼跌什麼，賣什麼漲什麼。AI 分析會：

- 辨識她提到的標的（個股、ETF、原物料）
- 判斷她的操作（買入 / 被套 / 停損）
- 反轉推導（她停損 → 可能反彈、她買入 → 可能下跌）
- 推導連鎖效應（油價跌 → 製造業利多 → 電子股受惠）

## 環境需求

- Node.js 20+
- [Apify](https://apify.com/) 帳號（免費額度即可）
- 任何 OpenAI 相容的 LLM API（預設 DeepInfra）
- Telegram Bot + 頻道（選用）

## 安裝

```bash
git clone https://github.com/CabLate/banini-tracker.git
cd banini-tracker
npm install
cp .env.example .env
```

編輯 `.env` 填入你的 API keys：

```env
APIFY_TOKEN=your_apify_token
LLM_BASE_URL=https://api.deepinfra.com/v1/openai
LLM_API_KEY=your_api_key
LLM_MODEL=MiniMaxAI/MiniMax-M2.5
TG_BOT_TOKEN=your_telegram_bot_token
TG_CHANNEL_ID=your_telegram_channel_id
```

## 使用

### 手動執行

```bash
npm run dev              # Threads + FB 各 3 篇，AI 分析 + 通知
npm run dry              # 只抓取，不呼叫 LLM（測試用）
npm run market           # 盤中模式：FB only, 1 篇
npm run evening          # 盤後模式：Threads + FB, 各 3 篇
```

### 常駐排程（部署用）

```bash
npm run build            # TypeScript 編譯
npm run start            # 啟動常駐排程
```

排程時間（台北時間）：

| 排程 | 時間 | 來源 | 篇數 |
|------|------|------|------|
| 盤中 | 週一~五 09:07-13:07 每 30 分 | Facebook | 1 篇 |
| 盤後 | 每天 23:03 | Threads + Facebook | 各 3 篇 |

盤中只用 Facebook（$0.02/次），盤後加 Threads（~$0.15/次），日成本約 $0.37。

## 費用估算

| 服務 | 單次費用 | 月估算 |
|------|---------|--------|
| Apify FB Scraper | $0.02/次 | ~$6（盤中 10 次/天 × 30 天） |
| Apify Threads Scraper | ~$0.15/次 | ~$4.5（盤後 1 次/天 × 30 天） |
| DeepInfra LLM | ~$0.001/次 | < $1 |
| **合計** | | **~$11/月** |

## 專案結構

```
src/
  index.ts       # 主程式 + 排程邏輯
  threads.ts     # Apify Threads Scraper 封裝
  facebook.ts    # Apify Facebook Scraper 封裝
  analyze.ts     # LLM 反指標分析（prompt + 呼叫）
  telegram.ts    # Telegram Bot 通知
data/            # 執行資料（gitignore）
  seen.json      # 已處理貼文 ID（去重用）
  report-*.json  # 每次分析結果存檔
```

## 免責聲明

本專案僅供娛樂參考，不構成任何投資建議。
