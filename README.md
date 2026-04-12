<p align="center">
  <img src="assets/banner.svg" alt="banini-tracker banner" width="100%">
</p>

# banini-tracker

> **AGPL-3.0** — 使用、修改或部署本專案，必須標明原作者 **[cablate](https://github.com/cablate)**、附上[本 repo 連結](https://github.com/cablate/banini-tracker)，並以相同授權公開原始碼。網路服務部署亦同。
>
> 本專案於 2026/04/13 從 MIT 切換至 AGPL-3.0。此日期之前取得的版本仍適用 MIT 授權。

追蹤「股海冥燈」巴逆逆（8zz）的 Facebook 社群貼文，透過 AI 反指標分析、多平台即時推送（Telegram / Discord / LINE），並自動追蹤預測準確度。

- 辨識她提到的標的（個股、ETF、原物料）
- 反轉推導（她停損 → 可能反彈、她買入 → 可能下跌）
- 推導連鎖效應（油價跌 → 製造業利多 → 電子股受惠）
- 自動記錄預測，追蹤 5 個交易日的實際走勢

---

### 歷史回測

使用 [Claude Opus 4.6](https://docs.anthropic.com/en/docs/about-claude/models) 回溯分析 2024/04～2026/04 共 2,249 篇貼文，從中提取 345 筆明確的投資操作預測。

<p align="center">
  <img src="assets/banini-report.gif" alt="歷史回測數據" width="600">
</p>

| | |
|---|---|
| **分析範圍** | 2,249 篇貼文 → 345 筆預測，涵蓋 70 個標的（個股、ETF、指數、原物料） |
| **追蹤方式** | 每筆預測後追蹤 5 個交易日，記錄盤中最高/最低價 |
| **判定標準** | 反指標方向正確且幅度超過 ±1% 即算「冥燈成功」 |
| **資料集** | [`data/banini-public.db`](data/banini-public.db)（SQLite，不含原始貼文） |

---

## 快速開始

四種使用方式，按推薦順序：

### 1. Zeabur 一鍵部署（推薦）

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/ITT41M)

部署後打開分配的網域，首次進入設定管理員帳密，然後在 Web UI 填入 API key 和通知管道。不需要手動設定環境變數。

### 2. Docker

```bash
docker build -t banini-tracker .
docker run -d --name banini --env-file .env -v banini-data:/data -p 3000:3000 banini-tracker
```

部署後打開 `http://localhost:3000` 進入設定頁面。也可以直接用 `.env` 檔設定環境變數（見下方）。

### 3. npx 直接啟動

```bash
npx @cablate/banini-tracker serve
npx @cablate/banini-tracker serve --port 8080
```

不需 Docker，直接在本機啟動常駐服務（排程 + Web 設定頁面）。打開 `http://localhost:3000` 進入設定。適合有 Node.js 環境的使用者。

### 4. 本地開發

```bash
cp .env.example .env  # 填入必要設定
npm install && npm run start
```

## 排程規則

| 排程 | 時間 | 說明 |
|------|------|------|
| 早晨補漏 | 每天 08:00 | 抓前一晚的貼文（3 篇） |
| 盤中 | 週一~五 09:07-13:07 每 30 分 | 即時追蹤（1 篇） |
| 追蹤更新 | 週一~五 15:00 | 收盤後更新預測追蹤 |
| 盤後 | 每天 23:03 | 當日彙整（3 篇） |

## 設定

### Web UI（Zeabur / Docker）

常駐模式會在 port 3000 啟動設定頁面。首次進入建立管理員帳密，之後登入即可修改設定。修改後下次排程執行自動生效，不需重啟。

### 環境變數（.env）

如果不使用 Web UI，也可以直接設定環境變數：

| 變數 | 必填 | 說明 |
|------|------|------|
| `APIFY_TOKEN` | 是 | Apify API token |
| `LLM_API_KEY` | 是 | LLM API key |
| `LLM_BASE_URL` | — | 預設 DeepInfra |
| `LLM_MODEL` | — | 預設 MiniMax-M2.5 |
| `TG_BOT_TOKEN` + `TG_CHANNEL_ID` | 至少一組 | Telegram 通知 |
| `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID` | 至少一組 | Discord 通知 |
| `LINE_CHANNEL_ACCESS_TOKEN` + `LINE_TO` | 至少一組 | LINE 通知（Free plan 200 則/月） |
| `TRANSCRIBER` | — | `noop`（預設）或 `groq` |
| `GROQ_API_KEY` | — | Groq Whisper 影片轉錄用 |
| `FINMIND_TOKEN` | — | 股價查詢（免費可用） |

Web UI 和環境變數可以混用，Web UI 的設定優先。

## 預測追蹤

LLM 分析出標的後，系統自動：

1. **映射股票代碼**：台股名稱 → 代碼（2230 檔上市 + 上櫃）
2. **記錄基準價格**：以貼文發佈時間查對應交易日收盤價
3. **追蹤 5 個交易日**：每天 15:00 收盤後抓 OHLC，記錄漲跌幅
4. **同股票取代**：新預測自動取代同標的舊預測（supersede 機制）

### 公開資料集

[`data/banini-public.db`](data/banini-public.db) 提供去識別化的預測資料（345 筆預測 + 價格快照），不含原始貼文。

```bash
sqlite3 data/banini-public.db "SELECT symbol_name, reverse_view, base_price, status FROM predictions LIMIT 10"
```

## CLI 工具

不需 clone repo，搭配 Claude Code 等 AI 使用：

```bash
# 啟動常駐服務（排程 + Web UI）
npx @cablate/banini-tracker serve

# 初始化 CLI 設定
npx @cablate/banini-tracker init --apify-token YOUR_TOKEN

# 抓取貼文
npx @cablate/banini-tracker fetch -n 3 --mark-seen

# 推送到 Telegram
npx @cablate/banini-tracker push -f report.txt
```

> **Claude Code 使用者？** 直接把 [`skill/SKILL.md`](skill/SKILL.md) 加到你的 `.claude/skills/` 就能用。Claude 自己當分析引擎，不需要額外 LLM。

完整指令說明見 `npx @cablate/banini-tracker --help`。

## 費用估算

| 項目 | 月估算 |
|------|--------|
| Facebook 抓取（Apify） | ~$1.35（~270 篇） |
| LLM 分析 | 依模型定價 |
| 通知推送（TG / DC） | 免費 |
| LINE 推送 | Free plan 200 則/月 |
| 股價查詢（FinMind） | 免費 |

> CLI 模式搭配 Claude Code 不需 LLM 費用，Claude 自己分析。

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

[AGPL-3.0](LICENSE)
