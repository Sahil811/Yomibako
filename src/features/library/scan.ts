// Scans on-device folder like Detective Conan series root
// Handles 100 volumes / 37k files without blocking UI — runs in background
// Expo SDK 57+: uses new Directory/File API (works for file:// and content:// SAF)

import { Directory, File } from 'expo-file-system';
import type { Volume, Series } from './types';

function isVolumeName(name: string) {
  if (/^\d{1,4}(?:$|[\s._-])/.test(name)) return true;
  if (/(?:^|[\s._-])(?:vol(?:ume)?|book|chapter|ch)\s*0*\d+\b/i.test(name)) return true;
  const trailing = name.match(/[\s._-](\d{1,4})$/);
  if (!trailing) return false;
  const value = Number(trailing[1]);
  return value < 1900 || value > 2099;
}

function volumeStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/(?:^|[\s._-])(?:vol(?:ume)?|book|chapter|ch)\s*0*\d+\s*$/i, '')
    .replace(/[\s._-]0*\d{1,4}\s*$/, '')
    .replace(/^0*\d{1,4}$/, '')
    .replace(/[\s._-]+/g, ' ')
    .trim();
}

function isImageName(n: string) {
  const l = n.toLowerCase();
  return l.endsWith('.jpeg') || l.endsWith('.jpg') || l.endsWith('.png') || l.endsWith('.webp');
}

type Level = {
  uri: string;
  files: Map<string, string>;
  dirs: Directory[];
  ocrDir: Directory | null;
};

function readLevel(uri: string): Level | null {
  let items: (File | Directory)[];
  try {
    items = new Directory(uri).list();
  } catch (e) {
    console.warn('scanSeries list failed', uri, e);
    return null;
  }
  const files = new Map<string, string>();
  const dirs: Directory[] = [];
  let ocrDir: Directory | null = null;
  for (const item of items) {
    if (item instanceof Directory) {
      if (item.name === '_ocr' || item.name === '_OCR') {
        if (!ocrDir) ocrDir = item;
      } else if (!item.name.startsWith('.')) {
        dirs.push(item);
      }
    } else {
      files.set(item.name, item.uri);
    }
  }
  return { uri, files, dirs, ocrDir };
}

function buildOcrMap(ocrDir: Directory | null): Map<string, string> | null {
  // List _ocr ONCE per level — the old per-volume findOcrUri() turned a
  // 100-volume scan into 100 extra full _ocr listings (10k+ entries).
  if (!ocrDir) return null;
  try {
    const map = new Map<string, string>();
    for (const e of ocrDir.list()) {
      if (e instanceof Directory) map.set((e as Directory).name, e.uri);
    }
    return map;
  } catch {
    return null;
  }
}

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

// Phase 1 (instant, 1 SAF call already done): shells from names only.
// pageCount 0 + no cover until fillDetails runs. Non-volume dirs get
// filtered in phase 2 — a couple of extras may flash briefly.
function shellsForLevel(
  level: Level,
  seriesName: string,
  ocrMap: Map<string, string> | null
): Volume[] {
  return level.dirs.map((dir) => {
    const title = dir.name;
    return {
      id: dir.uri,
      series: seriesName,
      title,
      uri: dir.uri,
      htmlUri:
        level.files.get(`${title}.mobile.html`) ?? level.files.get(`${title}.html`),
      mokuroUri: level.files.get(`${title}.mokuro`),
      ocrUri: ocrMap?.get(title),
      pageCount: 0,
      coverUri: undefined,
    };
  });
}

// Phase 2 (slow, N SAF calls): count images + find covers per volume.
// Pushes live updates so the UI fills in instead of blocking.
async function fillDetails(
  level: Level,
  shells: Volume[],
  out: Volume[],
  total: { pages: number },
  onProgress?: (done: number, totalDirs: number) => void,
  onUpdate?: () => void
) {
  const byUri = new Map(level.dirs.map((d) => [d.uri, d]));
  let n = 0;
  const totalDirs = shells.length;
  for (const shell of shells) {
    const dir = byUri.get(shell.uri);
    if (dir) {
      let jpegs: File[] = [];
      let nestedHtml: string | undefined;
      let nestedMokuro: string | undefined;
      try {
        const items = dir.list();
        for (const f of items) {
          if (f instanceof Directory) continue;
          if (isImageName(f.name)) jpegs.push(f as File);
          const lowerName = f.name.toLowerCase();
          if (lowerName.endsWith('.mobile.html')) nestedHtml = f.uri;
          else if (!nestedHtml && lowerName.endsWith('.html')) nestedHtml = f.uri;
          else if (lowerName.endsWith('.mokuro')) nestedMokuro = f.uri;
        }
      } catch {
        continue;
      }
      if (jpegs.length === 0 && !shell.htmlUri && !shell.mokuroUri && !nestedHtml && !nestedMokuro && !isVolumeName(shell.title)) continue;

      const lower = (s: string) => s.toLowerCase();
      const cover =
        jpegs.find((f) => lower(f.name).includes('cover')) ??
        jpegs.find((f) => lower(f.name).includes('page0001')) ??
        jpegs.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];

      out.push({
        ...shell,
        htmlUri: shell.htmlUri ?? nestedHtml,
        mokuroUri: shell.mokuroUri ?? nestedMokuro,
        pageCount: jpegs.length,
        coverUri: cover?.uri,
      });
      total.pages += jpegs.length;
    }
    // list() is sync native — yield + report every 10 volumes so the
    // UI stays alive instead of looking stuck.
    if (++n % 10 === 0) {
      onProgress?.(n, totalDirs);
      onUpdate?.();
      await yieldToUI();
    }
  }
  onProgress?.(n, totalDirs);
  onUpdate?.();
}

function readableAtLevel(level: Level, title: string): boolean {
  return level.files.has(`${title}.mobile.html`) || level.files.has(`${title}.html`) || level.files.has(`${title}.mokuro`);
}

function decodedName(name: string): string {
  try { return decodeURIComponent(name); } catch { return name; }
}

type FolderShape = 'volume' | 'series' | 'empty';

function inspectFolder(dir: Directory): FolderShape {
  try {
    let images = 0;
    let readable = 0;
    let childDirs = 0;
    for (const item of dir.list()) {
      if (item instanceof Directory) {
        if (item.name.toLowerCase() !== '_ocr' && !item.name.startsWith('.')) childDirs++;
      } else {
        const lower = item.name.toLowerCase();
        if (isImageName(lower)) images++;
        else if (lower.endsWith('.html') || lower.endsWith('.mokuro')) readable++;
      }
    }
    if (images > 0) return 'volume';
    // Mokuro commonly stores each volume's HTML beside its image folder, so a
    // series root can contain both readable files and many child directories.
    if (childDirs > 0) return 'series';
    if (readable > 1) return 'series';
    if (readable > 0) return 'volume';
  } catch {}
  return 'empty';
}

/**
 * Scan either one series folder or a shelf folder containing several series.
 * A numeric/Volume-named majority is a fast path, avoiding an extra listing
 * for large 100+ volume series such as Detective Conan.
 */
export async function scanLibrary(
  rootUri: string,
  rootName: string,
  onProgress?: (seriesName: string, done: number, totalDirs: number) => void,
  onUpdate?: (series: Series[]) => void
): Promise<Series[]> {
  const top = readLevel(rootUri);
  if (!top || top.dirs.length === 0) {
    const single = await scanSeries(rootUri, rootName, (done, total) => onProgress?.(rootName, done, total));
    const tagged = { ...single, sourceRootUri: rootUri };
    onUpdate?.(tagged.volumes.length ? [tagged] : []);
    return tagged.volumes.length ? [tagged] : [];
  }

  const namedVolumes = top.dirs.filter((dir) => isVolumeName(dir.name) || readableAtLevel(top, dir.name));
  const stemCounts = new Map<string, number>();
  for (const dir of namedVolumes) {
    const stem = volumeStem(dir.name);
    stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }
  const dominantStemCount = Math.max(0, ...stemCounts.values());
  const numericMajority = dominantStemCount >= Math.max(2, Math.ceil(top.dirs.length * 0.6));

  let seriesFolders: Directory[] = [];
  let directVolumeFolders: Directory[] = namedVolumes;
  if (!numericMajority) {
    directVolumeFolders = [];
    for (let index = 0; index < top.dirs.length; index++) {
      const dir = top.dirs[index];
      const shape = inspectFolder(dir);
      if (shape === 'series') seriesFolders.push(dir);
      else if (shape === 'volume' || readableAtLevel(top, dir.name) || isVolumeName(dir.name)) directVolumeFolders.push(dir);
      if ((index + 1) % 8 === 0) {
        onProgress?.(rootName, index + 1, top.dirs.length);
        await yieldToUI();
      }
    }
  }

  // A normal series root contains volume-like children only.
  if (numericMajority || seriesFolders.length === 0) {
    const single = await scanSeries(
      rootUri,
      rootName,
      (done, total) => onProgress?.(rootName, done, total),
      (shell) => onUpdate?.([{ ...shell, sourceRootUri: rootUri }])
    );
    const tagged = { ...single, sourceRootUri: rootUri };
    onUpdate?.(tagged.volumes.length ? [tagged] : []);
    return tagged.volumes.length ? [tagged] : [];
  }

  const results: Series[] = [];
  const publish = (draft?: Series) => {
    const all = draft ? [...results, draft] : [...results];
    onUpdate?.(all.filter((item) => item.volumes.length > 0));
  };

  // Mixed shelves may contain loose volumes alongside series folders. Keep
  // those loose volumes together under the selected root's name.
  if (directVolumeFolders.length > 0) {
    const direct = await scanSeries(
      rootUri,
      rootName,
      (done, total) => onProgress?.(rootName, done, total),
      undefined,
      new Set(directVolumeFolders.map((folder) => folder.uri))
    );
    if (direct.volumes.length) {
      results.push({ ...direct, sourceRootUri: rootUri });
      publish();
    }
  }

  for (const folder of seriesFolders) {
    const name = decodedName(folder.name);
    const scanned = await scanSeries(
      folder.uri,
      name,
      (done, total) => onProgress?.(name, done, total),
      (shell) => publish({ ...shell, sourceRootUri: rootUri })
    );
    if (scanned.volumes.length) {
      results.push({ ...scanned, sourceRootUri: rootUri });
      publish();
    }
    await yieldToUI();
  }

  return results;
}

export async function scanSeries(
  rootUri: string,
  seriesName: string,
  onProgress?: (done: number, totalDirs: number) => void,
  // Called with name-only shells right after the single root listing,
  // so the caller can show the library instantly while details fill in.
  onShell?: (shell: Series) => void,
  topDirectoryUris?: Set<string>
): Promise<Series> {
  const top = readLevel(rootUri);
  if (!top) return { name: seriesName, rootUri, volumes: [], totalPages: 0 };

  const volumes: Volume[] = [];
  const total = { pages: 0 };

  // Single-volume pick: user chose "Meitantei Konan 006" itself
  // (images directly in root, no subdirs). Treat root as one volume.
  if (top.dirs.length === 0) {
    const rootImages = [...top.files.keys()].filter((n) => isImageName(n));
    if (rootImages.length > 0) {
      const sorted = rootImages.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const coverName =
        sorted.find((n) => n.toLowerCase().includes('cover')) ??
        sorted.find((n) => n.toLowerCase().includes('page0001')) ??
        sorted[0];
      volumes.push({
        id: rootUri,
        series: seriesName,
        title: seriesName,
        uri: rootUri,
        htmlUri: top.files.get(`${seriesName}.mobile.html`) ?? top.files.get(`${seriesName}.html`),
        mokuroUri: top.files.get(`${seriesName}.mokuro`),
        ocrUri: undefined,
        pageCount: rootImages.length,
        coverUri: top.files.get(coverName),
      });
      return { name: seriesName, rootUri, volumes, totalPages: rootImages.length };
    }

    const standalone = new Map<string, { htmlUri?: string; mokuroUri?: string }>();
    for (const [name, uri] of top.files) {
      const lower = name.toLowerCase();
      let title = '';
      if (lower.endsWith('.mobile.html')) title = name.slice(0, -'.mobile.html'.length);
      else if (lower.endsWith('.html')) title = name.slice(0, -'.html'.length);
      else if (lower.endsWith('.mokuro')) title = name.slice(0, -'.mokuro'.length);
      if (!title) continue;
      const entry = standalone.get(title) ?? {};
      if (lower.endsWith('.mokuro')) entry.mokuroUri = uri;
      else if (lower.endsWith('.mobile.html') || !entry.htmlUri) entry.htmlUri = uri;
      standalone.set(title, entry);
    }
    if (standalone.size) {
      for (const [title, readable] of standalone) {
        volumes.push({
          id: `${rootUri}#${title}`,
          series: seriesName,
          title,
          uri: rootUri,
          progressKey: `${rootUri}#${title}`,
          ...readable,
          pageCount: 0,
        });
      }
      volumes.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
      return { name: seriesName, rootUri, volumes, totalPages: 0 };
    }
  }

  const snapshot = (): Series => ({
    name: seriesName,
    rootUri,
    volumes: [...volumes].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })),
    totalPages: total.pages,
  });

  const fillLevel = async (level: Level) => {
    const ocrMap = buildOcrMap(level.ocrDir);
    const shells = shellsForLevel(level, seriesName, ocrMap).filter(
      (shell) => level.uri !== rootUri || !topDirectoryUris || topDirectoryUris.has(shell.uri)
    );
    // Instant UI: names + html links after just 1 listing…
    onShell?.({ name: seriesName, rootUri, volumes: shells, totalPages: 0 });
    // …then counts/covers stream in every 10 volumes.
    await fillDetails(level, shells, volumes, total, onProgress, () => onShell?.(snapshot()));
  };

  await fillLevel(top);

  // Nested case: e.g. mokuro/Detective Conan/Detective Conan/volumes
  // (double nesting from unzip/file manager). Descend while the current
  // level yields 0 volumes but contains a subfolder that itself looks like
  // a series root (many subdirs, ~0 images). Max 3 levels deep.
  let current: Level | null = top;
  for (let depth = 0; depth < 3 && volumes.length === 0 && current && current.dirs.length > 0; depth++) {
    const candidates: { dir: Directory; subdirs: number }[] = [];
    for (const dir of current.dirs.slice(0, 20)) {
      try {
        const items = dir.list();
        let images = 0;
        let subdirs = 0;
        for (const it of items) {
          if (it instanceof Directory) {
            if ((it as Directory).name !== '_ocr') subdirs++;
          } else if (isImageName(it.name)) images++;
        }
        // A nested series root has many subdirs and ~0 images itself.
        if (images === 0 && subdirs > 0) candidates.push({ dir, subdirs });
      } catch {}
      if (depth === 0 && candidates.length >= 3) break;
    }
    candidates.sort((a, b) => b.subdirs - a.subdirs);
    let descended = false;
    for (const c of candidates.slice(0, 3)) {
      const nested = readLevel(c.dir.uri);
      if (!nested) continue;
      const before = volumes.length;
      await fillLevel(nested);
      if (volumes.length > before) {
        descended = true;
        break;
      }
      // This candidate was empty too — try descending THROUGH it next round.
      current = nested;
      descended = true;
      break;
    }
    if (!descended) break;
    // If we descended through an empty middle folder without finding volumes,
    // loop again to go one level deeper. Otherwise volumes.length > 0 exits.
    if (volumes.length > 0) break;
  }

  volumes.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  return { name: seriesName, rootUri, volumes, totalPages: total.pages };
}

// Also handle _ocr folder structure: .../Detective Conan/_ocr/Meitantei Konan 096/page0003.json
export async function listOcrPages(ocrRoot: string, volumeId: string): Promise<string[]> {
  // ocrRoot may be series root (contains _ocr/) or _ocr dir itself — handle both.
  // NOTE: no string-concat child URIs for SAF — resolve via list() name match.
  const tryDir = (dirUri: string): string[] | null => {
    try {
      const items = new Directory(dirUri).list();
      const out = items
        .filter((i) => !(i instanceof Directory) && i.name.endsWith('.json'))
        .map((i) => i.uri)
        .sort();
      return out.length ? out : null;
    } catch {
      return null;
    }
  };

  // 1) ocrRoot/_ocr/volumeId
  try {
    const top = new Directory(ocrRoot).list();
    const ocr = top.find((i) => i instanceof Directory && i.name === '_ocr') as Directory | undefined;
    if (ocr) {
      const vols = ocr.list();
      const match = vols.find((i) => i instanceof Directory && i.name === volumeId) as Directory | undefined;
      if (match) {
        const hit = tryDir(match.uri);
        if (hit) return hit;
      }
    }
    // 2) ocrRoot/volumeId (ocrRoot already is _ocr)
    const direct = top.find((i) => i instanceof Directory && i.name === volumeId) as Directory | undefined;
    if (direct) {
      const hit = tryDir(direct.uri);
      if (hit) return hit;
    }
  } catch {}
  return [];
}
