// Pure word-sheet helpers — dependency-free (word.ts / immersionKit types only)
// so they can be unit-tested headlessly (see __tests__/wordSheetHelpers.test.ts).
// Extracted from WordSheet.tsx, which cannot run under node:test.

import { groupMeanings, parsePitch } from '../../services/jpdb/word';
import type { ImmersionExample } from '../../services/jpdb/immersionKit';

export type SheetColors = {
  readonly onSurface: string;
  readonly secondaryLabel: string;
  readonly tertiaryLabel: string;
  readonly primary: string;
  readonly systemFill: string;
  readonly tertiarySystemFill: string;
  readonly secondarySystemFill: string;
  readonly separator: string;
  readonly surface: string;
  readonly error: string;
};

// State badge fills mirror jpd-breader content/popup.css `.state span`.
export function stateColors(st: string, isDark: boolean): { bg: string; fg: string } {
  switch (st) {
    case 'new':
    case 'not-in-deck':
      return isDark ? { bg: '#1c2f6b', fg: '#8ab4f8' } : { bg: '#e8f0fe', fg: '#1967d2' };
    case 'learning':
      return isDark ? { bg: '#0e3724', fg: '#81c995' } : { bg: '#e6f4ea', fg: '#137333' };
    case 'known':
      return isDark ? { bg: '#0d3b1e', fg: '#5bb974' } : { bg: '#ceead6', fg: '#0d652d' };
    case 'due':
    case 'failed':
      return isDark ? { bg: '#4a0c0a', fg: '#f28b82' } : { bg: '#fce8e6', fg: '#c5221f' };
    case 'never-forget':
      return isDark ? { bg: '#370d4f', fg: '#d7aefb' } : { bg: '#f3e8fd', fg: '#7b1fa2' };
    default:
      return isDark ? { bg: '#3c4043', fg: '#9aa0a6' } : { bg: '#f1f3f4', fg: '#5f6368' };
  }
}

// Review pills mirror popup.css solid traffic-light fills.
export function reviewColor(r: string, primary: string, isDark: boolean): string {
  switch (r) {
    case 'nothing': return isDark ? '#a50e0e' : '#c62828';
    case 'something': return isDark ? '#b23c00' : '#d84315';
    case 'hard': return isDark ? '#c85f00' : '#e65100';
    case 'good': return isDark ? '#1a6b2d' : '#2e7d32';
    case 'easy': return isDark ? '#1a4e9e' : primary;
    default: return primary;
  }
}

export function shiftPoint<T extends { x: number; y: number }>(
  p: T | null | undefined,
  visual: { offsetLeft: number; offsetTop: number } | undefined,
): T | null {
  if (!p) {
    return null;
  }
  if (!visual) {
    return p;
  }
  return { ...p, x: p.x - visual.offsetLeft, y: p.y - visual.offsetTop };
}

export function meaningsToggleLabel(showAllMeanings: boolean, hiddenGlossCount: number): string {
  if (showAllMeanings) {
    return 'Show fewer meanings';
  }
  if (hiddenGlossCount === 1) {
    return `${hiddenGlossCount} more meaning`;
  }
  return `${hiddenGlossCount} more meanings`;
}

export function reviewLabel(r: string): string {
  if (r === 'nothing') {
    return 'Nothing';
  }
  if (r === 'something') {
    return 'Something';
  }
  return r[0].toUpperCase() + r.slice(1);
}

export function quickActionBg(active: boolean, activeBg: string, pressed: boolean, pressedBg: string): string {
  if (active) {
    return activeBg;
  }
  if (pressed) {
    return pressedBg;
  }
  return 'transparent';
}

export function mineButtonContent(adding: boolean, doneOrInDeck: boolean): { icon: 'check' | 'plus'; label: string } {
  if (adding) {
    return { icon: 'plus', label: 'Add' };
  }
  if (doneOrInDeck) {
    return { icon: 'check', label: 'Added' };
  }
  return { icon: 'plus', label: 'Add' };
}

export function mineButtonBg(doneOrInDeck: boolean, systemFill: string, primary: string): string {
  if (doneOrInDeck) {
    return systemFill;
  }
  return primary;
}

export function mineButtonFg(doneOrInDeck: boolean, primary: string): string {
  if (doneOrInDeck) {
    return primary;
  }
  return '#fff';
}

export type GroupedMeanings = { partOfSpeech: string[]; glosses: string[][]; startIndex: number }[];

export function safeGroupMeanings(meanings: any): GroupedMeanings {
  try {
    return groupMeanings({ meanings: Array.isArray(meanings) ? meanings : [] });
  } catch {
    return [];
  }
}

export function trimGlossGroups(
  grouped: GroupedMeanings,
  showDetails: boolean,
  showAllMeanings: boolean,
): { visibleGroups: GroupedMeanings; hiddenGlossCount: number; totalGlosses: number } {
  const maxGlosses = showDetails ? 8 : 5;
  const totalGlosses = grouped.reduce((n, g) => n + g.glosses.length, 0);
  if (showAllMeanings || totalGlosses <= maxGlosses) {
    return { visibleGroups: grouped, hiddenGlossCount: 0, totalGlosses };
  }
  const out: GroupedMeanings = [];
  let used = 0;
  for (const g of grouped) {
    if (used >= maxGlosses) {
      break;
    }
    const take = Math.min(g.glosses.length, maxGlosses - used);
    out.push({ ...g, glosses: g.glosses.slice(0, take) });
    used += take;
  }
  const visibleCount = out.reduce((n, g) => n + g.glosses.length, 0);
  return { visibleGroups: out, hiddenGlossCount: Math.max(0, totalGlosses - visibleCount), totalGlosses };
}

export function safeParsePitch(
  reading: string,
  pitchAccent: any[],
): { text: string; isHigh: boolean; isFinal: boolean }[] | null {
  try {
    if (pitchAccent?.length) {
      return parsePitch(reading, pitchAccent[0]);
    }
    return null;
  } catch {
    return null;
  }
}

export function buildGeminiPrompt(spelling: string, reading: string, meanings: any[], pitchAccent: string[], sentence: string): string {
  const glossPart = (meanings || []).map((m: any) => (m.glosses || []).join(', ')).join(' ; ');
  return `Explain the Japanese word "${spelling}" (${reading}) — meanings: ${glossPart}. Pitch: ${pitchAccent.join(', ')}. Sentence: "${sentence}". Give a concise, learner-focused explanation with nuance, collocations, and one example.\n\nFormatting rules: reply in clean, simple Markdown. Use "## " for section headings, "**bold**" only for key terms, and "- " for bullet points. Do not stack markers like *** or ****, and never leave a * or ** unbalanced.`;
}

export function isPlayAllCancelled(runRef: { current: number }, run: number): boolean {
  return runRef.current !== run;
}

export function applyFetchedExamples(
  examples: ImmersionExample[],
  autoplay: boolean,
  setters: {
    setExamples: (e: ImmersionExample[]) => void;
    setIndex: (i: number) => void;
    setError: (s: string | null) => void;
  },
  playFirst: (e: ImmersionExample) => void,
): void {
  setters.setExamples(examples);
  setters.setIndex(0);
  if (!examples.length) {
    setters.setError('No examples found for this word.');
  } else if (autoplay && examples[0].soundUrl) {
    playFirst(examples[0]);
  }
}

export function isAnyExamplePlaying(playing: boolean, looping: boolean, playingAll: boolean): boolean {
  return playing || looping || playingAll;
}

export function canStartPlayAll(playingAll: boolean, examples: ImmersionExample[] | null): examples is ImmersionExample[] {
  return !playingAll && !!examples?.length;
}

export function shouldAutoFetchExamples(examples: ImmersionExample[] | null, loading: boolean): boolean {
  return examples === null && !loading;
}

export function nextExampleIndex(current: number, delta: number, length: number): number {
  return (current + delta + length) % length;
}

export function playPauseLabel(playing: boolean, looping: boolean, playingAll: boolean): 'pause' | 'play' {
  return playing && !looping && !playingAll ? 'pause' : 'play';
}

export function playPauseA11y(playing: boolean, looping: boolean, playingAll: boolean): string {
  return playing && !looping && !playingAll ? 'Stop example audio' : 'Play example audio';
}
