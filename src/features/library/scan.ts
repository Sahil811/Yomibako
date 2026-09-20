// Scans on-device folder like Detective Conan series root
// Handles 100 volumes / 37k files without blocking UI — runs in background
// Expo SDK 57+: uses new Directory/File API (works for file:// and content:// SAF)

import { Directory, File } from 'expo-file-system';
import type { Volume, Series } from './types';

const LEADING_NUMBER_RE = /^\d{1,4}(?:$|[\s._-])/;
const VOLUME_KEYWORD_RE = /(?:^|[\s._-])(?:vol(?:ume)?|book|chapter|ch)\s*\d+\b/i;
const TRAILING_NUMBER_RE = /[\s._-](\d{1,4})$/;
const VOLUME_KEYWORD_SUFFIX_RE = /(?:^|[\s._-])(?:vol(?:ume)?|book|chapter|ch)\s*\d+\s*$/i;

export function isVolumeName(name: string) {
  if (LEADING_NUMBER_RE.test(name)) return true;
  if (VOLUME_KEYWORD_RE.test(name)) return true;
  const trailing = TRAILING_NUMBER_RE.exec(name);
  if (!trailing) return false;
  const value = Number(trailing[1]);
  return value < 1900 || value > 2099;
}

export function volumeStem(name: string): string {
  return name
    .toLowerCase()
    .replace(VOLUME_KEYWORD_SUFFIX_RE, '')
    .replace(/[\s._-]0*\d{1,4}\s*$/, '')
    .replace(/^0*\d{1,4}$/, '')
    .replace(/[\s._-]+/g, ' ')
    .trim();
}

export function isImageName(n: string) {
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
        ocrDir ??= item;
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
type VolumeMedia = { jpegs: File[]; nestedHtml: string | undefined; nestedMokuro: string | undefined };

function trackVolumeFile(media: VolumeMedia, name: string, uri: string): void {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.mobile.html')) {
    media.nestedHtml = uri;
    return;
  }
  if (lowerName.endsWith('.html') && !media.nestedHtml) {
    media.nestedHtml = uri;
    return;
  }
  if (lowerName.endsWith('.mokuro')) {
    media.nestedMokuro = uri;
  }
}

function collectVolumeMedia(dir: Directory): VolumeMedia | null {
  try {
    const media: VolumeMedia = { jpegs: [], nestedHtml: undefined, nestedMokuro: undefined };
    for (const entry of dir.list()) {
      if (entry instanceof Directory) {
        continue;
      }
      if (isImageName(entry.name)) {
        media.jpegs.push(entry as File);
      }
      trackVolumeFile(media, entry.name, entry.uri);
    }
    return media;
  } catch {
    return null;
  }
}

function isSkippableVolume(
  shell: Volume,
  media: VolumeMedia
): boolean {
  if (media.jpegs.length > 0) {
    return false;
  }
  if (shell.htmlUri || shell.mokuroUri || media.nestedHtml || media.nestedMokuro) {
    return false;
  }
  return !isVolumeName(shell.title);
}

function findVolumeCover(jpegs: File[]): File | undefined {
  const byCover = jpegs.find((f) => f.name.toLowerCase().includes('cover'));
  if (byCover) {
    return byCover;
  }
  const byFirstPage = jpegs.find((f) => f.name.toLowerCase().includes('page0001'));
  if (byFirstPage) {
    return byFirstPage;
  }
  return jpegs.toSorted((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
}

function pushVolumeDetail(
  out: Volume[],
  shell: Volume,
  media: VolumeMedia,
  total: { pages: number }
): void {
  const cover = findVolumeCover(media.jpegs);
  out.push({
    ...shell,
    htmlUri: shell.htmlUri ?? media.nestedHtml,
    mokuroUri: shell.mokuroUri ?? media.nestedMokuro,
    pageCount: media.jpegs.length,
    coverUri: cover?.uri,
  });
  total.pages += media.jpegs.length;
}

async function reportFillProgress(
  n: number,
  totalDirs: number,
  onProgress?: (done: number, totalDirs: number) => void,
  onUpdate?: () => void
): Promise<void> {
  onProgress?.(n, totalDirs);
  onUpdate?.();
  await yieldToUI();
}

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
    if (!dir) {
      n++;
      continue;
    }
    const media = collectVolumeMedia(dir);
    if (media === null || isSkippableVolume(shell, media)) {
      continue;
    }
    pushVolumeDetail(out, shell, media, total);
    n++;
    // list() is sync native — yield + report every 10 volumes so the
    // UI stays alive instead of looking stuck.
    if (n % 10 === 0) {
      await reportFillProgress(n, totalDirs, onProgress, onUpdate);
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

type FolderCounts = { images: number; readable: number; childDirs: number };

function isCountableChildDir(name: string): boolean {
  if (name.startsWith('.')) {
    return false;
  }
  return name.toLowerCase() !== '_ocr';
}

function countFolderContents(dir: Directory): FolderCounts {
  const counts: FolderCounts = { images: 0, readable: 0, childDirs: 0 };
  for (const item of dir.list()) {
    if (item instanceof Directory) {
      if (isCountableChildDir(item.name)) {
        counts.childDirs++;
      }
      continue;
    }
    const lower = item.name.toLowerCase();
    if (isImageName(lower)) {
      counts.images++;
    } else if (lower.endsWith('.html') || lower.endsWith('.mokuro')) {
      counts.readable++;
    }
  }
  return counts;
}

function classifyFolderCounts(counts: FolderCounts): FolderShape {
  if (counts.images > 0) {
    return 'volume';
  }
  // Mokuro commonly stores each volume's HTML beside its image folder, so a
  // series root can contain both readable files and many child directories.
  if (counts.childDirs > 0) {
    return 'series';
  }
  if (counts.readable > 1) {
    return 'series';
  }
  if (counts.readable > 0) {
    return 'volume';
  }
  return 'empty';
}

function inspectFolder(dir: Directory): FolderShape {
  try {
    return classifyFolderCounts(countFolderContents(dir));
  } catch {
    return 'empty';
  }
}

/**
 * Scan either one series folder or a shelf folder containing several series.
 * A numeric/Volume-named majority is a fast path, avoiding an extra listing
 * for large 100+ volume series such as Detective Conan.
 */
function computeVolumeMajority(top: Level): { numericMajority: boolean } {
  const namedVolumes = top.dirs.filter((dir) => isVolumeName(dir.name) || readableAtLevel(top, dir.name));
  const stemCounts = new Map<string, number>();
  for (const dir of namedVolumes) {
    const stem = volumeStem(dir.name);
    stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }
  const dominantStemCount = Math.max(0, ...stemCounts.values());
  const numericMajority = dominantStemCount >= Math.max(2, Math.ceil(top.dirs.length * 0.6));
  return { numericMajority };
}

function isDirectVolumeFolder(top: Level, dir: Directory): boolean {
  return readableAtLevel(top, dir.name) || isVolumeName(dir.name);
}

async function partitionShelfDirs(
  top: Level,
  rootName: string,
  onProgress?: (seriesName: string, done: number, totalDirs: number) => void
): Promise<{ seriesFolders: Directory[]; directVolumeFolders: Directory[] }> {
  const seriesFolders: Directory[] = [];
  const directVolumeFolders: Directory[] = [];
  for (let index = 0; index < top.dirs.length; index++) {
    const dir = top.dirs[index];
    const shape = inspectFolder(dir);
    if (shape === 'series') {
      seriesFolders.push(dir);
    } else if (shape === 'volume' || isDirectVolumeFolder(top, dir)) {
      directVolumeFolders.push(dir);
    }
    if ((index + 1) % 8 === 0) {
      onProgress?.(rootName, index + 1, top.dirs.length);
      await yieldToUI();
    }
  }
  return { seriesFolders, directVolumeFolders };
}

async function scanSingleSeriesRoot(
  rootUri: string,
  rootName: string,
  onProgress?: (seriesName: string, done: number, totalDirs: number) => void,
  onUpdate?: (series: Series[]) => void
): Promise<Series[]> {
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

async function scanShelfLooseVolumes(
  rootUri: string,
  rootName: string,
  directVolumeFolders: Directory[],
  results: Series[],
  publish: (draft?: Series) => void,
  onProgress?: (seriesName: string, done: number, totalDirs: number) => void
): Promise<void> {
  // Mixed shelves may contain loose volumes alongside series folders. Keep
  // those loose volumes together under the selected root's name.
  if (directVolumeFolders.length === 0) {
    return;
  }
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

async function scanShelfSeriesFolders(
  rootUri: string,
  seriesFolders: Directory[],
  results: Series[],
  publish: (draft?: Series) => void,
  onProgress?: (seriesName: string, done: number, totalDirs: number) => void
): Promise<void> {
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
}

export async function scanLibrary(
  rootUri: string,
  rootName: string,
  onProgress?: (seriesName: string, done: number, totalDirs: number) => void,
  onUpdate?: (series: Series[]) => void
): Promise<Series[]> {
  const top = readLevel(rootUri);
  if (!top || top.dirs.length === 0) {
    return scanSingleSeriesRoot(rootUri, rootName, onProgress, onUpdate);
  }

  const { numericMajority } = computeVolumeMajority(top);
  if (numericMajority) {
    return scanSingleSeriesRoot(rootUri, rootName, onProgress, onUpdate);
  }

  const { seriesFolders, directVolumeFolders } = await partitionShelfDirs(top, rootName, onProgress);

  // A normal series root contains volume-like children only.
  if (seriesFolders.length === 0) {
    return scanSingleSeriesRoot(rootUri, rootName, onProgress, onUpdate);
  }

  const results: Series[] = [];
  const publish = (draft?: Series) => {
    const all = draft ? [...results, draft] : [...results];
    onUpdate?.(all.filter((item) => item.volumes.length > 0));
  };

  await scanShelfLooseVolumes(rootUri, rootName, directVolumeFolders, results, publish, onProgress);
  await scanShelfSeriesFolders(rootUri, seriesFolders, results, publish, onProgress);

  return results;
}

function findRootCoverName(sortedNames: string[]): string {
  const byCover = sortedNames.find((n) => n.toLowerCase().includes('cover'));
  if (byCover) {
    return byCover;
  }
  const byFirstPage = sortedNames.find((n) => n.toLowerCase().includes('page0001'));
  if (byFirstPage) {
    return byFirstPage;
  }
  return sortedNames[0];
}

function buildSingleImageVolume(
  top: Level,
  rootUri: string,
  seriesName: string,
  rootImages: string[]
): Series {
  const sorted = rootImages.toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const coverName = findRootCoverName(sorted);
  const volumes: Volume[] = [
    {
      id: rootUri,
      series: seriesName,
      title: seriesName,
      uri: rootUri,
      htmlUri: top.files.get(`${seriesName}.mobile.html`) ?? top.files.get(`${seriesName}.html`),
      mokuroUri: top.files.get(`${seriesName}.mokuro`),
      ocrUri: undefined,
      pageCount: rootImages.length,
      coverUri: top.files.get(coverName),
    },
  ];
  return { name: seriesName, rootUri, volumes, totalPages: rootImages.length };
}

function standaloneTitleForFile(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.mobile.html')) {
    return name.slice(0, -'.mobile.html'.length);
  }
  if (lower.endsWith('.html')) {
    return name.slice(0, -'.html'.length);
  }
  if (lower.endsWith('.mokuro')) {
    return name.slice(0, -'.mokuro'.length);
  }
  return '';
}

function collectStandaloneReadable(top: Level): Map<string, { htmlUri?: string; mokuroUri?: string }> {
  const standalone = new Map<string, { htmlUri?: string; mokuroUri?: string }>();
  for (const [name, uri] of top.files) {
    const title = standaloneTitleForFile(name);
    if (!title) {
      continue;
    }
    const entry = standalone.get(title) ?? {};
    const lower = name.toLowerCase();
    if (lower.endsWith('.mokuro')) {
      entry.mokuroUri = uri;
    } else if (lower.endsWith('.mobile.html') || !entry.htmlUri) {
      entry.htmlUri = uri;
    }
    standalone.set(title, entry);
  }
  return standalone;
}

function buildStandaloneSeries(
  rootUri: string,
  seriesName: string,
  standalone: Map<string, { htmlUri?: string; mokuroUri?: string }>
): Series | null {
  if (standalone.size === 0) {
    return null;
  }
  const volumes: Volume[] = [];
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

function scanBareRoot(
  top: Level,
  rootUri: string,
  seriesName: string
): Series | null {
  // Single-volume pick: user chose "Meitantei Konan 006" itself
  // (images directly in root, no subdirs). Treat root as one volume.
  if (top.dirs.length !== 0) {
    return null;
  }
  const rootImages = [...top.files.keys()].filter((n) => isImageName(n));
  if (rootImages.length > 0) {
    return buildSingleImageVolume(top, rootUri, seriesName, rootImages);
  }
  return buildStandaloneSeries(rootUri, seriesName, collectStandaloneReadable(top));
}

type SeriesScanState = {
  rootUri: string;
  seriesName: string;
  volumes: Volume[];
  total: { pages: number };
  onProgress?: (done: number, totalDirs: number) => void;
  onShell?: (shell: Series) => void;
  topDirectoryUris?: Set<string>;
};

function snapshotSeries(state: SeriesScanState): Series {
  return {
    name: state.seriesName,
    rootUri: state.rootUri,
    volumes: [...state.volumes].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })),
    totalPages: state.total.pages,
  };
}

async function fillSeriesLevel(level: Level, state: SeriesScanState): Promise<void> {
  const ocrMap = buildOcrMap(level.ocrDir);
  const shells = shellsForLevel(level, state.seriesName, ocrMap).filter(
    (shell) => level.uri !== state.rootUri || !state.topDirectoryUris || state.topDirectoryUris.has(shell.uri)
  );
  // Instant UI: names + html links after just 1 listing…
  state.onShell?.({ name: state.seriesName, rootUri: state.rootUri, volumes: shells, totalPages: 0 });
  // …then counts/covers stream in every 10 volumes.
  await fillDetails(level, shells, state.volumes, state.total, state.onProgress, () =>
    state.onShell?.(snapshotSeries(state))
  );
}

type NestedCandidate = { dir: Directory; subdirs: number };

function countNestedDir(dir: Directory): NestedCandidate | null {
  try {
    const items = dir.list();
    let images = 0;
    let subdirs = 0;
    for (const it of items) {
      if (it instanceof Directory) {
        if ((it as Directory).name !== '_ocr') {
          subdirs++;
        }
      } else if (isImageName(it.name)) {
        images++;
      }
    }
    // A nested series root has many subdirs and ~0 images itself.
    if (images === 0 && subdirs > 0) {
      return { dir, subdirs };
    }
    return null;
  } catch {
    return null;
  }
}

function collectNestedCandidates(current: Level, depth: number): NestedCandidate[] {
  const candidates: NestedCandidate[] = [];
  for (const dir of current.dirs.slice(0, 20)) {
    const candidate = countNestedDir(dir);
    if (candidate) {
      candidates.push(candidate);
    }
    if (depth === 0 && candidates.length >= 3) {
      break;
    }
  }
  candidates.sort((a, b) => b.subdirs - a.subdirs);
  return candidates;
}

async function attemptNestedDescents(
  candidates: NestedCandidate[],
  state: SeriesScanState
): Promise<{ descended: boolean; next: Level | null }> {
  for (const candidate of candidates.slice(0, 3)) {
    const nested = readLevel(candidate.dir.uri);
    if (!nested) {
      continue;
    }
    const before = state.volumes.length;
    await fillSeriesLevel(nested, state);
    if (state.volumes.length > before) {
      return { descended: true, next: null };
    }
    // This candidate was empty too — try descending THROUGH it next round.
    return { descended: true, next: nested };
  }
  return { descended: false, next: null };
}

async function descendNestedLevels(top: Level, state: SeriesScanState): Promise<void> {
  // Nested case: e.g. mokuro/Detective Conan/Detective Conan/volumes
  // (double nesting from unzip/file manager). Descend while the current
  // level yields 0 volumes but contains a subfolder that itself looks like
  // a series root (many subdirs, ~0 images). Max 3 levels deep.
  let current: Level | null = top;
  for (let depth = 0; depth < 3 && state.volumes.length === 0 && current && current.dirs.length > 0; depth++) {
    const candidates = collectNestedCandidates(current, depth);
    const outcome = await attemptNestedDescents(candidates, state);
    if (!outcome.descended) {
      break;
    }
    if (outcome.next) {
      current = outcome.next;
    }
    // If we descended through an empty middle folder without finding volumes,
    // loop again to go one level deeper. Otherwise volumes.length > 0 exits.
    if (state.volumes.length > 0) {
      break;
    }
  }
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

  const bare = scanBareRoot(top, rootUri, seriesName);
  if (bare) {
    return bare;
  }

  const state: SeriesScanState = {
    rootUri,
    seriesName,
    volumes: [],
    total: { pages: 0 },
    onProgress,
    onShell,
    topDirectoryUris,
  };

  await fillSeriesLevel(top, state);
  await descendNestedLevels(top, state);

  state.volumes.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  return { name: seriesName, rootUri, volumes: state.volumes, totalPages: state.total.pages };
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
        .sort((a, b) => a.localeCompare(b));
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
