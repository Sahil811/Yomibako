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

function urlPillBackground(isFocused: boolean, isDark: boolean, colors: any): string {
  if (isFocused) {
    return colors.background;
  }
  if (isDark) {
    return colors.surfaceContainer;
  }
  return '#E8E8ED';
}

function urlPillBorder(isFocused: boolean, colors: any): string {
  if (isFocused) {
    return colors.primary;
  }
  return 'transparent';
}

function urlPillShadow(isFocused: boolean): string {
  if (isFocused) {
    return '0 0 0 3px rgba(0,122,255,0.15)';
  }
  return '0 0 0 rgba(0,0,0,0)';
}

function urlBarDisplayValue(isFocused: boolean, input: string, url: string): string {
  if (isFocused) {
    return input;
  }
  return domainOf(url);
}

function goPillBackground(isFocused: boolean, pressed: boolean, colors: any): string {
  if (isFocused) {
    return colors.primary;
  }
  if (pressed) {
    return colors.systemFill;
  }
  return colors.secondarySystemFill;
}

function parseDotColor(parseError: string | null, bridgeReady: boolean, colors: any): string {
  if (parseError) {
    return colors.error;
  }
  if (bridgeReady) {
    return colors.success;
  }
  return colors.warning;
}

function parseStatusText(parseError: string | null, bridgeReady: boolean, parseCount: number): string {
  if (parseError) {
    return `${parseError} · Tap to retry`;
  }
  if (!bridgeReady) {
    return 'Preparing parser…';
  }
  if (parseCount > 0) {
    return `${parseCount} parsed · Tap a word`;
  }
  return 'Ready · Tap a word';
}

function parseStatusColor(parseError: string | null, colors: any): string {
  if (parseError) {
    return colors.error;
  }
  return colors.secondaryLabel;
}

function toolbarCenterText(parseCount: number): string {
  if (parseCount > 0) {
    return `${parseCount} parsed`;
  }
  return 'Tap a word';
}

function getIosWebViewProps(): object {
  if (Platform.OS === 'ios') {
    return { decelerationRate: 'normal' as const, allowsBackForwardNavigationGestures: true };
  }
  return {};
}

function normalizeNavigateUrl(next: string): string | null {
  const trimmed = next.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return 'https://' + trimmed;
}

function buildCustomWordInject(customWordCSS: string): string {
  if (!customWordCSS) {
    return '';
  }
  return `let cw=document.getElementById('yomibako-custom-word'); if(!cw){ cw=document.createElement('style'); cw.id='yomibako-custom-word'; cw.textContent=${JSON.stringify(customWordCSS)}; document.head.appendChild(cw); }`;
}

function buildCustomPopupInject(customPopupCSS: string): string {
  if (!customPopupCSS) {
    return '';
  }
  return `let cp=document.getElementById('yomibako-custom-popup'); if(!cp){ cp=document.createElement('style'); cp.id='yomibako-custom-popup'; cp.textContent=${JSON.stringify(customPopupCSS)}; document.head.appendChild(cp); }`;
}

function buildFadeInject(disableFade: boolean): string {
  if (!disableFade) {
    return '';
  }
  return `document.documentElement.style.setProperty('--jpdb-fade-duration','0s');`;
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

type BridgeCustomization = { customWordCSS: string; customPopupCSS: string; disableFade: boolean };

async function loadBridgeCustomization(interactionRef: React.RefObject<{ showPopupOnHover: boolean; playSoundOnHover: boolean }>): Promise<BridgeCustomization> {
  const result: BridgeCustomization = { customWordCSS: '', customPopupCSS: '', disableFade: false };
  const cfgRaw = await getItemAsync('yomibako_config_json');
  if (!cfgRaw) {
    return result;
  }
  try {
    const cfg = JSON.parse(cfgRaw);
    result.customWordCSS = cfg.customWordCSS || '';
    result.customPopupCSS = cfg.customPopupCSS || '';
    result.disableFade = !!cfg.disableFadeAnimation;
    interactionRef.current = {
      showPopupOnHover: cfg.showPopupOnHover !== false,
      playSoundOnHover: !!cfg.playSoundOnHover,
    };
  } catch {
    // Keep defaults.
  }
  return result;
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
  setBridgeReady: (v: boolean) => void;
  setParseCount: React.Dispatch<React.SetStateAction<number>>;
  setParseError: (v: string | null) => void;
  setQuizWords: (v: any[] | null) => void;
  presentLookup: (msg: any, haptic: boolean) => void;
  dismissLookup: () => void;
  playWordAudio: (msg: any) => void;
  scheduleHoverAudio: (msg: any) => void;
};

async function handleBridgeReadyMessage(ctx: BrowserMessageContext): Promise<void> {
  ctx.setBridgeReady(true);
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
    const payload = JSON.stringify(tokens);
    ctx.webRef.current?.injectJavaScript(`window.__yomibakoOnTokens(${JSON.stringify(id)}, ${payload}); true;`);
    ctx.setParseCount((c) => c + 1);
    ctx.setParseError(null);
  } catch (err: any) {
    ctx.setParseError(parseErrorText(err));
    ctx.webRef.current?.injectJavaScript(`window.__yomibakoOnError(${JSON.stringify(id)}, ${JSON.stringify(err.message)}); true;`);
  }
  return true;
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

function UrlBarAction({ isFocused, input, colors, onClear, onReload }: {
  readonly isFocused: boolean;
  readonly input: string;
  readonly colors: any;
  readonly onClear: () => void;
  readonly onReload: () => void;
}): React.ReactElement | null {
  if (isFocused && input.length > 0) {
    return (
      <Pressable onPress={onClear} hitSlop={8} accessibilityLabel="Clear">
        <View style={[s.clearPill, { backgroundColor: colors.secondaryLabel }]}>
          <Icon name="close" size={9} color="#fff" strokeWidth={2.8} />
        </View>
      </Pressable>
    );
  }
  if (!isFocused) {
    return (
      <Pressable onPress={onReload} hitSlop={8} accessibilityLabel="Reload">
        <Icon name="reload" size={13} color={colors.secondaryLabel} strokeWidth={2} />
      </Pressable>
    );
  }
  return null;
}

function GoButtonContent({ isFocused, colors }: {
  readonly isFocused: boolean;
  readonly colors: any;
}): React.ReactElement {
  if (isFocused) {
    return <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Go</Text>;
  }
  return <Icon name="expand" size={15} color={colors.primary} strokeWidth={2.1} />;
}

function goButtonLabel(isFocused: boolean): string {
  if (isFocused) {
    return 'Go';
  }
  return 'Enter full screen reading';
}

function handleGoPress(isFocused: boolean, input: string, navigate: (u: string) => void, setReadingMode: (v: boolean) => void): void {
  if (isFocused) {
    navigate(input);
    return;
  }
  setReadingMode(true);
}

function TopUrlBar({ isFocused, isDark, colors, input, url, onInput, onFocusUrl, onBlur, onNavigate, onClear, onReload, onGo, setReadingMode, navigate }: {
  readonly isFocused: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly input: string;
  readonly url: string;
  readonly onInput: (v: string) => void;
  readonly onFocusUrl: () => void;
  readonly onBlur: () => void;
  readonly onNavigate: (v: string) => void;
  readonly onClear: () => void;
  readonly onReload: () => void;
  readonly onGo: () => void;
  readonly setReadingMode: (v: boolean) => void;
  readonly navigate: (u: string) => void;
}): React.ReactElement {
  return (
    <View style={[s.urlPill, { backgroundColor: urlPillBackground(isFocused, isDark, colors), borderColor: urlPillBorder(isFocused, colors), boxShadow: urlPillShadow(isFocused) }]}>
      <Icon name="lock" size={11} color={colors.success} strokeWidth={2.4} />
      <TextInput
        value={urlBarDisplayValue(isFocused, input, url)}
        onChangeText={onInput}
        onFocus={onFocusUrl}
        onBlur={onBlur}
        onSubmitEditing={() => onNavigate(input)}
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
      <UrlBarAction isFocused={isFocused} input={input} colors={colors} onClear={onClear} onReload={onReload} />
    </View>
  );
}

function ParseStatusBar({ parseError, bridgeReady, parseCount, colors, onRetry }: {
  readonly parseError: string | null;
  readonly bridgeReady: boolean;
  readonly parseCount: number;
  readonly colors: any;
  readonly onRetry: () => void;
}): React.ReactElement {
  let accessibilityLabel = 'Parse status';
  if (parseError) {
    accessibilityLabel = 'Retry parsing';
  }
  return (
    <Pressable onPress={parseError ? onRetry : undefined} hitSlop={8} accessibilityLabel={accessibilityLabel}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 6 }}>
        <View style={[s.dot, { backgroundColor: parseDotColor(parseError, bridgeReady, colors) }]} />
        <Text style={[s.statusText, { color: parseStatusColor(parseError, colors) }]} numberOfLines={1}>
          {parseStatusText(parseError, bridgeReady, parseCount)}
        </Text>
      </View>
    </Pressable>
  );
}

function BrowserTopBar({ isDark, colors, topPad, isFocused, input, url, parseError, bridgeReady, parseCount, onBack, onForward, onInput, onFocusUrl, onBlur, onNavigate, onClear, onReload, onGoPress, goLabel, onRetry }: {
  readonly isDark: boolean;
  readonly colors: any;
  readonly topPad: number;
  readonly isFocused: boolean;
  readonly input: string;
  readonly url: string;
  readonly parseError: string | null;
  readonly bridgeReady: boolean;
  readonly parseCount: number;
  readonly onBack: () => void;
  readonly onForward: () => void;
  readonly onInput: (v: string) => void;
  readonly onFocusUrl: () => void;
  readonly onBlur: () => void;
  readonly onNavigate: (v: string) => void;
  readonly onClear: () => void;
  readonly onReload: () => void;
  readonly onGoPress: () => void;
  readonly goLabel: string;
  readonly onRetry: () => void;
}): React.ReactElement {
  return (
    <BlurView intensity={isDark ? 32 : 36} tint={isDark ? 'dark' : 'light'} style={[s.topBar, { paddingTop: topPad, borderBottomColor: colors.separator, backgroundColor: colors.blurTint }]}>
      <View style={s.topBarRow}>
        <Pressable onPress={onBack} style={({ pressed }) => [s.iconBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} hitSlop={8} accessibilityLabel="Back">
          <Icon name="chevronLeft" size={22} color={colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Pressable onPress={onForward} style={({ pressed }) => [s.iconBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} hitSlop={8} accessibilityLabel="Forward">
          <Icon name="chevronRight" size={22} color={colors.primary} strokeWidth={2.2} />
        </Pressable>
        <TopUrlBar
          isFocused={isFocused}
          isDark={isDark}
          colors={colors}
          input={input}
          url={url}
          onInput={onInput}
          onFocusUrl={onFocusUrl}
          onBlur={onBlur}
          onNavigate={onNavigate}
          onClear={onClear}
          onReload={onReload}
          onGo={onGoPress}
          setReadingMode={() => {}}
          navigate={() => {}}
        />
        <GoPill isFocused={isFocused} colors={colors} goLabel={goLabel} onPress={onGoPress} />
      </View>
      <ParseStatusBar parseError={parseError} bridgeReady={bridgeReady} parseCount={parseCount} colors={colors} onRetry={onRetry} />
    </BlurView>
  );
}

function GoPill({ isFocused, colors, goLabel, onPress }: {
  readonly isFocused: boolean;
  readonly colors: any;
  readonly goLabel: string;
  readonly onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.goPill, { backgroundColor: goPillBackground(isFocused, pressed, colors) }]} hitSlop={6} accessibilityLabel={goLabel}>
      <GoButtonContent isFocused={isFocused} colors={colors} />
    </Pressable>
  );
}

function QuickTilesBar({ url, colors, groupedBackground, onNavigate }: {
  readonly url: string;
  readonly colors: any;
  readonly groupedBackground: string;
  readonly onNavigate: (u: string) => void;
}): React.ReactElement {
  return (
    <View style={[s.tilesBar, { backgroundColor: groupedBackground }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}>
        {QUICK_TILES.map((t) => (
          <QuickTile key={t.label} label={t.label} tileUrl={t.url} icon={t.icon} active={url === t.url} colors={colors} onNavigate={onNavigate} />
        ))}
      </ScrollView>
    </View>
  );
}

function QuickTile({ label, tileUrl, icon, active, colors, onNavigate }: {
  readonly label: string;
  readonly tileUrl: string;
  readonly icon: IconName;
  readonly active: boolean;
  readonly colors: any;
  readonly onNavigate: (u: string) => void;
}): React.ReactElement {
  return (
    <Pressable
      key={label}
      onPress={() => onNavigate(tileUrl)}
      style={({ pressed }) => [s.tile, { backgroundColor: active ? colors.primary : colors.secondaryGroupedBackground, opacity: pressed ? 0.86 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
    >
      <View style={[s.tileIcon, { backgroundColor: active ? 'rgba(255,255,255,0.22)' : colors.tertiarySystemFill }]}>
        <Icon name={icon} size={12} color={active ? '#fff' : colors.secondaryLabel} strokeWidth={2} />
      </View>
      <Text style={[s.tileLabel, { color: active ? '#fff' : colors.onSurface }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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
      <Text style={[s.blockSub, { color: colors.secondaryLabel }]}>Anki domains are disabled. Choose another source.</Text>
      <Pressable onPress={onOpenWiki} style={[s.capsule, { backgroundColor: colors.primary }]}>
        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Open Wikipedia</Text>
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

async function showParserInfo(bridgeReady: boolean, parseCount: number): Promise<void> {
  const token = await getItemAsync('jpdb_token');
  if (token) {
    Alert.alert('Parser', bridgeReady ? `Ready · ${parseCount} parsed` : 'Loading…');
    return;
  }
  const raw = await getItemAsync('yomibako_config_json');
  let cfgToken: string | null = null;
  if (raw) {
    try {
      cfgToken = JSON.parse(raw).apiToken;
    } catch {
      cfgToken = null;
    }
  }
  if (!cfgToken) {
    Alert.alert('No token', 'Set JPDB API token in Settings to enable parsing.');
    return;
  }
  Alert.alert('Parser', bridgeReady ? `Ready · ${parseCount} parsed` : 'Loading…');
}

function TopBarContainer(args: {
  readonly immersive: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly topPad: number;
  readonly isFocused: boolean;
  readonly input: string;
  readonly url: string;
  readonly parseError: string | null;
  readonly bridgeReady: boolean;
  readonly parseCount: number;
  readonly onBack: () => void;
  readonly onForward: () => void;
  readonly onInput: (v: string) => void;
  readonly onFocusUrl: () => void;
  readonly onBlur: () => void;
  readonly onNavigate: (v: string) => void;
  readonly onClear: () => void;
  readonly onReload: () => void;
  readonly onGoPress: () => void;
  readonly goLabel: string;
  readonly onRetry: () => void;
}): React.ReactElement | null {
  if (args.immersive) {
    return null;
  }
  return (
    <BrowserTopBar
      isDark={args.isDark}
      colors={args.colors}
      topPad={args.topPad}
      isFocused={args.isFocused}
      input={args.input}
      url={args.url}
      parseError={args.parseError}
      bridgeReady={args.bridgeReady}
      parseCount={args.parseCount}
      onBack={args.onBack}
      onForward={args.onForward}
      onInput={args.onInput}
      onFocusUrl={args.onFocusUrl}
      onBlur={args.onBlur}
      onNavigate={args.onNavigate}
      onClear={args.onClear}
      onReload={args.onReload}
      onGoPress={args.onGoPress}
      goLabel={args.goLabel}
      onRetry={args.onRetry}
    />
  );
}

function TilesContainer({ immersive, url, colors, groupedBackground, onNavigate }: {
  readonly immersive: boolean;
  readonly url: string;
  readonly colors: any;
  readonly groupedBackground: string;
  readonly onNavigate: (u: string) => void;
}): React.ReactElement | null {
  if (immersive) {
    return null;
  }
  return <QuickTilesBar url={url} colors={colors} groupedBackground={groupedBackground} onNavigate={onNavigate} />;
}

function BottomBarContainer({ immersive, isDark, colors, bottomPad, parseCount, onPrev, onNext, onInfo, onLayout }: {
  readonly immersive: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly bottomPad: number;
  readonly parseCount: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onInfo: () => void;
  readonly onLayout: (h: number) => void;
}): React.ReactElement | null {
  if (immersive) {
    return null;
  }
  return (
    <BlurView intensity={isDark ? 28 : 32} tint={isDark ? 'dark' : 'light'} onLayout={(e) => onLayout(e.nativeEvent.layout.height)} style={[s.toolbar, { paddingBottom: bottomPad, borderTopColor: colors.separator, backgroundColor: colors.blurTint }]}>
      <BottomToolbarContent colors={colors} parseCount={parseCount} onPrev={onPrev} onNext={onNext} onInfo={onInfo} />
    </BlurView>
  );
}

function ExitReadingContainer({ immersive, isDark, colors, topInset, rightInset, onExit }: {
  readonly immersive: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly topInset: number;
  readonly rightInset: number;
  readonly onExit: () => void;
}): React.ReactElement | null {
  if (!immersive) {
    return null;
  }
  return (
    <BlurView intensity={28} tint={isDark ? 'dark' : 'light'} style={[s.exitReading, { top: topInset, right: rightInset, backgroundColor: colors.blurTint, borderColor: colors.separator }]}>
      <Pressable onPress={onExit} style={({ pressed }) => [s.exitReadingButton, { opacity: pressed ? 0.65 : 1 }]} accessibilityLabel="Exit full screen reading">
        <Icon name="collapse" size={17} color={colors.primary} strokeWidth={2.1} />
      </Pressable>
    </BlurView>
  );
}

function QuizFabContainer({ word, quizWords, url, immersive, isDark, colors, rightInset, toolbarH, bottomInset, onPress }: {
  readonly word: any;
  readonly quizWords: any[] | null;
  readonly url: string;
  readonly immersive: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly rightInset: number;
  readonly toolbarH: number;
  readonly bottomInset: number;
  readonly onPress: () => void;
}): React.ReactElement | null {
  if (word || quizWords || isBlockedAnki(url)) {
    return null;
  }
  let bottomOffset = toolbarH + 12;
  if (immersive) {
    bottomOffset = bottomInset;
  }
  return (
    <BrowserQuizFab visible isDark={isDark} colors={colors} rightInset={rightInset} bottomOffset={bottomOffset} onPress={onPress} />
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

function BrowserBottomToolbar({ colors, parseCount, onPrev, onNext, onInfo, onToolbarLayout }: {
  readonly colors: any;
  readonly parseCount: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onInfo: () => void;
  readonly onToolbarLayout: (h: number) => void;
}): React.ReactElement {
  return (
    <BlurView intensity={28} tint="light" onLayout={(e) => onToolbarLayout(e.nativeEvent.layout.height)} style={[s.toolbar, { paddingBottom: 10, borderTopColor: colors.separator, backgroundColor: colors.blurTint }]}>
      <BottomToolbarContent colors={colors} parseCount={parseCount} onPrev={onPrev} onNext={onNext} onInfo={onInfo} />
    </BlurView>
  );
}

function BottomToolbarContent({ colors, parseCount, onPrev, onNext, onInfo }: {
  readonly colors: any;
  readonly parseCount: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onInfo: () => void;
}): React.ReactElement {
  return (
    <>
      <Pressable onPress={onPrev} style={({ pressed }) => [s.toolBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} hitSlop={8}>
        <Icon name="chevronLeft" size={16} color={colors.primary} strokeWidth={2.2} />
        <Text style={[s.toolLabel, { color: colors.primary }]}>Prev</Text>
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center', gap: 1 }}>
        <Text style={[s.toolCenterLabel, { color: colors.secondaryLabel }]}>{toolbarCenterText(parseCount)}</Text>
        <Text style={[s.toolCenterSub, { color: colors.tertiaryLabel }]}>Dictionary lookup</Text>
      </View>
      <Pressable onPress={onNext} style={({ pressed }) => [s.toolBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} hitSlop={8}>
        <Text style={[s.toolLabel, { color: colors.primary }]}>Next</Text>
        <Icon name="chevronRight" size={16} color={colors.primary} strokeWidth={2.2} />
      </Pressable>
      <View style={[s.vSeparator, { backgroundColor: colors.separator }]} />
      <Pressable onPress={onInfo} style={({ pressed }) => [s.infoBtn, { backgroundColor: pressed ? colors.systemFill : colors.secondarySystemFill }]} hitSlop={8} accessibilityLabel="Parser info">
        <Icon name="info" size={15} color={colors.secondaryLabel} strokeWidth={2} />
      </Pressable>
    </>
  );
}

function BrowserQuizFab({ visible, isDark, colors, rightInset, bottomOffset, onPress }: {
  readonly visible: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly rightInset: number;
  readonly bottomOffset: number;
  readonly onPress: () => void;
}): React.ReactElement | null {
  if (!visible) {
    return null;
  }
  return (
    <BlurView
      intensity={isDark ? 30 : 34}
      tint={isDark ? 'dark' : 'light'}
      style={[s.fab, { backgroundColor: colors.blurTint, borderColor: colors.separator, right: rightInset, bottom: bottomOffset }]}
    >
      <Pressable onPress={onPress} style={({ pressed }) => [s.fabButton, { opacity: pressed ? 0.55 : 1 }]} hitSlop={10} accessibilityRole="button" accessibilityLabel="Quiz the words on this page">
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
      const nextUrl = normalizeNavigateUrl(next);
      if (!nextUrl) {
        return;
      }
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
      await dispatchBrowserMessage(msg, {
        webRef,
        interactionRef,
        setBridgeReady,
        setParseCount,
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
  const navigateUnknown = useCallback((dir: number) => {
    webRef.current?.injectJavaScript(`window.__yomibakoNavigateUnknown && window.__yomibakoNavigateUnknown(${dir}); true;`);
    Haptics.selectionAsync();
  }, []);

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
    if (!isFocused) {
      setInput(state.url);
    }
  }, [isFocused]);

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
    navigate('https://ja.wikipedia.org/wiki/日本語');
  }, [navigate]);

  const handleParserInfo = useCallback(() => {
    void showParserInfo(bridgeReady, parseCount);
  }, [bridgeReady, parseCount]);

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
      <StatusBar style={statusBarStyle(isDark)} hidden={immersive} animated />
      {/* Safari-like top bar with blur */}
      <TopBarContainer
        immersive={immersive}
        isDark={isDark}
        colors={colors}
        topPad={insets.top + 8}
        isFocused={isFocused}
        input={input}
        url={url}
        parseError={parseError}
        bridgeReady={bridgeReady}
        parseCount={parseCount}
        onBack={goBack}
        onForward={goForward}
        onInput={setInput}
        onFocusUrl={() => {
          setFocused(true);
          setInput(url);
        }}
        onBlur={() => setFocused(false)}
        onNavigate={navigate}
        onClear={() => setInput('')}
        onReload={reload}
        onGoPress={() => handleGoPress(isFocused, input, navigate, setReadingMode)}
        goLabel={goButtonLabel(isFocused)}
        onRetry={retryParse}
      />

      {/* Quick tiles — Safari start page */}
      <TilesContainer immersive={immersive} url={url} colors={colors} groupedBackground={colors.groupedBackground} onNavigate={navigate} />

      {/* WebView */}
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

      {/* Bottom toolbar — Safari */}
      <BottomBarContainer
        immersive={immersive}
        isDark={isDark}
        colors={colors}
        bottomPad={Math.max(insets.bottom, 10)}
        parseCount={parseCount}
        onPrev={() => navigateUnknown(-1)}
        onNext={() => navigateUnknown(1)}
        onInfo={handleParserInfo}
        onLayout={setToolbarH}
      />

      <ExitReadingContainer
        immersive={immersive}
        isDark={isDark}
        colors={colors}
        topInset={insets.top + 10}
        rightInset={Math.max(insets.right, 10)}
        onExit={() => setReadingMode(false)}
      />

      {/* Quiz is one tap from anywhere on the page, within thumb reach, and
          sits clear of the bottom toolbar when that is showing. */}
      <QuizFabContainer
        word={word}
        quizWords={quizWords}
        url={url}
        immersive={immersive}
        isDark={isDark}
        colors={colors}
        rightInset={Math.max(insets.right, 14)}
        toolbarH={toolbarH}
        bottomInset={Math.max(insets.bottom, 14)}
        onPress={startQuiz}
      />

      <LookupSheet word={word} webFrame={webFrame} onClose={dismissLookup} onStateChange={updateCardState} />

      <QuizDialog quizWords={quizWords} onClose={() => setQuizWords(null)} />
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
