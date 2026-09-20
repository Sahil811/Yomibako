// In-memory expo-file-system double for Node tests.
// Supports the subset used by saf/scan/libraryCache/httpServer/audio:
// Directory(uri | ...segments), File(uri | ...segments),
// .exists, .uri, .name, .size, .list(), .create(), .delete(),
// File.text()/textSync()/base64()/write()/copy(), parentDirectory, Paths.

export const Paths = {
  cache: 'file:///mock-cache',
  document: 'file:///mock-doc',
  availableDiskSpace: 8 * 1024 * 1024 * 1024,
};

type Entry = {
  uri: string;
  name: string;
  isDir: boolean;
  content: string;
  children: Set<string>; // child uris (both files and dirs)
  size: number;
};

const store = new Map<string, Entry>();

function baseName(uri: string): string {
  const clean = uri.replace(/\/+$/, '');
  const i = clean.lastIndexOf('/');
  return i >= 0 ? clean.slice(i + 1) : clean;
}

function parentUri(uri: string): string {
  const clean = uri.replace(/\/+$/, '');
  const i = clean.lastIndexOf('/');
  if (i <= 0) return clean;
  return clean.slice(0, i);
}

function joinSegments(segments: any[]): string {
  // new Directory(uri) / new File(uri)
  if (segments.length === 1 && typeof segments[0] === 'string') return segments[0];
  // new File(dirObject, name) / new Directory(parent, ...rest)
  const parts: string[] = [];
  for (const s of segments) {
    if (s == null) continue;
    if (typeof s === 'string') parts.push(s);
    else if (typeof s === 'object' && typeof (s as any).uri === 'string') parts.push((s as any).uri);
    else parts.push(String(s));
  }
  let out = parts[0] ?? '';
  for (const p of parts.slice(1)) {
    out = out.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, '');
  }
  return out;
}

function ensureDirEntry(uri: string): Entry {
  let e = store.get(uri);
  if (!e) {
    e = { uri, name: baseName(uri), isDir: true, content: '', children: new Set(), size: 0 };
    store.set(uri, e);
    const p = parentUri(uri);
    if (p && p !== uri) {
      const parent = ensureDirEntry(p);
      parent.children.add(uri);
    }
  } else if (!e.isDir) {
    e.isDir = true;
    if (!e.children) e.children = new Set();
  }
  return e;
}

function ensureFileEntry(uri: string, content = ''): Entry {
  let e = store.get(uri);
  if (!e) {
    e = { uri, name: baseName(uri), isDir: false, content, children: new Set(), size: content.length };
    store.set(uri, e);
    const p = parentUri(uri);
    if (p && p !== uri) {
      const parent = ensureDirEntry(p);
      parent.children.add(uri);
    }
  }
  return e;
}

export function __resetFS() {
  store.clear();
}

export function __putDir(uri: string) {
  ensureDirEntry(uri);
}

export function __putFile(uri: string, content = 'x') {
  const e = ensureFileEntry(uri, content);
  e.content = content;
  e.size = content.length;
  e.isDir = false;
}

export class Directory {
  uri: string;
  name: string;
  constructor(...segments: any[]) {
    this.uri = joinSegments(segments);
    this.name = baseName(this.uri);
  }
  get exists(): boolean {
    const e = store.get(this.uri);
    return !!e && e.isDir;
  }
  get size(): number {
    // Sum of descendant file sizes (best-effort).
    let total = 0;
    for (const [uri, e] of store) {
      if (!e.isDir && (uri === this.uri || uri.startsWith(this.uri + '/'))) total += e.size;
    }
    return total;
  }
  info(): { modificationTime: number } {
    return { modificationTime: 0 };
  }
  get parentDirectory(): Directory {
    return new Directory(parentUri(this.uri));
  }
  list(): (File | Directory)[] {
    const e = store.get(this.uri);
    if (!e || !e.isDir) throw new Error(`ENOENT: ${this.uri}`);
    const out: (File | Directory)[] = [];
    for (const childUri of e.children) {
      const child = store.get(childUri);
      if (!child) continue;
      if (child.isDir) out.push(new Directory(child.uri));
      else out.push(new File(child.uri));
    }
    // Sort for determinism like a real listing would be stable in tests.
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
  create(_opts?: any): void {
    ensureDirEntry(this.uri);
  }
  delete(): void {
    const e = store.get(this.uri);
    if (!e) return;
    // Recursive delete.
    for (const [uri] of [...store]) {
      if (uri === this.uri || uri.startsWith(this.uri + '/')) store.delete(uri);
    }
    const p = parentUri(this.uri);
    store.get(p)?.children.delete(this.uri);
  }
}

export class File {
  uri: string;
  name: string;
  constructor(...segments: any[]) {
    this.uri = joinSegments(segments);
    this.name = baseName(this.uri);
  }
  get exists(): boolean {
    const e = store.get(this.uri);
    return !!e && !e.isDir;
  }
  get size(): number {
    const e = store.get(this.uri);
    if (!e || e.isDir) throw new Error(`ENOENT size: ${this.uri}`);
    return e.size;
  }
  get parentDirectory(): Directory {
    return new Directory(parentUri(this.uri));
  }
  async text(): Promise<string> {
    const e = store.get(this.uri);
    if (!e || e.isDir) throw new Error(`ENOENT text: ${this.uri}`);
    return e.content;
  }
  textSync(): string {
    const e = store.get(this.uri);
    if (!e || e.isDir) throw new Error(`ENOENT textSync: ${this.uri}`);
    return e.content;
  }
  async base64(): Promise<string> {
    return Buffer.from(await this.text()).toString('base64');
  }
  write(data: any, _opts?: any): void {
    const s = typeof data === 'string' ? data : Buffer.from(data as any).toString('utf8');
    const e = ensureFileEntry(this.uri, s);
    e.content = s;
    e.size = s.length;
    e.isDir = false;
  }
  create(_opts?: any): void {
    ensureFileEntry(this.uri, '');
  }
  delete(): void {
    store.delete(this.uri);
    const p = parentUri(this.uri);
    store.get(p)?.children.delete(this.uri);
  }
  async copy(dest: File | string, _opts?: any): Promise<void> {
    const srcEntry = store.get(this.uri);
    if (!srcEntry || srcEntry.isDir) throw new Error(`ENOENT copy src: ${this.uri}`);
    const destUri = typeof dest === 'string' ? dest : (dest as File).uri;
    const e = ensureFileEntry(destUri, srcEntry.content);
    e.content = srcEntry.content;
    e.size = srcEntry.size;
    e.isDir = false;
  }
}
