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
    for (const c of [...candidates]) candidates.push(c.toLowerCase());
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
  const saveDiag = useCallback(async () => {
    try {
      await setItemAsync(
        'yomibako_reader_diag',
        JSON.stringify({ time: new Date().toISOString(), title, ...diag.current })
      );
    } catch {}
  }, [title]);

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
    (async () => {
      try {
        setLoadError(null);
        setStatus('Loading…');
        const isContent =
          (htmlUri?.startsWith('content://') ?? false) ||
          (mokuroUri?.startsWith('content://') ?? false) ||
          volumeDir.startsWith('content://');
        if (isContent) {
          // Cache-copy mode: copy this volume (html + ~180 jpgs) to
          // file:// cache once, then <img> loads natively. Shows progress
          // because the first copy of a volume takes a while over SAF.
          setStatus('Copying volume…');
          const prepared = await prepareVolumeForWebView(
            { htmlUri, mokuroUri, uri: volumeDir, title, series },
            (done, total) => {
              if (!cancelled && total > 1)
                setStatus(`Copying volume… ${done}/${total}`);
            }
          );
          if (cancelled) return;
          setStatus('Loading pages…');
          // Let the status paint before the (sync) file read.
          await new Promise((r) => setTimeout(r, 30));
          if (cancelled) return;
          const content = await new File(prepared.localHtmlUri).text();
          if (cancelled) return;
          setHtml(content);
          setBaseUrl(prepared.baseUrl);
          setDirectFile(true);
        } else {
          if (!htmlUri) throw new Error('No html for volume');
          const content = await new File(htmlUri).text();
          if (cancelled) return;
          setHtml(content);
          setBaseUrl(volumeDir.endsWith('/') ? volumeDir : volumeDir + '/');
          setDirectFile(true);
        }
      } catch (e: any) {
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
    const payload = JSON.stringify(tokens);
    const CHUNK = 20000;
    if (payload.length <= 30000) {
      webRef.current?.injectJavaScript(`window.__yomibakoOnTokens(${JSON.stringify(id)}, ${payload}); true;`);
      return;
    }
    const total = Math.ceil(payload.length / CHUNK);
    for (let i = 0; i < total; i++) {
      const part = payload.slice(i * CHUNK, (i + 1) * CHUNK);
      webRef.current?.injectJavaScript(
        `window.__yomibakoOnTokensChunk(${JSON.stringify(id)}, ${i}, ${total}, ${JSON.stringify(part)}); true;`
      );
    }
  }, []);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'bridgeReady') {
        // The bundle posts exactly one bridgeReady with payload. Ignore
        // stray empties so pages/sel/boxes are never clobbered back to 0.
        if (msg.pages !== undefined) diag.current.pages = Number(msg.pages ?? 0);
        if (msg.sel !== undefined) diag.current.sel = String(msg.sel ?? '');
        if (msg.boxes !== undefined) diag.current.boxes = Number(msg.boxes ?? 0);
        if (bridgeReadyHandled.current) return;
        bridgeReadyHandled.current = true;
        console.log('[MokuroWebView] ready', title, `${diag.current.pages} pages`);
        // Inject full CSS after bridge ready (calm color-only states + furigana) + customWordCSS/customPopupCSS from config
        const cfgRaw = await getItemAsync('yomibako_config_json');
        let customWordCSS = '';
        let customPopupCSS = '';
        let disableFade = false;
        if (cfgRaw) {
          try {
            const cfg = JSON.parse(cfgRaw);
            customWordCSS = cfg.customWordCSS || '';
            customPopupCSS = cfg.customPopupCSS || '';
            disableFade = !!cfg.disableFadeAnimation;
          } catch {}
        }
        const cssInject = `(function(){
          let s=document.getElementById('yomibako-css'); if(!s){ s=document.createElement('style'); s.id='yomibako-css'; s.textContent=${JSON.stringify(
            YOMIBAKO_CSS
          )}; document.head.appendChild(s);}
          ${customWordCSS ? `let cw=document.getElementById('yomibako-custom-word'); if(!cw){ cw=document.createElement('style'); cw.id='yomibako-custom-word'; cw.textContent=${JSON.stringify(
            customWordCSS
          )}; document.head.appendChild(cw); }` : ''}
          ${customPopupCSS ? `let cp=document.getElementById('yomibako-custom-popup'); if(!cp){ cp=document.createElement('style'); cp.id='yomibako-custom-popup'; cp.textContent=${JSON.stringify(
            customPopupCSS
          )}; document.head.appendChild(cp); }` : ''}
          ${disableFade ? `document.documentElement.style.setProperty('--jpdb-fade-duration','0s');` : ''}
          true;})();`;
        webRef.current?.injectJavaScript(cssInject);
        // Resume where the reader stopped last time. Done once, and only after
        // the bundle reports it is live so mokuro's own state is already loaded.
        if (!resumeDone.current) {
          resumeDone.current = true;
          const target = Math.round(initialPage ?? 0);
          const prefs = { ...initialPreferences, reduceMotion: disableFade };
          setTimeout(() => run(
            `window.__yomibakoApplyPrefs && window.__yomibakoApplyPrefs(${JSON.stringify(prefs)}, ${target})`
          ), 0);
        }
        // Surface the #1 lookup killer immediately: no token = no parsing,
        // and taps silently do nothing. Actionable alert, once per volume.
        diag.current.tokenPresent = !!(await getToken());
        saveDiag();
        if (!diag.current.tokenPresent) alertNoToken();
        return;
      }
      if (msg.type === 'parse') {
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
        return;
      }
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
      if (msg.type === 'lookup') {
        diag.current.lookups++;
        saveDiag();
        onWordTap?.(msg);
      }
      if (msg.type === 'hover') onWordHover?.(msg);
      if (msg.type === 'anchor') onWordAnchor?.(msg);
      if (msg.type === 'anchorLost') onWordAnchorLost?.();
      if (msg.type === 'textGuard') {
        diag.current.guardedTextTaps++;
        if (msg.pending) diag.current.deferredLookups++;
        saveDiag();
      }
      if (msg.type === 'tap') {
        diag.current.taps++;
        saveDiag();
        onTapBackground?.();
      }
      if (msg.type === 'viewReset') onViewReset?.();
      if (msg.type === 'words') onWords?.(Array.isArray(msg.words) ? msg.words : []);
      if (msg.type === 'progress') {
        onProgress?.(Math.max(0, Math.min(1, Number(msg.value) || 0)));
      }
      if (msg.type === 'page') {
        const value = Math.max(0, Math.min(1, Number(msg.value) || 0));
        onProgress?.(value);
        onPage?.({
          index: Number(msg.index ?? -1),
          total: Number(msg.total ?? 0),
          value,
          paged: !!msg.paged,
          rtl: msg.rtl !== false,
          twoPage: !!msg.twoPage,
          zoomMode: msg.zoomMode,
          menuOpen: !!msg.menuOpen,
        });
      }
      if (msg.type === 'control') {
        onControl?.({
          key: msg.key,
          ok: !!msg.ok,
          mode: msg.mode,
          value: typeof msg.value === 'boolean' ? msg.value : null,
        });
      }
      if (msg.type === 'layoutError') {
        console.warn('[MokuroWebView] layout failed', msg.error, msg.stack ?? '');
      }
      if (msg.type === 'fetchImage') {
        // Safety net only: in direct-file mode the bundle no longer hijacks
        // <img>, so this should rarely fire (e.g. stale cached page).
        const { orig, id } = msg as { orig: string; id: string };
        try {
          if (orig.startsWith('file://')) {
            // Native-readable already — hand the URL straight back, no
            // base64 round-trip (giant injects silently fail on Android).
            webRef.current?.injectJavaScript(`window.__yomibakoOnImage && window.__yomibakoOnImage(${JSON.stringify(id)}, ${JSON.stringify(orig)}); true;`);
          } else if (orig.startsWith('content://')) {
            const absolute = resolveImageUri(orig) ?? orig;
            const b64 = await new File(absolute).base64();
            const ext = absolute.split('.').pop()?.toLowerCase() ?? 'jpeg';
            const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
            webRef.current?.injectJavaScript(`window.__yomibakoOnImage && window.__yomibakoOnImage(${JSON.stringify(id)}, ${JSON.stringify(`data:${mime};base64,${b64}`)}); true;`);
          } else {
            // Relative path — resolve against the file:// baseUrl cache dir.
            const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
            const absolute = `${base}${orig.replace(/^\.\//, '')}`;
            webRef.current?.injectJavaScript(`window.__yomibakoOnImage && window.__yomibakoOnImage(${JSON.stringify(id)}, ${JSON.stringify(absolute)}); true;`);
          }
        } catch (e: any) {
          console.warn('[MokuroWebView] fetchImage failed', orig, e?.message ?? e);
          webRef.current?.injectJavaScript(`window.__yomibakoOnImageError && window.__yomibakoOnImageError(${JSON.stringify(id)}, ${JSON.stringify(e.message)}); true;`);
        }
      }
    } catch (err) { console.warn(err); }
  }, [title, onWordTap, onWordHover, onWordAnchor, onWordAnchorLost, onProgress, onPage, onControl, onWords, onTapBackground, onViewReset, resolveImageUri, volumeDir, baseUrl, getToken, alertNoToken, injectTokens, saveDiag, scheduleRetry, run, initialPage, initialPreferences]);

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
