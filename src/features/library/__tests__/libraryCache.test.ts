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
  saveLibraryIndex([], ['r']); // must not throw or schedule
  __flushLibraryIndexForTests();
});
