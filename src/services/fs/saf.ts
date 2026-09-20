// Direct folder access — SAF abstraction (Expo SDK 57+)
// Android: Directory.pickDirectoryAsync → content:// uri with persistable permission (read where data is, no copy)
// iOS: UIDocumentPicker → access is session-scoped (must re-pick after restart)

import { Directory, File } from 'expo-file-system';
import { getItemAsync, setItemAsync } from '../storage';

export type FsEntry = {
  uri: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  mimeType?: string;
};

const SAF_ROOT_KEY = 'yomibako_saf_roots';

// Persist granted roots
export async function saveRoot(uri: string) {
  const existing = await getRoots();
  if (!existing.includes(uri)) {
    await setItemAsync(SAF_ROOT_KEY, JSON.stringify([...existing, uri]));
  }
}

export async function getRoots(): Promise<string[]> {
  const raw = await getItemAsync(SAF_ROOT_KEY);
  return raw ? JSON.parse(raw) : [];
}

// Forget a granted root so restoring the library no longer rescans it.
export async function removeRoot(uri: string) {
  const existing = await getRoots();
  const next = existing.filter((item) => item !== uri);
  if (next.length !== existing.length) {
    await setItemAsync(SAF_ROOT_KEY, JSON.stringify(next));
  }
}

// Unified list — works for file:// and content:// via new Directory API
export async function listDirectory(uri: string): Promise<FsEntry[]> {
  try {
    const items = new Directory(uri).list();
    return items.map((item) => {
      const isDirectory = item instanceof Directory;
      let size: number | undefined;
      if (!isDirectory) {
        try {
          size = (item as File).size;
        } catch {}
      }
      return {
        uri: item.uri,
        name: item.name,
        isDirectory,
        size,
      };
    });
  } catch {
    return [];
  }
}

export function isMokuroVolume(entries: FsEntry[]): boolean {
  return entries.some((e) => e.name.endsWith('.html') || e.name.endsWith('.mokuro') || e.name === '_ocr');
}

// Breadcrumbs helper
export function uriToBreadcrumbs(uri: string): string[] {
  if (uri.startsWith('content://')) return ['Device', ...uri.split('/').slice(-2)];
  return uri.replace('file://', '').split('/').filter(Boolean);
}
