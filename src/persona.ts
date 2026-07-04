import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config-store.js';

export const DEFAULT_PROMPT_SENTINEL = '__DEFAULT_SYSTEM_PROMPT__';

export interface Persona {
  id: string;
  displayName: string;
  source: {
    type: 'facebook';
    target: string;
  };
  analysis: {
    mode: 'reverse' | 'forward';
    promptTemplate: string;
    trackingDays: number;
    thresholdPct: number;
  };
}

export function getDefaultPersonaPath(): string {
  return fileURLToPath(new URL('../personas/banini.json', import.meta.url));
}

export function getPersonaPathArg(args: string[] = process.argv): string | undefined {
  const inline = args.find((arg) => arg.startsWith('--persona='));
  if (inline) return inline.slice('--persona='.length);

  const index = args.indexOf('--persona');
  if (index >= 0) return args[index + 1];

  return undefined;
}

export function loadPersona(pathArg?: string): Persona {
  const configuredPath = pathArg || process.env.PERSONA_PATH || getStoredPersonaPath();
  const personaPath = configuredPath ? resolve(configuredPath) : getDefaultPersonaPath();

  if (!existsSync(personaPath)) {
    throw new Error(`Persona 設定檔不存在: ${personaPath}`);
  }

  const raw = JSON.parse(readFileSync(personaPath, 'utf-8')) as Partial<Persona>;
  validatePersona(raw, personaPath);
  return raw;
}

export function resolvePromptTemplate(persona: Persona, defaultPrompt: string): string {
  return persona.analysis.promptTemplate === DEFAULT_PROMPT_SENTINEL
    ? defaultPrompt
    : persona.analysis.promptTemplate;
}

export function getPersonaSourceTarget(persona: Persona, sourceType: 'facebook'): string {
  if (persona.source.type !== sourceType) {
    throw new Error(`Persona ${persona.id} 不支援來源: ${sourceType}`);
  }
  return persona.source.target;
}

function getStoredPersonaPath(): string {
  try {
    return getConfig('PERSONA_PATH');
  } catch {
    return '';
  }
}

function validatePersona(raw: Partial<Persona>, personaPath: string): asserts raw is Persona {
  if (!raw.id || !raw.displayName) {
    throw new Error(`Persona 缺少 id/displayName: ${personaPath}`);
  }
  if (raw.source?.type !== 'facebook' || !raw.source.target) {
    throw new Error(`Persona 缺少 facebook source.target: ${personaPath}`);
  }
  if (!raw.analysis) {
    throw new Error(`Persona 缺少 analysis: ${personaPath}`);
  }
  if (raw.analysis.mode !== 'reverse' && raw.analysis.mode !== 'forward') {
    throw new Error(`Persona analysis.mode 必須為 reverse 或 forward: ${personaPath}`);
  }
  if (!raw.analysis.promptTemplate) {
    throw new Error(`Persona 缺少 analysis.promptTemplate: ${personaPath}`);
  }
  if (!Number.isFinite(raw.analysis.trackingDays) || raw.analysis.trackingDays <= 0) {
    throw new Error(`Persona analysis.trackingDays 必須為正數: ${personaPath}`);
  }
  if (!Number.isFinite(raw.analysis.thresholdPct) || raw.analysis.thresholdPct <= 0) {
    throw new Error(`Persona analysis.thresholdPct 必須為正數: ${personaPath}`);
  }
}
