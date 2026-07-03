import { describe, expect, it } from 'vitest';
import { escapeHtml, splitMessage } from '../src/notifiers/format.js';

describe('notifier format helpers', () => {
  it('escapes html-sensitive characters', () => {
    expect(escapeHtml('<b>台積電 & 聯發科</b>')).toBe('&lt;b&gt;台積電 &amp; 聯發科&lt;/b&gt;');
  });

  it('splits long messages on line boundaries when possible', () => {
    expect(splitMessage('第一行\n第二行\n第三行', 8)).toEqual(['第一行\n第二行', '第三行']);
  });

  it('falls back to hard splits when no boundary exists', () => {
    expect(splitMessage('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
});
