// Ported from D:\Downloads\jpd-breader_13.0\content\word.js and popup_word_view.js
// Sentence extraction + POS map without Anki

const sentenceCache = new Map<string, number[]>();
const SENTENCE_CACHE_MAX = 200;

function getCachedBoundaries(context: string): number[] {
  const cached = sentenceCache.get(context);
  if (cached) return cached;
  const boundaries = [-1, ...Array.from(context.matchAll(/[。！？]/g), (m) => (m.index ?? -1)), context.length];
  if (sentenceCache.size >= SENTENCE_CACHE_MAX) {
    const first = sentenceCache.keys().next().value;
    if (first !== undefined) sentenceCache.delete(first);
  }
  sentenceCache.set(context, boundaries);
  return boundaries;
}

export function getSentences(
  data: { context: string; contextOffset: number; sentenceBoundaries?: number[]; sentenceIndex?: number },
  contextWidth: number
): string {
  if (data.context == null) return '';
  if (data.sentenceBoundaries === undefined || data.sentenceIndex === undefined) {
    const boundaries = getCachedBoundaries(data.context);
    data.sentenceBoundaries = boundaries;
    let left = 0;
    let right = boundaries.length;
    while (left < right) {
      const middle = (left + right) >> 1;
      if (boundaries[middle] <= data.contextOffset) left = middle + 1;
      else right = middle;
    }
    data.sentenceIndex = left;
  }
  const start = data.sentenceBoundaries[Math.max(data.sentenceIndex - contextWidth, 0)] + 1;
  const end = data.sentenceBoundaries[Math.min(data.sentenceIndex + contextWidth - 1, data.sentenceBoundaries.length - 1)] + 1;
  return data.context.slice(start, end).trim();
}

export const PARTS_OF_SPEECH: Record<string, string> = {
  n: 'Noun',
  pn: 'Pronoun',
  pref: 'Prefix',
  suf: 'Suffix',
  name: 'Name',
  'name-fem': 'Name (Feminine)',
  'name-male': 'Name (Masculine)',
  'name-surname': 'Surname',
  'name-person': 'Personal Name',
  'name-place': 'Place Name',
  'name-company': 'Company Name',
  'name-product': 'Product Name',
  'adj-i': 'Adjective',
  'adj-na': 'na-Adjective',
  'adj-no': 'no-Adjective',
  'adj-pn': 'Adjectival',
  'adj-nari': 'nari-Adjective (Archaic/Formal)',
  'adj-ku': 'ku-Adjective (Archaic)',
  'adj-shiku': 'shiku-Adjective (Archaic)',
  adv: 'Adverb',
  aux: 'Auxiliary',
  'aux-v': 'Auxiliary Verb',
  'aux-adj': 'Auxiliary Adjective',
  conj: 'Conjunction',
  cop: 'Copula',
  ctr: 'Counter',
  exp: 'Expression',
  int: 'Interjection',
  num: 'Numeric',
  prt: 'Particle',
  vt: 'Transitive Verb',
  vi: 'Intransitive Verb',
  v1: 'Ichidan Verb',
  'v1-s': 'Ichidan Verb (Irregular)',
  v5: 'Godan Verb',
  v5u: 'u Godan Verb',
  'v5u-s': 'u Godan Verb (Irregular)',
  v5k: 'ku Godan Verb',
  'v5k-s': 'ku/iku Godan Verb (Irregular)',
  v5g: 'gu Godan Verb',
  v5s: 'su Godan Verb',
  v5t: 'tsu Godan Verb',
  v5n: 'nu Godan Verb',
  v5b: 'bu Godan Verb',
  v5m: 'mu Godan Verb',
  v5r: 'ru Godan Verb',
  'v5r-i': 'ru Godan Verb (Irregular)',
  v5aru: 'aru Godan Verb (Irregular)',
  vk: 'Irregular Verb (kuru)',
  vs: 'suru Verb',
  vz: 'zuru Verb',
  'vs-c': 'Verb (Archaic)',
  v2: 'Nidan Verb (Archaic)',
  v4: 'Yodan Verb (Archaic)',
  va: 'Archaic',
};

export function groupMeanings(card: { meanings: { glosses: string[]; partOfSpeech: string[] }[] }) {
  const grouped: { partOfSpeech: string[]; glosses: string[][]; startIndex: number }[] = [];
  let lastPOS: string[] = [];
  for (const [index, meaning] of card.meanings.entries()) {
    const same =
      meaning.partOfSpeech.length === lastPOS.length &&
      meaning.partOfSpeech.every((p, i) => p === lastPOS[i]);
    if (same) {
      grouped.at(-1)!.glosses.push(meaning.glosses);
      continue;
    }
    grouped.push({ partOfSpeech: meaning.partOfSpeech, glosses: [meaning.glosses], startIndex: index });
    lastPOS = meaning.partOfSpeech;
  }
  return grouped;
}

// Pitch rendering helper returns segments for RN Text rendering
export function parsePitch(reading: string, pitch: string): { text: string; isHigh: boolean; isFinal: boolean }[] | null {
  if (!reading || !pitch || reading.length !== pitch.length - 1) return null;
  try {
    const parts: { text: string; isHigh: boolean; isFinal: boolean }[] = [];
    const borders = Array.from(pitch.matchAll(/L(?=H)|H(?=L)/g), (x) => (x.index ?? 0) + 1);
    let lastBorder = 0;
    let low = pitch.startsWith('L');
    for (const border of borders) {
      parts.push({ text: reading.slice(lastBorder, border), isHigh: !low, isFinal: false });
      lastBorder = border;
      low = !low;
    }
    if (lastBorder !== reading.length) {
      parts.push({ text: reading.slice(lastBorder), isHigh: !low, isFinal: true });
    }
    // annotate low/high for style
    return parts.map((p) => ({ ...p, isHigh: p.isHigh }));
  } catch {
    return null;
  }
}
