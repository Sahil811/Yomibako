// Ported from D:\Downloads\jpd-breader_13.0\integrations\api.js and background\backend.js
// RN adaptation: uses fetch directly, no browser.runtime. Implements full jpd-breader API minus Anki export.
// Keeps rate-limit, retry-like handling, and FORQ scrape fallback.
//
// Cookie-gated scraping (vocab/review/FORQ pages) runs through the hidden
// jpdb.io session WebView (session.ts) when available — the equivalent of
// the extension's `credentials: "include"`. Direct fetch is the fallback.

export type ParseToken = {
  card: {
    vid: number;
    sid: number;
    rid: number;
    spelling: string;
    reading: string;
    frequencyRank: number | null;
    partOfSpeech: string[];
    meanings: { glosses: string[]; partOfSpeech: string[] }[];
    state: string[];
    pitchAccent: string[];
  };
  start: number;
  end: number;
  length: number;
  rubies: { text: string; start: number; end: number; length: number }[];
};

// Keep same vocab/token fields as jpd-breader integrations/api.js so tokens exactly match
const VOCAB_FIELDS = [
  'vid',
  'sid',
  'rid',
  'spelling',
  'reading',
  'frequency_rank',
  'part_of_speech',
  'meanings_chunks',
  'meanings_part_of_speech',
  'card_state',
  'pitch_accent',
] as const;
const TOKEN_FIELDS = ['vocabulary_index', 'position', 'length', 'furigana'] as const;

const API_RATELIMIT_MS = 200; // same as background/backend.js API_RATELIMIT 0.2s
const SCRAPE_RATELIMIT_MS = 1100; // same as SCRAPE_RATELIMIT 1.1s

let lastCall = 0;
async function throttle(ms: number) {
  const now = Date.now();
  const wait = lastCall + ms - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

function jpdbHeaders(apiToken: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiToken}`,
    Accept: 'application/json',
  };
}

export class JpdbError extends Error {
  status?: number;
  retriable?: boolean;
  constructor(msg: string, status?: number, retriable = false) {
    super(msg);
    this.name = 'JpdbError';
    this.status = status;
    this.retriable = retriable;
  }
}

function isRetryableStatus(s: number) {
  return s === 500 || s === 502 || s === 503 || s === 504;
}

export const LOGIN_HINT = 'Not logged in to JPDB — open Settings → JPDB Login and sign in';

// Runs inside the hidden session WebView (cookies attached). Returns null
// when the bridge itself is unavailable so callers fall back to direct fetch.
async function sessionText(
  url: string,
  init?: { method?: 'GET' | 'POST'; body?: string; contentType?: string }
): Promise<string | null> {
  try {
    const { sessionFetch } = await import('./session');
    const r = await sessionFetch(url, init ?? {});
    return r.text;
  } catch {
    return null;
  }
}

async function requestWithRetry(
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; retries?: number; safeToRetry?: boolean } = {}
): Promise<Response> {
  const { timeoutMs = 10000, retries = 1, safeToRetry = init.method === 'GET' } = opts;
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal as any });
      clearTimeout(timeout);
      if (!res.ok) {
        // decide retry
        if (safeToRetry && isRetryableStatus(res.status) && attempt < retries) {
          attempt++;
          await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
          continue;
        }
        return res;
      }
      return res;
    } catch (e: any) {
      clearTimeout(timeout);
      if (e?.name === 'AbortError') throw new JpdbError(`Timeout after ${timeoutMs}ms for ${url}`, undefined, true);
      if (safeToRetry && attempt < retries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        continue;
      }
      throw new JpdbError(e?.message ?? `Network error for ${url}`, undefined, true);
    }
  }
}

export const jpdbApi = {
  async parse({ text, apiToken }: { text: string[]; apiToken: string }): Promise<{ tokens: ParseToken[][]; cards: any[] }> {
    await throttle(API_RATELIMIT_MS);
    const res = await requestWithRetry(
      'https://jpdb.io/api/v1/parse',
      {
        method: 'POST',
        headers: jpdbHeaders(apiToken),
        body: JSON.stringify({
          text,
          position_length_encoding: 'utf16',
          token_fields: [...TOKEN_FIELDS],
          vocabulary_fields: [...VOCAB_FIELDS],
        }),
      },
      { timeoutMs: 10000, safeToRetry: false, retries: 0 }
    );
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      let msg = `JPDB parse ${res.status}`;
      try {
        msg = JSON.parse(t)?.error_message ?? msg;
      } catch {}
      throw new JpdbError(msg, res.status, isRetryableStatus(res.status));
    }
    const data = await res.json();
    const cards = data.vocabulary.map((v: any) => {
      const [vid, sid, rid, spelling, reading, frequencyRank, partOfSpeech, meaningsChunks, meaningsPartOfSpeech, cardState, pitchAccent] =
        v;
      return {
        vid,
        sid,
        rid,
        spelling,
        reading,
        frequencyRank,
        partOfSpeech,
        meanings: meaningsChunks.map((g: string[], i: number) => ({ glosses: g, partOfSpeech: meaningsPartOfSpeech[i] })),
        state: cardState ?? ['not-in-deck'],
        pitchAccent: pitchAccent ?? [],
      };
    });
    const tokens: ParseToken[][] = data.tokens.map((toks: any[]) =>
      toks.map((tok: any) => {
        const [vocabularyIndex, position, length, furigana] = tok;
        const card = cards[vocabularyIndex];
        let offset = position;
        const rubies =
          furigana === null
            ? []
            : furigana.flatMap((p: any) => {
                if (typeof p === 'string') {
                  offset += p.length;
                  return [];
                }
                const [base, ruby] = p;
                const start = offset;
                offset = start + base.length;
                return { text: ruby, start, end: offset, length: base.length };
              });
        return { card, start: position, end: position + length, length, rubies };
      })
    );
    return { tokens, cards };
  },

  async addVocabulary({
    deckId,
    vocabulary,
    apiToken,
  }: {
    deckId: string | number;
    vocabulary: [number, number][];
    apiToken: string;
  }) {
    if (String(deckId) === 'forq') return jpdbApi.prioritize({ vid: vocabulary[0][0], sid: vocabulary[0][1] });
    await throttle(API_RATELIMIT_MS);
    const res = await requestWithRetry(
      'https://jpdb.io/api/v1/deck/add-vocabulary',
      {
        method: 'POST',
        headers: jpdbHeaders(apiToken),
        body: JSON.stringify({ id: deckId, vocabulary }),
      },
      { timeoutMs: 10000, safeToRetry: false }
    );
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      let msg = `addVocabulary ${res.status}`;
      try {
        msg = JSON.parse(t)?.error_message ?? msg;
      } catch {}
      throw new JpdbError(msg, res.status);
    }
    return res.json();
  },

  async removeVocabulary({
    deckId,
    vocabulary,
    apiToken,
  }: {
    deckId: string | number;
    vocabulary: [number, number][];
    apiToken: string;
  }) {
    if (String(deckId) === 'forq') return jpdbApi.deprioritize({ vid: vocabulary[0][0], sid: vocabulary[0][1] });
    await throttle(API_RATELIMIT_MS);
    const res = await requestWithRetry(
      'https://jpdb.io/api/v1/deck/remove-vocabulary',
      {
        method: 'POST',
        headers: jpdbHeaders(apiToken),
        body: JSON.stringify({ id: deckId, vocabulary }),
      },
      { timeoutMs: 10000, safeToRetry: false }
    );
    if (!res.ok) throw new JpdbError(`removeVocabulary ${res.status}`, res.status);
    return res.json();
  },

  async lookupVocabulary({ list, apiToken }: { list: [number, number][]; apiToken: string }) {
    await throttle(API_RATELIMIT_MS);
    const res = await requestWithRetry(
      'https://jpdb.io/api/v1/lookup-vocabulary',
      {
        method: 'POST',
        headers: jpdbHeaders(apiToken),
        body: JSON.stringify({ list, fields: ['card_state'] }),
      },
      { timeoutMs: 10000, safeToRetry: true, retries: 2 }
    );
    if (!res.ok) throw new JpdbError(`lookup ${res.status}`, res.status);
    return res.json();
  },

  async setCardSentence({
    vid,
    sid,
    sentence,
    translation,
    apiToken,
  }: {
    vid: number;
    sid: number;
    sentence?: string;
    translation?: string;
    apiToken: string;
  }) {
    await throttle(API_RATELIMIT_MS);
    const body: any = { vid, sid };
    if (sentence) body.sentence = sentence;
    if (translation) body.translation = translation;
    const res = await requestWithRetry(
      'https://jpdb.io/api/v1/set-card-sentence',
      {
        method: 'POST',
        headers: jpdbHeaders(apiToken),
        body: JSON.stringify(body),
      },
      { timeoutMs: 10000, safeToRetry: false }
    );
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      let msg = `setCardSentence ${res.status}`;
      try {
        msg = JSON.parse(t)?.error_message ?? msg;
      } catch {}
      throw new JpdbError(msg, res.status);
    }
    return res.json().catch(() => null);
  },

  async fetchVocabularyPage({ vid, spelling }: { vid: number; spelling: string }) {
    await throttle(SCRAPE_RATELIMIT_MS);
    const url = `https://jpdb.io/vocabulary/${vid}/${encodeURIComponent(spelling)}`;
    const viaSession = await sessionText(url);
    if (viaSession !== null) return viaSession;
    const res = await requestWithRetry(
      url,
      { method: 'GET', headers: { Accept: 'text/html' } as any },
      { timeoutMs: 10000, safeToRetry: true, retries: 2 }
    );
    if (!res.ok) throw new JpdbError(`vocab page ${res.status}`, res.status);
    return res.text();
  },

  async fetchAudioBytes({ hash }: { hash: string }) {
    await throttle(SCRAPE_RATELIMIT_MS);
    const res = await requestWithRetry(
      `https://jpdb.io/static/v/${hash}`,
      { method: 'GET', headers: { 'X-Access': "please don't steal these files" } as any },
      { timeoutMs: 12000, safeToRetry: true, retries: 2 }
    );
    if (!res.ok) throw new JpdbError(`audio ${res.status}`, res.status);
    const buf = await res.arrayBuffer();
    return buf;
  },

  async getAudioHash({ vid, spelling }: { vid: number; spelling: string }): Promise<string | null> {
    try {
      // No login needed: verified live that logged-out vocabulary pages
      // already contain data-audio (the /login link in the nav is a
      // red herring). Only review/FORQ scraping truly requires login.
      const html = await jpdbApi.fetchVocabularyPage({ vid, spelling });
      const m = html.match(/data-audio="([^"]+)"/);
      return m?.[1] ?? null;
    } catch (e: any) {
      if (e.status === 404) return null;
      // Surface both legs: bridge failure + direct failure tells us whether
      // the hidden session view or the login itself is the problem.
      try {
        const { lastSessionJobError } = await import('./session');
        const bridgeErr = lastSessionJobError();
        if (bridgeErr) throw new JpdbError(`${e?.message ?? e} [bridge: ${bridgeErr}]`, (e as JpdbError)?.status);
      } catch (inner: any) {
        if (inner instanceof JpdbError) throw inner;
      }
      throw e;
    }
  },

  async getCardState({ vid, sid, apiToken }: { vid: number; sid: number; apiToken: string }): Promise<string[]> {
    let data: any;
    try {
      data = await jpdbApi.lookupVocabulary({ list: [[vid, sid]], apiToken });
    } catch (e: any) {
      const status = (e as JpdbError)?.status;
      throw new JpdbError(`card state lookup failed: ${e?.message ?? e}`, status);
    }
    const info = data.vocabulary_info?.[0];
    if (info === null) throw new JpdbError(`word ${vid}/${sid} not found`, 404);
    return info?.[0] ?? ['not-in-deck'];
  },

  async fetchReviewPage({ vid, sid }: { vid: number; sid: number }) {
    await throttle(SCRAPE_RATELIMIT_MS);
    const url = `https://jpdb.io/review?c=vf%2C${vid}%2C${sid}`;
    const viaSession = await sessionText(url);
    if (viaSession !== null) {
      if (viaSession.includes('href="/login"')) throw new JpdbError(`${LOGIN_HINT} - review requires login`, 401);
      return viaSession;
    }
    const res = await requestWithRetry(
      url,
      { method: 'GET', headers: { Accept: 'text/html' } as any },
      { timeoutMs: 10000, safeToRetry: true, retries: 2 }
    );
    if (!res.ok) throw new JpdbError(`review page ${res.status}`, res.status);
    const html = await res.text();
    if (html.includes('href="/login"')) throw new JpdbError(`${LOGIN_HINT} - review requires login`, 401);
    return html;
  },

  async submitReview({ vid, sid, reviewNo, grade }: { vid: number; sid: number; reviewNo: number; grade: string }) {
    await throttle(SCRAPE_RATELIMIT_MS);
    const body = `c=vf%2C${vid}%2C${sid}&r=${reviewNo}&g=${grade}`;
    const viaSession = await sessionText('https://jpdb.io/review', {
      method: 'POST',
      body,
      contentType: 'application/x-www-form-urlencoded',
    });
    if (viaSession !== null) return viaSession;
    const res = await requestWithRetry(
      'https://jpdb.io/review',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' } as any,
        body,
      },
      { timeoutMs: 10000, safeToRetry: false }
    );
    if (!res.ok) throw new JpdbError(`submit review ${res.status}`, res.status);
    return res.text();
  },

  async review({
    vid,
    sid,
    rating,
  }: {
    vid: number;
    sid: number;
    rating: 'nothing' | 'something' | 'hard' | 'good' | 'easy' | 'pass' | 'fail' | 'known' | 'unknown' | 'never_forget' | 'blacklist';
  }) {
    const REVIEW_GRADES: Record<string, string> = {
      nothing: '1',
      something: '2',
      hard: '3',
      good: '4',
      easy: '5',
      pass: 'p',
      fail: 'f',
      known: 'k',
      unknown: 'n',
      never_forget: 'w',
      blacklist: '-1',
    };
    const grade = REVIEW_GRADES[rating];
    if (!grade) throw new JpdbError(`unknown rating ${rating}`);
    const html = await jpdbApi.fetchReviewPage({ vid, sid });
    const m = html.match(/name="r"\s+value="(\d+)"/i) || html.match(/value="(\d+)"\s+name="r"/i);
    if (!m) throw new JpdbError('Could not find review number');
    const reviewNo = parseInt(m[1], 10);
    return jpdbApi.submitReview({ vid, sid, reviewNo, grade });
  },

  async prioritize({ vid, sid }: { vid: number; sid: number }) {
    await throttle(SCRAPE_RATELIMIT_MS);
    const body = `v=${vid}&s=${sid}&origin=/`;
    const viaSession = await sessionText('https://jpdb.io/prioritize', {
      method: 'POST',
      body,
      contentType: 'application/x-www-form-urlencoded',
    });
    if (viaSession !== null) {
      if (viaSession.includes('href="/login"')) throw new JpdbError(`${LOGIN_HINT} - FORQ requires login`, 401);
      return viaSession;
    }
    const res = await requestWithRetry(
      'https://jpdb.io/prioritize',
      {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'content-type': 'application/x-www-form-urlencoded',
        } as any,
        body,
      },
      { timeoutMs: 10000, safeToRetry: false }
    );
    if (!res.ok) throw new JpdbError(`prioritize ${res.status}`, res.status);
    const html = await res.text();
    if (html.includes('href="/login"')) throw new JpdbError(`${LOGIN_HINT} - FORQ requires login`, 401);
    return html;
  },

  async deprioritize({ vid, sid }: { vid: number; sid: number }) {
    await throttle(SCRAPE_RATELIMIT_MS);
    const body = `v=${vid}&s=${sid}&origin=`;
    const viaSession = await sessionText('https://jpdb.io/deprioritize', {
      method: 'POST',
      body,
      contentType: 'application/x-www-form-urlencoded',
    });
    if (viaSession !== null) {
      if (viaSession.includes('href="/login"')) throw new JpdbError(`${LOGIN_HINT} - FORQ requires login`, 401);
      return viaSession;
    }
    const res = await requestWithRetry(
      'https://jpdb.io/deprioritize',
      {
        method: 'POST',
        headers: { Accept: '*/*', 'content-type': 'application/x-www-form-urlencoded' } as any,
        body,
      },
      { timeoutMs: 10000, safeToRetry: false }
    );
    if (!res.ok) throw new JpdbError(`deprioritize ${res.status}`, res.status);
    const html = await res.text();
    if (html.includes('href="/login"')) throw new JpdbError(`${LOGIN_HINT} - FORQ requires login`, 401);
    return html;
  },

  async setFlag({
    vid,
    sid,
    flag,
    state,
    apiToken,
  }: {
    vid: number;
    sid: number;
    flag: 'blacklist' | 'never-forget';
    state: boolean;
    apiToken: string;
  }) {
    let deckId: string | number | null;
    try {
      const { getDeckId } = await import('./config');
      deckId = await getDeckId(flag === 'blacklist' ? 'blacklistDeckId' : 'neverForgetDeckId');
    } catch (e: any) {
      throw new JpdbError(`flag ${flag}: deck lookup failed: ${e?.message ?? e}`);
    }
    if (!deckId) throw new JpdbError(`No deck ID for ${flag} - set in Settings`);
    try {
      if (state) return await jpdbApi.addVocabulary({ deckId, vocabulary: [[vid, sid]], apiToken });
      else return await jpdbApi.removeVocabulary({ deckId, vocabulary: [[vid, sid]], apiToken });
    } catch (e: any) {
      const status = (e as JpdbError)?.status;
      throw new JpdbError(`flag ${flag} ${state ? 'add' : 'remove'} failed: ${e?.message ?? e}`, status);
    }
  },

  // Direct FORQ-aware mine helper (mirrors background/background.js mine)
  async mine({
    vid,
    sid,
    apiToken,
    sentence,
    translation,
    forq,
    reviewRating,
  }: {
    vid: number;
    sid: number;
    apiToken: string;
    sentence?: string;
    translation?: string;
    forq?: boolean;
    reviewRating?: 'nothing' | 'something' | 'hard' | 'good' | 'easy';
  }) {
    const { getDeckId, loadConfig } = await import('./config');
    const cfg = await loadConfig();
    const miningDeckId = cfg.miningDeckId;
    if (!miningDeckId) throw new JpdbError('No mining deck ID set, check Settings');
    const shouldForq = forq ?? cfg.forqOnMine;
    await jpdbApi.addVocabulary({ deckId: miningDeckId, vocabulary: [[vid, sid]], apiToken });
    if (sentence || translation) {
      await jpdbApi.setCardSentence({ vid, sid, sentence, translation, apiToken });
    }
    if (shouldForq) {
      const forqId = cfg.forqDeckId ?? 'forq';
      await jpdbApi.addVocabulary({ deckId: forqId, vocabulary: [[vid, sid]], apiToken });
    }
    if (reviewRating) {
      await jpdbApi.review({ vid, sid, rating: reviewRating });
    }
  },
};

// Supplemental APIs — mirror integrations/api.js but without Anki (immersionKit/kanji/gemini kept)
export const immersionKitApi = {
  async fetchMetadata(signal?: AbortSignal) {
    const res = await requestWithRetry(
      'https://apiv2.immersionkit.com/index_meta',
      { method: 'GET', signal: signal as any },
      { timeoutMs: 7000, safeToRetry: true, retries: 2 }
    );
    if (!res.ok) throw new JpdbError(`ImmersionKit meta ${res.status}`, res.status);
    return res.json();
  },
  async search(word: string, signal?: AbortSignal) {
    const url = `https://apiv2.immersionkit.com/search?q=${encodeURIComponent(word)}&exactMatch=false&limit=50&sort=sentence_length:asc`;
    const res = await requestWithRetry(url, { method: 'GET', signal: signal as any }, { timeoutMs: 7000, safeToRetry: true, retries: 2 });
    if (!res.ok) throw new JpdbError(`ImmersionKit search ${res.status}`, res.status);
    return res.json();
  },
  async fetchMedia(url: string, signal?: AbortSignal) {
    const res = await requestWithRetry(url, { method: 'GET', signal: signal as any }, { timeoutMs: 12000, safeToRetry: true, retries: 1 });
    if (!res.ok) throw new JpdbError(`ImmersionKit media ${res.status}`, res.status);
    return res.arrayBuffer();
  },
};

export const kanjiApi = {
  async fetchKanji(char: string, signal?: AbortSignal) {
    const res = await requestWithRetry(
      `https://kanjiapi.dev/v1/kanji/${encodeURIComponent(char)}`,
      { method: 'GET', signal: signal as any },
      { timeoutMs: 5000, safeToRetry: true, retries: 1 }
    );
    if (!res.ok) throw new JpdbError(`kanji ${res.status}`, res.status);
    return res.json();
  },
};

export const geminiApi = {
  // Ordered fallbacks. The first is a moving alias that always resolves to a
  // current model, so the feature keeps working as Google retires versions.
  models: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'] as const,

  async explainWord({ apiKey, prompt, model, signal }: { apiKey: string; prompt: string; model?: string; signal?: AbortSignal }): Promise<string> {
    const key = (apiKey ?? '').trim();
    if (!key) throw new JpdbError('No Gemini API key set');

    const tried = model ? [model, ...this.models.filter((m) => m !== model)] : [...this.models];
    let lastError: JpdbError | null = null;

    for (const name of tried) {
      const res = await requestWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key } as any,
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
          signal: signal as any,
        },
        { timeoutMs: 45000, safeToRetry: true, retries: 2 }
      );

      if (res.ok) {
        const data = await res.json().catch(() => null as any);
        const parts = data?.candidates?.[0]?.content?.parts;
        const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? '').join('').trim() : '';
        if (text) return text;
        // 200 with no text = safety block or empty candidate. Surface why.
        const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
        throw new JpdbError(reason ? `Gemini returned no text (${reason})` : 'Gemini returned an empty response', 200);
      }

      const body = await res.text().catch(() => '');
      lastError = new JpdbError(`Gemini: ${geminiErrorMessage(body, res.status)}`, res.status);
      // A 404 means this model id is gone; try the next candidate. Every other
      // status (bad key 400/401/403, rate limit 429, server 5xx) would repeat
      // identically for every model, so fail fast instead of looping.
      if (res.status === 404) continue;
      throw lastError;
    }
    throw lastError ?? new JpdbError('Gemini request failed');
  },
};

// Gemini errors are JSON: { error: { code, message, status } }. Fall back to a
// trimmed raw body, then the bare status, so the UI always has something real.
function geminiErrorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message;
    if (message) return String(message);
  } catch {}
  const trimmed = body.trim();
  if (status === 429) return 'rate limit reached — wait a moment and retry';
  if (status === 401 || status === 403) return 'API key rejected — check it in Settings';
  return trimmed ? trimmed.slice(0, 200) : `HTTP ${status}`;
}


export const youtubeApi = {
  async fetchWatchPage(url: string, signal?: AbortSignal): Promise<string> {
    const res = await requestWithRetry(url, { method: 'GET', signal: signal as any }, { timeoutMs: 8000, safeToRetry: true, retries: 1 });
    if (!res.ok) throw new JpdbError(`YouTube watch ${res.status}`, res.status);
    return res.text();
  },
  async fetchTranscript(url: string, signal?: AbortSignal): Promise<string> {
    const res = await requestWithRetry(url, { method: 'GET', signal: signal as any }, { timeoutMs: 8000, safeToRetry: true, retries: 1 });
    if (!res.ok) throw new JpdbError(`YouTube transcript ${res.status}`, res.status);
    return res.text();
  },
};
