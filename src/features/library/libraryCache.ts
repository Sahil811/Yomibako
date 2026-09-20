// Cached snapshot of the scanned shelf.
//
// Every cold start otherwise re-walks each volume folder over SAF just to
// recover covers and page counts the previous run already found. This keeps the
// last good scan so the shelf paints immediately, while a live scan runs behind
// it and reconciles.
//
// Stored in the document directory, not the cache: the OS may purge the cache
// at any time, and losing this would silently bring back the slow cold start.
import { Directory, File, Paths } from 'expo-file-system';

import type { Series, Volume } from './types';

const FILE_NAME = 'library-index.json';
/** Bump when the shape below changes so stale entries are dropped, not misread. */
export const INDEX_VERSION = 1;

type Stored = { version: number; roots: string[]; series: Series[] };

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pending: Stored | null = null;

function indexFile(): File {
  const dir = new Directory(Paths.document, 'yomibako');
  if (!dir.exists) dir.create({ intermediates: true });
  return new File(dir, FILE_NAME);
}

// Written by an older build, hand-edited, or truncated mid-write: accept only
// fields we can use and let the live scan supply the rest.
export function normalizeVolume(raw: any): Volume | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || typeof raw.uri !== 'string') return null;
  if (typeof raw.title !== 'string' || typeof raw.series !== 'string') return null;
  const volume: Volume = {
    id: raw.id,
    series: raw.series,
    title: raw.title,
    uri: raw.uri,
    pageCount: Number(raw.pageCount) || 0,
  };
  if (typeof raw.progressKey === 'string') volume.progressKey = raw.progressKey;
  if (typeof raw.htmlUri === 'string') volume.htmlUri = raw.htmlUri;
  if (typeof raw.mokuroUri === 'string') volume.mokuroUri = raw.mokuroUri;
  if (typeof raw.ocrUri === 'string') volume.ocrUri = raw.ocrUri;
  if (typeof raw.coverUri === 'string') volume.coverUri = raw.coverUri;
  return volume;
}

export function normalizeSeries(raw: any): Series | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.name !== 'string' || typeof raw.rootUri !== 'string') return null;
  const volumes: Volume[] = Array.isArray(raw.volumes)
    ? raw.volumes.map(normalizeVolume).filter((v: Volume | null): v is Volume => !!v)
    : [];
  if (!volumes.length) return null;
  const series: Series = {
    name: raw.name,
    rootUri: raw.rootUri,
    volumes,
    totalPages: Number(raw.totalPages) || volumes.reduce((sum, v) => sum + v.pageCount, 0),
  };
  if (typeof raw.sourceRootUri === 'string') series.sourceRootUri = raw.sourceRootUri;
  return series;
}

/**
 * Last known shelf, limited to series still reachable from a granted root.
 * Returns an empty array when there is nothing usable — callers always follow
 * up with a live scan, so a miss only costs the old behaviour.
 *
 * Progress and removal are NOT baked in here; callers must still funnel the
 * result through the same path a live scan takes.
 */
export async function loadLibraryIndex(roots: string[]): Promise<Series[]> {
  try {
    const file = indexFile();
    if (!file.exists) return [];
    const raw = JSON.parse(await file.text());
    if (raw?.version !== INDEX_VERSION || !Array.isArray(raw?.series)) return [];
    const granted = new Set(roots);
    return raw.series
      .map(normalizeSeries)
      .filter((series: Series | null): series is Series => !!series)
      .filter((series: Series) => granted.has(series.sourceRootUri ?? series.rootUri) || granted.has(series.rootUri));
  } catch {
    // A corrupt index is not worth reporting: the scan rebuilds it.
    return [];
  }
}

function flushIndex() {
  const next = pending;
  pending = null;
  if (!next) return;
  try {
    const file = indexFile();
    if (!file.exists) file.create({ intermediates: true });
    file.write(JSON.stringify(next), { encoding: 'utf8' });
  } catch {
    // Best effort — the shelf still works, it just starts cold next time.
  }
}

/** Debounced: a streaming scan calls this repeatedly as series arrive. */
export function saveLibraryIndex(series: Series[], roots: string[]) {
  if (!series.length) return;
  pending = { version: INDEX_VERSION, roots, series };
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushIndex();
  }, 800);
}

/** Test-only: flush synchronously + clear timers. */
export function __flushLibraryIndexForTests() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  flushIndex();
}

/** Test-only: clear pending/timers. */
export function __resetLibraryCacheForTests() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  pending = null;
}
