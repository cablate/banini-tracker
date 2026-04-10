/**
 * 預測追蹤主邏輯
 * - recordPredictions：LLM 分析後記錄預測
 * - updateTracking：每日更新追蹤中的預測（15:00 排程）
 *
 * 設計原則：資料記錄與勝敗判定分離
 * 系統只負責忠實記錄 5 個交易日的 OHLC，勝敗在查詢時決定。
 */
import { getDb } from './db.js';
import { resolveStock } from './stock-map.js';
import { getBasePrice, getDailyOHLC } from './stock-price.js';
import type { BaniniAnalysis } from './analyze.js';

interface PostInfo {
  id: string;
  url: string;
  timestamp: string;
}

/**
 * 記錄 LLM 分析出的預測
 * 同股票有 tracking 中的舊預測 → supersede 舊的
 */
export async function recordPredictions(
  analysis: BaniniAnalysis,
  posts: PostInfo[],
): Promise<number> {
  if (!analysis.hasInvestmentContent || !analysis.mentionedTargets?.length) {
    return 0;
  }

  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO predictions
      (post_id, post_url, symbol_name, symbol_code, symbol_type,
       her_action, reverse_view, confidence, reasoning,
       base_price, created_at, recorded_at, status)
    VALUES
      (@post_id, @post_url, @symbol_name, @symbol_code, @symbol_type,
       @her_action, @reverse_view, @confidence, @reasoning,
       @base_price, @created_at, @recorded_at, @status)
  `);

  const findTracking = db.prepare(`
    SELECT id FROM predictions
    WHERE symbol_code = ? AND status = 'tracking'
    ORDER BY id DESC LIMIT 1
  `);

  const supersede = db.prepare(`
    UPDATE predictions
    SET status = 'superseded', next_prediction_id = ?
    WHERE id = ?
  `);

  const latestPost = posts[0];
  const now = new Date().toISOString();
  let recorded = 0;

  for (const target of analysis.mentionedTargets) {
    if (target.type !== '個股' && target.type !== 'ETF') {
      continue;
    }

    const stock = resolveStock(target.name);
    let basePrice: number | null = null;
    let status = 'tracking';

    if (stock) {
      basePrice = await getBasePrice(stock.code, stock.market, latestPost.timestamp);
    } else {
      status = 'unmappable';
      console.warn(`[tracker] 無法映射股票名稱: ${target.name}`);
    }

    const result = insert.run({
      post_id: latestPost.id,
      post_url: latestPost.url,
      symbol_name: target.name,
      symbol_code: stock?.code ?? null,
      symbol_type: target.type,
      her_action: target.herAction,
      reverse_view: target.reverseView,
      confidence: target.confidence,
      reasoning: target.reasoning ?? null,
      base_price: basePrice,
      created_at: latestPost.timestamp,
      recorded_at: now,
      status,
    });

    if (result.changes > 0) {
      const newId = result.lastInsertRowid as number;

      // 同股票有追蹤中的舊預測 → supersede
      if (stock && status === 'tracking') {
        const existing = findTracking.get(stock.code) as { id: number } | undefined;
        if (existing && existing.id !== newId) {
          supersede.run(newId, existing.id);
          console.log(`[tracker] 覆蓋舊預測 #${existing.id} → #${newId}（${target.name}）`);
        }
      }

      recorded++;
      const priceStr = basePrice ? `$${basePrice}` : '無報價';
      console.log(`[tracker] 記錄預測: ${target.name}（${stock?.code ?? '?'}）${target.reverseView} [${priceStr}]`);
    }
  }

  return recorded;
}

interface TrackingPrediction {
  id: number;
  symbol_code: string;
  symbol_name: string;
  base_price: number;
}

/**
 * 每日更新追蹤中的預測（建議 15:00 後執行）
 * 一律追蹤 5 個交易日，不提前終止。
 */
export async function updateTracking(): Promise<void> {
  let db;
  try {
    db = getDb();
  } catch (err) {
    console.error(`[tracker] 無法開啟資料庫: ${err instanceof Error ? err.message : err}`);
    return;
  }

  const predictions = db.prepare(`
    SELECT id, symbol_code, symbol_name, base_price
    FROM predictions
    WHERE status = 'tracking' AND symbol_code IS NOT NULL AND base_price IS NOT NULL
  `).all() as TrackingPrediction[];

  if (predictions.length === 0) {
    console.log('[tracker] 沒有追蹤中的預測');
    return;
  }

  console.log(`[tracker] 更新 ${predictions.length} 筆追蹤中的預測...`);

  // 去重 symbol_code，避免重複查詢
  const uniqueCodes = [...new Set(predictions.map((p) => p.symbol_code))];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  // 批次查詢今日 OHLC
  const ohlcMap = new Map<string, { open: number; high: number; low: number; close: number }>();
  for (const code of uniqueCodes) {
    try {
      const data = await getDailyOHLC(code, today);
      if (data.length > 0) {
        ohlcMap.set(code, data[0]);
      }
    } catch (err) {
      console.warn(`[tracker] 查詢 ${code} OHLC 失敗，跳過: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (ohlcMap.size === 0) {
    console.warn('[tracker] 今日無任何 OHLC 資料，跳過更新');
    return;
  }

  const countSnapshots = db.prepare(`
    SELECT COUNT(*) as cnt FROM price_snapshots WHERE prediction_id = ?
  `);

  const insertSnapshot = db.prepare(`
    INSERT OR IGNORE INTO price_snapshots
      (prediction_id, day_number, date, open_price, high_price, low_price, close_price,
       change_pct_close, change_pct_high, change_pct_low)
    VALUES (@prediction_id, @day_number, @date, @open_price, @high_price, @low_price, @close_price,
            @change_pct_close, @change_pct_high, @change_pct_low)
  `);

  const markCompleted = db.prepare(`
    UPDATE predictions SET status = 'completed', completed_at = ? WHERE id = ?
  `);

  const updateInTransaction = db.transaction(() => {
    for (const pred of predictions) {
      const ohlc = ohlcMap.get(pred.symbol_code);
      if (!ohlc) continue;

      // day_number = 已有的 snapshot 數 + 1
      const currentCount = (countSnapshots.get(pred.id) as any).cnt as number;
      const dayNumber = currentCount + 1;

      // 計算漲跌幅（兩個方向都記錄）
      const changePctClose = ((ohlc.close - pred.base_price) / pred.base_price) * 100;
      const changePctHigh = ((ohlc.high - pred.base_price) / pred.base_price) * 100;
      const changePctLow = ((ohlc.low - pred.base_price) / pred.base_price) * 100;

      insertSnapshot.run({
        prediction_id: pred.id,
        day_number: dayNumber,
        date: today,
        open_price: ohlc.open,
        high_price: ohlc.high,
        low_price: ohlc.low,
        close_price: ohlc.close,
        change_pct_close: Math.round(changePctClose * 100) / 100,
        change_pct_high: Math.round(changePctHigh * 100) / 100,
        change_pct_low: Math.round(changePctLow * 100) / 100,
      });

      // 5 個交易日 → completed
      if (dayNumber >= 5) {
        markCompleted.run(today, pred.id);
        console.log(`[tracker] 完成追蹤: ${pred.symbol_name}（${pred.symbol_code}）5 天結束`);
      } else {
        const pctStr = changePctClose >= 0 ? `+${changePctClose.toFixed(2)}` : changePctClose.toFixed(2);
        console.log(`[tracker] ${pred.symbol_name}（${pred.symbol_code}）day ${dayNumber}: ${pctStr}%`);
      }
    }
  });

  try {
    updateInTransaction();
    console.log('[tracker] 追蹤更新完成');
  } catch (err) {
    console.error(`[tracker] 寫入快照失敗: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * 取得追蹤統計（基本概覽）
 */
export function getStats(): { total: number; completed: number; tracking: number; superseded: number } {
  const db = getDb();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'tracking' THEN 1 ELSE 0 END) as tracking,
      SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END) as superseded
    FROM predictions
    WHERE status != 'unmappable'
  `).get() as any;

  return {
    total: stats.total,
    completed: stats.completed,
    tracking: stats.tracking,
    superseded: stats.superseded,
  };
}
