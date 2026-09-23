import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVolume,
  normalizeSeries,
  INDEX_VERSION,
  loadLibraryIndex,
  saveLibraryIndex,
  __flushLibraryIndexForTests,
  __resetLibraryCacheForTests,
} from '../libraryCache';
import { __resetFS, __putFile, __putDir } from '../../../../test/mocks/expo-file-system';
import { Paths } from 'expo-file-system';

function vol(over: any = {}) {
  return { id: 'id1', uri: 'file:///v1', title: 'Vol 1', series: 'S', pageCount: 10, ...over };
}

test('INDEX_VERSION is 1', () => {
  assert.equal(INDEX_VERSION, 1);
});

test('normalizeVolume accepts full shapes and drops junk', () => {
  assert.equal(normalizeVolume(null), null);
  assert.equal(normalizeVolume(42), null);
  assert.equal(normalizeVolume({}), null);
  const v = normalizeVolume(vol({ progressKey: 'k', htmlUri: 'h', mokuroUri: 'm', ocrUri: 'o', coverUri: 'c' }));
  assert.equal(v?.progressKey, 'k');
  assert.equal(v?.pageCount, 10);
  // pageCount coerces
  assert.equal(normalizeVolume(vol({ pageCount: '7' }))?.pageCount, 7);
  assert.equal(normalizeVolume(vol({ pageCount: 'x' }))?.pageCount, 0);
  // optional non-strings ignored
  assert.equal(normalizeVolume(vol({ htmlUri: 5 }))?.htmlUri, undefined);
});

test('normalizeSeries needs name/root/volumes', () => {
  assert.equal(normalizeSeries(null), null);
  assert.equal(normalizeSeries({}), null);
  assert.equal(normalizeSeries({ name: 'S', rootUri: 'r', volumes: [] }), null);
  const s = normalizeSeries({ name: 'S', rootUri: 'r', volumes: [vol(), { junk: 1 }], totalPages: 0, sourceRootUri: 'root' });
  assert.equal(s?.volumes.length, 1);
  assert.equal(s?.totalPages, 10);
  assert.equal(s?.sourceRootUri, 'root');
  // totalPages fallback sums volumes
  const s2 = normalizeSeries({ name: 'S', rootUri: 'r', volumes: [vol({ pageCount: 3 }), vol({ id: 'i2', uri: 'u2', pageCount: 4 })] });
  assert.equal(s2?.totalPages, 7);
});

test('loadLibraryIndex returns [] when missing/corrupt/version-mismatch', async () => {
  __resetFS();
  __resetLibraryCacheForTests();
  assert.deepEqual(await loadLibraryIndex(['r']), []);
  __putFile(`${Paths.document}/yomibako/library-index.json`, 'not json');
  assert.deepEqual(await loadLibraryIndex(['r']), []);
  __putFile(`${Paths.document}/yomibako/library-index.json`, JSON.stringify({ version: 999, series: [] }));
  assert.deepEqual(await loadLibraryIndex(['r']), []);
  __putFile(`${Paths.document}/yomibako/library-index.json`, JSON.stringify({ version: 1, series: 'nope' }));
  assert.deepEqual(await loadLibraryIndex(['r']), []);
});

test('save + load roundtrips and filters by granted roots', async () => {
  __resetFS();
  __resetLibraryCacheForTests();
  __putDir(`${Paths.document}/yomibako`);
  const series = [
    { name: 'A', rootUri: 'rootA', volumes: [vol({ id: 'a1', uri: 'a1' })], totalPages: 10 },
    { name: 'B', rootUri: 'rootB', sourceRootUri: 'shelf', volumes: [vol({ id: 'b1', uri: 'b1' })], totalPages: 5 },
  ];
  saveLibraryIndex(series as any, ['rootA', 'shelf']);
  __flushLibraryIndexForTests();
  const loaded = await loadLibraryIndex(['rootA', 'shelf']);
  assert.equal(loaded.length, 2);
  const filtered = await loadLibraryIndex(['rootA']);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, 'A');
});

test('saveLibraryIndex ignores empty series', () => {
  __resetLibraryCacheForTests();
  assert.doesNotThrow(() => saveLibraryIndex([], ['r']));
  __flushLibraryIndexForTests();
  assert.ok(true, 'saveLibraryIndex with empty series must not throw or schedule');
});

test('reset clears a pending debounced write', async () => {
  __resetFS();
  __resetLibraryCacheForTests();
  saveLibraryIndex([{ name: 'A', rootUri: 'r', volumes: [vol()], totalPages: 1 } as any], ['r']);
  __resetLibraryCacheForTests();
  __flushLibraryIndexForTests();
  assert.deepEqual(await loadLibraryIndex(['r']), []);
});

test('debounced timer flushes without an explicit flush', async () => {
  __resetFS();
  __resetLibraryCacheForTests();
  __putDir(`${Paths.document}/yomibako`);
  const origSetTimeout = globalThis.setTimeout;
  (globalThis as any).setTimeout = ((cb: any, ms?: any, ...rest: any[]) => {
    if (ms === 800) {
      cb();
      return 0 as any;
    }
    return origSetTimeout(cb, ms, ...rest);
  }) as any;
  try {
    saveLibraryIndex([{ name: 'A', rootUri: 'rootA', volumes: [vol({ id: 'a1', uri: 'a1' })], totalPages: 10 } as any], ['rootA']);
    const loaded = await loadLibraryIndex(['rootA']);
    assert.equal(loaded.length, 1);
  } finally {
    (globalThis as any).setTimeout = origSetTimeout;
    __resetLibraryCacheForTests();
  }
});

test('index write failures are swallowed', () => {
  __resetFS();
  __resetLibraryCacheForTests();
  __putDir(`${Paths.document}/yomibako`);
  return (async () => {
    const fs = (await import('expo-file-system')) as any;
    const origWrite = fs.File.prototype.write;
    fs.File.prototype.write = function () { throw new Error('readonly'); };
    try {
      saveLibraryIndex([{ name: 'A', rootUri: 'r', volumes: [vol()], totalPages: 1 } as any], ['r']);
      __flushLibraryIndexForTests();
    } finally {
      fs.File.prototype.write = origWrite;
      __resetLibraryCacheForTests();
    }
    assert.ok(true);
  })();
});
