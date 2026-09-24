import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBridgeCustomization,
  readBridgeCustomization,
  buildCustomWordInject,
  buildCustomPopupInject,
  buildFadeInject,
  buildTokenScripts,
} from '../webViewBridge';
import * as SecureStore from 'expo-secure-store';

test('parseBridgeCustomization falls back on missing/corrupt input', () => {
  assert.deepEqual(parseBridgeCustomization(null), {
    customWordCSS: '',
    customPopupCSS: '',
    disableFade: false,
    showPopupOnHover: true,
    playSoundOnHover: false,
  });
  assert.deepEqual(parseBridgeCustomization('{bad'), parseBridgeCustomization(null));
});

test('parseBridgeCustomization reads every key', () => {
  const out = parseBridgeCustomization(
    JSON.stringify({
      customWordCSS: 'w',
      customPopupCSS: 'p',
      disableFadeAnimation: true,
      showPopupOnHover: false,
      playSoundOnHover: true,
    })
  );
  assert.equal(out.customWordCSS, 'w');
  assert.equal(out.customPopupCSS, 'p');
  assert.equal(out.disableFade, true);
  assert.equal(out.showPopupOnHover, false);
  assert.equal(out.playSoundOnHover, true);
});

test('readBridgeCustomization loads the stored blob', async () => {
  (SecureStore as any).__resetSecureStore();
  assert.deepEqual(await readBridgeCustomization(), parseBridgeCustomization(null));
  (SecureStore as any).__seedSecureStore({
    yomibako_config_json: JSON.stringify({ customWordCSS: '.w{}', disableFadeAnimation: 1 }),
  });
  const out = await readBridgeCustomization();
  assert.equal(out.customWordCSS, '.w{}');
  assert.equal(out.disableFade, true);
  (SecureStore as any).__resetSecureStore();
});

test('CSS inject builders skip empty input', () => {
  assert.equal(buildCustomWordInject(''), '');
  assert.equal(buildCustomPopupInject(''), '');
  assert.equal(buildFadeInject(false), '');
  assert.ok(buildCustomWordInject('.w{}').includes('yomibako-custom-word'));
  assert.ok(buildCustomPopupInject('.p{}').includes('yomibako-custom-popup'));
  assert.ok(buildFadeInject(true).includes('--jpdb-fade-duration'));
});

test('buildTokenScripts sends small payloads in one script', () => {
  const scripts = buildTokenScripts('id1', [{ a: 1 }]);
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0].includes('__yomibakoOnTokens('));
  assert.ok(scripts[0].includes('"id1"'));
});

test('buildTokenScripts chunks large payloads losslessly', () => {
  const tokens = [{ text: 'x'.repeat(100000) }];
  const scripts = buildTokenScripts('id9', tokens);
  assert.ok(scripts.length > 1);
  assert.ok(scripts.every((s) => s.includes('__yomibakoOnTokensChunk')));
  const total = scripts.length;
  const parts: string[] = new Array(total);
  for (const s of scripts) {
    const m = /"id9", (\d+), (\d+), (".*")\); true;$/.exec(s);
    assert.ok(m, s.slice(0, 80));
    assert.equal(Number(m![2]), total);
    parts[Number(m![1])] = JSON.parse(m![3]);
  }
  assert.deepEqual(JSON.parse(parts.join('')), tokens);
});
