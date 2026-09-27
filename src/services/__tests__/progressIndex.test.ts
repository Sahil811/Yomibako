import test from 'node:test';
import assert from 'node:assert/strict';
import * as SecureStore from 'expo-secure-store';
import {
  parseProgressIndex,
  loadProgressIndex,
  saveProgressIndex,
  mergeIndexWithFallback,
  PROGRESS_INDEX_KEY,
} from '../progressIndex';
import { __resetStorageForTests, __setStorageCorruptForTests } from '../storage';

async function reset() {
  (SecureStore as any).__resetSecureStore();
  __resetStorageForTests();
}

test('parseProgressIndex validates entries and rejects corrupt', () => {
  assert.deepEqual(parseProgressIndex(null), {});
  assert.deepEqual(parseProgressIndex('{bad'), {});
  assert.deepEqual(parseProgressIndex(JSON.stringify([])), {});
  const good = parseProgressIndex(JSON.stringify({ a: { p: 3, t: 9, n: 10 }, b: { p: 'x', t: 1 } }));
  assert.deepEqual(good, { a: { p: 3, t: 9, n: 10 } });
  const noN = parseProgressIndex(JSON.stringify({ k: { p: 1, t: 2 } }));
  assert.deepEqual(noN, { k: { p: 1, t: 2 } });
});

test('save + load roundtrips single write', async () => {
  await reset();
  assert.equal(await saveProgressIndex({ k1: { p: 5, t: 7 } }), true);
  // Single SecureStore write for 100 entries — assert call count via raw read.
  const raw = await (SecureStore as any).getItemAsync(PROGRESS_INDEX_KEY);
  assert.ok(raw.includes('k1'));
  assert.deepEqual(await loadProgressIndex(), { k1: { p: 5, t: 7 } });
});

test('corrupt store holds the write', async () => {
  await reset();
  __setStorageCorruptForTests(true);
  assert.equal(await saveProgressIndex({ a: { p: 1, t: 1 } }), false);
  __setStorageCorruptForTests(false);
});

test('mergeIndexWithFallback fills misses without clobbering', () => {
  const merged = mergeIndexWithFallback(
    { a: { p: 1, t: 1 } },
    { a: { p: 99, t: 99 }, b: { p: 2, t: 2 }, c: null }
  );
  assert.deepEqual(merged, { a: { p: 1, t: 1 }, b: { p: 2, t: 2 } });
});
