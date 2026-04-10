import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export interface StockInfo {
  code: string;
  name: string;
  market: 'tse' | 'otc';
}

export interface ResolvedStock {
  code: string;
  market: 'tse' | 'otc';
}

let stockList: StockInfo[] | null = null;

function loadStockList(): StockInfo[] {
  if (stockList) return stockList;

  // 嘗試從專案 data/ 目錄載入
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(__dirname, '..', 'data', 'tw-stock-list.json'),
    join(__dirname, 'data', 'tw-stock-list.json'),
  ];

  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf-8');
      stockList = JSON.parse(raw) as StockInfo[];
      console.log(`[stock-map] 載入 ${stockList.length} 檔股票映射（${path}）`);
      return stockList;
    } catch {
      // 繼續嘗試下一個路徑
    }
  }

  console.warn('[stock-map] 找不到 tw-stock-list.json，名稱映射將無法使用');
  stockList = [];
  return stockList;
}

/**
 * 名稱→代碼映射
 * 匹配順序：完全匹配 → 包含匹配 → 反向包含
 */
export function resolveStock(name: string): ResolvedStock | null {
  const list = loadStockList();
  if (list.length === 0) return null;

  const trimmed = name.trim();

  // 1. 完全匹配
  const exact = list.find((s) => s.name === trimmed);
  if (exact) return { code: exact.code, market: exact.market };

  // 2. 包含匹配：輸入名稱包含在股票名稱中（如「台光電」→「台光電」）
  const contains = list.find((s) => s.name.includes(trimmed));
  if (contains) return { code: contains.code, market: contains.market };

  // 3. 反向包含：股票名稱包含在輸入中（如「台積電ADR」→「台積電」）
  const reverse = list.find((s) => trimmed.includes(s.name));
  if (reverse) return { code: reverse.code, market: reverse.market };

  return null;
}
