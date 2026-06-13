import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HistoryEntry } from './types.ts';

const HISTORY_PATH = 'data/post-history.json';

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(HISTORY_PATH, 'utf8');
    return JSON.parse(raw) as HistoryEntry[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  const existing = await loadHistory();
  existing.push(entry);
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(existing, null, 2));
}
