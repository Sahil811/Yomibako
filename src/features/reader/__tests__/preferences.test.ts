import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadReaderPreferences,
  getReaderPreferences,
  setReaderPreferences,
  flushReaderPreferences,
  defaultReaderPreferences,
  __resetPreferencesForTests,
} from '../preferences';
import * as SecureStore from 'expo-secure-store';

async function reset() {
  __resetPreferencesForTests();
  (SecureStore as any).__resetSecureStore();
}

test('defaults are screen/single/LTR', async () => {
  await reset();
  assert.deepEqual(await loadReaderPreferences(), defaultReaderPreferences);
  assert.equal(getReaderPreferences().zoomMode, 'screen');
});

test('set normalizes bad zoom and coerces flags', async () => {
  await reset();
  const p = setReaderPreferences({ zoomMode: 'bogus' as any, twoPage: true, rtl: true } as any);
  assert.equal(p.zoomMode, 'screen');
  assert.equal(p.twoPage, true);
  assert.equal(p.rtl, true);
  setReaderPreferences({ zoomMode: 'width' });
  assert.equal(getReaderPreferences().zoomMode, 'width');
  setReaderPreferences({ zoomMode: 'original' });
  assert.equal(getReaderPreferences().zoomMode, 'original');
});

test('persist + reload roundtrips', async () => {
  await reset();
  setReaderPreferences({ twoPage: true, rtl: true, zoomMode: 'width' });
  await flushReaderPreferences();
  __resetPreferencesForTests(); // drop memory, keep store (reset only memory? need store intact)
  // __resetPreferencesForTests clears memory but store mock still has data only if flush wrote it.
  // Re-seed check via load:
  const loaded = await loadReaderPreferences();
  assert.equal(loaded.twoPage, true);
  assert.equal(loaded.zoomMode, 'width');
});

test('corrupt stored json falls back to defaults', async () => {
  await reset();
  (SecureStore as any).__seedSecureStore({ yomibako_reader_prefs_v1: '{bad' });
  const p = await loadReaderPreferences();
  assert.equal(p.zoomMode, 'screen');
});
