import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Config {
  apifyToken: string;
  telegram?: {
    botToken: string;
    channelId: string;
  };
  targets: {
    facebookPageUrl: string;
  };
}

const CONFIG_PATH = join(homedir(), '.banini-tracker.json');
const DATA_DIR = join(homedir(), '.banini-tracker');
const SEEN_FILE = join(DATA_DIR, 'seen.json');

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getDataDir(): string {
  return DATA_DIR;
}

export function getSeenFile(): string {
  return SEEN_FILE;
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `設定檔不存在: ${CONFIG_PATH}\n請先執行 banini-tracker init 進行初始設定`,
    );
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  if (!raw.apifyToken) throw new Error('設定檔缺少 apifyToken');
  if (!raw.targets?.facebookPageUrl) {
    throw new Error('設定檔缺少 targets.facebookPageUrl 設定');
  }
  return raw as Config;
}

export function saveConfig(config: Config): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function defaultConfig(): Config {
  return {
    apifyToken: '',
    telegram: {
      botToken: '',
      channelId: '',
    },
    targets: {
      facebookPageUrl: 'https://www.facebook.com/DieWithoutBang/',
    },
  };
}
