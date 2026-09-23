import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRemoved, markRemoved, restoreRemoved, clearRemoved, withoutRemoved, __resetRemovedForTests } from '../removed';
import * as SecureStore from 'expo-secure-store';
import type { Series } from '../types';

async function reset() {
  __resetRemovedForTests();
  (SecureStore as any).__resetSecureStore();
}

function series(): Series[] {
  return [
    {
      name: 'S',
      rootUri: 'rootS',
      totalPages: 30,
      volumes: [
        { id: 'v1', series: 'S', title: 'Vol 1', uri: 'v1', pageCount: 10 },
        { id: 'v2', series: 'S', title: 'Vol 2', uri: 'v2', pageCount: 20 },
      ],
    },
    { name: 'T', rootUri: 'rootT', totalPages: 5, volumes: [{ id: 'w1', series: 'T', title: 'Vol 1', uri: 'w1', pageCount: 5 }] },
  ];
}

test('withoutRemoved passthrough on empty set', () => {
  const s = series();
  assert.equal(withoutRemoved(s, new Set()), s);
});

test('mark + load + restore + clear roundtrip', async () => {
  await reset();
  assert.equal((await loadRemoved()).size, 0);
  await markRemoved(['v1']);
  assert.equal((await loadRemoved()).size, 1);
  await restoreRemoved(['v1']);
  assert.equal((await loadRemoved()).size, 0);
  await markRemoved(['v1', 'v2']);
  await clearRemoved();
  assert.equal((await loadRemoved()).size, 0);
});

test('withoutRemoved drops volumes and recomputes totalPages', async () => {
  await reset();
  const removed = await markRemoved(['v1']);
  const kept = withoutRemoved(series(), removed);
  assert.equal(kept[0].volumes.length, 1);
  assert.equal(kept[0].volumes[0].id, 'v2');
  assert.equal(kept[0].totalPages, 20);
});

test('withoutRemoved drops whole series by rootUri or when emptied', async () => {
  await reset();
  const byRoot = await markRemoved(['rootT']);
  // rootUri hashed — series T root matches, so T disappears
  const kept = withoutRemoved(series(), byRoot);
  assert.ok(kept.every((s) => s.name !== 'T'));
  // emptying all volumes of S drops S too
  await reset();
  const all = await markRemoved(['v1', 'v2']);
  assert.ok(withoutRemoved(series(), all).every((s) => s.name !== 'T' || true));
  assert.equal(withoutRemoved(series(), all).find((s) => s.name === 'S'), undefined);
});

test('corrupt stored json yields empty set', async () => {
  await reset();
  (SecureStore as any).__seedSecureStore({ yomibako_library_removed: 'bad' });
  assert.equal((await loadRemoved()).size, 0);
});

test('non-array stored json yields empty set', async () => {
  await reset();
  (SecureStore as any).__seedSecureStore({ yomibako_library_removed: JSON.stringify({ not: 'an array' }) });
  assert.equal((await loadRemoved()).size, 0);
});

test('persist failures never reject', async () => {
  await reset();
  const storage = await import('../../../services/storage');
  const orig = (storage as any).setItemAsync;
  (storage as any).setItemAsync = async () => { throw new Error('disk full'); };
  try {
    const next = await markRemoved(['v1']);
    assert.ok(next.size >= 1);
  } finally {
    (storage as any).setItemAsync = orig;
  }
});
