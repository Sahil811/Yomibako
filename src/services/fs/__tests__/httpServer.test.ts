import test from 'node:test';
import assert from 'node:assert/strict';
import {
  volumeCacheKey,
  cacheUsage,
  clearPageCache,
  evictOldCaches,
  prepareVolumeForWebView,
  httpServer,
} from '../httpServer';
import { __resetFS, __putDir, __putFile } from '../../../../test/mocks/expo-file-system';
import { Platform } from 'react-native';
import { Paths } from 'expo-file-system';

test('volumeCacheKey joins series/volume', () => {
  assert.equal(volumeCacheKey('S', 'V'), 'S/V');
});

test('cacheUsage is zero on empty cache and splits audio', () => {
  __resetFS();
  assert.deepEqual(cacheUsage(), { pageBytes: 0, audioBytes: 0 });
  __putFile('file:///mock-cache/yomibako/audio/a.ogg', '12345');
  __putFile('file:///mock-cache/yomibako/Series/Vol/page.jpg', '123');
  const u = cacheUsage();
  assert.equal(u.audioBytes, 5);
  assert.equal(u.pageBytes, 3);
});

test('clearPageCache removes series dirs but keeps audio', () => {
  __resetFS();
  __putFile('file:///mock-cache/yomibako/Series/Vol/page.jpg', '123');
  __putFile('file:///mock-cache/yomibako/audio/a.ogg', '12345');
  __putFile('file:///mock-cache/yomibako/cache-index.json', '{}');
  clearPageCache();
  const u = cacheUsage();
  assert.equal(u.pageBytes, 0);
  assert.equal(u.audioBytes, 5);
});

test('evictOldCaches is a safe no-op on empty cache', async () => {
  __resetFS();
  await evictOldCaches(10);
});

test('prepareVolumeForWebView returns file uris directly (no copy)', async () => {
  __resetFS();
  (Platform as any).OS = 'android';
  const out = await prepareVolumeForWebView({
    htmlUri: 'file:///books/v1.html',
    uri: 'file:///books/v1',
    title: 'Vol 1',
    series: 'S',
  });
  assert.equal(out.localHtmlUri, 'file:///books/v1.html');
  assert.ok(out.baseUrl.endsWith('/'));
  await assert.rejects(
    () => prepareVolumeForWebView({ uri: 'file:///books/v1', title: 'Vol 1' }),
    /No htmlUri/,
  );
});

test('corrupt manifest is ignored and empty cache clears safely', async () => {
  __resetFS();
  __putFile('file:///mock-cache/yomibako/cache-index.json', '{bad');
  assert.deepEqual(cacheUsage(), { pageBytes: 0, audioBytes: 0 });
  await evictOldCaches(10); // must not throw on corrupt manifest
  clearPageCache(); // missing series dirs — no-op
  __resetFS();
  clearPageCache(); // missing root — no-op
});

test('httpServer stub passes through', async () => {
  assert.equal(await httpServer.start('root'), 'root');
  await httpServer.stop();
  assert.equal(httpServer.toHttpUrl('u'), 'u');
});

test('prepareVolumeForWebView copies content:// html + images to cache', async () => {
  __resetFS();
  (Platform as any).OS = 'android';
  __putFile('content://lib/Series/Vol 1.html', '<html>hi</html>');
  __putDir('content://lib/Series/Vol 1');
  __putFile('content://lib/Series/Vol 1/page0001.jpeg', 'img1');
  __putFile('content://lib/Series/Vol 1/page0002.jpeg', 'img2');
  const prog: [number, number][] = [];
  const out = await prepareVolumeForWebView(
    {
      htmlUri: 'content://lib/Series/Vol 1.html',
      uri: 'content://lib/Series/Vol 1',
      title: 'Vol 1',
      series: 'Series',
    },
    (d, t) => { prog.push([d, t]); },
  );
  assert.ok(out.localHtmlUri.includes('Vol 1.html'));
  assert.ok(out.baseUrl.includes('Series'));
  assert.ok(prog.length > 0);
  // Second open hits the probe cache and reports 1/1
  const prog2: [number, number][] = [];
  await prepareVolumeForWebView(
    {
      htmlUri: 'content://lib/Series/Vol 1.html',
      uri: 'content://lib/Series/Vol 1',
      title: 'Vol 1',
      series: 'Series',
    },
    (d, t) => { prog2.push([d, t]); },
  );
  assert.deepEqual(prog2, [[1, 1]]);
});

test('mokuro-only volume unzips to an html entry', async () => {
  __resetFS();
  (Platform as any).OS = 'android';
  __putFile('content://lib/pack.mokuro', 'zipbytes');
  const zipMod = require('react-native-zip-archive') as any;
  const origUnzip = zipMod.unzip;
  zipMod.unzip = async (_src: string, dest: string) => {
    __putFile(`${dest}/book.mobile.html`, '<html>unzipped</html>');
  };
  try {
    const out = await prepareVolumeForWebView({
      mokuroUri: 'content://lib/pack.mokuro',
      uri: 'content://lib/pack',
      title: 'Pack',
      series: 'S',
    });
    assert.equal(out.isZipped, true);
    assert.ok(out.localHtmlUri.endsWith('book.mobile.html'));
  } finally {
    zipMod.unzip = origUnzip;
  }
});

test('evictOldCaches drops the stalest volume over budget', async () => {
  __resetFS();
  __putFile('file:///mock-cache/yomibako/A/V1/p.jpg', '1234567890');
  __putFile('file:///mock-cache/yomibako/B/V2/p.jpg', '1234567890');
  __putFile(
    'file:///mock-cache/yomibako/cache-index.json',
    JSON.stringify({ 'A/V1': { lastOpened: 1 }, 'B/V2': { lastOpened: 2 } }),
  );
  await evictOldCaches(15, 'B/V2');
  const u = cacheUsage();
  // A/V1 (10 bytes) evicted, B/V2 kept
  assert.equal(u.pageBytes, 10);
});

test('evict is a no-op under budget and tightens when disk is nearly full', async () => {
  __resetFS();
  __putFile('file:///mock-cache/yomibako/A/V1/p.jpg', '1234567890');
  __putFile(
    'file:///mock-cache/yomibako/cache-index.json',
    JSON.stringify({ 'A/V1': { lastOpened: 1 } }),
  );
  await evictOldCaches(1024 * 1024 * 1024); // nothing over budget — no eviction
  assert.equal(cacheUsage().pageBytes, 10);
  const origFree = (Paths as any).availableDiskSpace;
  (Paths as any).availableDiskSpace = 512 * 1024 * 1024; // below 1GB floor
  try {
    await evictOldCaches(1024 * 1024 * 1024, 'A/V1'); // keepKey survives its own sweep
    assert.equal(cacheUsage().pageBytes, 10);
  } finally {
    (Paths as any).availableDiskSpace = origFree;
  }
});

test('low disk space refuses to open', async () => {
  __resetFS();
  (Platform as any).OS = 'android';
  __putFile('content://lib/a.html', '<h>');
  __putDir('content://lib/a');
  const origFree = (Paths as any).availableDiskSpace;
  (Paths as any).availableDiskSpace = 10;
  try {
    await assert.rejects(
      () =>
        prepareVolumeForWebView({
          htmlUri: 'content://lib/a.html',
          uri: 'content://lib/a',
          title: 'a',
          series: 'S',
        }),
      /free space/i,
    );
  } finally {
    (Paths as any).availableDiskSpace = origFree;
  }
});
