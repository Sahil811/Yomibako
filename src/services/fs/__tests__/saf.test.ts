import test from 'node:test';
import assert from 'node:assert/strict';
import { isMokuroVolume, uriToBreadcrumbs, saveRoot, getRoots, removeRoot, listDirectory } from '../saf';
import * as SecureStore from 'expo-secure-store';
import { __resetFS, __putDir, __putFile } from '../../../../test/mocks/expo-file-system';

test('isMokuroVolume detects html/mokuro/_ocr', () => {
  assert.equal(isMokuroVolume([{ uri: 'u', name: 'a.html', isDirectory: false }]), true);
  assert.equal(isMokuroVolume([{ uri: 'u', name: 'a.mokuro', isDirectory: false }]), true);
  assert.equal(isMokuroVolume([{ uri: 'u', name: '_ocr', isDirectory: true }]), true);
  assert.equal(isMokuroVolume([{ uri: 'u', name: 'page0001.jpg', isDirectory: false }]), false);
  assert.equal(isMokuroVolume([]), false);
});

test('uriToBreadcrumbs splits content and file uris', () => {
  assert.deepEqual(uriToBreadcrumbs('content://com.android/tree/primary/Manga'), ['Device', 'primary', 'Manga']);
  assert.deepEqual(uriToBreadcrumbs('file:///a/b/c'), ['a', 'b', 'c']);
  assert.deepEqual(uriToBreadcrumbs('file:///a//b/'), ['a', 'b']);
});

test('roots save/get/remove roundtrip with dedupe', async () => {
  (SecureStore as any).__resetSecureStore();
  assert.deepEqual(await getRoots(), []);
  await saveRoot('root1');
  await saveRoot('root1'); // dedupe
  await saveRoot('root2');
  assert.deepEqual(await getRoots(), ['root1', 'root2']);
  await removeRoot('root1');
  assert.deepEqual(await getRoots(), ['root2']);
  await removeRoot('missing'); // no-op
  assert.deepEqual(await getRoots(), ['root2']);
});

test('getRoots returns [] on corrupt or non-array JSON', async () => {
  (SecureStore as any).__resetSecureStore();
  (SecureStore as any).__seedSecureStore({ yomibako_saf_roots: '{bad' });
  assert.deepEqual(await getRoots(), []);
  (SecureStore as any).__seedSecureStore({ yomibako_saf_roots: JSON.stringify({ not: 'an array' }) });
  assert.deepEqual(await getRoots(), []);
  (SecureStore as any).__seedSecureStore({ yomibako_saf_roots: JSON.stringify(['ok', 42, null]) });
  assert.deepEqual(await getRoots(), ['ok']);
  // saveRoot still works after corruption (rewrites the key).
  (SecureStore as any).__resetSecureStore();
  await saveRoot('fresh');
  assert.deepEqual(await getRoots(), ['fresh']);
  (SecureStore as any).__resetSecureStore();
});

test('listDirectory maps files and dirs, swallows errors', async () => {
  __resetFS();
  __putDir('file:///lib');
  __putDir('file:///lib/vol1');
  __putFile('file:///lib/a.html', '<html>');
  const entries = await listDirectory('file:///lib');
  assert.equal(entries.length, 2);
  const dir = entries.find((e) => e.name === 'vol1')!;
  assert.equal(dir.isDirectory, true);
  const file = entries.find((e) => e.name === 'a.html')!;
  assert.equal(file.isDirectory, false);
  assert.deepEqual(await listDirectory('file:///missing'), []);
});

test('listDirectory tolerates size failures', async () => {
  __resetFS();
  __putDir('file:///lib2');
  __putFile('file:///lib2/a.html', '<html>');
  const fs = (await import('expo-file-system')) as any;
  const desc = Object.getOwnPropertyDescriptor(fs.File.prototype, 'size');
  Object.defineProperty(fs.File.prototype, 'size', { get() { throw new Error('no size'); }, configurable: true });
  try {
    const entries = await listDirectory('file:///lib2');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].size, undefined);
  } finally {
    if (desc) Object.defineProperty(fs.File.prototype, 'size', desc);
  }
});
