// Pure reader helpers (extracted from ReaderScreen.tsx) — pinned here so the
// Sonar complexity refactor cannot silently drift their behavior.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInteractionState,
  applyToggleControl,
  applyToggleOptionsSideEffects,
  applyWordHover,
  applyZoomControl,
  clearAnchoredWord,
  clearToastTimer,
  clamp01,
  computeSeekPage,
  computeToggleOptionsNext,
  currentIndexFor,
  decideCenterTap,
  formatPageLabel,
  handleControlInfo,
  hideChromeForWord,
  isReadableVolume,
  maybePlayTapAudio,
  mergePageState,
  nextProgressValue,
  reanchorWord,
  shouldShowFab,
  shouldShowOptions,
  shouldShowWebView,
} from '../readerHelpers';

test('clamp01 pins to [0, 1]', () => {
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(0), 0);
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(1), 1);
  assert.equal(clamp01(9), 1);
});

test('formatPageLabel counts pages or shows percent', () => {
  assert.equal(formatPageLabel(true, 10, 3, 0), '4 / 10');
  assert.equal(formatPageLabel(true, 10, 9, 0), '10 / 10');
  assert.equal(formatPageLabel(false, 0, 0, 0.456), '46%');
});

test('currentIndexFor prefers the scrub target and never goes negative', () => {
  assert.equal(currentIndexFor(null, 5), 5);
  assert.equal(currentIndexFor(3, 5), 3);
  assert.equal(currentIndexFor(null, -2), 0);
});

test('mergePageState reuses the previous object when nothing changed', () => {
  const prev = { index: 1, total: 4, paged: true, rtl: false, twoPage: false };
  assert.equal(mergePageState(prev, { ...prev }), prev);
  const next = mergePageState(prev, { ...prev, index: 2 });
  assert.deepEqual(next, { index: 2, total: 4, paged: true, rtl: false, twoPage: false });
});

test('applyZoomControl only acts on zoom messages with a mode', () => {
  let mode: string | undefined;
  applyZoomControl({ key: 'twoPage' }, (m) => { mode = m; });
  applyZoomControl({ key: 'zoom' }, (m) => { mode = m; });
  assert.equal(mode, undefined);
  applyZoomControl({ key: 'zoom', mode: 'width' }, (m) => { mode = m; });
  assert.equal(mode, 'width');
});

test('applyToggleControl only acts on matching boolean values', () => {
  const seen: { twoPage?: boolean } = {};
  const setPage = (updater: any) => { Object.assign(seen, updater({ index: 0, total: 0, paged: false, rtl: false, twoPage: false })); };
  applyToggleControl({ key: 'rtl', value: true }, 'twoPage', setPage as any);
  applyToggleControl({ key: 'twoPage', value: 'yes' as any }, 'twoPage', setPage as any);
  assert.equal(seen.twoPage, undefined);
  applyToggleControl({ key: 'twoPage', value: true }, 'twoPage', setPage as any);
  assert.equal(seen.twoPage, true);
});

test('applyWordHover respects popup and sound settings', () => {
  const calls: string[] = [];
  const setOptionsOpen = () => { calls.push('options'); };
  const setWord = () => { calls.push('word'); };
  const schedule = () => { calls.push('schedule'); };
  const cancel = () => { calls.push('cancel'); };
  applyWordHover('w', { showPopupOnHover: true, playSoundOnHover: true }, setOptionsOpen, setWord, schedule, cancel);
  assert.deepEqual(calls, ['options', 'word', 'schedule']);
  calls.length = 0;
  applyWordHover('w', { showPopupOnHover: false, playSoundOnHover: false }, setOptionsOpen, setWord, schedule, cancel);
  assert.deepEqual(calls, ['cancel']);
});

test('decideCenterTap prefers dismiss, then hide, then show', () => {
  const calls: string[] = [];
  decideCenterTap(true, true, () => calls.push('dismiss'), () => calls.push('hide'), () => calls.push('show'));
  decideCenterTap(false, true, () => calls.push('dismiss'), () => calls.push('hide'), () => calls.push('show'));
  decideCenterTap(false, false, () => calls.push('dismiss'), () => calls.push('hide'), () => calls.push('show'));
  assert.deepEqual(calls, ['dismiss', 'hide', 'show']);
});

test('handleControlInfo gates on ok and delegates the rest', () => {
  let err: string | null = 'unset';
  const setErr = (s: string | null) => { err = s; };
  handleControlInfo({ ok: false, key: 'zoom' }, setErr, () => {}, (() => {}) as any);
  assert.equal(err, 'This file does not expose that control.');
  let mode = '';
  handleControlInfo({ ok: true, key: 'zoom', mode: 'width' }, setErr, (m) => { mode = m; }, ((u: any) => u({})) as any);
  assert.equal(err, null);
  assert.equal(mode, 'width');
});

test('computeToggleOptionsNext flips the flag', () => {
  assert.equal(computeToggleOptionsNext(true, false), false);
  assert.equal(computeToggleOptionsNext(false, true), true);
});

test('applyToggleOptionsSideEffects only closes an open menu', () => {
  let menu: boolean | undefined;
  let native = 0;
  const ref = { current: { setMokuroMenu: () => { native++; } } };
  applyToggleOptionsSideEffects(true, true, (b) => { menu = b; }, ref as any);
  applyToggleOptionsSideEffects(false, false, (b) => { menu = b; }, ref as any);
  assert.equal(menu, undefined);
  assert.equal(native, 0);
  applyToggleOptionsSideEffects(false, true, (b) => { menu = b; }, ref as any);
  assert.equal(menu, false);
  assert.equal(native, 1);
});

test('computeSeekPage maps a 0..1 scrub to a page or null', () => {
  assert.equal(computeSeekPage(1, 0.5), null);
  assert.equal(computeSeekPage(0, 0.5), null);
  assert.equal(computeSeekPage(10, 0), 0);
  assert.equal(computeSeekPage(10, 0.5), 5);
  assert.equal(computeSeekPage(10, 1), 9);
});

test('volume and visibility predicates', () => {
  assert.equal(isReadableVolume({ htmlUri: 'f://a' }), true);
  assert.equal(isReadableVolume({ mokuroUri: 'f://b' }), true);
  assert.equal(isReadableVolume({}), false);
  assert.equal(shouldShowWebView(0, {} as any), true);
  assert.equal(shouldShowWebView(null, {} as any), false);
  assert.equal(shouldShowWebView(0, null), false);
  assert.equal(shouldShowOptions(true, null), true);
  assert.equal(shouldShowOptions(true, {}), false);
  assert.equal(shouldShowOptions(false, null), false);
  assert.equal(shouldShowFab(null, null), true);
  assert.equal(shouldShowFab({}, null), false);
  assert.equal(shouldShowFab(null, []), false);
});

test('nextProgressValue ignores sub-frame jitter', () => {
  assert.equal(nextProgressValue(1, 1.001), 1);
  assert.equal(nextProgressValue(1, 1.5), 1.5);
});

test('clearAnchoredWord only clears when a word is anchored', () => {
  let cleared = 0;
  const handle = { clearAnchor: () => { cleared++; }, setMokuroMenu: () => {} };
  clearAnchoredWord({ current: null }, { current: null });
  clearAnchoredWord({ current: {} }, { current: null });
  clearAnchoredWord({ current: {} }, { current: handle });
  assert.equal(cleared, 1);
});

test('maybePlayTapAudio only plays when enabled', () => {
  let played = 0;
  maybePlayTapAudio(false, 'w', () => { played++; });
  assert.equal(played, 0);
  maybePlayTapAudio(true, 'w', () => { played++; });
  assert.equal(played, 1);
});

test('clearToastTimer cancels a pending timer', async () => {
  let fired = 0;
  const ref = { current: setTimeout(() => { fired++; }, 5) };
  clearToastTimer(ref);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(fired, 0);
  clearToastTimer({ current: null });
});

test('reanchorWord drops the tap point and keeps the word', () => {
  assert.equal(reanchorWord(null, {}), null);
  const next = { rect: 1, rects: 2, boxRect: 3, vertical: true, vw: 4, point: { x: 1 } };
  assert.deepEqual(reanchorWord({ keep: 1 }, next), { keep: 1, rect: 1, rects: 2, boxRect: 3, vertical: true, vw: 4, point: null });
});

test('hideChromeForWord only hides for an open lookup', () => {
  let hid = 0;
  hideChromeForWord(false, () => { hid++; });
  assert.equal(hid, 0);
  hideChromeForWord(true, () => { hid++; });
  assert.equal(hid, 1);
});

test('applyInteractionState normalizes config flags', () => {
  const ref = { current: { showPopupOnHover: false, playSoundOnHover: true } };
  applyInteractionState({}, ref);
  assert.deepEqual(ref.current, { showPopupOnHover: true, playSoundOnHover: false });
  applyInteractionState({ showPopupOnHover: false, playSoundOnHover: true }, ref);
  assert.deepEqual(ref.current, { showPopupOnHover: false, playSoundOnHover: true });
});
