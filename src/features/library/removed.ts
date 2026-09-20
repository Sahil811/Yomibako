// Volumes and series the user removed from the library.
//
// Removal has to survive a rescan: the files stay on disk, so the next launch
// would happily find them again. Entries are stored as short hashes because
// SAF content:// URIs are long and SecureStore values are size limited.
import { getItemAsync, setItemAsync } from '../../services/storage';
import { volumeKey } from '../reader/progress';
import type { Series } from './types';

const KEY = 'yomibako_library_removed';

let cache: Set<string> | null = null;

async function load(): Promise<Set<string>> {
  if (cache) return cache;
  try {
    const raw = await getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

async function persist(next: Set<string>) {
  cache = next;
  try {
    await setItemAsync(KEY, JSON.stringify([...next]));
  } catch {}
}

export async function loadRemoved(): Promise<Set<string>> {
  return new Set(await load());
}

export async function markRemoved(uris: string[]): Promise<Set<string>> {
  const next = new Set(await load());
  for (const uri of uris) next.add(volumeKey(uri));
  await persist(next);
  return new Set(next);
}

export async function restoreRemoved(uris: string[]): Promise<Set<string>> {
  const next = new Set(await load());
  for (const uri of uris) next.delete(volumeKey(uri));
  await persist(next);
  return new Set(next);
}

export async function clearRemoved(): Promise<Set<string>> {
  await persist(new Set());
  return new Set();
}

// Drops removed series and removed volumes from freshly scanned results.
export function withoutRemoved(series: Series[], removed: Set<string>): Series[] {
  if (!removed.size) return series;
  const kept: Series[] = [];
  for (const item of series) {
    if (removed.has(volumeKey(item.rootUri))) continue;
    const volumes = item.volumes.filter((volume) => !removed.has(volumeKey(volume.id)));
    if (!volumes.length) continue;
    kept.push({
      ...item,
      volumes,
      totalPages: volumes.reduce((count, volume) => count + volume.pageCount, 0),
    });
  }
  return kept;
}
