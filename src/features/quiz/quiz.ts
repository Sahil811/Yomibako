// Quiz model — pure and dependency-free so it can be reasoned about (and
// tested) without a WebView or a device.
//
// Words come straight from the cards the reader/browser bundles already
// attached to every parsed span, so building a quiz costs no extra JPDB call.

export type QuizWord = {
  vid: number;
  sid: number;
  spelling: string;
  reading?: string;
  /** One entry per sense, each already flattened to a single gloss string. */
  meanings: string[];
  state?: string[];
};

export type QuizQuestion = {
  word: QuizWord;
  /** Shuffled answer set; always contains `answer`. */
  options: string[];
  answer: string;
};

export const QUIZ_MAX_QUESTIONS = 20;
export const QUIZ_OPTIONS = 4;
/** One right answer and at least one wrong one, or there is no question. */
export const QUIZ_MIN_OPTIONS = 2;

/**
 * Card states worth testing: anything unknown, or known-but-due-for-review.
 * The same set the userscript selects on (`failed`, `due`, `new`,
 * `not-in-deck`) — quizzing settled vocabulary is just noise.
 */
const ASKABLE = ['new', 'not-in-deck', 'due', 'failed'];
/** States that must never be shown, whatever else the card is tagged with. */
const SUPPRESSED = ['blacklisted', 'suspended', 'locked', 'redundant', 'never-forget'];

export function isAskable(state: string[] | undefined): boolean {
  // A card with no state at all has not been added to any deck.
  if (!state || !state.length) return true;
  if (state.some((s) => SUPPRESSED.includes(s))) return false;
  return state.some((s) => ASKABLE.includes(s));
}

/** Words the quiz will actually ask about, out of everything on the page. */
export function askableWords(words: QuizWord[]): QuizWord[] {
  return words.filter((word) => isAskable(word.state));
}

export function wordKey(word: { vid: number; sid: number }): string {
  return `${word.vid}/${word.sid}`;
}

function shuffle<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function glossesOf(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const meaning of raw) {
    // Cards carry { glosses, partOfSpeech }; be tolerant of plain strings too.
    const text = typeof meaning === 'string' ? meaning : Array.isArray(meaning?.glosses) ? meaning.glosses.join('; ') : '';
    const trimmed = text.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * Turns raw collected spans into a deduplicated word list. Card state is kept
 * rather than filtered here so the caller can tell "nothing parsed yet" from
 * "everything on this page is already known".
 */
export function normalizeQuizWords(raw: any[]): QuizWord[] {
  const byKey = new Map<string, QuizWord>();
  for (const item of raw ?? []) {
    const vid = Number(item?.vid);
    const sid = Number(item?.sid);
    const spelling = typeof item?.spelling === 'string' ? item.spelling.trim() : '';
    if (!Number.isFinite(vid) || !Number.isFinite(sid) || !spelling) continue;
    const meanings = glossesOf(item?.meanings);
    if (!meanings.length) continue;
    const key = `${vid}/${sid}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      vid,
      sid,
      spelling,
      reading: typeof item?.reading === 'string' && item.reading ? item.reading : undefined,
      meanings,
      state: Array.isArray(item?.state) ? item.state : [],
    });
  }
  return [...byKey.values()];
}

/**
 * Builds a round in random order.
 *
 * `pool` supplies the wrong answers and defaults to `ask`. Passing every word
 * on the page makes the distractors plausible without ever asking about
 * vocabulary the reader has already settled.
 *
 * Returns an empty list when there is nothing to ask or no real choice.
 */
export function buildQuestions(
  ask: QuizWord[],
  pool: QuizWord[] = ask,
  max = QUIZ_MAX_QUESTIONS
): QuizQuestion[] {
  const askable = ask.filter((w) => w.meanings.length > 0);
  if (!askable.length) return [];
  const meanings = [...new Set([...pool, ...askable].filter((w) => w.meanings.length > 0).map((w) => w.meanings[0]))];
  if (meanings.length < QUIZ_MIN_OPTIONS) return [];

  const ordered = shuffle(askable).slice(0, max);

  return ordered.map((word) => {
    const answer = word.meanings[0];
    const distractors = shuffle(meanings.filter((m) => m !== answer));
    const options = shuffle([answer, ...distractors.slice(0, QUIZ_OPTIONS - 1)]);
    return { word, options, answer };
  });
}

export function scoreMessage(percent: number): string {
  if (percent === 100) return 'パーフェクト！ Perfect score';
  if (percent >= 90) return '素晴らしい！ Excellent work';
  if (percent >= 70) return 'よくできました！ Great job';
  if (percent >= 50) return 'まあまあ。Keep going';
  return 'がんばれ！ Keep practicing';
}
