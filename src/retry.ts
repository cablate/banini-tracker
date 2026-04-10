export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  label?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 3000, label = '' } = opts;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        const delay = baseDelayMs * attempt;
        console.error(`[${label}] 第 ${attempt} 次失敗: ${msg}，${delay / 1000}s 後重試...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        console.error(`[${label}] 第 ${attempt} 次失敗: ${msg}，已達重試上限`);
      }
    }
  }
  throw lastError;
}
