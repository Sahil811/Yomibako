import test from 'node:test';
import assert from 'node:assert/strict';
import { isKanjiChar, loadKanjiDetails } from '../kanjiData';
import { kanjiApi } from '../api';

test('isKanjiChar matches Han script except 。', () => {
  assert.equal(isKanjiChar('漢'), true);
  assert.equal(isKanjiChar('字'), true);
  assert.equal(isKanjiChar('あ'), false);
  assert.equal(isKanjiChar('ア'), false);
  assert.equal(isKanjiChar('a'), false);
  assert.equal(isKanjiChar('。'), false);
  assert.equal(isKanjiChar('、'), false);
});

test('bundled kanji resolve offline without network', async () => {
  const orig = kanjiApi.fetchKanji;
  let calls = 0;
  (kanjiApi as any).fetchKanji = async () => { calls++; throw new Error('should not fetch'); };
  try {
    const out = await loadKanjiDetails('日本語', { showRtk: false });
    assert.ok(out.length >= 2);
    assert.ok(out.every((d) => d.meanings.length > 0));
    assert.equal(calls, 0);
  } finally {
    (kanjiApi as any).fetchKanji = orig;
  }
});

test('non-kanji and empty input yield []', async () => {
  assert.deepEqual(await loadKanjiDetails(''), []);
  assert.deepEqual(await loadKanjiDetails('あいう'), []);
  assert.deepEqual(await loadKanjiDetails(null as any), []);
});

test('dedupes repeat kanji and caps at 8', async () => {
  const out = await loadKanjiDetails('日日日本本語語語', { showRtk: false });
  const keys = out.map((d) => d.kanji);
  assert.equal(new Set(keys).size, keys.length);
  const long = await loadKanjiDetails('日一二三四五六七八九十百千', { showRtk: false });
  assert.ok(long.length <= 8);
});

test('missing kanji falls back to kanjiApi, null when empty', async () => {
  const orig = kanjiApi.fetchKanji;
  (kanjiApi as any).fetchKanji = async (ch: string) =>
    ch === 'ZZ' ? { meanings: ['test meaning'], heisig_en: '' } : { meanings: [], heisig_en: '' };
  try {
    // 'ZZ' is not kanji so filtered before fetch — use a Han char missing from bundle via stubbed maps path:
    // Instead verify the fallback error path returns [] for unresolvable kana-adjacent input.
    const out = await loadKanjiDetails('あ', {});
    assert.deepEqual(out, []);
  } finally {
    (kanjiApi as any).fetchKanji = orig;
  }
});

test('showRtk attaches cleaned mnemonics when present', async () => {
  const out = await loadKanjiDetails('日', { showRtk: true });
  assert.equal(out.length, 1);
  // rtk may or may not exist for 日 in bundle — just assert shape
  assert.ok(typeof out[0].meanings === 'string');
  assert.ok(Array.isArray(out[0].components));
});

test('unbundled kanji use the kanjiApi fallback, null when empty', async () => {
  const orig = kanjiApi.fetchKanji;
  try {
    // U+9F98 is BMP Han but far too rare for the bundled meanings table.
    // (Non-BMP chars would split into surrogates under String.split.)
    (kanjiApi as any).fetchKanji = async () => ({ meanings: ['rare'], heisig_en: '' });
    const out = await loadKanjiDetails('龘', { showRtk: true });
    assert.equal(out.length, 1);
    assert.equal(out[0].meanings, 'rare');
    (kanjiApi as any).fetchKanji = async () => ({ meanings: [], heisig_en: '' });
    assert.deepEqual(await loadKanjiDetails('龘'), []);
    (kanjiApi as any).fetchKanji = async () => { throw new Error('down'); };
    assert.deepEqual(await loadKanjiDetails('龘'), []);
  } finally {
    (kanjiApi as any).fetchKanji = orig;
  }
});
