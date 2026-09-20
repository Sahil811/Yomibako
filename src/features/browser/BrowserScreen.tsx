import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, useColorScheme, Alert, ScrollView, Platform, BackHandler } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { darkColors, lightColors } from '../../theme/colors';
import { Icon, type IconName } from '../../components/ui/Icon';
import { getItemAsync } from '../../services/storage';
import { jpdbApi } from '../../services/jpdb/api';
import { loadConfig } from '../../services/jpdb/config';
import { useWordAudio } from '../shared/useWordAudio';
import { BROWSER_CSS, BROWSER_JS } from './browserBundle';
import WordSheet from '../reader/WordSheet';
import QuizModal from '../quiz/QuizModal';

const QUICK_TILES: { label: string; url: string; icon: IconName }[] = [
  { label: 'TTSU', url: 'https://reader.ttsu.app/', icon: 'bookOpen' },
  { label: 'Wikipedia', url: 'https://ja.wikipedia.org/wiki/日本語', icon: 'book' },
  { label: 'Syosetu', url: 'https://ncode.syosetu.com/n9669bk/', icon: 'file' },
  { label: 'Readwok', url: 'https://app.readwok.com/', icon: 'library' },
  { label: 'Bunpro', url: 'https://bunpro.jp/', icon: 'lang' },
  { label: 'NHK News', url: 'https://www3.nhk.or.jp/news/', icon: 'browser' },
  { label: 'JPDB', url: 'https://jpdb.io/', icon: 'book' },
  { label: 'Texthooker', url: 'https://anacreondjt.gitlab.io/texthooker.html', icon: 'file' },
];

const BLOCKED_ANKI = ['ankiuser.net', 'ankiweb.net'];
function isBlockedAnki(url: string): boolean {
  return BLOCKED_ANKI.some((d) => url.toLowerCase().includes(d));
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function BrowserScreen({ route, navigation }: any) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = isDark ? darkColors : lightColors;
  const insets = useSafeAreaInsets();

  const [url, setUrl] = useState('https://reader.ttsu.app/');
  const [input, setInput] = useState(url);
  const [isFocused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [word, setWord] = useState<any>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [parseCount, setParseCount] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [webFrame, setWebFrame] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [quizWords, setQuizWords] = useState<any[] | null>(null);
  /** Measured so the floating quiz button can clear the bottom toolbar. */
  const [toolbarH, setToolbarH] = useState(58);
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
    setFocused(false);
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

  const navigate = useCallback(
    (next: string) => {
      let nextUrl = next.trim();
      if (!nextUrl) return;
      if (!/^https?:\/\//i.test(nextUrl)) nextUrl = 'https://' + nextUrl;
      if (isBlockedAnki(nextUrl)) {
        Alert.alert('Anki disabled', 'Anki support was removed.');
        return;
      }
      setUrl(nextUrl);
      setInput(nextUrl);
      setBridgeReady(false);
      setParseCount(0);
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
    if (typeof deepLinkUrl === 'string' && deepLinkUrl && deepLinkUrl !== url) navigate(deepLinkUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkUrl]);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'bridgeReady') {
        setBridgeReady(true);
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
            interactionRef.current = {
              showPopupOnHover: cfg.showPopupOnHover !== false,
              playSoundOnHover: !!cfg.playSoundOnHover,
            };
          } catch {}
        }
        const cssInject = `(function(){
          let s=document.getElementById('yomibako-browser-css'); if(!s){ s=document.createElement('style'); s.id='yomibako-browser-css'; s.textContent=${JSON.stringify(BROWSER_CSS)}; document.head.appendChild(s);}
          ${customWordCSS ? `let cw=document.getElementById('yomibako-custom-word'); if(!cw){ cw=document.createElement('style'); cw.id='yomibako-custom-word'; cw.textContent=${JSON.stringify(customWordCSS)}; document.head.appendChild(cw); }` : ''}
          ${customPopupCSS ? `let cp=document.getElementById('yomibako-custom-popup'); if(!cp){ cp=document.createElement('style'); cp.id='yomibako-custom-popup'; cp.textContent=${JSON.stringify(customPopupCSS)}; document.head.appendChild(cp); }` : ''}
          ${disableFade ? `document.documentElement.style.setProperty('--jpdb-fade-duration','0s');` : ''}
          true;})();`;
        webRef.current?.injectJavaScript(cssInject);
        return;
      }
      if (msg.type === 'blocked' && msg.reason === 'anki') {
        Alert.alert('Anki blocked', 'Anki domains are disabled.');
        return;
      }
      if (msg.type === 'parseError') {
        setParseError(typeof msg.error === 'string' && msg.error ? msg.error : 'Parse failed');
        return;
      }
      if (msg.type === 'parse') {
        const texts: string[] = msg.texts.map((t: any) => t[1]);
        const id = msg.id;
        const token = await getItemAsync('jpdb_token');
        let apiToken = token;
        if (!apiToken) {
          const raw = await getItemAsync('yomibako_config_json');
          if (raw) {
            try {
              apiToken = JSON.parse(raw).apiToken;
            } catch {}
          }
        }
        if (!apiToken) {
          setParseError('Missing JPDB token — set it in Settings');
          webRef.current?.injectJavaScript(`window.__yomibakoOnError(${JSON.stringify(id)}, 'Missing JPDB token — Settings'); true;`);
          return;
        }
        try {
          const { tokens } = await jpdbApi.parse({ text: texts, apiToken });
          const payload = JSON.stringify(tokens);
          webRef.current?.injectJavaScript(`window.__yomibakoOnTokens(${JSON.stringify(id)}, ${payload}); true;`);
          setParseCount((c) => c + 1);
          setParseError(null);
        } catch (err: any) {
          setParseError(err?.message ? String(err.message).slice(0, 120) : 'Parse failed');
          webRef.current?.injectJavaScript(`window.__yomibakoOnError(${JSON.stringify(id)}, ${JSON.stringify(err.message)}); true;`);
        }
      }
      if (msg.type === 'lookup') {
        presentLookup(msg, true);
        // A tap is a deliberate selection — pronounce it immediately, with no
        // hover debounce. presentLookup already stopped any prior audio.
        if (interactionRef.current.playSoundOnHover) playWordAudio(msg);
      }
      if (msg.type === 'hover') {
        const cfg = interactionRef.current;
        if (cfg.showPopupOnHover) presentLookup(msg, false);
        // Popup and pronunciation are independent in jpd-breader.
        if (cfg.playSoundOnHover) scheduleHoverAudio(msg);
      }
      if (msg.type === 'viewportChanged' || msg.type === 'backgroundTap') dismissLookup();
      if (msg.type === 'words') setQuizWords(Array.isArray(msg.words) ? msg.words : []);
    } catch (err) {
      console.warn('[BrowserScreen] onMessage', err);
    }
  }, [dismissLookup, playWordAudio, presentLookup, scheduleHoverAudio]);

  const goBack = useCallback(() => {
    dismissLookup();
    webRef.current?.goBack();
    Haptics.selectionAsync();
  }, [dismissLookup]);
  const goForward = useCallback(() => {
    dismissLookup();
    webRef.current?.goForward();
    Haptics.selectionAsync();
  }, [dismissLookup]);
  const reload = useCallback(() => {
    dismissLookup();
    webRef.current?.reload();
    setBridgeReady(false);
    setParseCount(0);
    setParseError(null);
    Haptics.selectionAsync();
  }, [dismissLookup]);
  const navigateUnknown = (dir: number) => {
    webRef.current?.injectJavaScript(`window.__yomibakoNavigateUnknown && window.__yomibakoNavigateUnknown(${dir}); true;`);
    Haptics.selectionAsync();
  };

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
    <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} hidden={immersive} animated />
      {/* Safari-like top bar with blur */}
      {!immersive ? <BlurView intensity={isDark ? 32 : 36} tint={isDark ? 'dark' : 'light'} style={[s.topBar, { paddingTop: insets.top + 8, borderBottomColor: colors.separator, backgroundColor: colors.blurTint }]}>
        <View style={s.topBarRow}>
          <Pressable onPress={goBack} style={({ pressed }) => [s.iconBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} hitSlop={8} accessibilityLabel="Back">
            <Icon name="chevronLeft" size={22} color={colors.primary} strokeWidth={2.2} />
          </Pressable>
          <Pressable onPress={goForward} style={({ pressed }) => [s.iconBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} hitSlop={8} accessibilityLabel="Forward">
            <Icon name="chevronRight" size={22} color={colors.primary} strokeWidth={2.2} />
          </Pressable>

          {/* Pill URL bar — Safari */}
          <View style={[s.urlPill, { backgroundColor: isFocused ? colors.background : (isDark ? colors.surfaceContainer : '#E8E8ED'), borderColor: isFocused ? colors.primary : 'transparent', boxShadow: isFocused ? '0 0 0 3px rgba(0,122,255,0.15)' : '0 0 0 rgba(0,0,0,0)' }]}>
            <Icon name="lock" size={11} color={colors.success} strokeWidth={2.4} />
            <TextInput
              value={isFocused ? input : domainOf(url)}
              onChangeText={setInput}
              onFocus={() => {
                setFocused(true);
                setInput(url);
              }}
              onBlur={() => setFocused(false)}
              onSubmitEditing={() => navigate(input)}
              placeholder="Search or enter website"
              placeholderTextColor={colors.tertiaryLabel}
              style={[s.urlInput, { color: colors.onSurface }]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              selectTextOnFocus
              numberOfLines={1}
            />
            {isFocused && input.length > 0 ? (
              <Pressable onPress={() => setInput('')} hitSlop={8} accessibilityLabel="Clear">
                <View style={[s.clearPill, { backgroundColor: colors.secondaryLabel }]}>
                  <Icon name="close" size={9} color="#fff" strokeWidth={2.8} />
                </View>
              </Pressable>
            ) : !isFocused ? (
              <Pressable onPress={reload} hitSlop={8} accessibilityLabel="Reload">
                <Icon name="reload" size={13} color={colors.secondaryLabel} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>

          <Pressable onPress={isFocused ? () => navigate(input) : () => setReadingMode(true)} style={({ pressed }) => [s.goPill, { backgroundColor: isFocused ? colors.primary : (pressed ? colors.systemFill : colors.secondarySystemFill) }]} hitSlop={6} accessibilityLabel={isFocused ? 'Go' : 'Enter full screen reading'}>
            {isFocused ? <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Go</Text> : <Icon name="expand" size={15} color={colors.primary} strokeWidth={2.1} />}
          </Pressable>
        </View>

        {/* Parse status — tappable to retry after failures */}
        <Pressable onPress={parseError ? retryParse : undefined} hitSlop={8} accessibilityLabel={parseError ? 'Retry parsing' : 'Parse status'}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 6 }}>
            <View style={[s.dot, { backgroundColor: parseError ? colors.error : bridgeReady ? colors.success : colors.warning }]} />
            <Text style={[s.statusText, { color: parseError ? colors.error : colors.secondaryLabel }]} numberOfLines={1}>
              {parseError
                ? `${parseError} · Tap to retry`
                : bridgeReady
                  ? (parseCount > 0 ? `${parseCount} parsed · Tap a word` : 'Ready · Tap a word')
                  : 'Preparing parser…'}
            </Text>
          </View>
        </Pressable>
      </BlurView> : null}

      {/* Quick tiles — Safari start page */}
      {!immersive ? <View style={[s.tilesBar, { backgroundColor: colors.groupedBackground }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}>
          {QUICK_TILES.map((t) => {
            const active = url === t.url;
            return (
              <Pressable
                key={t.label}
                onPress={() => navigate(t.url)}
                style={({ pressed }) => [s.tile, { backgroundColor: active ? colors.primary : colors.secondaryGroupedBackground, opacity: pressed ? 0.86 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
              >
                <View style={[s.tileIcon, { backgroundColor: active ? 'rgba(255,255,255,0.22)' : colors.tertiarySystemFill }]}>
                  <Icon name={t.icon} size={12} color={active ? '#fff' : colors.secondaryLabel} strokeWidth={2} />
                </View>
                <Text style={[s.tileLabel, { color: active ? '#fff' : colors.onSurface }]} numberOfLines={1}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View> : null}

      {/* WebView */}
      <View
        ref={webFrameRef}
        style={{ flex: 1, backgroundColor: colors.background }}
        onLayout={() => {
          webFrameRef.current?.measureInWindow((x, y, width, height) => {
            setWebFrame((prev) => prev.x === x && prev.y === y && prev.width === width && prev.height === height ? prev : { x, y, width, height });
          });
        }}
      >
        {isBlockedAnki(url) ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 10 }}>
            <View style={[s.blockIcon, { backgroundColor: colors.secondaryGroupedBackground }]}>
              <Icon name="book" size={24} color={colors.secondaryLabel} strokeWidth={1.6} />
            </View>
            <Text style={[s.blockTitle, { color: colors.onSurface }]}>Not supported</Text>
            <Text style={[s.blockSub, { color: colors.secondaryLabel }]}>Anki domains are disabled. Choose another source.</Text>
            <Pressable onPress={() => navigate('https://ja.wikipedia.org/wiki/日本語')} style={[s.capsule, { backgroundColor: colors.primary }]}>
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Open Wikipedia</Text>
            </Pressable>
          </View>
        ) : (
          <>
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
              onLoadStart={() => { setLoading(true); dismissLookup(); }}
              onLoadEnd={() => setLoading(false)}
              onNavigationStateChange={(state) => {
                if (/^https?:\/\//i.test(state.url) && !isBlockedAnki(state.url)) {
                  setUrl(state.url);
                  if (!isFocused) setInput(state.url);
                }
              }}
              onMessage={onMessage}
              injectedJavaScriptBeforeContentLoaded={BROWSER_JS}
              injectedJavaScript={`(function(){ let s=document.getElementById('yomibako-browser-css'); if(!s){ s=document.createElement('style'); s.id='yomibako-browser-css'; s.textContent=${JSON.stringify(BROWSER_CSS)}; document.head.appendChild(s);} true;})();`}
              onShouldStartLoadWithRequest={(req) => {
                if (isBlockedAnki(req.url)) {
                  Alert.alert('Anki blocked', 'Anki domains are disabled.');
                  return false;
                }
                return true;
              }}
              {...(Platform.OS === 'ios' ? { decelerationRate: 'normal' as const } : {})}
              {...(Platform.OS === 'ios' ? { allowsBackForwardNavigationGestures: true } : {})}
            />
            {/* Progress hairline */}
            {loading ? (
              <View style={[s.progressBar, { backgroundColor: colors.quaternarySystemFill }]}>
                <View style={[s.progressFill, { backgroundColor: colors.primary }]} />
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Bottom toolbar — Safari */}
      {!immersive ? <BlurView intensity={isDark ? 28 : 32} tint={isDark ? 'dark' : 'light'} onLayout={(e) => setToolbarH(e.nativeEvent.layout.height)} style={[s.toolbar, { paddingBottom: Math.max(insets.bottom, 10), borderTopColor: colors.separator, backgroundColor: colors.blurTint }]}>
        <Pressable onPress={() => navigateUnknown(-1)} style={({ pressed }) => [s.toolBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} hitSlop={8}>
          <Icon name="chevronLeft" size={16} color={colors.primary} strokeWidth={2.2} />
          <Text style={[s.toolLabel, { color: colors.primary }]}>Prev</Text>
        </Pressable>

        <View style={{ flex: 1, alignItems: 'center', gap: 1 }}>
          <Text style={[s.toolCenterLabel, { color: colors.secondaryLabel }]}>{parseCount > 0 ? `${parseCount} parsed` : 'Tap a word'}</Text>
          <Text style={[s.toolCenterSub, { color: colors.tertiaryLabel }]}>Dictionary lookup</Text>
        </View>

        <Pressable onPress={() => navigateUnknown(1)} style={({ pressed }) => [s.toolBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} hitSlop={8}>
          <Text style={[s.toolLabel, { color: colors.primary }]}>Next</Text>
          <Icon name="chevronRight" size={16} color={colors.primary} strokeWidth={2.2} />
        </Pressable>

        <View style={[s.vSeparator, { backgroundColor: colors.separator }]} />

        <Pressable
          onPress={async () => {
            const token = await getItemAsync('jpdb_token');
            if (!token) {
              const raw = await getItemAsync('yomibako_config_json');
              const cfgToken = raw ? JSON.parse(raw).apiToken : null;
              if (!cfgToken) {
                Alert.alert('No token', 'Set JPDB API token in Settings to enable parsing.');
                return;
              }
            }
            Alert.alert('Parser', bridgeReady ? `Ready · ${parseCount} parsed` : 'Loading…');
          }}
          style={({ pressed }) => [s.infoBtn, { backgroundColor: pressed ? colors.systemFill : colors.secondarySystemFill }]}
          hitSlop={8}
          accessibilityLabel="Parser info"
        >
          <Icon name="info" size={15} color={colors.secondaryLabel} strokeWidth={2} />
        </Pressable>
      </BlurView> : null}

      {immersive ? (
        <BlurView intensity={28} tint={isDark ? 'dark' : 'light'} style={[s.exitReading, { top: insets.top + 10, right: Math.max(insets.right, 10), backgroundColor: colors.blurTint, borderColor: colors.separator }]}>
          <Pressable onPress={() => setReadingMode(false)} style={({ pressed }) => [s.exitReadingButton, { opacity: pressed ? 0.65 : 1 }]} accessibilityLabel="Exit full screen reading">
            <Icon name="collapse" size={17} color={colors.primary} strokeWidth={2.1} />
          </Pressable>
        </BlurView>
      ) : null}

      {/* Quiz is one tap from anywhere on the page, within thumb reach, and
          sits clear of the bottom toolbar when that is showing. */}
      {!word && !quizWords && !isBlockedAnki(url) ? (
        <BlurView
          intensity={isDark ? 30 : 34}
          tint={isDark ? 'dark' : 'light'}
          style={[
            s.fab,
            {
              backgroundColor: colors.blurTint,
              borderColor: colors.separator,
              right: Math.max(insets.right, 14),
              bottom: immersive ? Math.max(insets.bottom, 14) : toolbarH + 12,
            },
          ]}
        >
          <Pressable
            onPress={startQuiz}
            style={({ pressed }) => [s.fabButton, { opacity: pressed ? 0.55 : 1 }]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Quiz the words on this page"
          >
            <Icon name="repeat" size={18} color={colors.primary} strokeWidth={2} />
          </Pressable>
        </BlurView>
      ) : null}

      {word ? (
        <WordSheet
          key={`${word.vid}/${word.sid}`}
          word={word}
          anchorFrame={webFrame.width > 0 ? webFrame : undefined}
          onClose={dismissLookup}
          onStateChange={updateCardState}
        />
      ) : null}

      {quizWords ? (
        <QuizModal words={quizWords} onClose={() => setQuizWords(null)} />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  topBarRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  urlPill: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderCurve: 'continuous' as any,
  },
  urlInput: { flex: 1, fontFamily: 'System', fontSize: 15, fontWeight: '400' as const, paddingVertical: 0, letterSpacing: -0.2 },
  clearPill: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  goPill: { minWidth: 38, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: 'System', fontSize: 12, fontWeight: '400' as const, letterSpacing: 0 },
  tilesBar: {
    height: 50,
    justifyContent: 'center',
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
  },
  tileIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: 'System', fontSize: 13, fontWeight: '600' as const, letterSpacing: -0.1 },
  blockIcon: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  blockTitle: { fontFamily: 'System', fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.3 },
  blockSub: { fontFamily: 'System', fontSize: 14, fontWeight: '400' as const, textAlign: 'center' as const, maxWidth: 280, lineHeight: 19 },
  capsule: { marginTop: 10, paddingHorizontal: 22, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' as any },
  progressBar: { height: 2, width: '100%' },
  progressFill: { flex: 1, height: 2, width: '62%' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 34, borderRadius: 17 },
  toolLabel: { fontFamily: 'System', fontSize: 14, fontWeight: '600' as const, letterSpacing: -0.15 },
  toolCenterLabel: { fontFamily: 'System', fontSize: 12, fontWeight: '600' as const },
  toolCenterSub: { fontFamily: 'System', fontSize: 11, fontWeight: '400' as const },
  vSeparator: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 2, opacity: 0.8 },
  infoBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  exitReading: { position: 'absolute', zIndex: 40, width: 42, height: 42, borderRadius: 21, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', boxShadow: '0 5px 18px rgba(0,0,0,0.28)' },
  exitReadingButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    zIndex: 45,
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: '0 5px 16px rgba(0,0,0,0.22)',
  },
  fabButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
