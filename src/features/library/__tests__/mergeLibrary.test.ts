import test from 'node:test';
import assert from 'node:assert/strict';
import {
  absorbSeries,
  compareStrings,
  compareTitle,
  mergeSeries,
  mergeVolumeDetails,
  patchSeries,
  pruneMissingSeries,
  recount,
  seriesKey,
  sortVolumes,
} from '../mergeLibrary';
import type { Series, Volume } from '../types';

function vol(over: Partial<Volume> & { id: string }): Volume {
  return {
    series: 'Conan',
    title: over.id,
    uri: `file:///conan/${over.id}`,
    pageCount: 0,
    ...over,
  };
}

/**
 * Exactly what the scanner publishes right after one folder listing: every
 * detail field present but blank. `id` matches vol()'s because the scanner
 * derives both phases from the same folder uri.
 */
function shell(id: string): Volume {
  return {
    id,
    series: 'Conan',
    title: id,
    uri: `file:///conan/${id}`,
    htmlUri: undefined,
    mokuroUri: undefined,
    ocrUri: undefined,
    pageCount: 0,
    coverUri: undefined,
  };
}

function series(rootUri: string, volumes: Volume[], over: Partial<Series> = {}): Series {
  return recount({ name: over.name ?? 'Conan', rootUri, volumes, totalPages: 0, ...over }, volumes);
}

const KNOWN = [
  vol({ id: '001', pageCount: 18, coverUri: 'file:///conan/001/p1.jpg', htmlUri: 'file:///conan/001.html', progress: 0.5, lastOpened: 111 }),
  vol({ id: '002', pageCount: 20, coverUri: 'file:///conan/002/p1.jpg', mokuroUri: 'file:///conan/002.mokuro', ocrUri: 'file:///ocr/002', progressKey: 'pk2' }),
  vol({ id: '003', pageCount: 22, coverUri: 'file:///conan/003/p1.jpg' }),
];

test('compareTitle orders numerically and sortVolumes does not mutate', () => {
  assert.ok(compareTitle({ title: '2' }, { title: '10' }) < 0, 'numeric, not lexical');
  const list = [vol({ id: '10' }), vol({ id: '2' })];
  assert.deepEqual(sortVolumes(list).map((v) => v.id), ['2', '10']);
  assert.deepEqual(list.map((v) => v.id), ['10', '2'], 'input untouched');
});

test('seriesKey is the root uri and recount sums pages', () => {
  const s = series('file:///conan', KNOWN);
  assert.equal(seriesKey(s), 'file:///conan');
  assert.equal(s.totalPages, 60);
});

test('recount keeps the series identity and rewrites only volumes/pages', () => {
  const s = series('file:///conan', KNOWN, { sourceRootUri: 'file:///shelf' });
  const next = recount(s, KNOWN.slice(0, 1));
  assert.equal(next.rootUri, 'file:///conan');
  assert.equal(next.sourceRootUri, 'file:///shelf');
  assert.equal(next.totalPages, 18);
});

test('mergeSeries replaces the series for a root and sorts by name', () => {
  const a = series('file:///a', KNOWN, { name: 'A' });
  const b = series('file:///b', [vol({ id: '1' })], { name: 'B' });
  const merged = mergeSeries([b, a], [series('file:///a', [vol({ id: '9' })], { name: 'A' })]);
  assert.deepEqual(merged.map((s) => s.name), ['A', 'B']);
  assert.deepEqual(merged[0].volumes.map((v) => v.id), ['9'], 'wholesale replace');
});

test('absorbSeries requires explicit mode (no silent replace default)', () => {
  const current = [series('file:///a', KNOWN)];
  const draft = [series('file:///a', KNOWN.slice(0, 1))];
  assert.deepEqual(absorbSeries(current, draft, 'replace')[0].volumes.length, 1);
  assert.deepEqual(absorbSeries(current, draft, 'patch')[0].volumes.length, 3);
});

test('compareStrings is numeric and shared with scanner ordering', () => {
  assert.ok(compareStrings('2', '10') < 0, 'numeric, not lexical');
  assert.equal(compareStrings('a', 'B'), compareTitle({ title: 'a' }, { title: 'B' }));
});
test('mergeVolumeDetails without a cached volume is the incoming one', () => {
  const v = vol({ id: '001' });
  assert.equal(mergeVolumeDetails(undefined, v), v);
});

test('a shell cannot blank a cached volume', () => {
  const cached = KNOWN[1];
  const merged = mergeVolumeDetails(cached, shell('002'));
  assert.equal(merged.coverUri, cached.coverUri, 'cover survives');
  assert.equal(merged.pageCount, cached.pageCount, 'page count survives');
  assert.equal(merged.mokuroUri, cached.mokuroUri);
  assert.equal(merged.ocrUri, cached.ocrUri);
  assert.equal(merged.progressKey, 'pk2');
  assert.equal(merged.htmlUri, undefined, 'nothing knew it');
});

test('a hydration result keeps cached progress, and real progress wins', () => {
  const cached = KNOWN[0];
  // Scanner drafts carry no progress fields at all.
  assert.equal(mergeVolumeDetails(cached, shell('001')).progress, 0.5);
  assert.equal(mergeVolumeDetails(cached, shell('001')).lastOpened, 111);
  // Hydration always reports a number, including a genuine 0.
  assert.equal(mergeVolumeDetails(cached, vol({ id: '001', progress: 0 })).progress, 0);
  assert.equal(mergeVolumeDetails(cached, vol({ id: '001', progress: 1, lastOpened: 9 })).lastOpened, 9);
});

test('patch keeps detail for volumes the draft has not reached', () => {
  const current = [series('file:///conan', KNOWN)];
  // The scanner's first publish: shells for everything, zero detail.
  const shells = [series('file:///conan', [shell('001'), shell('002'), shell('003')], { sourceRootUri: 'file:///shelf' })];
  const patched = patchSeries(current, shells);
  assert.deepEqual(patched[0].volumes.map((v) => v.id), ['001', '002', '003']);
  assert.deepEqual(patched[0].volumes.map((v) => v.coverUri), KNOWN.map((v) => v.coverUri));
  assert.equal(patched[0].totalPages, 60, 'total never dips mid-walk');
  assert.equal(patched[0].sourceRootUri, 'file:///shelf');
  assert.equal(patched[0].volumes[0].progress, 0.5);
});

test('patch grows the list as volumes stream in and keeps them sorted', () => {
  const current = [series('file:///conan', [KNOWN[0]])];
  const draft = [series('file:///conan', [
    vol({ id: '002', pageCount: 20, coverUri: 'file:///conan/002/p1.jpg' }),
    vol({ id: '003', pageCount: 22, coverUri: 'file:///conan/003/p1.jpg' }),
  ])];
  const patched = patchSeries(current, draft);
  assert.deepEqual(patched[0].volumes.map((v) => v.id), ['001', '002', '003']);
  assert.equal(patched[0].totalPages, 60);
});

test('patch adds an unknown series and leaves other roots alone', () => {
  const conan = series('file:///conan', KNOWN);
  const other = series('file:///other', [vol({ id: 'x' })], { name: 'Other' });
  const fresh = series('file:///fresh', [vol({ id: '1', pageCount: 5 })], { name: 'Fresh' });
  const patched = patchSeries([other, conan], [fresh]);
  assert.deepEqual(patched.map((s) => s.name), ['Conan', 'Fresh', 'Other']);
  assert.equal(patched[1].volumes.length, 1);
  assert.equal(patched[2].volumes.length, 1);
});

test('patch without sourceRootUri keeps the one on record', () => {
  const current = [series('file:///conan', KNOWN, { sourceRootUri: 'file:///shelf' })];
  const patched = patchSeries(current, [series('file:///conan', [shell('001')])]);
  assert.equal(patched[0].sourceRootUri, 'file:///shelf');
});


test('a draft that reveals nothing leaves every reference untouched', () => {
  const current = [series('file:///conan', KNOWN, { sourceRootUri: 'file:///shelf' })];
  // Same facts, freshly allocated objects — exactly a repeat scan of a
  // folder that has not changed on disk.
  const repeated = [series('file:///conan', KNOWN.map((v) => ({ ...v })), { sourceRootUri: 'file:///shelf' })];
  const patched = patchSeries(current, repeated);
  assert.equal(patched, current, 'same array — setState can bail out');
  assert.equal(patched[0].volumes[0], KNOWN[0], 'volume object reused, cards stay memoised');
});

test('a repeat of the cached index (what hydration delivers) is a no-op', () => {
  const current = [series('file:///conan', KNOWN)];
  const fromCache = [series('file:///conan', KNOWN.map((v) => ({ ...v, pageCount: 0 })))];
  assert.equal(patchSeries(current, fromCache), current, 'zero page counts must not dirty anything');
});

test('only the volume that gained detail changes identity', () => {
  const current = [series('file:///conan', KNOWN)];
  const gained = [series('file:///conan', [
    KNOWN[0],
    { ...KNOWN[1], coverUri: 'file:///conan/002/new.jpg' },
    KNOWN[2],
  ])];
  const patched = patchSeries(current, gained);
  assert.notEqual(patched, current);
  assert.equal(patched[0].volumes[0], KNOWN[0]);
  assert.notEqual(patched[0].volumes[1], KNOWN[1]);
  assert.equal(patched[0].volumes[2], KNOWN[2]);
});

test('a series rename from the scanner is honoured by patch', () => {
  const current = [series('file:///conan', KNOWN)];
  const renamed = [series('file:///conan', [], { name: 'Detective Conan' })];
  const patched = patchSeries(current, renamed);
  assert.equal(patched[0].name, 'Detective Conan');
  assert.equal(patched[0].volumes.length, 3, 'empty draft never empties the shelf');
});

test('a finished root walk may drop volumes deleted on disk', () => {
  const current = [series('file:///conan', KNOWN)];
  const final = [series('file:///conan', KNOWN.slice(0, 2))];
  assert.deepEqual(absorbSeries(current, final, 'replace')[0].volumes.map((v) => v.id), ['001', '002']);
  assert.deepEqual(absorbSeries(current, final, 'patch')[0].volumes.map((v) => v.id), ['001', '002', '003']);
});

test('pruneMissingSeries drops a series deleted from a walked shelf', () => {
  const a = series('file:///shelf/A', [vol({ id: 'a1' })], { name: 'A', sourceRootUri: 'file:///shelf' });
  const b = series('file:///shelf/B', [vol({ id: 'b1' })], { name: 'B', sourceRootUri: 'file:///shelf' });
  const other = series('file:///other', [vol({ id: 'x' })], { name: 'Other' });
  const live = new Set(['file:///shelf/A']);
  const walked = new Set(['file:///shelf']);
  const pruned = pruneMissingSeries([a, b, other], live, walked);
  assert.deepEqual(pruned.map((s) => s.name), ['A', 'Other']);
});

test('pruneMissingSeries keeps everything when nothing was walked', () => {
  const a = series('file:///shelf/A', [vol({ id: 'a1' })], { name: 'A', sourceRootUri: 'file:///shelf' });
  const current = [a];
  // Empty walkedSources = walk failed/cancelled: keep stale shelf.
  assert.equal(pruneMissingSeries(current, new Set<string>(), new Set<string>()), current);
});

test('pruneMissingSeries is a no-op reference when nothing pruned', () => {
  const a = series('file:///shelf/A', [vol({ id: 'a1' })], { name: 'A', sourceRootUri: 'file:///shelf' });
  const current = [a];
  const next = pruneMissingSeries(current, new Set(['file:///shelf/A']), new Set(['file:///shelf']));
  assert.equal(next, current);
});

test('pruneMissingSeries drops an emptied single-series root', () => {
  const single = series('file:///single', [vol({ id: 'v1' })], { name: 'Single' });
  const pruned = pruneMissingSeries([single], new Set<string>(), new Set(['file:///single']));
  assert.deepEqual(pruned, []);
});

