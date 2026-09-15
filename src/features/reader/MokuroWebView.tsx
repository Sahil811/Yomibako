import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Alert } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Directory, File } from 'expo-file-system';
import { prepareVolumeForWebView } from '../../services/fs/httpServer';
import { getItemAsync, setItemAsync } from '../../services/storage';
import { YOMIBAKO_CSS, YOMIBAKO_JS } from './yomibakoBundle';
import { jpdbApi } from '../../services/jpdb/api';
// Direct stream uses image bridge, no prepareVolume copy needed for content://
// import { prepareVolumeForWebView } from '../../services/fs/httpServer';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors } from '../../theme/colors';

type Props = {
  htmlUri?: string; // file:// or content:// to .mobile.html
  mokuroUri?: string; // file:// or content:// to .mokuro zip (iOS share path)
  volumeDir: string; // dir with images
  title: string;
  series?: string;
  onWordTap?: (data: any) => void;
  onProgress?: (p: number) => void;
  onOpenSettings?: () => void;
  onTapBackground?: () => void;
};

// Loads mokuro .mobile.html, serves images from a file:// cache copy so the
// WebView loads <img> natively. The data-URI bridge path blanked pages
// (giant base64 injects + SAF URI guessing), so cache-copy is primary.
export default function MokuroWebView({ htmlUri, mokuroUri, volumeDir, title, series, onWordTap, onProgress, onOpenSettings, onTapBackground }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [status, setStatus] = useState('Loading…');
  const [directFile, setDirectFile] = useState(false);
  const webRef = useRef<WebView>(null);
  const colors = useColorScheme() === 'light' ? lightColors : darkColors;
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
  // Pipeline stats for on-device diagnostics (Settings → Diagnostics).
  // No logcat needed: open a volume, tap words, then read the counters.
  // taps = raw background taps reaching the page (observer-independent).
  // lookups = word-span taps (tokens applied + click wired).
  // applied = spans wrapped by applyTokens (parseOk but applied 0 = span/click mismatch).
  const diag = useRef({
    pages: 0, sel: '', boxes: 0, tokenPresent: false,
    parseReq: 0, parseOk: 0, parseErr: 0, lastErr: '',
    lookups: 0, taps: 0, applied: 0, applyErr: 0,
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
    (async () => {
      try {
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
        if (!cancelled) setStatus(`Failed: ${e?.message ?? e}`);
        console.warn('MokuroWebView load', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [htmlUri, mokuroUri, volumeDir, title, series, ensureImgMap]);

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
        console.log('[MokuroWebView] bridge ready for', title, msg.pages ? `${msg.pages} pages` : '');
        // The bundle posts exactly one bridgeReady with payload. Ignore
        // stray empties so pages/sel/boxes are never clobbered back to 0.
        if (msg.pages !== undefined) diag.current.pages = Number(msg.pages ?? 0);
        if (msg.sel !== undefined) diag.current.sel = String(msg.sel ?? '');
        if (msg.boxes !== undefined) diag.current.boxes = Number(msg.boxes ?? 0);
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
        return;
      }
      if (msg.type === 'lookup') {
        diag.current.lookups++;
        saveDiag();
        onWordTap?.(msg);
      }
      if (msg.type === 'tap') {
        diag.current.taps++;
        saveDiag();
        onTapBackground?.();
      }
      if (msg.type === 'progress') {
        onProgress?.(Math.max(0, Math.min(1, Number(msg.value) || 0)));
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
  }, [title, onWordTap, onProgress, onTapBackground, resolveImageUri, volumeDir, baseUrl, getToken, alertNoToken, injectTokens, saveDiag]);

  if (!html)
    return (
      <View style={[s.c, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', gap: 12 }]}>
        <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#fff" />
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.92)', fontFamily: 'System', fontSize: 15, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.50)', fontFamily: 'System', fontSize: 12, fontWeight: '400' }}>{status}</Text>
      </View>
    );

  return (
    <View style={[s.c, { backgroundColor: colors.background }]}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl }}
        style={{ flex: 1, backgroundColor: colors.background }}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
        onMessage={onMessage}
        injectedJavaScriptBeforeContentLoaded={`${directFile ? 'window.__yomibakoDirectFile=true;' : ''}\n${YOMIBAKO_JS}`}
        injectedJavaScript={`
          (function(){
            // Ensure mokuro textBoxes visible + inject CSS fallback
            document.documentElement.style.setProperty('--textBoxDisplay','initial');
            let s=document.getElementById('yomibako-css');
            if(!s){ s=document.createElement('style'); s.id='yomibako-css'; s.textContent=${JSON.stringify(YOMIBAKO_CSS)}; document.head.appendChild(s); }
            // Kick observer if missed
            if(window.__yomibakoObserve) window.__yomibakoObserve();
            // Progress reporter — Apple Books scrubber
            let lastP = -1;
            function report(){
              const h = document.documentElement.scrollHeight - window.innerHeight;
              const p = h > 0 ? window.scrollY / h : 0;
              const v = Math.max(0, Math.min(1, p));
              if (Math.abs(v - lastP) > 0.01) { lastP = v; window.ReactNativeWebView.postMessage(JSON.stringify({type:'progress', value: v})); }
            }
            window.addEventListener('scroll', report, { passive: true });
            setInterval(report, 400);
            report();
            true;
          })();
        `}
      />
    </View>
  );
}

const s = StyleSheet.create({ c: { flex: 1 } });
