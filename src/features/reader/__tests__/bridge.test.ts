import test from 'node:test';
import assert from 'node:assert/strict';
import { YOMIBAKO_BRIDGE_JS, buildFullBundle } from '../bridge';
import { YOMIBAKO_BUNDLE_VERSION, YOMIBAKO_CSS, YOMIBAKO_JS } from '../yomibakoBundle';
import { BROWSER_CSS, BROWSER_JS } from '../../browser/browserBundle';

test('legacy bridge guards double-inject and posts bridgeReady', () => {
  assert.ok(YOMIBAKO_BRIDGE_JS.includes('__yomibakoBridgeInjected'));
  assert.ok(YOMIBAKO_BRIDGE_JS.includes('bridgeReady'));
  assert.ok(YOMIBAKO_BRIDGE_JS.includes('ReactNativeWebView.postMessage'));
  assert.ok(YOMIBAKO_BRIDGE_JS.includes('__yomibakoPostParse'));
  assert.ok(YOMIBAKO_BRIDGE_JS.trimEnd().endsWith('true;'));
});

test('buildFullBundle resolves to the bridge (placeholder)', async () => {
  assert.equal(await buildFullBundle(), YOMIBAKO_BRIDGE_JS);
});

test('yomibako bundle has version, css hooks and js guard', () => {
  assert.ok(typeof YOMIBAKO_BUNDLE_VERSION === 'string' && YOMIBAKO_BUNDLE_VERSION.length > 0);
  assert.ok(YOMIBAKO_CSS.includes('.jpdb-word'), 'css highlights parsed words');
  assert.ok(YOMIBAKO_JS.length > 1000, 'bundle is substantial');
  assert.ok(YOMIBAKO_JS.includes('__yomibakoInjected') || YOMIBAKO_JS.includes('yomibako'));
});

test('browser bundle exposes css and js strings', () => {
  assert.ok(BROWSER_CSS.length > 0);
  assert.ok(BROWSER_JS.length > 0);
});
