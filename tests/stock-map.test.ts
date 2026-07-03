import { describe, expect, it } from 'vitest';
import { resolveStock } from '../src/stock-map.js';

describe('stock-map', () => {
  it('resolves exact stock names', () => {
    expect(resolveStock('台積電')).toEqual({ code: '2330', market: 'tse' });
  });

  it('falls back to reverse contains matching', () => {
    expect(resolveStock('台積電ADR')).toEqual({ code: '2330', market: 'tse' });
  });

  it('returns null for unknown names', () => {
    expect(resolveStock('不存在的標的')).toBeNull();
  });
});
