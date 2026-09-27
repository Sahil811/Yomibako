// Repeat-lookup cache keyed by spelling|reading. Manga repeats words
// constantly; WordSheet remounts per vid/sid (key=`${vid}/${sid}`) so config,
// kanji and ImmersionKit re-fetch every tap without this.
// Never store per-user `state` — always merge fresh getCardState on mine/flag.
// Pure + dependency-free for node:test. LRU with fixed cap.

export function wordCacheKey(spelling: string, reading: string): string {
  return `${spelling}｜${reading ?? ''}`;
}

export type WordCacheValue = {
  meanings?: unknown;
  pitch?: unknown;
  kanji?: unknown;
  examples?: unknown;
  updatedAt: number;
};

const DEFAULT_MAX = 200;

export class WordCache {
  private readonly map = new Map<string, WordCacheValue>();
  constructor(private readonly max = DEFAULT_MAX) {}

  get(spelling: string, reading: string): WordCacheValue | undefined {
    const k = wordCacheKey(spelling, reading);
    const v = this.map.get(k);
    if (!v) return undefined;
    // Refresh recency.
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }

  set(spelling: string, reading: string, value: Omit<WordCacheValue, 'updatedAt'> & Partial<Pick<WordCacheValue, 'updatedAt'>>): void {
    const k = wordCacheKey(spelling, reading);
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { ...value, updatedAt: value.updatedAt ?? Date.now() });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (!oldest) break;
      this.map.delete(oldest);
    }
  }

  has(spelling: string, reading: string): boolean {
    return this.map.has(wordCacheKey(spelling, reading));
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** Test-only: inspect eviction order. */
  keys(): string[] {
    return [...this.map.keys()];
  }
}

/** Shared instance for the reader session. Invalidate on token change. */
export const sharedWordCache = new WordCache();
