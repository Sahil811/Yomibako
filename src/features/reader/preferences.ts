// Reader layout choices live with the reader, not in app Settings: they are
// per-reading-session decisions made from the options bar while a page is on
// screen. They are persisted so leaving and re-entering a volume keeps them.
import { getItemAsync, setItemAsync } from '../../services/storage';

export type ZoomMode = 'screen' | 'width' | 'original';

export type ReaderPreferences = {
  zoomMode: ZoomMode;
  twoPage: boolean;
  /** Left-to-right page order — the base default. Toggle to RTL for manga. */
  rtl: boolean;
};

const KEY = 'yomibako_reader_prefs_v1';

export const defaultReaderPreferences: ReaderPreferences = {
  zoomMode: 'screen',
  twoPage: false,
  rtl: false,
};

let cache: ReaderPreferences = { ...defaultReaderPreferences };
let loaded = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function normalize(raw: any): ReaderPreferences {
  const zoom = raw?.zoomMode;
  return {
    zoomMode: zoom === 'width' || zoom === 'original' ? zoom : 'screen',
    twoPage: raw?.twoPage === true,
    rtl: raw?.rtl === true,
  };
}

export async function loadReaderPreferences(): Promise<ReaderPreferences> {
  if (loaded) return { ...cache };
  try {
    const raw = await getItemAsync(KEY);
    if (raw) cache = normalize(JSON.parse(raw));
  } catch {
    // Corrupt or unreadable prefs must never block opening a volume.
  }
  loaded = true;
  return { ...cache };
}

/** Last known values, available synchronously once loadReaderPreferences ran. */
export function getReaderPreferences(): ReaderPreferences {
  return { ...cache };
}

/**
 * Update in memory immediately and persist on a short debounce — toggling the
 * options bar rapidly should not queue a write per tap.
 */
export function setReaderPreferences(patch: Partial<ReaderPreferences>): ReaderPreferences {
  cache = normalize({ ...cache, ...patch });
  loaded = true;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void setItemAsync(KEY, JSON.stringify(cache)).catch(() => {});
  }, 250);
  return { ...cache };
}

/** Persist immediately — used when the reader unmounts. */
export async function flushReaderPreferences(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    await setItemAsync(KEY, JSON.stringify(cache));
  } catch {}
}
