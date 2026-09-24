import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Alert, Pressable } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Directory, File } from 'expo-file-system';
import { prepareVolumeForWebView } from '../../services/fs/httpServer';
import { getItemAsync, setItemAsync } from '../../services/storage';
import { YOMIBAKO_BUNDLE_VERSION, YOMIBAKO_CSS, YOMIBAKO_JS } from './yomibakoBundle';
import { jpdbApi } from '../../services/jpdb/api';
import { Icon } from '../../components/ui/Icon';
import type { ReaderPreferences, ZoomMode } from './preferences';
import {
  buildCustomWordInject,
  buildCustomPopupInject,
  buildFadeInject,
  buildTokenScripts,
  readBridgeCustomization,
} from '../shared/webViewBridge';
// Direct stream uses image bridge, no prepareVolume copy needed for content://
// import { prepareVolumeForWebView } from '../../services/fs/httpServer';

type Props = {
  htmlUri?: string; // file:// or content:// to .mobile.html
  mokuroUri?: string; // file:// or content:// to .mokuro zip (iOS share path)
  volumeDir: string; // dir with images
  title: string;
  series?: string;
  /** Page to jump to once the bundle reports it is ready (resume position). */
  initialPage?: number;
  initialPreferences: ReaderPreferences;
  onWordTap?: (data: any) => void;
  onWordHover?: (data: any) => void;
  /** Fresh rects for the open lookup after the page panned or zoomed. */
  onWordAnchor?: (data: any) => void;
  /** The anchored word left the DOM (page turn), so the lookup should close. */
  onWordAnchorLost?: () => void;
  onProgress?: (p: number) => void;
  onPage?: (info: ReaderPageInfo) => void;
  onControl?: (info: ReaderControlInfo) => void;
  /** Reply to collectWords(): every parsed card the volume has produced. */
  onWords?: (words: any[]) => void;
  onOpenSettings?: () => void;
  onTapBackground?: () => void;
  onViewReset?: () => void;
};

export type ReaderPageInfo = {
  index: number;
  total: number;
  value: number;
  paged: boolean;
  rtl: boolean;
  twoPage: boolean;
  zoomMode?: ZoomMode;
  menuOpen: boolean;
};

export type ReaderControlInfo = {
  key: 'zoom' | 'twoPage' | 'rtl' | 'menu' | 'reparse';
  ok: boolean;
  mode?: ZoomMode;
  value?: boolean | null;
};

export type MokuroWebViewHandle = {
  goToPage: (index: number) => void;
  step: (delta: number) => void;
  setZoom: (mode: ZoomMode) => void;
  toggle: (key: 'twoPage' | 'rtl') => void;
  setMokuroMenu: (show: boolean) => void;
  setChromeTop: (px: number) => void;
  retryParse: () => void;
  /** Stop tracking the word the popup was anchored to. */
  clearAnchor: () => void;
  /** Repaint every span for a word after its JPDB card state changes. */
  setCardState: (vid: number, sid: number, state: string[]) => void;
  /** Ask the page for its parsed vocabulary; answered via onWords. */
  collectWords: () => void;
};

// Loads mokuro .mobile.html, serves images from a file:// cache copy so the
// WebView loads <img> natively. The data-URI bridge path blanked pages
// (giant base64 injects + SAF URI guessing), so cache-copy is primary.
function mimeForExtension(ext: string): string {
  if (ext === 'png') {
    return 'image/png';
  }
  if (ext === 'webp') {
    return 'image/webp';
  }
  return 'image/jpeg';
}

const WORD_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'lookup',
  'hover',
  'anchor',
  'anchorLost',
  'textGuard',
  'tap',
  'viewReset',
  'words',
]);
const STATUS_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'applied',
  'applyError',
  'parseError',
  'progress',
  'page',
  'control',
  'layoutError',
]);

function isContentVolume(htmlUri: string | undefined, mokuroUri: string | undefined, volumeDir: string): boolean {
  if (htmlUri?.startsWith('content://') ?? false) {
    return true;
  }
  if (mokuroUri?.startsWith('content://') ?? false) {
    return true;
  }
  return volumeDir.startsWith('content://');
}

type VolumeLoadResult = { content: string; baseUrl: string };

async function fetchVolumeHtml(
  args: { htmlUri?: string; mokuroUri?: string; volumeDir: string; title: string; series?: string },
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<VolumeLoadResult> {
  if (isContentVolume(args.htmlUri, args.mokuroUri, args.volumeDir)) {
    const prepared = await prepareVolumeForWebView(
      { htmlUri: args.htmlUri, mokuroUri: args.mokuroUri, uri: args.volumeDir, title: args.title, series: args.series },
      (done, total) => {
        onProgress(done, total);
      },
    );
    if (isCancelled()) {
      throw new Error('cancelled');
    }
    // Let the status paint before the (sync) file read.
    await new Promise((r) => setTimeout(r, 30));
    if (isCancelled()) {
      throw new Error('cancelled');
    }
    const content = await new File(prepared.localHtmlUri).text();
    return { content, baseUrl: prepared.baseUrl };
  }
  if (!args.htmlUri) {
    throw new Error('No html for volume');
  }
  const content = await new File(args.htmlUri).text();
  const baseUrl = args.volumeDir.endsWith('/') ? args.volumeDir : `${args.volumeDir}/`;
  return { content, baseUrl };
}

function MokuroWebView(
  { htmlUri, mokuroUri, volumeDir, title, series, initialPage, initialPreferences, onWordTap, onWordHover, onWordAnchor, onWordAnchorLost, onProgress, onPage, onControl, onWords, onOpenSettings, onTapBackground, onViewReset }: Props,
  ref: React.Ref<MokuroWebViewHandle>
) {
  const [html, setHtml] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [status, setStatus] = useState('Loading…');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [directFile, setDirectFile] = useState(false);
  const lastWebViewSize = useRef({ width: 0, height: 0 });
  const webRef = useRef<WebView>(null);
  // basename (lowercased) -> real SAF document URI. SAF tree children are NOT
  // parentUri + '/' + name, so string-concat resolution always fails — the map
  // from a real list() is the only correct resolver.
  const imgMap = useRef<Map<string, string>>(new Map());

  const ensureImgMap = useCallback(() => {
    if (imgMap.current.size > 0) return imgMap.current;
    try {
      const items = new Directory(volumeDir).list();
      const m = new Map<string, string>();
      for (const it of items) {
        if (it instanceof Directory) continue;
        const f = it as File;
        m.set(f.name, f.uri);
        m.set(f.name.toLowerCase(), f.uri);
        try {
          const dec = decodeURIComponent(f.name);
          m.set(dec, f.uri);
          m.set(dec.toLowerCase(), f.uri);
        } catch {}
      }
      imgMap.current = m;
      console.log('[MokuroWebView] imgMap', m.size / 2, 'images for', title);
    } catch (e) {
      console.warn('[MokuroWebView] imgMap list failed', volumeDir, e);
    }
    return imgMap.current;
  }, [volumeDir, title]);

  const resolveImageUri = useCallback((orig: string): string | null => {
    const map = ensureImgMap();
    const rawBase = orig.split('/').pop() ?? orig;
    const candidates = [rawBase];
    try {
      candidates.push(decodeURIComponent(rawBase));
    } catch {}
    const initialCount = candidates.length;
    for (let i = 0; i < initialCount; i++) {
      candidates.push(candidates[i].toLowerCase());
    }
    for (const c of candidates) {
      const hit = map.get(c);
      if (hit) return hit;
    }
    return null;
  }, [ensureImgMap]);

  const tokenAlertShown = useRef(false);
  const parseErrShown = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesLeft = useRef(4);
  const resumeDone = useRef(false);
  const bridgeReadyHandled = useRef(false);

  const run = useCallback((js: string) => {
    webRef.current?.injectJavaScript(`${js}; true;`);
  }, []);

  React.useImperativeHandle(ref, () => ({
    goToPage: (index: number) => run(`window.__yomibakoGoTo && window.__yomibakoGoTo(${Math.round(index)})`),
    step: (delta: number) => run(`window.__yomibakoStep && window.__yomibakoStep(${delta > 0 ? 1 : -1})`),
    setZoom: (mode) => run(`window.__yomibakoSetZoom && window.__yomibakoSetZoom(${JSON.stringify(mode)})`),
    toggle: (key) => run(`window.__yomibakoToggle && window.__yomibakoToggle(${JSON.stringify(key)})`),
    setMokuroMenu: (show: boolean) => run(`window.__yomibakoMokuroMenu && window.__yomibakoMokuroMenu(${show ? 'true' : 'false'})`),
    setChromeTop: (px: number) => run(`window.__yomibakoChromeTop && window.__yomibakoChromeTop(${Math.round(px)})`),
    retryParse: () => run('window.__yomibakoReparse ? window.__yomibakoReparse() : (window.__yomibakoRetry && window.__yomibakoRetry())'),
    clearAnchor: () => run('window.__yomibakoClearAnchor && window.__yomibakoClearAnchor()'),
    setCardState: (vid: number, sid: number, state: string[]) =>
      run(`window.__yomibakoSetCardState && window.__yomibakoSetCardState(${Number(vid)}, ${Number(sid)}, ${JSON.stringify(state ?? [])})`),
    // Always answers: a page whose bundle never ran replies with an empty set
    // so the quiz can explain itself instead of the button doing nothing.
    collectWords: () =>
      run(
        'window.__yomibakoCollectWords ? window.__yomibakoCollectWords()' +
          ' : (window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:"words",words:[]})))'
      ),
  }), [run]);

  // A failed/timed-out chunk leaves its page observed but unparsed, and an
  // IntersectionObserver never re-fires for a page that stays on screen.
  // Nudge it a few times instead of leaving the text permanently dead.
  const scheduleRetry = useCallback(() => {
    if (retryTimer.current || retriesLeft.current <= 0) return;
    retriesLeft.current--;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      run('window.__yomibakoRetry && window.__yomibakoRetry()');
    }, 4000);
  }, [run]);

  React.useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    []
  );
  // Pipeline stats for on-device diagnostics (Settings → Diagnostics).
  // No logcat needed: open a volume, tap words, then read the counters.
  // taps = raw background taps reaching the page (observer-independent).
  // lookups = word-span taps (tokens applied + click wired).
  // applied = spans wrapped by applyTokens (parseOk but applied 0 = span/click mismatch).
  const diag = useRef({
    pages: 0, sel: '', boxes: 0, tokenPresent: false,
    parseReq: 0, parseOk: 0, parseErr: 0, lastErr: '',
    lookups: 0, taps: 0, guardedTextTaps: 0, deferredLookups: 0,
    applied: 0, applyErr: 0,
  });
  // Throttled diag persistence: taps/parse/progress fire many times per
  // second and SecureStore is encrypted/slow. Coalesce to at most one write
  // per 5s; unmount flushes the tail so diagnostics are never lost.
  const diagTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagPending = useRef(false);
  const lastDiagWrite = useRef(0);
  const flushDiag = useCallback(async () => {
    if (diagTimer.current) {
      clearTimeout(diagTimer.current);
      diagTimer.current = null;
    }
    diagPending.current = false;
    lastDiagWrite.current = Date.now();
    try {
      await setItemAsync(
        'yomibako_reader_diag',
        JSON.stringify({ time: new Date().toISOString(), title, ...diag.current })
      );
    } catch {}
  }, [title]);
  const saveDiag = useCallback(() => {
    // First write (or >5s since last) goes out immediately so Diagnostics
    // stays fresh; bursts within the window coalesce to one trailing write.
    if (!diagPending.current && Date.now() - lastDiagWrite.current > 5000) {
      void flushDiag();
      return;
    }
    if (diagPending.current) return;
    diagPending.current = true;
    diagTimer.current = setTimeout(() => {
      diagTimer.current = null;
      diagPending.current = false;
      void flushDiag();
    }, 5000);
  }, [flushDiag]);

  React.useEffect(
    () => () => {
      if (diagTimer.current) clearTimeout(diagTimer.current);
      void flushDiag();
    },
    [flushDiag]
  );

  const getToken = useCallback(async (): Promise<string | null> => {
    let token: string | null = await getItemAsync('jpdb_token');
    if (!token) {
      const raw = await getItemAsync('yomibako_config_json');
      if (raw) {
        try {
          token = JSON.parse(raw).apiToken;
        } catch {}
      }
    }
    return token || null;
  }, []);

  const alertNoToken = useCallback(() => {
    if (tokenAlertShown.current) return;
    tokenAlertShown.current = true;
    Alert.alert(
      'JPDB parsing off',
      'No API token set — words won\'t parse and tapping does nothing.\n\nSet it in Settings (jpdb.io → Settings → API token).',
      [
        ...(onOpenSettings ? [{ text: 'Open Settings', onPress: onOpenSettings } as const] : []),
        { text: 'Later', style: 'cancel' as const },
      ]
    );
  }, [onOpenSettings]);

  React.useEffect(() => {
    let cancelled = false;
    bridgeReadyHandled.current = false;
    resumeDone.current = false;
    const isCancelled = () => cancelled;
    (async () => {
      try {
        setLoadError(null);
        const contentVolume = isContentVolume(htmlUri, mokuroUri, volumeDir);
        if (contentVolume) {
          setStatus('Copying volume…');
        } else {
          setStatus('Loading…');
        }
        const result = await fetchVolumeHtml(
          { htmlUri, mokuroUri, volumeDir, title, series },
          (done, total) => {
            if (!cancelled && total > 1) {
              setStatus(`Copying volume… ${done}/${total}`);
            }
          },
          isCancelled,
        );
        if (cancelled) {
          return;
        }
        if (contentVolume) {
          setStatus('Loading pages…');
        }
        setHtml(result.content);
        setBaseUrl(result.baseUrl);
        setDirectFile(true);
      } catch (e: any) {
        if (String(e?.message) === 'cancelled') {
          return;
        }
        if (!cancelled) {
          const message = String(e?.message ?? e);
          setLoadError(message);
          setStatus('Could not open this volume');
        }
        console.warn('MokuroWebView load', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [htmlUri, mokuroUri, volumeDir, title, series, ensureImgMap, loadAttempt]);

  // Chunked token reply: giant injectJavaScript payloads (100KB+ of JSON)
  // die silently on Android. Split into ~20KB slices; the bundle
  // reassembles via __yomibakoOnTokensChunk then resolves the pending parse.
  const injectTokens = useCallback((id: string, tokens: unknown) => {
    for (const script of buildTokenScripts(id, tokens)) {
      webRef.current?.injectJavaScript(script);
    }
  }, []);

  function buildCssInject(customWordCSS: string, customPopupCSS: string, disableFade: boolean): string {
    const baseRule = `let s=document.getElementById('yomibako-css'); if(!s){ s=document.createElement('style'); s.id='yomibako-css'; s.textContent=${JSON.stringify(YOMIBAKO_CSS)}; document.head.appendChild(s);}`;
    const wordRule = buildCustomWordInject(customWordCSS);
    const popupRule = buildCustomPopupInject(customPopupCSS);
    const fadeRule = buildFadeInject(disableFade);
    return `(function(){ ${baseRule} ${wordRule} ${popupRule} ${fadeRule} true;})();`;
  }

  async function readCustomCss(): Promise<{ customWordCSS: string; customPopupCSS: string; disableFade: boolean }> {
    const { customWordCSS, customPopupCSS, disableFade } = await readBridgeCustomization();
    return { customWordCSS, customPopupCSS, disableFade };
  }

  const handleBridgeReady = useCallback(async (msg: any) => {
    // The bundle posts exactly one bridgeReady with payload. Ignore
    // stray empties so pages/sel/boxes are never clobbered back to 0.
    if (msg.pages !== undefined) {
      diag.current.pages = Number(msg.pages ?? 0);
    }
    if (msg.sel !== undefined) {
      diag.current.sel = String(msg.sel ?? '');
    }
    if (msg.boxes !== undefined) {
      diag.current.boxes = Number(msg.boxes ?? 0);
    }
    if (bridgeReadyHandled.current) {
      return;
    }
    bridgeReadyHandled.current = true;
    console.log('[MokuroWebView] ready', title, `${diag.current.pages} pages`);
    // Inject full CSS after bridge ready (calm color-only states + furigana) + customWordCSS/customPopupCSS from config
    const custom = await readCustomCss();
    webRef.current?.injectJavaScript(buildCssInject(custom.customWordCSS, custom.customPopupCSS, custom.disableFade));
    // Resume where the reader stopped last time. Done once, and only after
    // the bundle reports it is live so mokuro's own state is already loaded.
    if (!resumeDone.current) {
      resumeDone.current = true;
      const target = Math.round(initialPage ?? 0);
      const prefs = { ...initialPreferences, reduceMotion: custom.disableFade };
      setTimeout(() => run(
        `window.__yomibakoApplyPrefs && window.__yomibakoApplyPrefs(${JSON.stringify(prefs)}, ${target})`
      ), 0);
    }
    // Surface the #1 lookup killer immediately: no token = no parsing,
    // and taps silently do nothing. Actionable alert, once per volume.
    diag.current.tokenPresent = !!(await getToken());
    saveDiag();
    if (!diag.current.tokenPresent) {
      alertNoToken();
    }
  }, [title, getToken, saveDiag, alertNoToken, run, initialPage, initialPreferences]);

  const handleParseMessage = useCallback(async (msg: any) => {
    // msg.texts: [[seq, text], ...] and id for batch correlation.
    // Chunks are bounded by the bundle (<=4000 chars) so each reply
    // stays small; oversized replies are still chunk-sent below.
    const texts: string[] = msg.texts.map((t: any) => t[1]);
    const id = msg.id;
    diag.current.parseReq++;
    saveDiag();
    const token = await getToken();
    if (!token) {
      const errInject = `window.__yomibakoOnError && window.__yomibakoOnError(${JSON.stringify(id)}, 'No JPDB token - set in Settings'); true;`;
      webRef.current?.injectJavaScript(errInject);
      diag.current.parseErr++;
      diag.current.lastErr = 'No JPDB token - set in Settings';
      saveDiag();
      alertNoToken();
      return;
    }
    try {
      const { tokens } = await jpdbApi.parse({ text: texts, apiToken: token });
      diag.current.parseOk++;
      saveDiag();
      // tokens is ParseToken[][] ordered same as texts.
      // The bundle's pending resolver applies spans on resolve.
      injectTokens(id, tokens);
    } catch (err: any) {
      webRef.current?.injectJavaScript(`window.__yomibakoOnError(${JSON.stringify(id)}, ${JSON.stringify(err.message)}); true;`);
      diag.current.parseErr++;
      diag.current.lastErr = String(err?.message ?? err);
      saveDiag();
      scheduleRetry();
      // Silent parse failures = dead taps. Show the real error once.
      if (!parseErrShown.current) {
        parseErrShown.current = true;
        Alert.alert('JPDB parse failed', `${err?.message ?? err}\n\nCheck the API token and network in Settings.`);
      }
    }
  }, [getToken, saveDiag, alertNoToken, injectTokens, scheduleRetry]);

  const handleWordMessages = useCallback((msg: any) => {
    if (msg.type === 'lookup') {
      diag.current.lookups++;
      saveDiag();
      onWordTap?.(msg);
      return;
    }
    if (msg.type === 'hover') {
      onWordHover?.(msg);
      return;
    }
    if (msg.type === 'anchor') {
      onWordAnchor?.(msg);
      return;
    }
    if (msg.type === 'anchorLost') {
      onWordAnchorLost?.();
      return;
    }
    if (msg.type === 'textGuard') {
      diag.current.guardedTextTaps++;
      if (msg.pending) {
        diag.current.deferredLookups++;
      }
      saveDiag();
      return;
    }
    if (msg.type === 'tap') {
      diag.current.taps++;
      saveDiag();
      onTapBackground?.();
      return;
    }
    if (msg.type === 'viewReset') {
      onViewReset?.();
      return;
    }
    if (msg.type === 'words') {
      onWords?.(Array.isArray(msg.words) ? msg.words : []);
    }
  }, [saveDiag, onWordTap, onWordHover, onWordAnchor, onWordAnchorLost, onTapBackground, onViewReset, onWords]);

  const handleStatusMessages = useCallback((msg: any) => {
    if (msg.type === 'applied') {
      diag.current.applied += Number(msg.spans ?? 0);
      saveDiag();
      return;
    }
    if (msg.type === 'applyError' || msg.type === 'parseError') {
      diag.current.applyErr++;
      diag.current.lastErr = String(msg.error ?? msg.type).slice(0, 200);
      saveDiag();
      scheduleRetry();
      return;
    }
    if (msg.type === 'progress') {
      onProgress?.(Math.max(0, Math.min(1, Number(msg.value) || 0)));
      return;
    }
    if (msg.type === 'page') {
      const value = Math.max(0, Math.min(1, Number(msg.value) || 0));
      onProgress?.(value);
      onPage?.({
        index: Number(msg.index ?? -1),
        total: Number(msg.total ?? 0),
        value,
        paged: !!msg.paged,
        rtl: msg.rtl === true,
        twoPage: !!msg.twoPage,
        zoomMode: msg.zoomMode,
        menuOpen: !!msg.menuOpen,
      });
      return;
    }
    if (msg.type === 'control') {
      onControl?.({
        key: msg.key,
        ok: !!msg.ok,
        mode: msg.mode,
        value: typeof msg.value === 'boolean' ? msg.value : null,
      });
      return;
    }
    if (msg.type === 'layoutError') {
      console.warn('[MokuroWebView] layout failed', msg.error, msg.stack ?? '');
    }
  }, [saveDiag, scheduleRetry, onProgress, onPage, onControl]);

  const handleFetchImageMessage = useCallback(async (msg: any) => {
    // Safety net only: in direct-file mode the bundle no longer hijacks
    // <img>, so this should rarely fire (e.g. stale cached page).
    const { orig, id } = msg as { orig: string; id: string };
    try {
      if (orig.startsWith('file://')) {
        // Native-readable already — hand the URL straight back, no
        // base64 round-trip (giant injects silently fail on Android).
        webRef.current?.injectJavaScript(`window.__yomibakoOnImage && window.__yomibakoOnImage(${JSON.stringify(id)}, ${JSON.stringify(orig)}); true;`);
        return;
      }
      if (orig.startsWith('content://')) {
        await handleContentImage(orig, id);
        return;
      }
      // Relative path — resolve against the file:// baseUrl cache dir.
      const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
      const absolute = `${base}${orig.replace(/^\.\//, '')}`;
      webRef.current?.injectJavaScript(`window.__yomibakoOnImage && window.__yomibakoOnImage(${JSON.stringify(id)}, ${JSON.stringify(absolute)}); true;`);
    } catch (e: any) {
      console.warn('[MokuroWebView] fetchImage failed', orig, e?.message ?? e);
      webRef.current?.injectJavaScript(`window.__yomibakoOnImageError && window.__yomibakoOnImageError(${JSON.stringify(id)}, ${JSON.stringify(e.message)}); true;`);
    }
  }, [resolveImageUri, baseUrl]);

  async function handleContentImage(orig: string, id: string): Promise<void> {
    try {
      const absolute = resolveImageUri(orig) ?? orig;
      const file = new File(absolute);
      // Safety-net path only: skip giant pages instead of building a huge
      // data: URI that dies silently on Android and spikes the JS heap.
      try {
        const info = file.info();
        const size = (info as { size?: number })?.size;
        if (typeof size === 'number' && size > 4 * 1024 * 1024) {
          throw new Error(`image too large (${Math.round(size / 1024 / 1024)}MB) for bridge`);
        }
      } catch (e: any) {
        if (String(e?.message ?? '').includes('too large')) throw e;
        // info() unavailable on some URIs — fall through and try.
      }
      const b64 = await file.base64();
      if (b64.length > 5 * 1024 * 1024) {
        throw new Error('image too large for bridge');
      }
      const ext = absolute.split('.').pop()?.toLowerCase() ?? 'jpeg';
      const mime = mimeForExtension(ext);
      const dataUri = `data:${mime};base64,${b64}`;
      webRef.current?.injectJavaScript(`window.__yomibakoOnImage && window.__yomibakoOnImage(${JSON.stringify(id)}, ${JSON.stringify(dataUri)}); true;`);
    } catch (e: any) {
      console.warn('[MokuroWebView] fetchImage skipped', orig, e?.message ?? e);
      webRef.current?.injectJavaScript(`window.__yomibakoOnImageError && window.__yomibakoOnImageError(${JSON.stringify(id)}, ${JSON.stringify(String(e?.message ?? e).slice(0, 200))}); true;`);
    }
  }

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      const type = msg.type as string;
      if (type === 'bridgeReady') {
        await handleBridgeReady(msg);
        return;
      }
      if (type === 'parse') {
        await handleParseMessage(msg);
        return;
      }
      if (type === 'fetchImage') {
        await handleFetchImageMessage(msg);
        return;
      }
      if (WORD_MESSAGE_TYPES.has(type)) {
        handleWordMessages(msg);
        return;
      }
      if (STATUS_MESSAGE_TYPES.has(type)) {
        handleStatusMessages(msg);
        return;
      }
      handleWordMessages(msg);
      handleStatusMessages(msg);
    } catch (err) { console.warn(err); }
  }, [handleBridgeReady, handleParseMessage, handleWordMessages, handleStatusMessages, handleFetchImageMessage]);

  // Stable identity: a fresh source object on every parent re-render (progress
  // ticks, scrubbing) can make the native WebView reload the whole volume.
  const source = React.useMemo(() => ({ html: html ?? '', baseUrl }), [html, baseUrl]);

  if (!html)
    return (
      <View style={[s.c, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', gap: 12 }]}>
        <View style={s.loadIcon}>
          {loadError ? <Icon name="book" size={24} color="rgba(255,255,255,0.74)" strokeWidth={1.7} /> : <ActivityIndicator color="#fff" />}
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.92)', fontFamily: 'System', fontSize: 15, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.50)', fontFamily: 'System', fontSize: 12, fontWeight: '400' }}>{status}</Text>
        {loadError ? (
          <>
            <Text numberOfLines={3} style={s.loadError}>{loadError}</Text>
            <Pressable
              onPress={() => setLoadAttempt((n) => n + 1)}
              style={({ pressed }) => [s.retryButton, { opacity: pressed ? 0.75 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Retry opening volume"
            >
              <Icon name="reload" size={15} color="#fff" strokeWidth={2.1} />
              <Text style={s.retryText}>Try again</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    );

  return (
    <View style={[s.c, { backgroundColor: '#000' }]}>
      <WebView
        ref={webRef}
        // Module constant: stable at runtime, so this only remounts when the
        // injected bundle itself changed rather than on every render.
        key={YOMIBAKO_BUNDLE_VERSION}
        originWhitelist={['*']}
        source={source}
        style={{ flex: 1, backgroundColor: '#000' }}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
        // The system font-scale is applied to WebView text on Android and blows
        // mokuro's absolutely positioned textBoxes off their panels.
        textZoom={100}
        // Panzoom moves a full manga page every frame. The ghost was a real
        // #preload-image node, not a stale layer, so retain GPU composition.
        androidLayerType="hardware"
        overScrollMode="never"
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          const previous = lastWebViewSize.current;
          lastWebViewSize.current = { width, height };
          if (previous.width > 0 && (Math.abs(previous.width - width) > 1 || Math.abs(previous.height - height) > 1)) {
            run('window.__yomibakoRelayout && window.__yomibakoRelayout()');
          }
        }}
        onMessage={onMessage}
        onRenderProcessGone={() => setStatus('Renderer crashed — reopen the volume.')}
        injectedJavaScriptBeforeContentLoaded={`${directFile ? 'window.__yomibakoDirectFile=true;' : ''}\n${YOMIBAKO_JS}`}
        injectedJavaScript={`
          (function(){
            // Ensure mokuro textBoxes are visible, then hand control to the
            // bundle. CSS/progress used to be duplicated here and fought the
            // bundle's own reporter.
            document.documentElement.style.setProperty('--textBoxDisplay','initial');
            let s=document.getElementById('yomibako-css');
            if(!s){ s=document.createElement('style'); s.id='yomibako-css'; s.textContent=${JSON.stringify(YOMIBAKO_CSS)}; document.head.appendChild(s); }
            if(window.__yomibakoObserve) window.__yomibakoObserve();
            if(window.__yomibakoReport) window.__yomibakoReport();
            true;
          })();
        `}
      />
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1 },
  loadIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  loadError: { color: 'rgba(255,255,255,0.46)', fontFamily: 'System', fontSize: 12, lineHeight: 17, textAlign: 'center', maxWidth: 300, paddingHorizontal: 12 },
  retryButton: { minHeight: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#0A84FF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  retryText: { color: '#fff', fontFamily: 'System', fontSize: 14, fontWeight: '700' },
});

export default React.forwardRef(MokuroWebView);
