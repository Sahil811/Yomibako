// JPDB login session — bridges cookie-authenticated scraping through a
// hidden jpdb.io WebView (mirrors the extension's `credentials: "include"`).
//
// Why: plain React Native fetch has no jpdb.io cookies, so every
// login-gated feature fails with "Not logged in": audio hash lookup,
// review pages/submission, FORQ prioritize. API-token calls (parse, mine,
// deck ops, card state) are unaffected and never touch this bridge.
//
// Flow: JpdbSessionWebView (mounted once in App) registers an executor.
// sessionFetch() wakes it, waits for readiness, runs fetch() inside the
// page (cookies attached automatically), and returns text chunked over
// postMessage. Login itself happens in the normal Browser tab on
// https://jpdb.io/login — the hidden view shares the cookie jar.
import { getItemAsync, setItemAsync } from '../storage';

export type SessionStatus = 'unknown' | 'out' | 'in';

type PendingJob = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  parts: string[];
  total: number;
  timer: ReturnType<typeof setTimeout>;
};

const SESSION_KEY = 'yomibako_jpdb_session';
const JOB_TIMEOUT_MS = 30000;
const READY_TIMEOUT_MS = 15000;

let executor: ((code: string) => void) | null = null;
let ready = false;
let status: SessionStatus = 'unknown';
let statusTime = '';
let jobsRun = 0;
let jobsOk = 0;
let lastJobError = '';
let readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
const pending = new Map<string, PendingJob>();
const wakers = new Set<() => void>();
const statusListeners = new Set<(s: SessionStatus) => void>();

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Called once by JpdbSessionWebView to plug in injectJavaScript. */
export function registerSessionExecutor(fn: (code: string) => void) {
  executor = fn;
}

/** Called by JpdbSessionWebView when its bridge JS is alive. */
export function markSessionReady() {
  if (ready) return;
  ready = true;
  const waiters = readyWaiters;
  readyWaiters = [];
  for (const w of waiters) w.resolve();
}

/** JpdbSessionWebView subscribes so jobs can wake it (load jpdb.io). */
export function subscribeSessionWake(fn: () => void): () => void {
  wakers.add(fn);
  return () => { wakers.delete(fn); };
}

export function subscribeSessionStatus(fn: (s: SessionStatus) => void): () => void {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}

async function loadCachedStatus() {
  try {
    const raw = await getItemAsync(SESSION_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.status === 'in' || d.status === 'out') {
        status = d.status;
        statusTime = d.time ?? '';
      }
    }
  } catch {}
}

void loadCachedStatus();

function setStatus(s: SessionStatus) {
  status = s;
  statusTime = new Date().toISOString();
  void setItemAsync(SESSION_KEY, JSON.stringify({ status: s, time: statusTime })).catch(() => {});
  for (const fn of statusListeners) {
    try { fn(s); } catch {}
  }
}

export function getSessionStatus(): SessionStatus {
  return status;
}

/** Ask the hidden view to (re)load jpdb.io — refreshes the login status. */
export function pokeSession() {
  for (const w of wakers) {
    try { w(); } catch {}
  }
}

/** One-line bridge health for Settings → Diagnostics. */
export function sessionDebug(): string {
  return `bridge ${ready ? 'ready' : 'NOT-READY'}, login ${status}, jobs ${jobsOk}/${jobsRun}${lastJobError ? `, last: ${lastJobError}` : ''}`;
}

export function lastSessionJobError(): string {
  return lastJobError;
}

export function getSessionStatusTime(): string {
  return statusTime;
}

function waitReady(): Promise<void> {
  if (ready && executor) return Promise.resolve();
  for (const w of wakers) {
    try { w(); } catch {}
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter((w) => w.resolve !== done);
      reject(new Error('JPDB session view not ready — reopen the app and try again'));
    }, READY_TIMEOUT_MS);
    const done = () => { clearTimeout(timer); resolve(); };
    readyWaiters.push({ resolve: done, reject });
  });
}

export type SessionFetchInit = {
  method?: 'GET' | 'POST';
  body?: string;
  contentType?: string;
};

/**
 * fetch() executed inside the logged-in jpdb.io page. Only use for
 * cookie-gated jpdb.io pages (vocab/review/prioritize). Throws JpdbError-
 * style Errors with actionable messages.
 */
export async function sessionFetch(url: string, init: SessionFetchInit = {}): Promise<{ status: number; text: string }> {
  await waitReady();
  const exec = executor;
  if (!exec) throw new Error('JPDB session unavailable');
  const id = newId();
  const method = init.method ?? 'GET';
  jobsRun++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      lastJobError = `timeout (${url.split('?')[0]})`;
      reject(new Error(`JPDB request timed out (${url.split('?')[0]})`));
    }, JOB_TIMEOUT_MS);
    pending.set(id, {
      resolve: (text) => { clearTimeout(timer); jobsOk++; lastJobError = ''; resolve({ status: 200, text }); },
      reject: (err) => { clearTimeout(timer); lastJobError = String(err?.message ?? err).slice(0, 160); reject(err); },
      parts: [],
      total: -1,
      timer,
    });
    try {
      exec(
        `window.__yomibakoSessionDo(${JSON.stringify(id)}, ${JSON.stringify(method)}, ${JSON.stringify(url)}, ` +
        `${init.body !== undefined ? JSON.stringify(init.body) : 'null'}, ` +
        `${init.contentType !== undefined ? JSON.stringify(init.contentType) : 'null'}); true;`
      );
    } catch (e: any) {
      pending.delete(id);
      clearTimeout(timer);
      reject(new Error(String(e?.message ?? e)));
    }
  });
}

/** Routed from JpdbSessionWebView.onMessage — do not call elsewhere. */
export function handleSessionMessage(msg: any): boolean {
  if (!msg || typeof msg.type !== 'string') return false;
  switch (msg.type) {
    case 'sessionReady':
      markSessionReady();
      return true;
    case 'sessionStatus':
      if (msg.value === 'in' || msg.value === 'out') setStatus(msg.value);
      return true;
    case 'sessionMeta': {
      const p = pending.get(msg.id);
      if (p && typeof msg.chunks === 'number') {
        p.total = msg.chunks;
        p.parts = new Array(msg.chunks);
        if (msg.chunks === 0) {
          pending.delete(msg.id);
          clearTimeout(p.timer);
          p.resolve('');
        }
      }
      return true;
    }
    case 'sessionChunk': {
      const p = pending.get(msg.id);
      if (p && typeof msg.i === 'number' && typeof msg.part === 'string') {
        p.parts[msg.i] = msg.part;
        const got = p.parts.filter((x) => x !== undefined).length;
        if (p.total >= 0 && got >= p.total) {
          pending.delete(msg.id);
          clearTimeout(p.timer);
          p.resolve(p.parts.join(''));
        }
      }
      return true;
    }
    case 'sessionError': {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        clearTimeout(p.timer);
        p.reject(new Error(String(msg.error ?? 'JPDB request failed')));
      }
      return true;
    }
    default:
      return false;
  }
}
