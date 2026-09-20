// Yomibako local cache helper — direct without copy for large libraries
// Handles content:// SAF URIs (Android) and file:// (iOS) so WebView can load manga images
// Strategy: on volume open, copy single volume (html + ~180 jpgs ~50MB) to cacheDirectory/yomibako/<series>/<volume>
// Then WebView baseUrl is file:// cache path - no http server needed for MVP, instant relative resolve
// For 5.6GB library, no full copy, only active volume cached + LRU eviction
// Expo SDK 57+: new Directory/File API

import { Platform } from 'react-native';
import { unzip } from 'react-native-zip-archive';

import { Paths, Directory, File } from 'expo-file-system';

function cacheDir(...segments: string[]) {
  return new Directory(Paths.cache, 'yomibako', ...segments);
}

// Page-image cache accounting.
//
// Opening a SAF volume copies its entire page set (~50MB for 180 pages) into
// the cache, so a few volumes per session are enough to fill the device. Every
// prepared volume is recorded below and the least recently opened ones are
// dropped once the total passes the budget. Recording the open time ourselves
// keeps the ordering deterministic: Android reports no directory creation time
// before API 26, and directory mtime does not reliably track child writes.
const MANIFEST_NAME = 'cache-index.json';
/** Owned by clearAudioCache() in services/jpdb/audio — never evicted here. */
const AUDIO_DIR_NAME = 'audio';
const DEFAULT_CACHE_BUDGET = 1.5 * 1024 * 1024 * 1024;
/** Below this much free space the standing budget is tightened. */
const FREE_SPACE_FLOOR = 1024 * 1024 * 1024;
/** Below this much free space opening a volume fails rather than half-copying. */
const MIN_FREE_BYTES = 256 * 1024 * 1024;

type CacheManifest = Record<string, { lastOpened: number }>;

export function volumeCacheKey(safeSeries: string, safeVolume: string) {
  return `${safeSeries}/${safeVolume}`;
}

function readManifest(): CacheManifest {
  try {
    const file = new File(cacheDir(), MANIFEST_NAME);
    if (!file.exists) return {};
    const parsed = JSON.parse(file.textSync());
    return parsed && typeof parsed === 'object' ? (parsed as CacheManifest) : {};
  } catch {
    return {};
  }
}

function writeManifest(manifest: CacheManifest) {
  try {
    ensureDir(cacheDir());
    const file = new File(cacheDir(), MANIFEST_NAME);
    if (!file.exists) file.create({ intermediates: true });
    file.write(JSON.stringify(manifest), { encoding: 'utf8' });
  } catch (e) {
    console.warn('cache manifest write', e);
  }
}

function touchVolumeCache(key: string) {
  const manifest = readManifest();
  manifest[key] = { lastOpened: Date.now() };
  writeManifest(manifest);
}

function directoryBytes(dir: Directory): number {
  try {
    return dir.size ?? 0;
  } catch {
    return 0;
  }
}

function directoryTime(dir: Directory): number {
  try {
    return dir.info().modificationTime ?? 0;
  } catch {
    return 0;
  }
}

function listSeriesDirs(): Directory[] {
  const root = cacheDir();
  if (!root.exists) return [];
  try {
    return root
      .list()
      .filter((entry): entry is Directory => entry instanceof Directory)
      .filter((entry) => entry.name !== AUDIO_DIR_NAME);
  } catch {
    return [];
  }
}

type CachedVolume = { key: string; dir: Directory; bytes: number; lastOpened: number };

function listCachedVolumes(manifest: CacheManifest): CachedVolume[] {
  const out: CachedVolume[] = [];
  for (const seriesDir of listSeriesDirs()) {
    let entries: (File | Directory)[];
    try {
      entries = seriesDir.list();
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!(entry instanceof Directory)) continue;
      const key = volumeCacheKey(seriesDir.name, entry.name);
      out.push({
        key,
        dir: entry,
        bytes: directoryBytes(entry),
        // Volumes cached before the manifest existed fall back to mtime.
        lastOpened: manifest[key]?.lastOpened ?? directoryTime(entry),
      });
    }
  }
  return out;
}

// A series directory also holds each volume's loose .html (and .zip for .mokuro
// imports). Once no volume directories remain, those belong to nothing.
function pruneEmptySeriesDirs() {
  for (const seriesDir of listSeriesDirs()) {
    try {
      const hasVolume = seriesDir.list().some((entry) => entry instanceof Directory);
      if (!hasVolume) seriesDir.delete();
    } catch (e) {
      console.warn('prune series dir', seriesDir.name, e);
    }
  }
}

function ensureDir(dir: Directory) {
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  } catch (e) {
    console.warn('ensureDir', dir.uri, e);
  }
}

function ensureParentForFile(file: File) {
  try {
    const parent = file.parentDirectory;
    if (!parent.exists) parent.create({ intermediates: true, idempotent: true });
  } catch {}
}

async function copyFile(srcUri: string, destUri: string) {
  const src = new File(srcUri);
  const dest = new File(destUri);
  ensureParentForFile(dest);
  try {
    await src.copy(dest, { overwrite: true });
    return;
  } catch {
    // SAF quirks fallback: read + write
  }
  try {
    const isBin = /\.(jpeg|jpg|png|webp|zip)$/i.test(srcUri);
    if (isBin) {
      const b64 = await src.base64();
      try {
        if (!dest.exists) dest.create({ intermediates: true });
      } catch {}
      dest.write(b64, { encoding: 'base64' });
    } else {
      const txt = await src.text();
      try {
        if (!dest.exists) dest.create({ intermediates: true });
      } catch {}
      dest.write(txt, { encoding: 'utf8' });
    }
  } catch (e) {
    console.warn('copyFile fallback failed', srcUri, e);
    throw e;
  }
}

// Prepare volume for WebView: returns local html file uri and baseUrl dir
// volume.htmlUri = content://.../Detective Conan/Meitantei Konan 001.mobile.html
// volume.uri = content://.../Detective Conan/Meitantei Konan 001
function sanitizeCacheSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_ ]/g, '_');
}

function findUnzippedHtml(names: string[]): string | undefined {
  return names.find((f) => f.endsWith('.mobile.html')) ?? names.find((f) => f.endsWith('.html'));
}

async function prepareMokuroVolume(
  safeSeries: string,
  safeVolume: string,
  mokuroUri: string
): Promise<{ localHtmlUri: string; baseUrl: string; isZipped?: boolean } | null> {
  const seriesDir = cacheDir(safeSeries);
  const volumeDir = cacheDir(safeSeries, safeVolume);
  ensureDir(seriesDir);
  ensureDir(volumeDir);
  touchVolumeCache(volumeCacheKey(safeSeries, safeVolume));
  await reserveSpaceFor(volumeCacheKey(safeSeries, safeVolume));
  const zipFile = new File(seriesDir, `${safeVolume}.zip`);
  await copyFile(mokuroUri, zipFile.uri);
  try {
    await unzip(zipFile.uri, volumeDir.uri);
    // Find html inside
    const items = volumeDir.list();
    const names = items.map((i) => i.name);
    const htmlName = findUnzippedHtml(names);
    if (htmlName) {
      const htmlFile = new File(volumeDir, htmlName);
      return { localHtmlUri: htmlFile.uri, baseUrl: volumeDir.uri, isZipped: true };
    }
  } catch (e) {
    console.warn('unzip failed', e);
  }
  return null;
}

function isContentVolume(htmlUri: string, uri: string): boolean {
  return htmlUri.startsWith('content://') || uri.startsWith('content://');
}

async function copyVolumeImages(volumeUri: string, cacheVolumeDir: Directory, onProgress?: (done: number, total: number) => void) {
  const probe = new File(cacheVolumeDir, 'page0001.jpeg');
  if (probe.exists) {
    onProgress?.(1, 1);
    return;
  }
  const all = new Directory(volumeUri).list();
  const imgs = all.filter(
    (entry) => !(entry instanceof Directory) && /\.(jpeg|jpg|png|webp)$/i.test(entry.name)
  );
  let done = 0;
  onProgress?.(0, imgs.length);
  for (const entry of imgs) {
    await copySingleImage(entry, cacheVolumeDir);
    done++;
    if (done % 10 === 0 || done === imgs.length) onProgress?.(done, imgs.length);
  }
}

async function copySingleImage(entry: File | Directory, cacheVolumeDir: Directory) {
  if (entry instanceof Directory) return;
  const dest = new File(cacheVolumeDir, entry.name);
  if (dest.exists) return;
  try {
    await copyFile(entry.uri, dest.uri);
  } catch (e) {
    console.warn('copy image', entry.name, e);
  }
}

export async function prepareVolumeForWebView(
  volume: {
    htmlUri?: string;
    mokuroUri?: string;
    uri: string;
    title: string;
    series?: string;
  },
  onProgress?: (done: number, total: number) => void
): Promise<{ localHtmlUri: string; baseUrl: string; isZipped?: boolean }> {
  const seriesName = volume.series ?? 'Detective Conan';
  const safeSeries = sanitizeCacheSegment(seriesName);
  const safeVolume = sanitizeCacheSegment(volume.title);

  // Handle .mokuro zip (single file share, iOS friendly) - unzip to cache
  if (volume.mokuroUri && !volume.htmlUri) {
    const unzipped = await prepareMokuroVolume(safeSeries, safeVolume, volume.mokuroUri);
    if (unzipped) return unzipped;
  }

  if (!volume.htmlUri) throw new Error('No htmlUri for volume');

  // Content:// needs copy to cache for file:// WebView access
  if (Platform.OS === 'web' || !isContentVolume(volume.htmlUri, volume.uri)) {
    // file:// can be loaded directly - baseUrl is parent dir
    const baseUrl = volume.uri.endsWith('/') ? volume.uri : volume.uri + '/';
    return { localHtmlUri: volume.htmlUri, baseUrl };
  }

  // SAF content:// -> copy to cache preserving relative structure
  const cacheSeriesDir = cacheDir(safeSeries);
  const cacheVolumeDir = cacheDir(safeSeries, safeVolume);
  ensureDir(cacheSeriesDir);
  ensureDir(cacheVolumeDir);

  // Mark this volume as most recently used before sweeping, so the sweep can
  // never reclaim the one being opened.
  touchVolumeCache(volumeCacheKey(safeSeries, safeVolume));
  await reserveSpaceFor(volumeCacheKey(safeSeries, safeVolume));

  const htmlFileName = new File(volume.htmlUri).name || `${safeVolume}.html`;
  const localHtmlFile = new File(cacheSeriesDir, htmlFileName);

  // Copy html (1x)
  try {
    await copyFile(volume.htmlUri, localHtmlFile.uri);
  } catch (e) {
    console.warn('copy html', e);
  }

  // Copy images for this volume (lazy, only if not cached)
  try {
    await copyVolumeImages(volume.uri, cacheVolumeDir, onProgress);
  } catch (e) {
    console.warn('copy images', e);
  }

  // baseUrl must be cacheSeriesDir so relative "Meitantei Konan 001/page0001.jpeg" resolves
  return { localHtmlUri: localHtmlFile.uri, baseUrl: cacheSeriesDir.uri };
}

/**
 * Drop least-recently-opened volumes until the page cache fits the budget.
 * `keepKey` is never evicted, so the volume being opened survives its own sweep.
 */
export async function evictOldCaches(maxBytes = DEFAULT_CACHE_BUDGET, keepKey?: string) {
  try {
    if (!cacheDir().exists) return;
    const manifest = readManifest();
    const volumes = listCachedVolumes(manifest);
    let total = volumes.reduce((sum, volume) => sum + volume.bytes, 0);

    // A nearly full device needs a tighter budget than the standing one.
    let budget = maxBytes;
    const free = Paths.availableDiskSpace;
    if (typeof free === 'number' && free > 0 && free < FREE_SPACE_FLOOR) {
      budget = Math.max(0, Math.min(budget, total - (FREE_SPACE_FLOOR - free)));
    }
    if (total <= budget) return;

    const stale = volumes
      .filter((volume) => volume.key !== keepKey)
      .sort((a, b) => a.lastOpened - b.lastOpened);

    let evicted = false;
    for (const volume of stale) {
      if (total <= budget) break;
      try {
        volume.dir.delete();
        total -= volume.bytes;
        delete manifest[volume.key];
        evicted = true;
      } catch (e) {
        console.warn('evict volume', volume.key, e);
      }
    }

    if (evicted) {
      writeManifest(manifest);
      pruneEmptySeriesDirs();
    }
  } catch (e) {
    console.warn('evictOldCaches', e);
  }
}

/**
 * Make room before a copy that can add ~50MB, and fail loudly rather than
 * leaving a half-copied volume the reader would render as broken pages.
 */
async function reserveSpaceFor(key: string) {
  await evictOldCaches(DEFAULT_CACHE_BUDGET, key);
  const free = Paths.availableDiskSpace;
  if (typeof free === 'number' && free > 0 && free < MIN_FREE_BYTES) {
    throw new Error('Not enough free space to open this volume. Free up space and try again.');
  }
}

export type CacheUsage = { pageBytes: number; audioBytes: number };

/** Bytes held by cached manga pages vs. cached pronunciation audio. */
export function cacheUsage(): CacheUsage {
  let pageBytes = 0;
  let audioBytes = 0;
  try {
    const root = cacheDir();
    if (!root.exists) return { pageBytes, audioBytes };
    for (const entry of root.list()) {
      if (!(entry instanceof Directory)) continue;
      if (entry.name === AUDIO_DIR_NAME) audioBytes += directoryBytes(entry);
      else pageBytes += directoryBytes(entry);
    }
  } catch (e) {
    console.warn('cacheUsage', e);
  }
  return { pageBytes, audioBytes };
}

/** Drop every cached volume. Source files are untouched; pages re-copy on open. */
export function clearPageCache() {
  try {
    const root = cacheDir();
    if (!root.exists) return;
    for (const seriesDir of listSeriesDirs()) {
      try {
        seriesDir.delete();
      } catch (e) {
        console.warn('clear page cache', seriesDir.name, e);
      }
    }
    const manifest = new File(root, MANIFEST_NAME);
    if (manifest.exists) manifest.delete();
  } catch (e) {
    console.warn('clearPageCache', e);
  }
}

export const httpServer = {
  async start(rootUri: string) {
    console.log('[yomibako] prepareVolume will be used instead of httpServer for', rootUri);
    return rootUri;
  },
  async stop() {},
  toHttpUrl: (u: string) => u,
};
