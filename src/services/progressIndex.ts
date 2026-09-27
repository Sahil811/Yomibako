// Consolidated reading-position index — F1 of Final Vetted Plan.
//
// SecureStore per-call cost is one native round-trip + one cipher op.
// Batching 8 only amortizes JS scheduling, not the native cost. Collapsing
// N keys → 1 is the entire win: withSavedProgress drops from 100+ reads +
// 13×25ms sleeps to a single read.
//
// Safety: per-key `yomibako_reader_position.<hash>` entries stay the SOURCE
// OF TRUTH. The index is a rebuildable cache. Miss/partial/corrupt blob ⇒
// fall back to per-key reads and rebuild. A torn blob write can therefore
// never lose all positions. Writes are also held while storage reads as
// corrupt (keystore-loss) — see storage.ts.
import { getItemAsync, setItemAsync, isStorageCorrupt } from './storage';

export type ProgressIndexEntry = { p: number; t: number; n?: number };
export type ProgressIndex = Record<string, ProgressIndexEntry>;

export const PROGRESS_INDEX_KEY = 'yomibako_progress_v2';

function isValidEntry(v: unknown): v is ProgressIndexEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as { p?: unknown; t?: unknown; n?: unknown };
  if (typeof e.p !== 'number' || !Number.isFinite(e.p)) return false;
  if (typeof e.t !== 'number' || !Number.isFinite(e.t)) return false;
  if (e.n !== undefined && (typeof e.n !== 'number' || !Number.isFinite(e.n))) return false;
  return true;
}

/** Parse + validate the blob. Corrupt/partial input yields {} (fallback path). */
export function parseProgressIndex(raw: string | null | undefined): ProgressIndex {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ProgressIndex = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (isValidEntry(v)) out[k] = { p: v.p, t: v.t, ...(v.n !== undefined ? { n: v.n } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadProgressIndex(): Promise<ProgressIndex> {
  try {
    return parseProgressIndex(await getItemAsync(PROGRESS_INDEX_KEY));
  } catch {
    return {};
  }
}

/**
 * Single-write persist. Held while storage reads as corrupt so defaults never
 * clobber good data. Returns false when skipped.
 */
export async function saveProgressIndex(index: ProgressIndex): Promise<boolean> {
  if (isStorageCorrupt()) return false;
  try {
    await setItemAsync(PROGRESS_INDEX_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

/** Merge per-key fallback entries into a (possibly partial) index. */
export function mergeIndexWithFallback(
  index: ProgressIndex,
  fallback: Record<string, ProgressIndexEntry | null | undefined>
): ProgressIndex {
  const out: ProgressIndex = { ...index };
  for (const [k, v] of Object.entries(fallback)) {
    if (!out[k] && v && isValidEntry(v)) out[k] = v;
  }
  return out;
}

/** Test-only: stateless over storage, nothing cached — kept for symmetry. */
export function __resetProgressIndexForTests(): void {
  void 0;
}
