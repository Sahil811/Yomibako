import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrateSchema,
  parseHotkeyInput,
  hotkeyToString,
  loadConfig,
  saveConfig,
  getConfig,
  stageConfig,
  getApiToken,
  getDeckId,
  setDeckId,
  exportConfigJson,
  importConfigJson,
  defaultConfig,
  CURRENT_SCHEMA_VERSION,
  __resetConfigForTests,
} from '../config';
import * as SecureStore from 'expo-secure-store';

async function reset() {
  __resetConfigForTests();
  (SecureStore as any).__resetSecureStore();
}

test('migrateSchema walks 0..5', () => {
  const c: any = { schemaVersion: 0 };
  migrateSchema(c);
  assert.equal(c.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.ok(c.showPopupKey);
  assert.equal(c.showPopupOnHover, true);
  assert.equal(c.showReviewButtons, false);
  assert.equal(c.showRtk, true);
  const partial: any = { schemaVersion: 2 };
  migrateSchema(partial);
  assert.equal(partial.schemaVersion, 5);
  const current: any = { schemaVersion: 5 };
  migrateSchema(current);
  assert.equal(current.schemaVersion, 5);
});

test('parseHotkeyInput/hotkeyToString roundtrip', () => {
  assert.equal(parseHotkeyInput(''), null);
  assert.equal(parseHotkeyInput('none'), null);
  assert.equal(parseHotkeyInput('NONE'), null);
  assert.equal(parseHotkeyInput('-'), null);
  assert.deepEqual(parseHotkeyInput('ShiftLeft'), { key: 'Shift', code: 'ShiftLeft', modifiers: [] });
  assert.deepEqual(parseHotkeyInput('KeyA'), { key: 'KeyA', code: 'KeyA', modifiers: [] });
  assert.deepEqual(parseHotkeyInput('{"key":"a","code":"KeyA","modifiers":["Ctrl"]}'), {
    key: 'a',
    code: 'KeyA',
    modifiers: ['Ctrl'],
  });
  assert.equal(hotkeyToString(null), '');
  assert.equal(hotkeyToString({ key: 'x', code: '', modifiers: [] } as any), 'x');
  assert.equal(hotkeyToString({ key: 'Shift', code: 'ShiftLeft', modifiers: [] }), 'ShiftLeft');
  assert.equal(hotkeyToString({ key: 'a', code: 'KeyA', modifiers: ['Ctrl'] }), 'Ctrl+KeyA');
});

test('loadConfig defaults, clamps and validates theme', async () => {
  await reset();
  const c = await loadConfig();
  assert.equal(c.schemaVersion, CURRENT_SCHEMA_VERSION);
  (SecureStore as any).__seedSecureStore({
    yomibako_config_json: JSON.stringify({ popupScale: 999, contextWidth: -5, popupTheme: 'nope' }),
  });
  const c2 = await loadConfig(true);
  assert.equal(c2.popupScale, 200);
  assert.equal(c2.contextWidth, 0);
  assert.equal(c2.popupTheme, 'auto');
});

test('save/load roundtrips and mirrors legacy keys', async () => {
  await reset();
  const cfg = { ...(await loadConfig()), apiToken: 'tok', miningDeckId: 42, popupScale: 150 };
  await saveConfig(cfg as any);
  __resetConfigForTests();
  const re = await loadConfig();
  assert.equal(re.apiToken, 'tok');
  assert.equal(re.miningDeckId, 42);
  assert.equal(await getApiToken(), 'tok');
  assert.equal(await getDeckId('miningDeckId'), 42);
});

test('save failures are swallowed after publishing', async () => {
  await reset();
  const base = await loadConfig();
  const storage = await import('../../storage');
  const origSet = (storage as any).setItemAsync;
  const origDel = (storage as any).deleteItemAsync;
  (storage as any).setItemAsync = async () => { throw new Error('disk full'); };
  (storage as any).deleteItemAsync = async () => { throw new Error('disk full'); };
  try {
    await saveConfig({ ...base, apiToken: 'tok-fail' } as any);
    assert.equal(getConfig().apiToken, 'tok-fail');
  } finally {
    (storage as any).setItemAsync = origSet;
    (storage as any).deleteItemAsync = origDel;
  }
});

test('getConfig/stageConfig expose snapshots', async () => {
  await reset();
  assert.equal(getConfig().schemaVersion, CURRENT_SCHEMA_VERSION);
  stageConfig({ ...defaultConfig, apiToken: 'staged' });
  assert.equal(getConfig().apiToken, 'staged');
});

test('setDeckId parses numbers and clears on empty', async () => {
  await reset();
  await setDeckId('miningDeckId', '7');
  assert.equal(await getDeckId('miningDeckId'), 7);
  await setDeckId('miningDeckId', 'mydeck');
  assert.equal(await getDeckId('miningDeckId'), 'mydeck');
  await setDeckId('miningDeckId', '  ');
  assert.equal(await getDeckId('miningDeckId'), null);
  await setDeckId('token', 'abc');
  assert.equal(await getApiToken(), 'abc');
});

test('export/import json roundtrip migrates', async () => {
  await reset();
  await saveConfig({ ...(await loadConfig()), apiToken: 'e1' } as any);
  const json = await exportConfigJson();
  assert.ok(json.includes('e1'));
  await reset();
  await importConfigJson(json);
  assert.equal(await getApiToken(), 'e1');
});

test('legacy keys seed fresh installs', async () => {
  await reset();
  (SecureStore as any).__seedSecureStore({ jpdb_token: 'legacy-tok', jpdb_miningDeckId: '99' });
  const c = await loadConfig(true);
  assert.equal(c.apiToken, 'legacy-tok');
  assert.equal(c.miningDeckId, 99);
});

test('legacy deck ids keep strings and map numbers per key', async () => {
  await reset();
  (SecureStore as any).__seedSecureStore({
    jpdb_blacklistDeckId: 'my-black',
    jpdb_neverForgetDeckId: '42',
    jpdb_forqDeckId: '7',
  });
  const c = await loadConfig(true);
  assert.equal(c.blacklistDeckId, 'my-black');
  assert.equal(c.neverForgetDeckId, 42);
  assert.equal(c.forqDeckId, 7);
  // defaults are not overwritten when legacy absent
  await reset();
  const c2 = await loadConfig(true);
  assert.equal(c2.blacklistDeckId, 'blacklist');
});

test('corrupt stored json falls back to defaults', async () => {
  await reset();
  (SecureStore as any).__seedSecureStore({ yomibako_config_json: '{oops' });
  const c = await loadConfig(true);
  assert.equal(c.schemaVersion, CURRENT_SCHEMA_VERSION);
});

test('future schema preserves stored prefs instead of resetting', async () => {
  await reset();
  (SecureStore as any).__seedSecureStore({
    yomibako_config_json: JSON.stringify({
      schemaVersion: 99,
      apiToken: 'keep',
      miningDeckId: 5,
      forqDeckId: 'f',
      blacklistDeckId: 'b',
      neverForgetDeckId: 'n',
      showRtk: false,
      popupScale: 150,
    }),
  });
  const c = await loadConfig(true);
  assert.equal(c.schemaVersion, 99);
  assert.equal(c.apiToken, 'keep');
  assert.equal(c.miningDeckId, 5);
  assert.equal(c.showRtk, false);
  assert.equal(c.popupScale, 150);
});

test('save failure is swallowed and unknown deck keys ignored', async () => {
  await reset();
  const orig = (SecureStore as any).setItemAsync;
  (SecureStore as any).setItemAsync = async () => { throw new Error('disk full'); };
  try {
    await saveConfig({ ...(await loadConfig()), apiToken: 'x' } as any); // must not throw
  } finally {
    (SecureStore as any).setItemAsync = orig;
  }
  await setDeckId('bogus' as any, 'v');
  assert.equal(await getDeckId('forqDeckId'), 'forq');
});

test('parseHotkeyInput tolerates colon garbage, getDeckId empty', async () => {
  assert.deepEqual(parseHotkeyInput('a:b:c'), { key: 'a:b:c', code: 'a:b:c', modifiers: [] });
  await reset();
  (SecureStore as any).__seedSecureStore({
    yomibako_config_json: JSON.stringify({ miningDeckId: '' }),
  });
  assert.equal(await getDeckId('miningDeckId'), null);
});
