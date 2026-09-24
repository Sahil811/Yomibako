import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme, Alert, Platform, BackHandler } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { darkColors, lightColors } from '../../theme/colors';
import { Icon } from '../../components/ui/Icon';
import { getItemAsync } from '../../services/storage';
import { jpdbApi } from '../../services/jpdb/api';
import { loadConfig } from '../../services/jpdb/config';
import { useWordAudio } from '../shared/useWordAudio';
import {
  buildCustomWordInject,
  buildCustomPopupInject,
  buildFadeInject,
  buildTokenScripts,
  readBridgeCustomization,
  type BridgeCustomization,
} from '../shared/webViewBridge';
import { BROWSER_CSS, BROWSER_JS } from './browserBundle';
import WordSheet from '../reader/WordSheet';
import QuizModal from '../quiz/QuizModal';

// The browser is locked to the TTSU reader — no search, no address bar,
// no manual navigation. TTSU is the only page ever shown.
const TTSU_URL = 'https://reader.ttsu.app/';
const BLOCKED_ANKI = ['ankiuser.net', 'ankiweb.net'];
function isBlockedAnki(url: string): boolean {
  return BLOCKED_ANKI.some((d) => url.toLowerCase().includes(d));
}

function getIosWebViewProps(): object {
  if (Platform.OS === 'ios') {
    return { decelerationRate: 'normal' as const, allowsBackForwardNavigationGestures: true };
  }
  return {};
}

function buildBridgeCssInject(customWordCSS: string, customPopupCSS: string, disableFade: boolean): string {
  const wordInject = buildCustomWordInject(customWordCSS);
  const popupInject = buildCustomPopupInject(customPopupCSS);
  const fadeInject = buildFadeInject(disableFade);
  return `(function(){
          let s=document.getElementById('yomibako-browser-css'); if(!s){ s=document.createElement('style'); s.id='yomibako-browser-css'; s.textContent=${JSON.stringify(BROWSER_CSS)}; document.head.appendChild(s);}
          ${wordInject}
          ${popupInject}
          ${fadeInject}
          true;})();`;
}

async function loadBridgeCustomization(interactionRef: React.RefObject<{ showPopupOnHover: boolean; playSoundOnHover: boolean }>): Promise<BridgeCustomization> {
  const parsed = await readBridgeCustomization();
  interactionRef.current = {
    showPopupOnHover: parsed.showPopupOnHover,
    playSoundOnHover: parsed.playSoundOnHover,
  };
  return parsed;
}

async function resolveParseApiToken(): Promise<string | null> {
  const token = await getItemAsync('jpdb_token');
  if (token) {
    return token;
  }
  const raw = await getItemAsync('yomibako_config_json');
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw).apiToken ?? null;
  } catch {
    return null;
  }
}

function extractParseTexts(msg: any): string[] {
  if (!Array.isArray(msg.texts)) {
    return [];
  }
  return msg.texts.map((t: any) => t[1]);
}

function parseErrorText(error: unknown): string {
  const message = (error as any)?.message;
  if (typeof message === 'string' && message) {
    return String(message).slice(0, 120);
  }
  return 'Parse failed';
}

type BrowserMessageContext = {
  webRef: React.RefObject<WebView | null>;
  interactionRef: React.RefObject<{ showPopupOnHover: boolean; playSoundOnHover: boolean }>;
  setParseError: (v: string | null) => void;
  setQuizWords: (v: any[] | null) => void;
  presentLookup: (msg: any, haptic: boolean) => void;
  dismissLookup: () => void;
  playWordAudio: (msg: any) => void;
  scheduleHoverAudio: (msg: any) => void;
};

async function handleBridgeReadyMessage(ctx: BrowserMessageContext): Promise<void> {
  const custom = await loadBridgeCustomization(ctx.interactionRef);
  ctx.webRef.current?.injectJavaScript(buildBridgeCssInject(custom.customWordCSS, custom.customPopupCSS, custom.disableFade));
}

function handleBlockedMessage(msg: any): boolean {
  if (msg.type === 'blocked' && msg.reason === 'anki') {
    Alert.alert('Anki blocked', 'Anki domains are disabled.');
    return true;
  }
  return false;
}

function handleParseErrorMessage(msg: any, ctx: BrowserMessageContext): boolean {
  if (msg.type !== 'parseError') {
    return false;
  }
  if (typeof msg.error === 'string' && msg.error) {
    ctx.setParseError(msg.error);
  } else {
    ctx.setParseError('Parse failed');
  }
  return true;
}

async function handleParseMessage(msg: any, ctx: BrowserMessageContext): Promise<boolean> {
  if (msg.type !== 'parse') {
    return false;
  }
  const texts = extractParseTexts(msg);
  const id = msg.id;
  const apiToken = await resolveParseApiToken();
  if (!apiToken) {
    ctx.setParseError('Missing JPDB token — set it in Settings');
    ctx.webRef.current?.injectJavaScript(`window.__yomibakoOnError(${JSON.stringify(id)}, 'Missing JPDB token — Settings'); true;`);
    return true;
  }
  try {
    const { tokens } = await jpdbApi.parse({ text: texts, apiToken });
    injectBrowserTokens(ctx.webRef, id, tokens);
    ctx.setParseError(null);
  } catch (err: any) {
    ctx.setParseError(parseErrorText(err));
    ctx.webRef.current?.injectJavaScript(`window.__yomibakoOnError(${JSON.stringify(id)}, ${JSON.stringify(err.message)}); true;`);
  }
  return true;
}

// Chunked token reply: giant injectJavaScript payloads (100KB+ of JSON) die
// silently on Android. Split into ~20KB slices like MokuroWebView; the
// browser bundle reassembles via __yomibakoOnTokensChunk.
function injectBrowserTokens(webRef: React.RefObject<WebView | null>, id: string, tokens: unknown): void {
  for (const script of buildTokenScripts(id, tokens)) {
    webRef.current?.injectJavaScript(script);
  }
}

function handleLookupMessage(msg: any, ctx: BrowserMessageContext): boolean {
  if (msg.type !== 'lookup') {
    return false;
  }
  ctx.presentLookup(msg, true);
  // A tap is a deliberate selection — pronounce it immediately, with no
  // hover debounce. presentLookup already stopped any prior audio.
  if (ctx.interactionRef.current.playSoundOnHover) {
    ctx.playWordAudio(msg);
  }
  return true;
}

function handleHoverMessage(msg: any, ctx: BrowserMessageContext): boolean {
  if (msg.type !== 'hover') {
    return false;
  }
  const cfg = ctx.interactionRef.current;
  if (cfg.showPopupOnHover) {
    ctx.presentLookup(msg, false);
  }
  // Popup and pronunciation are independent in jpd-breader.
  if (cfg.playSoundOnHover) {
    ctx.scheduleHoverAudio(msg);
  }
  return true;
}

function handleDismissMessage(msg: any, ctx: BrowserMessageContext): boolean {
  if (msg.type === 'viewportChanged' || msg.type === 'backgroundTap') {
    ctx.dismissLookup();
    return true;
  }
  return false;
}

function handleWordsMessage(msg: any, ctx: BrowserMessageContext): boolean {
  if (msg.type !== 'words') {
    return false;
  }
  if (Array.isArray(msg.words)) {
    ctx.setQuizWords(msg.words);
  } else {
    ctx.setQuizWords([]);
  }
  return true;
}

async function dispatchBrowserMessage(msg: any, ctx: BrowserMessageContext): Promise<void> {
  if (msg.type === 'bridgeReady') {
    await handleBridgeReadyMessage(ctx);
    return;
  }
  if (handleBlockedMessage(msg)) {
    return;
  }
  if (handleParseErrorMessage(msg, ctx)) {
    return;
  }
  if (await handleParseMessage(msg, ctx)) {
    return;
  }
  if (handleLookupMessage(msg, ctx)) {
    return;
  }
  if (handleHoverMessage(msg, ctx)) {
    return;
  }
  if (handleDismissMessage(msg, ctx)) {
    return;
  }
  handleWordsMessage(msg, ctx);
}

// Failures only — floating pill at the top so it never fights the FABs.
function ParseErrorOverlay({ parseError, isDark, colors, topInset, onRetry }: {
  readonly parseError: string | null;
  readonly isDark: boolean;
  readonly colors: any;
  readonly topInset: number;
  readonly onRetry: () => void;
}): React.ReactElement | null {
  if (!parseError) {
    return null;
  }
  return (
    <BlurView intensity={isDark ? 30 : 34} tint={isDark ? 'dark' : 'light'} style={[s.errorPill, { top: topInset, backgroundColor: colors.blurTint, borderColor: colors.separator }]}>
      <Pressable onPress={onRetry} hitSlop={8} accessibilityLabel="Retry parsing" style={s.errorPillButton}>
        <View style={[s.dot, { backgroundColor: colors.error }]} />
        <Text style={[s.statusText, { color: colors.error }]} numberOfLines={1}>
          {`${parseError} · Tap to retry`}
        </Text>
      </Pressable>
    </BlurView>
  );
}

function BlockedAnkiView({ colors, onOpenWiki }: {
  readonly colors: any;
  readonly onOpenWiki: () => void;
}): React.ReactElement {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 10 }}>
      <View style={[s.blockIcon, { backgroundColor: colors.secondaryGroupedBackground }]}>
        <Icon name="book" size={24} color={colors.secondaryLabel} strokeWidth={1.6} />
      </View>
      <Text style={[s.blockTitle, { color: colors.onSurface }]}>Not supported</Text>
      <Text style={[s.blockSub, { color: colors.secondaryLabel }]}>Anki domains are disabled.</Text>
      <Pressable onPress={onOpenWiki} style={[s.capsule, { backgroundColor: colors.primary }]}>
        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Open TTSU Reader</Text>
      </Pressable>
    </View>
  );
}

function shouldUpdateNavigationState(navUrl: string): boolean {
  if (!/^https?:\/\//i.test(navUrl)) {
    return false;
  }
  return !isBlockedAnki(navUrl);
}

// Bottom-right stack: fullscreen and quiz side by side in one row with
// a fixed gap so the two can never overlap and cover less reader text.
function BottomRightActions({ immersive, isDark, colors, rightInset, bottomInset, word, quizWords, url, onToggleReading, onQuiz }: {
  readonly immersive: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly rightInset: number;
  readonly bottomInset: number;
  readonly word: any;
  readonly quizWords: any[] | null;
  readonly url: string;
  readonly onToggleReading: () => void;
  readonly onQuiz: () => void;
}): React.ReactElement | null {
  const showQuiz = !word && !quizWords && !isBlockedAnki(url);
  return (
    <View style={[s.bottomStack, { right: rightInset, bottom: bottomInset }]} pointerEvents="box-none">
      <BrowserFullscreenFab immersive={immersive} isDark={isDark} colors={colors} onPress={onToggleReading} />
      {showQuiz ? (
        <BrowserQuizFab visible isDark={isDark} colors={colors} onPress={onQuiz} />
      ) : null}
    </View>
  );
}

function BrowserFullscreenFab({ immersive, isDark, colors, onPress }: {
  readonly immersive: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly onPress: () => void;
}): React.ReactElement {
  return (
    <BlurView intensity={10} tint={isDark ? 'dark' : 'light'} style={[s.edgeFabStatic, { backgroundColor: colors.blurTint, borderColor: colors.separator }]}>
      <Pressable onPress={onPress} style={({ pressed }) => [s.exitReadingButton, { opacity: pressed ? 0.5 : 1 }]} hitSlop={10} accessibilityRole="button" accessibilityLabel={immersive ? 'Exit full screen reading' : 'Enter full screen reading'}>
        <Icon name={immersive ? 'collapse' : 'expand'} size={17} color={colors.primary} strokeWidth={2.1} />
      </Pressable>
    </BlurView>
  );
}

function LookupSheet({ word, webFrame, onClose, onStateChange }: {
  readonly word: any;
  readonly webFrame: { x: number; y: number; width: number; height: number };
  readonly onClose: () => void;
  readonly onStateChange: (vid: number, sid: number, state: string[]) => void;
}): React.ReactElement | null {
  if (!word) {
    return null;
  }
  let anchor: { x: number; y: number; width: number; height: number } | undefined;
  if (webFrame.width > 0) {
    anchor = webFrame;
  }
  return <WordSheet key={`${word.vid}/${word.sid}`} word={word} anchorFrame={anchor} onClose={onClose} onStateChange={onStateChange} />;
}

function QuizDialog({ quizWords, onClose }: {
  readonly quizWords: any[] | null;
  readonly onClose: () => void;
}): React.ReactElement | null {
  if (!quizWords) {
    return null;
  }
  return <QuizModal words={quizWords} onClose={onClose} />;
}

function statusBarStyle(isDark: boolean): 'light' | 'dark' {
  if (isDark) {
    return 'light';
  }
  return 'dark';
}

function BrowserWebContent({ url, colors, loading, webRef, webFrameRef, onLoadStart, onLoadEnd, onNavState, onMessage, onShouldStart, onMeasure, onOpenWiki }: {
  readonly url: string;
  readonly colors: any;
  readonly loading: boolean;
  readonly webRef: React.RefObject<WebView | null>;
  readonly webFrameRef: React.RefObject<View | null>;
  readonly onLoadStart: () => void;
  readonly onLoadEnd: () => void;
  readonly onNavState: (state: any) => void;
  readonly onMessage: (e: WebViewMessageEvent) => void;
  readonly onShouldStart: (req: any) => boolean;
  readonly onMeasure: () => void;
  readonly onOpenWiki: () => void;
}): React.ReactElement {
  if (isBlockedAnki(url)) {
    return (
      <View ref={webFrameRef} style={{ flex: 1, backgroundColor: colors.background }} onLayout={onMeasure}>
        <BlockedAnkiView colors={colors} onOpenWiki={onOpenWiki} />
      </View>
    );
  }
  return (
    <View ref={webFrameRef} style={{ flex: 1, backgroundColor: colors.background }} onLayout={onMeasure}>
      <WebView
        ref={webRef}
        source={{ uri: url }}
        style={{ flex: 1, backgroundColor: colors.background }}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
        onLoadStart={onLoadStart}
        onLoadEnd={onLoadEnd}
        onNavigationStateChange={onNavState}
        onMessage={onMessage}
        injectedJavaScriptBeforeContentLoaded={BROWSER_JS}
        injectedJavaScript={`(function(){ let s=document.getElementById('yomibako-browser-css'); if(!s){ s=document.createElement('style'); s.id='yomibako-browser-css'; s.textContent=${JSON.stringify(BROWSER_CSS)}; document.head.appendChild(s);} true;})();`}
        onShouldStartLoadWithRequest={onShouldStart}
        {...getIosWebViewProps()}
      />
      <ProgressHairline loading={loading} colors={colors} />
    </View>
  );
}

function ProgressHairline({ loading, colors }: {
  readonly loading: boolean;
  readonly colors: any;
}): React.ReactElement | null {
  if (!loading) {
    return null;
  }
  return (
    <View style={[s.progressBar, { backgroundColor: colors.quaternarySystemFill }]}>
      <View style={[s.progressFill, { backgroundColor: colors.primary }]} />
    </View>
  );
}

function BrowserWebViewArea(args: {
  readonly url: string;
  readonly colors: any;
  readonly loading: boolean;
  readonly webRef: React.RefObject<WebView | null>;
  readonly webFrameRef: React.RefObject<View | null>;
  readonly onLoadStart: () => void;
  readonly onLoadEnd: () => void;
  readonly onNavState: (state: any) => void;
  readonly onMessage: (e: WebViewMessageEvent) => void;
  readonly onShouldStart: (req: any) => boolean;
  readonly onMeasure: () => void;
  readonly onOpenWiki: () => void;
}): React.ReactElement {
  return (
    <BrowserWebContent
      url={args.url}
      colors={args.colors}
      loading={args.loading}
      webRef={args.webRef}
      webFrameRef={args.webFrameRef}
      onLoadStart={args.onLoadStart}
      onLoadEnd={args.onLoadEnd}
      onNavState={args.onNavState}
      onMessage={args.onMessage}
      onShouldStart={args.onShouldStart}
      onMeasure={args.onMeasure}
      onOpenWiki={args.onOpenWiki}
    />
  );
}

function BrowserQuizFab({ visible, isDark, colors, onPress }: {
  readonly visible: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly onPress: () => void;
}): React.ReactElement | null {
  if (!visible) {
    return null;
  }
  return (
    <BlurView
      intensity={10}
      tint={isDark ? 'dark' : 'light'}
      style={[s.fabStatic, { backgroundColor: colors.blurTint, borderColor: colors.separator }]}
    >
      <Pressable onPress={onPress} style={({ pressed }) => [s.fabButton, { opacity: pressed ? 0.5 : 1 }]} hitSlop={10} accessibilityRole="button" accessibilityLabel="Quiz the words on this page">
        <Icon name="repeat" size={18} color={colors.primary} strokeWidth={2} />
      </Pressable>
    </BlurView>
  );
}

export default function BrowserScreen({ route, navigation }: any) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = isDark ? darkColors : lightColors;
  const insets = useSafeAreaInsets();

  // Locked to TTSU — no search UI, no editable URL. Deep links (e.g. JPDB
  // login from Settings) may still swap it via route params.
  const [url, setUrl] = useState(TTSU_URL);
  const [loading, setLoading] = useState(false);
  const [word, setWord] = useState<any>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [webFrame, setWebFrame] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [quizWords, setQuizWords] = useState<any[] | null>(null);
  const webRef = useRef<WebView>(null);
  const webFrameRef = useRef<View>(null);
  const lookupRequest = useRef(0);
  const interactionRef = useRef({ showPopupOnHover: true, playSoundOnHover: false });

  const { cancel: cancelHoverAudio, scheduleHover: scheduleHoverAudio, playNow: playWordAudio } = useWordAudio();

  const dismissLookup = useCallback(() => {
    lookupRequest.current++;
    cancelHoverAudio(true);
    setWord(null);
  }, [cancelHoverAudio]);

  const presentLookup = useCallback((nextWord: any, haptic: boolean) => {
    cancelHoverAudio(true);
    const request = ++lookupRequest.current;
    if (webFrameRef.current) {
      webFrameRef.current.measureInWindow((x, y, width, height) => {
        if (lookupRequest.current !== request) return;
        if (width > 0 && height > 0) setWebFrame({ x, y, width, height });
        setWord(nextWord);
      });
    } else {
      setWord(nextWord);
    }
    if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [cancelHoverAudio]);

  React.useEffect(() => navigation.addListener('blur', dismissLookup), [navigation, dismissLookup]);

  const setReadingMode = useCallback((next: boolean) => {
    dismissLookup();
    setImmersive(next);
    navigation.setParams({ immersive: next });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [navigation, dismissLookup]);

  React.useEffect(() => () => {
    navigation.setParams({ immersive: false });
  }, [navigation]);

  React.useEffect(() => {
    const refresh = () => {
      void loadConfig().then((cfg) => {
        interactionRef.current = {
          showPopupOnHover: cfg.showPopupOnHover !== false,
          playSoundOnHover: !!cfg.playSoundOnHover,
        };
      });
    };
    refresh();
    return navigation.addListener('focus', refresh);
  }, [navigation]);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    void import('expo-navigation-bar')
      .then(({ NavigationBar }) => NavigationBar.setHidden(immersive))
      .catch((error) => console.warn('[Browser] navigation bar unavailable until native rebuild', error));
    return () => {
      void import('expo-navigation-bar')
        .then(({ NavigationBar }) => NavigationBar.setHidden(false))
        .catch(() => {});
    };
  }, [immersive]);

  React.useEffect(() => {
    if (!immersive || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setReadingMode(false);
      return true;
    });
    return () => subscription.remove();
  }, [immersive, setReadingMode]);

  const openUrl = useCallback(
    (next: string) => {
      if (!/^https?:\/\//i.test(next)) {
        return;
      }
      if (isBlockedAnki(next)) {
        Alert.alert('Anki disabled', 'Anki support was removed.');
        return;
      }
      setUrl(next);
      setParseError(null);
      dismissLookup();
      Haptics.selectionAsync();
    },
    [dismissLookup]
  );

  const retryParse = useCallback(() => {
    setParseError(null);
    Haptics.selectionAsync();
    webRef.current?.injectJavaScript('(function(){ try{ window.__yomibakoRetry && window.__yomibakoRetry(); }catch(e){} return true; })();');
  }, []);

  // Deep link: Settings → JPDB Login navigates here with { url }.
  const deepLinkUrl = route?.params?.url;
  React.useEffect(() => {
    if (typeof deepLinkUrl === 'string' && deepLinkUrl && deepLinkUrl !== url) openUrl(deepLinkUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkUrl]);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      await dispatchBrowserMessage(msg, {
        webRef,
        interactionRef,
        setParseError,
        setQuizWords,
        presentLookup,
        dismissLookup,
        playWordAudio,
        scheduleHoverAudio,
      });
    } catch (err) {
      console.warn('[BrowserScreen] onMessage', err);
    }
  }, [dismissLookup, playWordAudio, presentLookup, scheduleHoverAudio]);

  const handleLoadStart = useCallback(() => {
    setLoading(true);
    dismissLookup();
  }, [dismissLookup]);

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
  }, []);

  const handleNavState = useCallback((state: any) => {
    if (!shouldUpdateNavigationState(state.url)) {
      return;
    }
    setUrl(state.url);
  }, []);

  const handleShouldStart = useCallback((req: any) => {
    if (isBlockedAnki(req.url)) {
      Alert.alert('Anki blocked', 'Anki domains are disabled.');
      return false;
    }
    return true;
  }, []);

  const handleMeasureFrame = useCallback(() => {
    webFrameRef.current?.measureInWindow((x, y, width, height) => {
      setWebFrame((prev) => {
        if (prev.x === x && prev.y === y && prev.width === width && prev.height === height) {
          return prev;
        }
        return { x, y, width, height };
      });
    });
  }, []);

  const handleOpenWiki = useCallback(() => {
    openUrl(TTSU_URL);
  }, [openUrl]);

  const updateCardState = useCallback((vid: number, sid: number, state: string[]) => {
    webRef.current?.injectJavaScript(
      `window.__yomibakoSetCardState && window.__yomibakoSetCardState(${Number(vid)},${Number(sid)},${JSON.stringify(state)}); true;`
    );
  }, []);

  // The page already holds every parsed card, so the quiz just asks for them.
  // quizWords stays null until the WebView answers, which is what opens it.
  // A page whose bundle never ran answers with an empty set, so the button is
  // never dead — the quiz explains why there is nothing to ask.
  const startQuiz = useCallback(() => {
    dismissLookup();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    webRef.current?.injectJavaScript(
      'window.__yomibakoCollectWords ? window.__yomibakoCollectWords()' +
        ' : (window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:"words",words:[]}))); true;'
    );
  }, [dismissLookup]);

  return (
    <View style={[s.root, { backgroundColor: colors.groupedBackground, paddingTop: insets.top }]}>
      <StatusBar style={statusBarStyle(isDark)} hidden={immersive} animated />
      {/* TTSU reader only — no search, no bottom bars */}
      <BrowserWebViewArea
        url={url}
        colors={colors}
        loading={loading}
        webRef={webRef}
        webFrameRef={webFrameRef}
        onLoadStart={handleLoadStart}
        onLoadEnd={handleLoadEnd}
        onNavState={handleNavState}
        onMessage={onMessage}
        onShouldStart={handleShouldStart}
        onMeasure={handleMeasureFrame}
        onOpenWiki={handleOpenWiki}
      />

      <ParseErrorOverlay
        parseError={parseError}
        isDark={isDark}
        colors={colors}
        topInset={10}
        onRetry={retryParse}
      />

      {/* Bottom-right stack: fullscreen + quiz side by side, fixed gap, no overlap.
          Tab bar already clears the system gesture area, so only add the
          safe-area inset in immersive (tab bar hidden) — otherwise foldables
          get double spacing and the buttons float too high. */}
      <BottomRightActions
        immersive={immersive}
        isDark={isDark}
        colors={colors}
        rightInset={Math.max(insets.right, 12)}
        bottomInset={immersive ? Math.max(insets.bottom, 8) : 8}
        word={word}
        quizWords={quizWords}
        url={url}
        onToggleReading={() => setReadingMode(!immersive)}
        onQuiz={startQuiz}
      />

      <LookupSheet word={word} webFrame={webFrame} onClose={dismissLookup} onStateChange={updateCardState} />

      <QuizDialog quizWords={quizWords} onClose={() => setQuizWords(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  errorPill: {
    position: 'absolute',
    alignSelf: 'center',
    top: 10,
    maxWidth: '90%',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    zIndex: 50,
    boxShadow: '0 5px 16px rgba(0,0,0,0.22)',
  },
  errorPillButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: 'System', fontSize: 12, fontWeight: '400' as const, letterSpacing: 0 },
  blockIcon: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  blockTitle: { fontFamily: 'System', fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.3 },
  blockSub: { fontFamily: 'System', fontSize: 14, fontWeight: '400' as const, textAlign: 'center' as const, maxWidth: 280, lineHeight: 19 },
  capsule: { marginTop: 10, paddingHorizontal: 22, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' as any },
  progressBar: { height: 2, width: '100%' },
  progressFill: { flex: 1, height: 2, width: '62%' },
  bottomStack: { position: 'absolute', zIndex: 45, flexDirection: 'row', alignItems: 'center', gap: 10 },
  edgeFabStatic: { width: 42, height: 42, borderRadius: 21, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', opacity: 0.45, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  exitReadingButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fabStatic: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.45,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  },
  fabButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
