import { immersionKitApi } from './api';

const MEDIA_ROOT = 'https://us-southeast-1.linodeobjects.com/immersionkit/media/';
const FALLBACK_PARTICLES = ['を', 'に', 'が', 'へ', 'と', 'で'];

type DeckMetadata = Record<string, { title?: string; category?: string; tags?: string[] }>;

export type ImmersionExample = {
  id: string;
  sourceSlug: string;
  sourceTitle: string;
  category: string;
  sentence: string;
  translation: string;
  imageUrl: string;
  soundUrl: string;
};

let metadataPromise: Promise<DeckMetadata> | null = null;
const examplesCache = new Map<string, Promise<ImmersionExample[]>>();

/** Test-only: drop cached metadata so each test refetches. */
export function __resetImmersionForTests() {
  metadataPromise = null;
  examplesCache.clear();
}

async function getMetadata(signal?: AbortSignal): Promise<DeckMetadata> {
  metadataPromise ??= immersionKitApi
    .fetchMetadata(signal)
    .then((json: any) => json?.data ?? {})
    .catch(() => ({}));
  return metadataPromise;
}

function mediaUrl(category: string, title: string, filename: string): string {
  if (!category || !title || !filename) return '';
  const path = [category, title, 'media', filename]
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${MEDIA_ROOT}${path}`;
}

function mapExamples(raw: any[], metadata: DeckMetadata): ImmersionExample[] {
  return raw.map((example) => {
    const sourceSlug = String(example?.title ?? '');
    const mediaTitle = String(metadata[sourceSlug]?.title ?? '');
    const sourceTitle = mediaTitle || sourceSlug.replaceAll('_', ' ').trim() || 'ImmersionKit';
    const category = String(example?.id ?? '').split('_')[0] || String(metadata[sourceSlug]?.category ?? '');
    return {
      id: String(example?.id ?? `${sourceSlug}-${example?.sentence ?? ''}`),
      sourceSlug,
      sourceTitle,
      category,
      sentence: String(example?.sentence ?? example?.text ?? ''),
      translation: String(example?.translation ?? ''),
      imageUrl: mediaUrl(category, mediaTitle, String(example?.image ?? '')),
      soundUrl: mediaUrl(category, mediaTitle, String(example?.sound ?? '')),
    };
  });
}

async function searchCandidate(word: string, signal?: AbortSignal): Promise<any[]> {
  if (!word || signal?.aborted) return [];
  const data: any = await immersionKitApi.search(word, signal);
  return Array.isArray(data?.examples) ? data.examples : [];
}

/**
 * Fetch and normalize ImmersionKit examples using the same metadata/media
 * mapping and particle fallback as JPDB Breader.
 */
async function searchWithParticleFallback(word: string, signal?: AbortSignal): Promise<any[]> {
  for (const particle of FALLBACK_PARTICLES) {
    if (!word.includes(particle)) continue;
    const candidates = word.split(particle).filter(Boolean);
    for (const candidate of candidates) {
      const found = await searchCandidate(candidate, signal);
      if (found.length) return found;
    }
  }
  return [];
}

export async function fetchImmersionExamples(word: string, signal?: AbortSignal): Promise<ImmersionExample[]> {
  const key = String(word ?? '');
  if (!key) return [];
  if (signal?.aborted) return [];
  // Promise cache: tapping the same word (or re-expanding examples) reuses
  // the in-flight/completed fetch instead of firing sequential particle
  // fallback searches again. Abortable requests bypass the cache.
  const cached = examplesCache.get(key);
  if (cached) {
    try {
      return await cached;
    } catch {
      examplesCache.delete(key);
    }
  }
  const promise = (async () => {
    const metadata = await getMetadata(signal);
    const direct = await searchCandidate(key, signal);
    if (direct.length) return mapExamples(direct, metadata);

    const fallback = await searchWithParticleFallback(key, signal);
    return mapExamples(fallback, metadata);
  })();
  // Bounded cache — long browsing sessions shouldn't grow without limit.
  if (examplesCache.size > 200) examplesCache.clear();
  examplesCache.set(key, promise);
  try {
    return await promise;
  } catch (e) {
    if (examplesCache.get(key) === promise) examplesCache.delete(key);
    throw e;
  }
}

/** Convert the limited HTML found in ImmersionKit translations to native text. */
export function immersionText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}
