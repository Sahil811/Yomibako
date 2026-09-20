import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSessionExecutor,
  markSessionReady,
  subscribeSessionWake,
  subscribeSessionStatus,
  getSessionStatus,
  pokeSession,
  sessionDebug,
  lastSessionJobError,
  getSessionStatusTime,
  sessionFetch,
  handleSessionMessage,
  newId,
  __resetSessionForTests,
  __pendingSessionJobsForTests,
} from '../session';

async function settled() {
  await new Promise((r) => setTimeout(r, 0));
}

test('unknown message types are ignored', () => {
  __resetSessionForTests();
  assert.equal(handleSessionMessage(null), false);
  assert.equal(handleSessionMessage({}), false);
  assert.equal(handleSessionMessage({ type: 'nope' }), false);
});

test('ready/status messages update state and notify', () => {
  __resetSessionForTests();
  const seen: string[] = [];
  const unsub = subscribeSessionStatus((s) => seen.push(s));
  assert.equal(handleSessionMessage({ type: 'sessionReady' }), true);
  assert.equal(handleSessionMessage({ type: 'sessionStatus', value: 'in' }), true);
  assert.equal(getSessionStatus(), 'in');
  assert.ok(getSessionStatusTime().length > 0);
  assert.ok(seen.includes('in'));
  unsub();
  assert.match(sessionDebug(), /bridge ready/);
});

test('wakers fire on poke and readiness wait', async () => {
  __resetSessionForTests();
  let woke = 0;
  const unsub = subscribeSessionWake(() => { woke++; });
  pokeSession();
  assert.equal(woke, 1);
  unsub();
  pokeSession();
  assert.equal(woke, 1);
  await settled();
});

test('sessionFetch resolves via chunked messages', async () => {
  __resetSessionForTests();
  const codes: string[] = [];
  registerSessionExecutor((code) => codes.push(code));
  markSessionReady();
  const p = sessionFetch('https://jpdb.io/vocab', { method: 'GET' });
  await settled();
  assert.equal(codes.length, 1);
  const id = JSON.parse(codes[0].match(/__yomibakoSessionDo\((.*)\); true;/)![1].split(',')[0].trim());
  assert.equal(handleSessionMessage({ type: 'sessionMeta', id, chunks: 2 }), true);
  assert.equal(handleSessionMessage({ type: 'sessionChunk', id, i: 0, part: 'hello ' }), true);
  assert.equal(handleSessionMessage({ type: 'sessionChunk', id, i: 1, part: 'world' }), true);
  const res = await p;
  assert.equal(res.text, 'hello world');
  assert.equal(lastSessionJobError(), '');
});

test('zero-chunk job resolves empty', async () => {
  __resetSessionForTests();
  let captured = '';
  registerSessionExecutor((code) => { captured = code; });
  markSessionReady();
  const p = sessionFetch('https://jpdb.io/empty');
  await settled();
  const id = JSON.parse(captured.match(/__yomibakoSessionDo\((.*)\); true;/)![1].split(',')[0].trim());
  handleSessionMessage({ type: 'sessionMeta', id, chunks: 0 });
  assert.equal((await p).text, '');
});

test('sessionError rejects the job', async () => {
  __resetSessionForTests();
  let captured = '';
  registerSessionExecutor((code) => { captured = code; });
  markSessionReady();
  const p = sessionFetch('https://jpdb.io/fail');
  // attach handler to avoid unhandled rejection warnings ordering
  const settledP = p.then(
    () => 'resolved',
    (e) => (e as Error).message,
  );
  await settled();
  const id = JSON.parse(captured.match(/__yomibakoSessionDo\((.*)\); true;/)![1].split(',')[0].trim());
  handleSessionMessage({ type: 'sessionError', id, error: 'nope' });
  assert.equal(await settledP, 'nope');
  assert.ok(lastSessionJobError().length > 0);
});

test('throwing wakers/listeners never break the bridge', () => {
  __resetSessionForTests();
  subscribeSessionWake(() => { throw new Error('wake boom'); });
  subscribeSessionStatus(() => { throw new Error('status boom'); });
  pokeSession(); // must not throw
  handleSessionMessage({ type: 'sessionStatus', value: 'out' });
  assert.equal(getSessionStatus(), 'out');
  __resetSessionForTests();
});

test('markSessionReady is idempotent and debug reports jobs', () => {
  __resetSessionForTests();
  markSessionReady();
  markSessionReady();
  assert.match(sessionDebug(), /ready/);
});

test('sessionFetch rejects when the executor throws', async () => {
  __resetSessionForTests();
  registerSessionExecutor(() => { throw new Error('inject fail'); });
  markSessionReady();
  await assert.rejects(() => sessionFetch('https://jpdb.io/x'), /inject fail/);
  __resetSessionForTests();
});

test('cached login status hydrates on load', async () => {
  const SecureStore = await import('expo-secure-store');
  (SecureStore as any).__resetSecureStore();
  (SecureStore as any).__seedSecureStore({
    yomibako_jpdb_session: JSON.stringify({ status: 'in', time: 't0' }),
  });
  // Re-require a fresh copy of the module so top-level loadCachedStatus runs.
  const path = require.resolve('../session');
  delete require.cache[path];
  const fresh = require('../session');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fresh.getSessionStatus(), 'in');
  assert.equal(fresh.getSessionStatusTime(), 't0');
  // Restore the original module instance for the remaining tests.
  delete require.cache[path];
  require('../session');
  __resetSessionForTests();
  // Corrupt cache never throws.
  (SecureStore as any).__seedSecureStore({ yomibako_jpdb_session: '{bad' });
  delete require.cache[path];
  require('../session');
  await new Promise((r) => setTimeout(r, 20));
  delete require.cache[path];
  require('../session');
  __resetSessionForTests();
});

test('waitReady wakes the view and resolves when it becomes ready', async () => {
  __resetSessionForTests();
  let captured = '';
  registerSessionExecutor((code) => { captured = code; });
  subscribeSessionWake(() => { setTimeout(() => markSessionReady(), 10); });
  const p = sessionFetch('https://jpdb.io/ready-test');
  const result = p.then(
    (r) => r.text,
    (e) => `ERR:${(e as Error).message}`,
  );
  // waitReady (10ms) + job creation beat, then complete with zero chunks.
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(captured.length > 0, 'executor ran after wake');
  const id = JSON.parse(captured.match(/__yomibakoSessionDo\((.*)\); true;/)![1].split(',')[0].trim());
  handleSessionMessage({ type: 'sessionMeta', id, chunks: 0 });
  assert.equal(await result, '');
  __resetSessionForTests();
});

test('reset clears pending job timers', async () => {
  __resetSessionForTests();
  registerSessionExecutor(() => {});
  markSessionReady();
  const p = sessionFetch('https://jpdb.io/pending');
  const done = p.then(
    () => 'resolved',
    () => 'rejected',
  );
  __resetSessionForTests(); // clears the pending timer; the promise never settles
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(__pendingSessionJobsForTests(), 0);
  void done;
});

test('stray chunk/meta/error messages for unknown jobs are ignored safely', () => {
  __resetSessionForTests();
  assert.equal(handleSessionMessage({ type: 'sessionMeta', id: 'ghost', chunks: 2 }), true);
  assert.equal(handleSessionMessage({ type: 'sessionChunk', id: 'ghost', i: 0, part: 'x' }), true);
  assert.equal(handleSessionMessage({ type: 'sessionError', id: 'ghost', error: 'x' }), true);
  assert.equal(handleSessionMessage({ type: 'sessionStatus', value: 'bogus' }), true);
  assert.equal(getSessionStatus(), 'unknown');
});

test('newId is unique and url-safe', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newId()));
  assert.equal(ids.size, 200);
  for (const id of ids) {
    assert.match(id, /^[0-9a-z]+$/);
  }
});

test('newId works without WebCrypto', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    assert.equal(ids.size, 50);
  } finally {
    if (desc) Object.defineProperty(globalThis, 'crypto', desc);
  }
});
