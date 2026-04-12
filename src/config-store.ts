/**
 * DB-backed config store with env fallback + in-memory cache.
 * Web UI writes here, cron reads here on every run().
 */
import { getDb } from './db.js';

export interface ConfigEntry {
  key: string;
  value: string;
}

const CONFIG_KEYS = [
  'APIFY_TOKEN',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'TG_BOT_TOKEN',
  'TG_CHANNEL_ID',
  'DISCORD_BOT_TOKEN',
  'DISCORD_CHANNEL_ID',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_TO',
  'TRANSCRIBER',
  'GROQ_API_KEY',
  'FINMIND_TOKEN',
] as const;

export type ConfigKey = typeof CONFIG_KEYS[number];

const DEFAULTS: Partial<Record<ConfigKey, string>> = {
  LLM_BASE_URL: 'https://api.deepinfra.com/v1/openai',
  LLM_MODEL: 'MiniMaxAI/MiniMax-M2.5',
  TRANSCRIBER: 'noop',
};

let cache: Map<string, string> | null = null;
let cacheVersion = 0;

/** Ensure config table exists */
export function initConfigTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);
}

/** Get a single config value: DB > env > default */
export function getConfig(key: ConfigKey): string {
  loadCache();
  return cache!.get(key) || process.env[key] || DEFAULTS[key] || '';
}

/** Get all config as object */
export function getAllConfig(): Record<ConfigKey, string> {
  loadCache();
  const result = {} as Record<ConfigKey, string>;
  for (const key of CONFIG_KEYS) {
    result[key] = cache!.get(key) || process.env[key] || DEFAULTS[key] || '';
  }
  return result;
}

/** Set a single config value in DB */
export function setConfig(key: ConfigKey, value: string): void {
  const db = getDb();
  initConfigTable();
  db.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
  cache = null; // invalidate
  cacheVersion++;
}

/** Batch set multiple config values */
export function setConfigs(entries: Partial<Record<ConfigKey, string>>): void {
  const db = getDb();
  initConfigTable();
  const upsert = db.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const [key, value] of Object.entries(entries)) {
      if (CONFIG_KEYS.includes(key as ConfigKey)) {
        upsert.run(key, value ?? '');
      }
    }
  })();
  cache = null; // invalidate
  cacheVersion++;
}

/** Current cache version, can be used for hot-reload detection */
export function getConfigVersion(): number {
  return cacheVersion;
}

/** Valid config keys list */
export function getConfigKeys(): readonly string[] {
  return CONFIG_KEYS;
}

function loadCache(): void {
  if (cache) return;
  initConfigTable();
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM config').all() as ConfigEntry[];
  cache = new Map(rows.map((r) => [r.key, r.value]));
}
