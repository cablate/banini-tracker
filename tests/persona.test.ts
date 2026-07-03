import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPersona, resolvePromptTemplate } from '../src/persona.js';

describe('persona', () => {
  it('loads a custom persona and uses its prompt/tracking parameters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'banini-persona-'));
    const personaPath = join(dir, 'custom.json');

    try {
      writeFileSync(
        personaPath,
        JSON.stringify(
          {
            id: 'custom',
            displayName: '自訂人物',
            source: { type: 'facebook', target: 'https://example.com/profile' },
            analysis: {
              mode: 'reverse',
              promptTemplate: '自訂 prompt',
              trackingDays: 3,
              thresholdPct: 2.5,
            },
          },
          null,
          2,
        ),
        'utf-8',
      );

      const persona = loadPersona(personaPath);

      expect(persona.displayName).toBe('自訂人物');
      expect(persona.source.target).toBe('https://example.com/profile');
      expect(persona.analysis.trackingDays).toBe(3);
      expect(persona.analysis.thresholdPct).toBe(2.5);
      expect(resolvePromptTemplate(persona, 'default prompt')).toBe('自訂 prompt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
