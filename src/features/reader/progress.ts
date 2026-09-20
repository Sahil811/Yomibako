// Per-volume reading position, so reopening a volume resumes where you stopped.
//
// Each entry uses a hash-only key accepted by SecureStore. The original shared
// JSON blob capped history at 80 volumes; a multi-series shelf or Detective
// Conan alone can exceed that, so reads migrate transparently to independent
// entries with no practical collection-size limit.
import { getItemAsync, setItemAsync } from '../../services/storage';

const LEGACY_KEY = 'yomibako_reader_positions';
const ENTRY_PREFIX = 'yomibako_reader_position.';

type Entry = { p: number; t: number; n?: number };
type Blob = Record<string, Entry>;

let legacyCache: Blob | null = null;
const entryCache = new Map<string, Entry | null>();
const dirty = new Set<string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

// Stable, short id for a volume URI (content:// URIs are long and unstable to slice).
export function volumeKey(uri: string): string {
  let h = 5381;
  for (let i = 0; i < uri.length; i++) h = ((h << 5) + h + uri.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function readLegacy(): Promise<Blob> {
  if (legacyCache) return legacyCache;
  try {
    const raw = await getItemAsync(LEGACY_KEY);
    legacyCache = raw ? (JSON.parse(raw) as Blob) : {};
  } catch {
    legacyCache = {};
  }
  return legacyCache;
}

async function readEntry(uri: string): Promise<Entry | null> {
  const key = volumeKey(uri);
  if (entryCache.has(key)) return entryCache.get(key) ?? null;
  let entry: Entry | null = null;
  try {
    const raw = await getItemAsync(ENTRY_PREFIX + key);
    if (raw) entry = JSON.parse(raw) as Entry;
  } catch {}
  if (!entry) entry = (await readLegacy())[key] ?? null;
  if (!entry || typeof entry.p !== 'number') entry = null;
  entryCache.set(key, entry);
  return entry;
}

export async function getSavedPage(uri: string): Promise<number | null> {
  const entry = await readEntry(uri);
  return entry?.p ?? null;
}

export async function getSavedReading(uri: string): Promise<{ page: number; total?: number; updatedAt: number } | null> {
  const entry = await readEntry(uri);
  if (!entry) return null;
  return { page: entry.p, total: entry.n, updatedAt: typeof entry.t === 'number' ? entry.t : 0 };
}

// Debounced: page turns fire far faster than SecureStore can commit.
export function savePage(uri: string, page: number, total?: number) {
  if (!Number.isFinite(page) || page < 0) return;
  const key = volumeKey(uri);
  entryCache.set(key, {
    p: Math.round(page),
    t: Date.now(),
    ...(Number.isFinite(total) && Number(total) > 0 ? { n: Math.round(Number(total)) } : {}),
  });
  dirty.add(key);
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void flush();
  }, 1200);
}

export async function flush(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const keys = [...dirty];
  for (const key of keys) {
    const entry = entryCache.get(key);
    if (!entry) continue;
    try {
      await setItemAsync(ENTRY_PREFIX + key, JSON.stringify(entry));
      dirty.delete(key);
    } catch {}
  }
}

/** Test-only: clear in-memory caches and timers. */
export function __resetProgressForTests() {
  legacyCache = null;
  entryCache.clear();
  dirty.clear();
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}
