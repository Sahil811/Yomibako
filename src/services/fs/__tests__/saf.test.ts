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
