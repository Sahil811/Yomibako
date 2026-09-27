// Per-volume reading position, so reopening a volume resumes where you stopped.
//
// Each entry uses a hash-only key accepted by SecureStore. The original shared
// JSON blob capped history at 80 volumes; a multi-series shelf or Detective
// Conan alone can exceed that, so reads migrate transparently to independent
// entries with no practical collection-size limit.
import { getItemAsync, setItemAsync } from '../../services/storage';
import { loadProgressIndex, saveProgressIndex, mergeIndexWithFallback } from '../../services/progressIndex';

const LEGACY_KEY = 'yomibako_reader_positions';
const ENTRY_PREFIX = 'yomibako_reader_position.';

type Entry = { p: number; t: number; n?: number };
type Blob = Record<string, Entry>;

let legacyCache: Blob | null = null;
const entryCache = new Map<string, Entry | null>();
const dirty = new Set<string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let indexCache: Blob | null = null;
let indexLoaded = false;

// Stable, short id for a volume URI (content:// URIs are long and unstable to slice).
export function volumeKey(uri: string): string {
  let h = 5381;
  for (let i = 0; i < uri.length; i++) h = Math.trunc((h << 5) + h + (uri.codePointAt(i) ?? 0));
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
  entry ??= (await readLegacy())[key] ?? null;
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
  // Keep the consolidated index fresh as a rebuildable cache (single write).
  // Per-key entries above stay authoritative; a torn index write loses nothing.
  if (keys.length && indexLoaded && indexCache) {
    try {
      for (const key of keys) {
        const entry = entryCache.get(key);
        if (entry) indexCache[key] = entry;
      }
      await saveProgressIndex(indexCache);
    } catch {}
  }
}

/**
 * Bulk hydration for library shelf — F1. Single index read instead of 100+
 * per-volume SecureStore round-trips. Misses fall back to per-key reads and
 * rebuild the index in the background (no data loss on partial blob).
 */
export async function getBulkReading(
  uris: string[]
): Promise<Map<string, { page: number; total?: number; updatedAt: number } | null>> {
  const out = new Map<string, { page: number; total?: number; updatedAt: number } | null>();
  if (!uris.length) return out;
  if (!indexLoaded) {
    try {
      indexCache = await loadProgressIndex();
    } catch {
      indexCache = {};
    }
    indexLoaded = true;
  }
  const index = indexCache ?? {};
  const missing: string[] = [];
  const keyFor = new Map<string, string>();
  for (const uri of uris) {
    const key = volumeKey(uri);
    keyFor.set(uri, key);
    const cached = entryCache.get(key);
    if (cached !== undefined) {
      out.set(uri, cached ? { page: cached.p, total: cached.n, updatedAt: cached.t } : null);
      continue;
    }
    const indexed = index[key];
    if (indexed && typeof indexed.p === 'number') {
      entryCache.set(key, indexed);
      out.set(uri, { page: indexed.p, total: indexed.n, updatedAt: indexed.t });
    } else {
      missing.push(uri);
    }
  }
  if (missing.length) {
    // Fallback path: per-key reads only for misses, then rebuild index.
    const fallback: Record<string, Entry | null> = {};
    for (const uri of missing) {
      const entry = await readEntry(uri);
      const key = keyFor.get(uri) ?? volumeKey(uri);
      fallback[key] = entry;
      out.set(uri, entry ? { page: entry.p, total: entry.n, updatedAt: entry.t } : null);
    }
    try {
      const merged = mergeIndexWithFallback(index, fallback);
      indexCache = merged;
      // Best-effort rebuild, held automatically while storage is corrupt.
      void saveProgressIndex(merged);
    } catch {}
  }
  return out;
}

/** Test-only: clear in-memory caches and timers. */
export function __resetProgressForTests() {
  legacyCache = null;
  entryCache.clear();
  dirty.clear();
  indexCache = null;
  indexLoaded = false;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}
