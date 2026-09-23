// Pure word-sheet helpers (extracted from WordSheet.tsx) — pinned here so the
// Sonar complexity refactor cannot silently drift their behavior.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFetchedExamples,
  buildGeminiPrompt,
  canStartPlayAll,
  isAnyExamplePlaying,
  isPlayAllCancelled,
  meaningsToggleLabel,
  mineButtonBg,
  mineButtonContent,
  mineButtonFg,
  nextExampleIndex,
  playPauseA11y,
  playPauseLabel,
  quickActionBg,
  reviewColor,
  reviewLabel,
  safeGroupMeanings,
  safeParsePitch,
  shiftPoint,
  shouldAutoFetchExamples,
  stateColors,
  trimGlossGroups,
} from '../wordSheetHelpers';

test('stateColors covers every card state in both themes', () => {
  for (const st of ['new', 'not-in-deck', 'learning', 'known', 'due', 'failed', 'never-forget', 'mystery']) {
    for (const dark of [true, false]) {
      const c = stateColors(st, dark);
      assert.ok(c.bg && c.fg, `${st}/${dark}`);
    }
  }
  assert.deepEqual(stateColors('new', true), { bg: '#1c2f6b', fg: '#8ab4f8' });
  assert.deepEqual(stateColors('known', false), { bg: '#ceead6', fg: '#0d652d' });
});

test('reviewColor maps every rating and falls back to primary', () => {
  assert.equal(reviewColor('nothing', 'P', true), '#a50e0e');
  assert.equal(reviewColor('something', 'P', false), '#d84315');
  assert.equal(reviewColor('hard', 'P', false), '#e65100');
  assert.equal(reviewColor('good', 'P', true), '#1a6b2d');
  assert.equal(reviewColor('easy', 'P', false), 'P');
  assert.equal(reviewColor('weird', 'P', true), 'P');
});

test('shiftPoint handles missing inputs', () => {
  assert.equal(shiftPoint(null, { offsetLeft: 1, offsetTop: 2 }), null);
  const p = { x: 5, y: 7 };
  assert.equal(shiftPoint(p, undefined), p);
  assert.deepEqual(shiftPoint(p, { offsetLeft: 2, offsetTop: 3 }), { x: 3, y: 4 });
});

test('meaningsToggleLabel singularizes one hidden gloss', () => {
  assert.equal(meaningsToggleLabel(true, 9), 'Show fewer meanings');
  assert.equal(meaningsToggleLabel(false, 1), '1 more meaning');
  assert.equal(meaningsToggleLabel(false, 4), '4 more meanings');
});

test('reviewLabel capitalizes the rest', () => {
  assert.equal(reviewLabel('nothing'), 'Nothing');
  assert.equal(reviewLabel('something'), 'Something');
  assert.equal(reviewLabel('hard'), 'Hard');
});

test('quickActionBg prefers active over pressed', () => {
  assert.equal(quickActionBg(true, 'A', true, 'P'), 'A');
  assert.equal(quickActionBg(false, 'A', true, 'P'), 'P');
  assert.equal(quickActionBg(false, 'A', false, 'P'), 'transparent');
});

test('mine button states', () => {
  assert.deepEqual(mineButtonContent(true, false), { icon: 'plus', label: 'Add' });
  assert.deepEqual(mineButtonContent(false, true), { icon: 'check', label: 'Added' });
  assert.deepEqual(mineButtonContent(false, false), { icon: 'plus', label: 'Add' });
  assert.equal(mineButtonBg(true, 'S', 'P'), 'S');
  assert.equal(mineButtonBg(false, 'S', 'P'), 'P');
  assert.equal(mineButtonFg(true, 'P'), 'P');
  assert.equal(mineButtonFg(false, 'P'), '#fff');
});

test('safeGroupMeanings tolerates junk and groups real cards', () => {
  assert.deepEqual(safeGroupMeanings(null), []);
  assert.deepEqual(safeGroupMeanings('nope'), []);
  const grouped = safeGroupMeanings([
    { partOfSpeech: ['n'], glosses: ['book'] },
    { partOfSpeech: ['n'], glosses: ['volume'] },
    { partOfSpeech: ['v5'], glosses: ['to read'] },
  ]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].glosses, [['book'], ['volume']]);
});

test('trimGlossGroups caps at 5 collapsed / 8 expanded', () => {
  const groups = [
    { partOfSpeech: ['n'], glosses: [['a'], ['b'], ['c'], ['d'], ['e']], startIndex: 0 },
    { partOfSpeech: ['v5'], glosses: [['f'], ['g'], ['h']], startIndex: 1 },
  ];
  const all = trimGlossGroups(groups, false, true);
  assert.equal(all.hiddenGlossCount, 0);
  assert.equal(all.totalGlosses, 8);
  const collapsed = trimGlossGroups(groups, false, false);
  assert.equal(collapsed.hiddenGlossCount, 3);
  assert.equal(collapsed.visibleGroups.reduce((n, g) => n + g.glosses.length, 0), 5);
  const expanded = trimGlossGroups(groups, true, false);
  assert.equal(expanded.hiddenGlossCount, 0);
  const small = trimGlossGroups(groups.slice(0, 1), false, false);
  assert.equal(small.hiddenGlossCount, 0);
});

test('safeParsePitch parses valid pitch and nulls the rest', () => {
  assert.equal(safeParsePitch('x', []), null);
  const parts = safeParsePitch('はし', ['LHL']);
  assert.ok(parts);
  assert.equal(parts!.map((p) => p.text).join(''), 'はし');
});

test('buildGeminiPrompt carries the word and context', () => {
  const prompt = buildGeminiPrompt('猫', 'ねこ', [{ glosses: ['cat'] }], ['LHH'], '猫が鳴いた。');
  assert.ok(prompt.includes('猫'));
  assert.ok(prompt.includes('ねこ'));
  assert.ok(prompt.includes('猫が鳴いた。'));
  assert.ok(prompt.includes('cat'));
});

test('play-all guards', () => {
  assert.equal(isPlayAllCancelled({ current: 1 }, 1), false);
  assert.equal(isPlayAllCancelled({ current: 2 }, 1), true);
  const ex = (soundUrl?: string) => ({ sentence: 's', soundUrl } as any);
  assert.equal(canStartPlayAll(true, [ex('u')]), false);
  assert.equal(canStartPlayAll(false, null), false);
  assert.equal(canStartPlayAll(false, []), false);
  assert.equal(canStartPlayAll(false, [ex('u')]), true);
  assert.equal(shouldAutoFetchExamples(null, false), true);
  assert.equal(shouldAutoFetchExamples(null, true), false);
  assert.equal(shouldAutoFetchExamples([], false), false);
  assert.equal(nextExampleIndex(0, 1, 3), 1);
  assert.equal(nextExampleIndex(0, -1, 3), 2);
  assert.equal(playPauseLabel(true, false, false), 'pause');
  assert.equal(playPauseLabel(true, true, false), 'play');
  assert.equal(playPauseA11y(false, false, false), 'Play example audio');
  assert.equal(playPauseA11y(true, false, false), 'Stop example audio');
});

test('applyFetchedExamples reports empty and autoplays sound', () => {
  const seen: any = { examples: null, index: -1, error: 'unset', played: null };
  const setters = {
    setExamples: (e: any) => { seen.examples = e; },
    setIndex: (i: number) => { seen.index = i; },
    setError: (s: string | null) => { seen.error = s; },
  };
  applyFetchedExamples([], true, setters, (e) => { seen.played = e; });
  assert.equal(seen.error, 'No examples found for this word.');
  assert.equal(seen.played, null);
  const withSound = [{ sentence: 'a', soundUrl: 'u' } as any];
  applyFetchedExamples(withSound, true, setters, (e) => { seen.played = e; });
  assert.deepEqual(seen.played, withSound[0]);
  seen.played = null;
  applyFetchedExamples(withSound, false, setters, (e) => { seen.played = e; });
  assert.equal(seen.played, null);
  applyFetchedExamples([{ sentence: 't' } as any], true, setters, (e) => { seen.played = e; });
  assert.equal(seen.played, null);
});

test('safeGroupMeanings returns [] when grouping throws', () => {
  assert.deepEqual(safeGroupMeanings([null]), []);
});

test('safeParsePitch returns null when the accessor throws', () => {
  const evil: any[] = ['x'];
  Object.defineProperty(evil, '0', { get() { throw new Error('nope'); }, configurable: true });
  assert.equal(safeParsePitch('あ', evil), null);
  assert.equal(safeParsePitch('あ', null as any), null);
  assert.equal(safeParsePitch('あ', [] as any), null);
});

test('isAnyExamplePlaying covers every combination', () => {
  assert.equal(isAnyExamplePlaying(false, false, false), false);
  assert.equal(isAnyExamplePlaying(true, false, false), true);
  assert.equal(isAnyExamplePlaying(false, true, false), true);
  assert.equal(isAnyExamplePlaying(false, false, true), true);
  assert.equal(isAnyExamplePlaying(true, true, true), true);
});
