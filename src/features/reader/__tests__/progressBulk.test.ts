import test from 'node:test';
import assert from 'node:assert/strict';
import { getBulkReading, savePage, flush, volumeKey, __resetProgressForTests } from '../progress';
import * as SecureStore from 'expo-secure-store';
import { __resetStorageForTests } from '../../../services/storage';

async function reset() {
  __resetProgressForTests();
  __resetStorageForTests();
  (SecureStore as any).__resetSecureStore();
}

test('getBulkReading empty input returns empty map', async () => {
  await reset();
  assert.equal((await getBulkReading([])).size, 0);
});

test('getBulkReading uses index then falls back per-key and rebuilds', async () => {
  await reset();
  // Seed one per-key entry (authoritative) and one index entry.
  savePage('content://bulk-a', 4, 20);
  await flush();
  (SecureStore as any).__seedSecureStore({
    yomibako_progress_v2: JSON.stringify({ [volumeKey('content://bulk-b')]: { p: 6, t: 11, n: 30 } }),
  });
  __resetProgressForTests(); // drop in-memory, keep store
  const out = await getBulkReading(['content://bulk-a', 'content://bulk-b', 'content://bulk-miss']);
  assert.equal(out.get('content://bulk-a')?.page, 4);
  assert.equal(out.get('content://bulk-b')?.page, 6);
  assert.equal(out.get('content://bulk-miss'), null);
  // Rebuild wrote the fallback into the index (single write, includes bulk-a).
  const raw = await (SecureStore as any).getItemAsync('yomibako_progress_v2');
  assert.ok(raw.includes(volumeKey('content://bulk-a')));
});

test('getBulkReading serves entryCache without storage', async () => {
  await reset();
  savePage('content://cached', 9, 15);
  // No flush — entryCache hit only.
  const out = await getBulkReading(['content://cached']);
  assert.equal(out.get('content://cached')?.page, 9);
});
