import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeKey, getSavedPage, getSavedReading, savePage, flush, __resetProgressForTests } from '../progress';
import * as SecureStore from 'expo-secure-store';

async function reset() {
  __resetProgressForTests();
  (SecureStore as any).__resetSecureStore();
}

test('volumeKey is stable, short and differs per uri', () => {
  const a = volumeKey('content://a/vol1');
  assert.equal(volumeKey('content://a/vol1'), a);
  assert.notEqual(volumeKey('content://a/vol1'), volumeKey('content://a/vol2'));
  assert.ok(/^[0-9a-z]+$/.test(a));
  assert.ok(volumeKey('').length > 0);
});

test('miss returns null', async () => {
  await reset();
  assert.equal(await getSavedPage('content://missing'), null);
  assert.equal(await getSavedReading('content://missing'), null);
});

test('save + flush roundtrips page and total', async () => {
  await reset();
  savePage('content://v1', 7, 100);
  await flush();
  assert.equal(await getSavedPage('content://v1'), 7);
  const r = await getSavedReading('content://v1');
  assert.equal(r?.page, 7);
  assert.equal(r?.total, 100);
  assert.ok(typeof r?.updatedAt === 'number');
});

test('savePage rounds and ignores bad input', async () => {
  await reset();
  savePage('content://v2', 3.6);
  await flush();
  assert.equal(await getSavedPage('content://v2'), 4);
  savePage('content://bad', NaN);
  savePage('content://bad2', -1);
  await flush();
  assert.equal(await getSavedPage('content://bad'), null);
});

test('legacy blob migrates transparently', async () => {
  await reset();
  const key = volumeKey('content://legacy');
  (SecureStore as any).__seedSecureStore({
    yomibako_reader_positions: JSON.stringify({ [key]: { p: 12, t: 5, n: 50 } }),
  });
  assert.equal(await getSavedPage('content://legacy'), 12);
});

test('corrupt entries are treated as miss', async () => {
  await reset();
  const key = volumeKey('content://corrupt');
  (SecureStore as any).__seedSecureStore({
    [`yomibako_reader_position.${key}`]: 'not-json',
    yomibako_reader_positions: 'also-not-json',
  });
  assert.equal(await getSavedPage('content://corrupt'), null);
});

test('reset clears a pending debounced write', async () => {
  await reset();
  savePage('content://pending', 3, 10);
  __resetProgressForTests();
  await flush();
  assert.equal(await getSavedPage('content://pending'), null);
});

test('debounced timer flushes without an explicit flush()', async () => {
  await reset();
  const origSetTimeout = globalThis.setTimeout;
  (globalThis as any).setTimeout = ((cb: any, ms?: any, ...rest: any[]) => {
    if (ms === 1200) {
      cb();
      return 0 as any;
    }
    return origSetTimeout(cb, ms, ...rest);
  }) as any;
  try {
    savePage('content://debounced', 9, 20);
    assert.equal(await getSavedPage('content://debounced'), 9);
  } finally {
    (globalThis as any).setTimeout = origSetTimeout;
    await reset();
  }
});

test('immediate flush after rapid turns persists the latest page (blur contract)', async () => {
  await reset();
  savePage('content://blur', 41, 200);
  savePage('content://blur', 42, 200);
  // Blur/unmount flushes without waiting for the 1200ms debounce.
  await flush();
  assert.equal(await getSavedPage('content://blur'), 42);
});
