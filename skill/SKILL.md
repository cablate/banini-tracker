---
name: banini-tracker
description: |
  巴逆逆反指標分析。觸發時機：使用者要求追蹤巴逆逆、分析反指標、抓取社群貼文並推送 Telegram 時。
  能力範圍：透過 CLI 抓取 Facebook 貼文、反指標邏輯分析、連鎖效應推導、Telegram 推送。
  目標：由 Claude 作為分析引擎，產出直白中文的反指標分析報告。
---

# banini-tracker — 巴逆逆反指標分析

追蹤「股海冥燈」巴逆逆（8zz）的 Facebook 貼文，由你（Claude）進行反指標分析，推送結果到 Telegram。

## 前置條件

```bash
# 首次使用：初始化設定
npx @cablate/banini-tracker init --apify-token <TOKEN> --tg-bot-token <TOKEN> --tg-channel-id <ID>

# 確認設定
npx @cablate/banini-tracker config
```

## 工作流程

### Step 1：抓取貼文

```bash
npx @cablate/banini-tracker fetch -s fb -n 3 --mark-seen
```

輸出是 JSON 陣列，每篇貼文包含：
- `id` / `source`
- `text`（貼文內容）
- `ocrText`（圖片 OCR 文字，可能包含下單截圖）
- `timestamp` / `url` / `likeCount`
- `mediaType` / `mediaUrl`

`--mark-seen` 會自動記錄已讀，下次不重複抓。

### Step 2：你來分析

讀取 Step 1 的 JSON 後，進行反指標分析。分析要點：

**核心邏輯**（方向完全相反，不要搞混）：
| 她的狀態 | 反指標解讀 |
|---------|-----------|
| 買入/加碼 | 該標的可能下跌 |
| 被套（還沒賣） | 可能繼續跌（她還沒認輸） |
| 停損/賣出 | 可能反彈上漲（她認輸 = 底部訊號） |
| 看多/喊買 | 該標的可能下跌 |
| 看空/喊賣 | 該標的可能上漲 |

**分析原則**：
- 只根據貼文明確提到的操作判斷，不要腦補
- 停損 = 她之前買了（做多），現在賣掉認賠。不是「放空」
- 標的用正式名稱（信驊、鈦昇），不用她的暱稱（王、渣男）
- 當天貼文最重要，注意時序（她的想法可能幾小時內改變）
- 語氣越篤定/興奮 → 反指標信號越強
- 善用 WebSearch 查詢標的最新走勢，豐富分析

**連鎖效應推導**：
- 她買油正二被套 → 油價可能繼續跌 → 原物料成本降 → 製造業利多
- 她停損鈦昇 → 鈦昇可能反彈 → IC 設計族群連動上漲
- 她停損賣出油正二 → 油價可能反彈 → 通膨壓力回來

### Step 3：推送 Telegram

將分析結果寫入暫存檔再推送（多行訊息用 `-m` 會被 shell 截斷，務必用 `-f`）：

```bash
# 寫入暫存檔後推送（推薦）
npx @cablate/banini-tracker push -f /tmp/report.txt

# 短訊息可用 -m
npx @cablate/banini-tracker push -m "短訊息"

# 純文字（不解析 HTML）
npx @cablate/banini-tracker push -f /tmp/report.txt --parse-mode none
```

## 其他指令

```bash
# 去重管理
npx @cablate/banini-tracker seen list          # 列出所有已讀 ID
npx @cablate/banini-tracker seen mark <id...>  # 手動標記已讀
npx @cablate/banini-tracker seen clear         # 清空已讀紀錄

# 查看/修改設定
npx @cablate/banini-tracker config             # 顯示設定（token 遮蔽）
# 手動編輯: ~/.banini-tracker.json
```

## 費用參考

Facebook 每次抓取約 $0.02（Apify CU 計費）。

## 報告格式建議

推送到 Telegram 時建議用以下 HTML 格式。注意：
- 每篇貼文附上原文連結（從 fetch 的 `url` 欄位取得）
- `<` `>` `&` 必須轉義（`&lt;` `&gt;` `&amp;`），避免 HTML 解析錯誤
- 多行內容務必寫入檔案後用 `-f` 推送

```
<b>巴逆逆反指標速報</b>
日期：2026-04-10

<b>她的動態</b>
FB 16:56｜我想好明天要買啥了！大家期待嗎...
<a href="https://www.facebook.com/...">原文</a>

FB 14:30｜今天又被套了 油正二...
<a href="https://www.facebook.com/...">原文</a>

<b>反指標分析</b>
↓ 原油正二（ETF）
  她：被套持有中 → 反指標：油價可能繼續跌
  原因：她還沒認輸停損，底部還沒到

<b>連鎖推導</b>
油價續跌 → 原物料成本降 → 製造業毛利提升 → 電子代工股受惠

<b>建議方向</b>
關注電子代工族群，等她停損油正二那天再考慮反手做多油價

冥燈指數：8/10

<i>僅供娛樂參考，不構成投資建議</i>
```
