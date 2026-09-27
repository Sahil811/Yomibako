// Merging scan results into the shelf without wiping what is already on screen.
//
// A scan never arrives whole. It streams: first one shell per volume (names
// only, pageCount 0, coverUri undefined) right after a single folder listing,
// then a snapshot that grows one volume at a time as every volume folder is
// walked over SAF, then a final result once the root is done. If each of those
// drafts replaces the series wholesale, everything the cached index already
// knew — covers, page counts, progress — disappears and streams back in. That
// is what reads as "the library renders again" on every app start.
//
// Two modes:
//   patch   — a partial/streaming draft. Never removes, never downgrades detail.
//   replace — the authoritative result of a finished root walk; deletions count.
import type { Series, Volume } from './types';

export type AbsorbMode = 'patch' | 'replace';
export type AbsorbFn = (incoming: Series[], mode: AbsorbMode) => void;

// Cached collator: a new Intl.Collator per comparison is brutal when
// re-sorting 100+ volumes on every streaming scan update. Series names,
// volume titles, and file names all want the same order, so one instance
// serves everything. Single source of truth — scanner must use these too,
// otherwise patch order differs from replace order and the shelf reshuffles.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const compareStrings = (a: string, b: string) => collator.compare(a, b);

export const compareTitle = (a: { title: string }, b: { title: string }) => collator.compare(a.title, b.title);

export function seriesKey(series: Series): string {
  return series.rootUri;
}

export function recount(series: Series, volumes: Volume[]): Series {
  return { ...series, volumes, totalPages: volumes.reduce((count, volume) => count + volume.pageCount, 0) };
}

/** Same order the scanner publishes in, so patched lists never reshuffle. */
export function sortVolumes(volumes: Volume[]): Volume[] {
  return [...volumes].sort(compareTitle);
}

function indexByRoot(current: Series[]): Map<string, Series> {
  return new Map(current.map((item) => [seriesKey(item), item]));
}

function sortedRoots(byRoot: Map<string, Series>): Series[] {
  return [...byRoot.values()].sort((a, b) => collator.compare(a.name, b.name));
}

function sameList<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((item, index) => b[index] === item);
}

/** Authoritative: an incoming series replaces the one we held for that root. */
export function mergeSeries(current: Series[], incoming: Series[]): Series[] {
  const byRoot = indexByRoot(current);
  for (const item of incoming) byRoot.set(seriesKey(item), item);
  return sortedRoots(byRoot);
}

function sameVolume(a: Volume, b: Volume): boolean {
  return (
    a.title === b.title &&
    a.series === b.series &&
    a.uri === b.uri &&
    a.pageCount === b.pageCount &&
    a.coverUri === b.coverUri &&
    a.htmlUri === b.htmlUri &&
    a.mokuroUri === b.mokuroUri &&
    a.ocrUri === b.ocrUri &&
    a.progressKey === b.progressKey &&
    a.progress === b.progress &&
    a.lastOpened === b.lastOpened
  );
}

/**
 * Keep the better-known volume. Scanner output carries explicit `undefined`
 * and `0` for everything it has not listed yet, so a plain spread would let a
 * shell overwrite real detail with blanks.
 *
 * Returns `cached` untouched when the incoming volume reveals nothing new —
 * the memoised cards then bail out and the shelf does not repaint.
 */
export function mergeVolumeDetails(cached: Volume | undefined, incoming: Volume): Volume {
  if (!cached) return incoming;
  const merged: Volume = { ...cached, ...incoming };
  merged.progressKey = incoming.progressKey ?? cached.progressKey;
  merged.htmlUri = incoming.htmlUri ?? cached.htmlUri;
  merged.mokuroUri = incoming.mokuroUri ?? cached.mokuroUri;
  merged.ocrUri = incoming.ocrUri ?? cached.ocrUri;
  merged.coverUri = incoming.coverUri ?? cached.coverUri;
  // 0 pages means "not counted yet", never "this volume is empty".
  merged.pageCount = incoming.pageCount || cached.pageCount;
  // Progress is never reported by the scanner — only by SecureStore hydration.
  merged.progress = incoming.progress ?? cached.progress;
  merged.lastOpened = incoming.lastOpened ?? cached.lastOpened;
  return sameVolume(cached, merged) ? cached : merged;
}

function patchSeriesDetails(existing: Series, incoming: Series): Series {
  const byId = new Map(existing.volumes.map((volume) => [volume.id, volume]));
  // A rename or a newly discovered source root is the only label a draft may
  // change; a missing one must not wipe what is on record.
  let changed =
    incoming.name !== existing.name ||
    (!!incoming.sourceRootUri && incoming.sourceRootUri !== existing.sourceRootUri);
  for (const volume of incoming.volumes) {
    const cached = byId.get(volume.id);
    const merged = mergeVolumeDetails(cached, volume);
    if (merged !== cached) {
      byId.set(volume.id, merged);
      changed = true;
    }
  }
  // Identical reference in, identical reference out: nothing to render.
  if (!changed) return existing;
  const patched: Series = { ...existing, name: incoming.name };
  if (incoming.sourceRootUri) patched.sourceRootUri = incoming.sourceRootUri;
  return recount(patched, sortVolumes([...byId.values()]));
}

/**
 * Additive: volumes the draft has not reached yet keep the detail they had.
 * Handing back `current` when a draft adds nothing new lets `setLibrary` bail
 * out of the update entirely — that is what stops the shelf from repainting on
 * every streaming publish.
 */
export function patchSeries(current: Series[], incoming: Series[]): Series[] {
  const byRoot = indexByRoot(current);
  for (const item of incoming) {
    const key = seriesKey(item);
    const existing = byRoot.get(key);
    if (!existing) {
      byRoot.set(key, item);
      continue;
    }
    const patched = patchSeriesDetails(existing, item);
    if (patched !== existing) byRoot.set(key, patched);
  }
  const next = sortedRoots(byRoot);
  return sameList(current, next) ? current : next;
}

export function absorbSeries(current: Series[], incoming: Series[], mode: AbsorbMode): Series[] {
  return mode === 'patch' ? patchSeries(current, incoming) : mergeSeries(current, incoming);
}

/**
 * Drop series that were walked but no longer on disk.
 * `liveKeys` = seriesKeys seen in the successful walk(s).
 * `walkedSources` = sourceRootUris (shelf uris) plus single-series rootUris
 * that were walked successfully. Series whose source was not walked are kept.
 * Returns `current` untouched when nothing is pruned so setState can bail out.
 */
export function pruneMissingSeries(current: Series[], liveKeys: Set<string>, walkedSources: Set<string>): Series[] {
  if (!walkedSources.size) return current;
  let pruned = false;
  const next = current.filter((item) => {
    const source = item.sourceRootUri ?? item.rootUri;
    const walked = walkedSources.has(source) || walkedSources.has(item.rootUri);
    if (!walked) return true;
    const live = liveKeys.has(seriesKey(item));
    if (!live) pruned = true;
    return live;
  });
  if (!pruned) return current;
  return next;
}
