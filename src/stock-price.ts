/**
 * 股價查詢模組
 * - TWSE 即時報價（盤中）
 * - FinMind OHLC（盤後歷史資料）
 */

const FINMIND_TOKEN = process.env.FINMIND_TOKEN || '';
const FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';
const TWSE_REALTIME = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';

export interface OHLCData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * 判斷台股是否在交易時間（週一到五 09:00-13:30 台北時間）
 */
export function isMarketOpen(now?: Date): boolean {
  const taipei = new Date((now ?? new Date()).toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const day = taipei.getDay();
  if (day === 0 || day === 6) return false;
  const hours = taipei.getHours();
  const minutes = taipei.getMinutes();
  const timeMinutes = hours * 60 + minutes;
  return timeMinutes >= 540 && timeMinutes <= 810; // 09:00 ~ 13:30
}

/**
 * TWSE 即時報價（盤中使用）
 * 回傳最新成交價
 */
export async function getRealtimePrice(code: string, market: 'tse' | 'otc'): Promise<number | null> {
  try {
    const prefix = market === 'tse' ? 'tse' : 'otc';
    const url = `${TWSE_REALTIME}?ex_ch=${prefix}_${code}.tw&json=1&delay=0`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const data = await res.json() as any;
    const info = data?.msgArray?.[0];
    if (!info) return null;

    // z = 最新成交價，y = 昨收
    const price = parseFloat(info.z);
    if (!isNaN(price) && price > 0) return price;

    // 尚未成交，用昨收
    const yesterday = parseFloat(info.y);
    if (!isNaN(yesterday) && yesterday > 0) return yesterday;

    return null;
  } catch (err) {
    console.warn(`[stock-price] TWSE 即時報價失敗 (${code}): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * FinMind API 取得歷史 OHLC 資料
 */
export async function getDailyOHLC(code: string, startDate: string, endDate?: string): Promise<OHLCData[]> {
  const end = endDate ?? startDate;
  const params = new URLSearchParams({
    dataset: 'TaiwanStockPrice',
    data_id: code,
    start_date: startDate,
    end_date: end,
  });
  if (FINMIND_TOKEN) params.set('token', FINMIND_TOKEN);

  const url = `${FINMIND_BASE}?${params}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`[stock-price] FinMind API 回應 ${res.status}`);
      return [];
    }

    const json = await res.json() as any;
    if (json.status !== 200 || !Array.isArray(json.data)) {
      console.warn(`[stock-price] FinMind API 錯誤: ${json.msg ?? 'unknown'}`);
      return [];
    }

    return json.data.map((d: any) => ({
      date: d.date,
      open: d.open,
      high: d.max,
      low: d.min,
      close: d.close,
    }));
  } catch (err) {
    console.warn(`[stock-price] FinMind API 失敗 (${code}): ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/**
 * 取得基準價格（以貼文時間為準）
 * 貼文當天 + 盤中 → TWSE 即時報價
 * 其他情況 → FinMind 貼文當日收盤價
 */
export async function getBasePrice(code: string, market: 'tse' | 'otc', postTimestamp?: string): Promise<number | null> {
  const now = new Date();
  const postDate = postTimestamp ? new Date(postTimestamp) : now;
  const postDateStr = postDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  // 貼文是今天 + 現在盤中 → 即時報價（最接近發文時的價格）
  if (postDateStr === todayStr && isMarketOpen()) {
    const price = await getRealtimePrice(code, market);
    if (price) return price;
  }

  // 查貼文當日收盤價
  const ohlc = await getDailyOHLC(code, postDateStr);
  if (ohlc.length > 0) return ohlc[0].close;

  // fallback：貼文日期往前查 5 天（處理週末/假日）
  const fallbackStart = new Date(postDate);
  fallbackStart.setDate(fallbackStart.getDate() - 5);
  const startStr = fallbackStart.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const recent = await getDailyOHLC(code, startStr, postDateStr);
  if (recent.length > 0) return recent[recent.length - 1].close;

  return null;
}
