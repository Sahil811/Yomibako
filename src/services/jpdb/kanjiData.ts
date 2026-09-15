// Bundled kanji data — ports assets/jpd-breader content/popup_resources.js
// to React Native. Meanings, components, and RTK mnemonics come from the
// same JSON files the extension ships (assets/kanji/*.json), so the popup
// kanji breakdown works fully offline. kanjiapi.dev is only a fallback for
// characters missing from the bundle.
import meaningsJson from '../../../assets/kanji/kanji_meanings.json';
import componentsJson from '../../../assets/kanji/kanji_components.json';
import componentMeaningsJson from '../../../assets/kanji/component_meanings.json';
import { kanjiApi } from './api';

export type KanjiComponent = { component: string; meaning: string };
export type KanjiDetail = {
  kanji: string;
  meanings: string;
  components: KanjiComponent[];
  rtk?: string;
};

let meaningMap: Map<string, string> | null = null;
let rtkMap: Map<string, string> | null = null;
let componentsMap: Map<string, string[]> | null = null;
let componentMeaningsMap: Map<string, string> | null = null;

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  return (arr || []).filter((c) => !seen.has(c) && (seen.add(c), true));
}

function ensureMaps() {
  if (!meaningMap) {
    meaningMap = new Map();
    rtkMap = new Map();
    for (const entry of meaningsJson as { kanji: string; meaning: string; rtk?: string }[]) {
      if (entry.kanji && entry.meaning) meaningMap.set(entry.kanji, entry.meaning);
      if (entry.kanji && entry.rtk) rtkMap!.set(entry.kanji, entry.rtk);
    }
  }
  if (!componentsMap) {
    componentsMap = new Map();
    const raw = componentsJson as Record<string, string[]>;
    for (const k of Object.keys(raw)) componentsMap.set(k, dedupe(raw[k]));
  }
  if (!componentMeaningsMap) {
    componentMeaningsMap = new Map(Object.entries(componentMeaningsJson as Record<string, string>));
  }
}

function cleanRtkText(rtk: string): string {
  if (!rtk || typeof rtk !== 'string') return '';
  return rtk
    .replace(/#\*/g, '')
    .replace(/\*#/g, '')
    .replace(/#/g, '')
    .replace(/\*/g, '')
    .replace(/\{/g, '')
    .replace(/\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isKanjiChar(ch: string): boolean {
  try {
    return /\p{Script=Han}/u.test(ch) && ch !== '。';
  } catch {
    return false;
  }
}

/** Full breakdown for every unique kanji in spelling (max 8), like the extension popup. */
export async function loadKanjiDetails(
  spelling: string,
  opts: { showRtk?: boolean } = {}
): Promise<KanjiDetail[]> {
  ensureMaps();
  const chars = Array.from(new Set(String(spelling ?? '').split('').filter(isKanjiChar))).slice(0, 8);
  if (!chars.length) return [];
  const showRtk = !!opts.showRtk;
  const out = await Promise.all(
    chars.map(async (ch) => {
      let meanings = meaningMap!.get(ch) ?? '';
      if (!meanings) {
        try {
          const data = await kanjiApi.fetchKanji(ch);
          meanings = (data.meanings || []).join(', ') || data.heisig_en || '';
          if (!meanings) return null;
        } catch {
          return null;
        }
      }
      const comps = dedupe(componentsMap!.get(ch) || []).map((component) => ({
        component,
        meaning: meaningMap!.get(component) || componentMeaningsMap!.get(component) || '',
      }));
      let rtk: string | undefined;
      if (showRtk) {
        const raw = rtkMap!.get(ch) || '';
        const cleaned = cleanRtkText(raw);
        if (cleaned) rtk = cleaned;
      }
      return { kanji: ch, meanings, components: comps, rtk } as KanjiDetail;
    })
  );
  return out.filter(Boolean) as KanjiDetail[];
}
