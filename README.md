<p align="center">
  <img src="assets/banner.svg" alt="banini-tracker banner" width="100%">
</p>

# banini-tracker

追蹤「股海冥燈」巴逆逆（8zz）的 Facebook 社群貼文，透過 Apify 抓取、AI 反指標分析、Telegram 即時推送。

- 辨識她提到的標的（個股、ETF、原物料）
- 判斷她的操作（買入 / 被套 / 停損）
- 反轉推導（她停損 → 可能反彈、她買入 → 可能下跌）
- 推導連鎖效應（油價跌 → 製造業利多 → 電子股受惠）

> **Claude Code 使用者？** 直接把 [`skill/SKILL.md`](skill/SKILL.md) 加到你的 `.claude/skills/` 就能用。Claude 自己當分析引擎，不需要額外 LLM。

支援兩種使用模式：
- **常駐排程**：Docker 部署，自動盤中/盤後排程 + LLM 分析 + Telegram 推送
- **CLI 工具**：`npx @cablate/banini-tracker`，搭配 Claude Code 等 AI 手動執行分析

## 快速開始（常駐排程）

```bash
# 1. 複製設定
cp .env.example .env
# 填入 APIFY_TOKEN, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, TG_BOT_TOKEN, TG_CHANNEL_ID

# 2. Docker 部署
docker build -t banini-tracker .
docker run -d --name banini --env-file .env banini-tracker

# 3. 或本地直接跑
npm install && npm run start
```

### 排程規則

- **盤中**（週一~五 09:00-13:30）：每 30 分鐘，FB only 抓 1 篇
- **盤後**（每天 23:00）：FB 3 篇

### npm scripts

| 指令 | 說明 |
|------|------|
| `npm run start` | 常駐排程模式（盤中 + 盤後自動跑） |
| `npm run dev` | 單次執行（FB 3 篇） |
| `npm run dry` | 只抓取，不呼叫 LLM |
| `npm run market` | 盤中模式（FB only, 1 篇） |
| `npm run evening` | 盤後模式（各 3 篇） |

### .env 設定

```
APIFY_TOKEN=apify_api_...
LLM_BASE_URL=https://api.deepinfra.com/v1/openai
LLM_API_KEY=...
LLM_MODEL=MiniMaxAI/MiniMax-M2.5
TG_BOT_TOKEN=...
TG_CHANNEL_ID=-100...
```

## CLI 工具模式

不需 clone repo，任何環境直接用：

```bash
# 初始化設定
npx @cablate/banini-tracker init \
  --apify-token YOUR_APIFY_TOKEN \
  --tg-bot-token YOUR_TG_BOT_TOKEN \
  --tg-channel-id YOUR_TG_CHANNEL_ID

# 抓取 Facebook 最新 3 篇
npx @cablate/banini-tracker fetch -s fb -n 3 --mark-seen

# 推送結果到 Telegram
npx @cablate/banini-tracker push -m "分析結果..."
```

### CLI 指令

| 指令 | 說明 |
|------|------|
| `init` | 初始化設定檔（`~/.banini-tracker.json`） |
| `config` | 顯示目前設定 |
| `fetch` | 抓取貼文，輸出 JSON 到 stdout |
| `push` | 推送訊息到 Telegram |
| `seen list` | 列出已讀貼文 ID |
| `seen mark <id...>` | 標記貼文為已讀 |
| `seen clear` | 清空已讀紀錄 |

### fetch 選項

```
-s, --source <source>  來源：fb（預設 fb）
-n, --limit <n>        每個來源抓幾篇（預設 3）
--no-dedup             不去重
--mark-seen            輸出後自動標記已讀
```

### push 選項

```
-m, --message <text>     直接帶訊息
-f, --file <path>        從檔案讀取
--parse-mode <mode>      HTML / Markdown / none（預設 HTML）
```

不帶 `-m` 或 `-f` 時從 stdin 讀取。

### 搭配 Claude Code 使用

在 Claude Code 的 skill 中，Claude 自己就是分析引擎：

1. `fetch` 抓貼文 → Claude 讀 JSON
2. Claude 分析 + WebSearch 查最新走勢
3. Claude 組報告 → `push` 推送 Telegram

詳見 [`skill/SKILL.md`](skill/SKILL.md)。

## 費用估算

| 項目 | 單次費用 | 頻率 | 月估算 |
|------|---------|------|--------|
| Facebook 抓取（Apify） | ~$0.02 | 盤中 ~198 次 + 盤後 30 次 | ~$4.56 |
| LLM 分析（常駐模式） | 依模型而定 | 同上 | 依模型定價 |
| Telegram 推送 | 免費 | — | $0 |

> 盤中：週一~五 09:00-13:30 每 30 分鐘（~9 次/日 × 22 工作日）
> 盤後：每天 23:00（30 次/月）
> CLI 模式搭配 Claude Code 使用則不需 LLM 費用，Claude 自己分析

## 為什麼只用 Facebook？

早期版本同時支援 Threads 和 Facebook 爬取，後來基於兩個原因移除了 Threads：

1. **費用差距大**：Threads 每次抓取 ~$0.15（Pay-per-event），Facebook 只要 ~$0.02（CU 計費），差 7 倍以上
2. **FB 參考價值更高**：巴逆逆的投資相關貼文（持倉截圖、操作心得）主要發在 Facebook 粉專，Threads 多為生活日常，反指標參考價值較低

## Star History

<a href="https://star-history.com/#cablate/banini-tracker&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=cablate/banini-tracker&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=cablate/banini-tracker&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=cablate/banini-tracker&type=Date" />
 </picture>
</a>

## 免責聲明

本專案僅供娛樂參考，不構成任何投資建議。

## License

MIT
