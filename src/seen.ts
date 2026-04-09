import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getSeenFile } from './config.js';

function loadIds(): string[] {
  const file = getSeenFile();
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveIds(ids: string[]): void {
  const file = getSeenFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(ids.slice(-500), null, 2), 'utf-8');
}

export function isPostSeen(id: string): boolean {
  return loadIds().includes(id);
}

export function markPostsSeen(ids: string[]): void {
  const existing = loadIds();
  const set = new Set(existing);
  for (const id of ids) set.add(id);
  saveIds([...set]);
}

export function filterNewPosts<T extends { id: string }>(posts: T[]): T[] {
  const seen = new Set(loadIds());
  return posts.filter((p) => !seen.has(p.id));
}

export function listSeenIds(): string[] {
  return loadIds();
}

export function clearSeen(): void {
  const file = getSeenFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '[]', 'utf-8');
}
