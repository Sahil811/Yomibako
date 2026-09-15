// Scans on-device folder like Detective Conan series root
// Handles 100 volumes / 37k files without blocking UI — runs in background
// Expo SDK 57+: uses new Directory/File API (works for file:// and content:// SAF)

import { Directory, File } from 'expo-file-system';
import type { Volume, Series } from './types';

function isVolumeName(name: string) {
  return /^Meitantei Konan \d+/.test(name) || /^\d+/.test(name) || name.includes('Konan');
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
      id: title,
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
      try {
        const items = dir.list();
        for (const f of items) {
          if (f instanceof Directory) continue;
          if (isImageName(f.name)) jpegs.push(f as File);
        }
      } catch {
        continue;
      }
      if (jpegs.length === 0 && !isVolumeName(shell.title)) continue;

      const lower = (s: string) => s.toLowerCase();
      const cover =
        jpegs.find((f) => lower(f.name).includes('cover')) ??
        jpegs.find((f) => lower(f.name).includes('page0001')) ??
        jpegs.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];

      out.push({
        ...shell,
        pageCount: jpegs.length,
        coverUri: cover?.uri ?? `${dir.uri}/cover.jpeg`,
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

export async function scanSeries(
  rootUri: string,
  seriesName: string,
  onProgress?: (done: number, totalDirs: number) => void,
  // Called with name-only shells right after the single root listing,
  // so the caller can show the library instantly while details fill in.
  onShell?: (shell: Series) => void
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
        id: seriesName,
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
  }

  const snapshot = (): Series => ({
    name: seriesName,
    rootUri,
    volumes: [...volumes].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })),
    totalPages: total.pages,
  });

  const fillLevel = async (level: Level) => {
    const ocrMap = buildOcrMap(level.ocrDir);
    const shells = shellsForLevel(level, seriesName, ocrMap);
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
