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
  const safeSeries = seriesName.replace(/[^a-zA-Z0-9-_ ]/g, '_');
  const safeVolume = volume.title.replace(/[^a-zA-Z0-9-_ ]/g, '_');

  // Handle .mokuro zip (single file share, iOS friendly) - unzip to cache
  if (volume.mokuroUri && !volume.htmlUri) {
    const seriesDir = cacheDir(safeSeries);
    const volumeDir = cacheDir(safeSeries, safeVolume);
    ensureDir(seriesDir);
    ensureDir(volumeDir);
    const zipFile = new File(seriesDir, `${safeVolume}.zip`);
    await copyFile(volume.mokuroUri, zipFile.uri);
    try {
      await unzip(zipFile.uri, volumeDir.uri);
      // Find html inside
      const items = volumeDir.list();
      const names = items.map((i) => i.name);
      const htmlName =
        names.find((f) => f.endsWith('.mobile.html')) ?? names.find((f) => f.endsWith('.html'));
      if (htmlName) {
        const htmlFile = new File(volumeDir, htmlName);
        return { localHtmlUri: htmlFile.uri, baseUrl: volumeDir.uri, isZipped: true };
      }
    } catch (e) {
      console.warn('unzip failed', e);
    }
  }

  if (!volume.htmlUri) throw new Error('No htmlUri for volume');

  // Content:// needs copy to cache for file:// WebView access
  const isContentUri = volume.htmlUri.startsWith('content://') || volume.uri.startsWith('content://');
  if (Platform.OS === 'web' || !isContentUri) {
    // file:// can be loaded directly - baseUrl is parent dir
    const baseUrl = volume.uri.endsWith('/') ? volume.uri : volume.uri + '/';
    return { localHtmlUri: volume.htmlUri, baseUrl };
  }

  // SAF content:// -> copy to cache preserving relative structure
  const cacheSeriesDir = cacheDir(safeSeries);
  const cacheVolumeDir = cacheDir(safeSeries, safeVolume);
  ensureDir(cacheSeriesDir);
  ensureDir(cacheVolumeDir);

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
    const probe = new File(cacheVolumeDir, 'page0001.jpeg');
    if (!probe.exists) {
      const all = new Directory(volume.uri).list();
      const imgs = all.filter(
        (entry) =>
          !(entry instanceof Directory) &&
          /\.(jpeg|jpg|png|webp)$/i.test(entry.name)
      );
      let done = 0;
      onProgress?.(0, imgs.length);
      for (const entry of imgs) {
        const dest = new File(cacheVolumeDir, entry.name);
        if (!dest.exists) {
          try {
            await copyFile(entry.uri, dest.uri);
          } catch (e) {
            console.warn('copy image', entry.name, e);
          }
        }
        done++;
        if (done % 10 === 0 || done === imgs.length) onProgress?.(done, imgs.length);
      }
    } else {
      onProgress?.(1, 1);
    }
  } catch (e) {
    console.warn('copy images', e);
  }

  // baseUrl must be cacheSeriesDir so relative "Meitantei Konan 001/page0001.jpeg" resolves
  return { localHtmlUri: localHtmlFile.uri, baseUrl: cacheSeriesDir.uri };
}

// LRU evict old volumes if cache > 500MB
export async function evictOldCaches(_maxBytes = 500 * 1024 * 1024) {
  try {
    const root = cacheDir();
    if (!root.exists) return;
    // noop for now - implement size check via readDirectory recursion
  } catch {}
}

export const httpServer = {
  async start(rootUri: string) {
    console.log('[yomibako] prepareVolume will be used instead of httpServer for', rootUri);
    return rootUri;
  },
  async stop() {},
  toHttpUrl: (u: string) => u,
};
