import { readExtJson } from "../util.js";
import { kanjiApi } from "../integrations/api.js";

let kanjiMeaningsPromise = null;
let kanjiComponentsPromise = null;
let componentMeaningsPromise = null;

function isKanji(char) {
  return /\p{Script=Han}/u.test(char) && char !== "。";
}

function getKanjiFromMap(map, char) {
  const meaning = map.get(char);
  return meaning ? { kanji: char, meaning } : null;
}

let kanjiFullDataPromise = null;
let kanjiRtkPromise = null;

async function getKanjiFullData() {
  if (kanjiFullDataPromise) return kanjiFullDataPromise;
  kanjiFullDataPromise = (async () => {
    const data = await readExtJson("kanji_meanings.json");
    const meaningMap = new Map();
    const rtkMap = new Map();
    for (const entry of data) {
      if (entry.kanji && entry.meaning) meaningMap.set(entry.kanji, entry.meaning);
      if (entry.kanji && entry.rtk) rtkMap.set(entry.kanji, entry.rtk);
    }
    return { meaningMap, rtkMap };
  })().catch((error) => {
    console.error("Failed to load kanji_meanings.json:", error);
    kanjiFullDataPromise = null;
    return { meaningMap: new Map(), rtkMap: new Map() };
  });
  return kanjiFullDataPromise;
}

async function getKanjiMeaningsPromise() {
  if (kanjiMeaningsPromise) return kanjiMeaningsPromise;
  kanjiMeaningsPromise = getKanjiFullData()
    .then((d) => d.meaningMap)
    .catch((error) => {
      console.error("Failed to load kanji_meanings.json:", error);
      kanjiMeaningsPromise = null;
      return new Map();
    });
  return kanjiMeaningsPromise;
}

async function getKanjiRtkMap() {
  if (kanjiRtkPromise) return kanjiRtkPromise;
  kanjiRtkPromise = getKanjiFullData()
    .then((d) => d.rtkMap)
    .catch((error) => {
      console.error("Failed to load RTK data:", error);
      kanjiRtkPromise = null;
      return new Map();
    });
  return kanjiRtkPromise;
}

function cleanRtkText(rtk) {
  if (!rtk || typeof rtk !== "string") return "";
  // Remove RTK markup: # # * * { } but keep inner text
  // Also collapse whitespace
  return rtk
    .replace(/#\*/g, "")
    .replace(/\*#/g, "")
    .replace(/#/g, "")
    .replace(/\*/g, "")
    .replace(/\{/g, "")
    .replace(/\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function getKanjiDetails(char, kanjiMap) {
  const local = getKanjiFromMap(kanjiMap, char);
  if (local) return local;

  try {
    return await kanjiApi.fetchKanji(char);
  } catch {
    return null;
  }
}

function dedupeComponents(arr) {
  if (!arr || !arr.length) return [];
  const seen = new Set();
  return arr.filter((c) => !seen.has(c) && seen.add(c));
}

async function getKanjiComponentsMap() {
  if (kanjiComponentsPromise) return kanjiComponentsPromise;

  kanjiComponentsPromise = (async () => {
    const data = await readExtJson("kanji_components.json");
    // data is { kanji: [components] } — dedupe to avoid ugly duplicate rows like 準: 氵 隼 隼
    const map = new Map();
    for (const [k, v] of Object.entries(data)) {
      map.set(k, dedupeComponents(v));
    }
    return map;
  })().catch((error) => {
    console.error("Failed to load kanji_components.json:", error);
    kanjiComponentsPromise = null;
    return new Map();
  });

  return kanjiComponentsPromise;
}

async function getComponentMeaningsMap() {
  if (componentMeaningsPromise) return componentMeaningsPromise;

  componentMeaningsPromise = (async () => {
    const data = await readExtJson("component_meanings.json");
    // data is { component: meaning }
    return new Map(Object.entries(data));
  })().catch((error) => {
    console.error("Failed to load component_meanings.json:", error);
    componentMeaningsPromise = null;
    return new Map();
  });

  return componentMeaningsPromise;
}

export async function getComponentsForKanji(char) {
  const [kanjiMap, compMeaningsMap, kanjiCompMap] = await Promise.all([
    getKanjiMeaningsPromise(),
    getComponentMeaningsMap(),
    getKanjiComponentsMap(),
  ]);

  const comps = dedupeComponents(kanjiCompMap.get(char) || []);
  if (!comps.length) return [];

  return comps.map((component) => {
    const meaning =
      kanjiMap.get(component) || compMeaningsMap.get(component) || "";
    return { component, meaning };
  });
}

// P0: Preload on idle — warm cache before first hover (~40ms saved)
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  requestIdleCallback(() => { void getKanjiMeaningsPromise(); void getKanjiComponentsMap(); void getComponentMeaningsMap(); }, { timeout: 2000 });
} else if (typeof window !== 'undefined') {
  setTimeout(() => { void getKanjiMeaningsPromise(); void getKanjiComponentsMap(); void getComponentMeaningsMap(); }, 800);
}
export async function loadPopupSupplementalData(card, options = {}) {
  const { showKanji = true, showRtk = false } = options;
  let characterDetails = null;
  let kanjiComponents = null;

  if (showKanji) {
    const [kanjiMap, compMeaningsMap, kanjiCompMap, rtkMap] = await Promise.all([
      getKanjiMeaningsPromise(),
      getComponentMeaningsMap(),
      getKanjiComponentsMap(),
      showRtk ? getKanjiRtkMap() : Promise.resolve(null),
    ]);

    characterDetails = (
      await Promise.all(
        [...card.spelling].filter(isKanji).map(async (char) => {
          const charDetails = await getKanjiDetails(char, kanjiMap);
          return charDetails
            ? {
                kanji: charDetails.kanji,
                meanings:
                  charDetails.meaning || charDetails.meanings?.join(", ") || "",
              }
            : null;
        })
      )
    ).filter(Boolean);

    characterDetails = characterDetails.length ? characterDetails : null;

    if (characterDetails) {
      kanjiComponents = new Map();
      for (const details of characterDetails) {
        const comps = dedupeComponents(kanjiCompMap.get(details.kanji) || []);
        const enriched = comps.map((component) => {
          const meaning =
            kanjiMap.get(component) || compMeaningsMap.get(component) || "";
          return { component, meaning };
        });
        kanjiComponents.set(details.kanji, enriched);
        // Attach directly for convenient rendering
        details.components = enriched;
        if (showRtk && rtkMap) {
          const raw = rtkMap.get(details.kanji) || "";
          details.rtk = cleanRtkText(raw);
          details.rtkRaw = raw;
        }
      }
      if (kanjiComponents.size === 0) kanjiComponents = new Map();
    }
  }

  return { characterDetails, kanjiComponents };
}
