import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { darkColors } from '../../theme/colors';
import { Icon } from '../../components/ui/Icon';
import MokuroWebView, { type MokuroWebViewHandle, type ReaderControlInfo, type ReaderPageInfo } from './MokuroWebView';
import WordSheet from './WordSheet';
import { flush as flushProgress, getSavedPage, savePage } from './progress';
import {
  defaultReaderPreferences,
  flushReaderPreferences,
  loadReaderPreferences,
  setReaderPreferences,
  type ReaderPreferences,
  type ZoomMode,
} from './preferences';
import { loadConfig } from '../../services/jpdb/config';
import { useWordAudio } from '../shared/useWordAudio';
import QuizModal from '../quiz/QuizModal';
import {
  applyInteractionState,
  applyToggleOptionsSideEffects,
  applyWordHover,
  clearAnchoredWord,
  clearToastTimer,
  clamp01,
  computeSeekPage,
  computeToggleOptionsNext,
  currentIndexFor,
  decideCenterTap,
  formatPageLabel,
  handleControlInfo,
  hideChromeForWord,
  isReadableVolume,
  maybePlayTapAudio,
  mergePageState,
  nextProgressValue,
  reanchorWord,
  shouldShowFab,
  shouldShowOptions,
  shouldShowWebView,
  type ReaderPageState,
} from './readerHelpers';

const AUTO_HIDE_MS = 2200;

function ReaderEmptyState({ onBack }: { readonly onBack: () => void }) {
  const colors = darkColors;
  return (
    <View style={[s.root, s.empty]}>
      <Icon name="book" size={28} color={colors.secondaryLabel} strokeWidth={1.6} />
      <Text style={s.emptyTitle}>No readable file</Text>
      <Text style={s.emptySub}>This volume has no HTML to display.</Text>
      <Pressable onPress={onBack} style={s.emptyButton}>
        <Text style={s.emptyButtonText}>Back to Library</Text>
      </Pressable>
    </View>
  );
}

function useChromeController(
  readerRef: React.RefObject<MokuroWebViewHandle | null>,
  wordRef: React.RefObject<any>,
  optionsRef: React.RefObject<boolean>,
) {
  const headerY = useSharedValue(-240);
  const footerY = useSharedValue(180);
  const headerH = useSharedValue(90);
  const footerH = useSharedValue(80);
  const toastOpacity = useSharedValue(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [mokuroMenu, setMokuroMenu] = useState(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const hideChrome = useCallback(() => {
    clearHideTimer();
    headerY.value = withTiming(-headerH.value, { duration: 180 });
    footerY.value = withTiming(footerH.value, { duration: 180 });
    setOptionsOpen(false);
    setMokuroMenu((open) => {
      // Putting the chrome away also closes mokuro's own menu.
      if (open) {
        readerRef.current?.setMokuroMenu(false);
      }
      return false;
    });
    setChromeVisible(false);
  }, [clearHideTimer, footerH, footerY, headerH, headerY, readerRef]);

  const showChrome = useCallback(() => {
    clearHideTimer();
    setChromeVisible(true);
    headerY.value = withSpring(0, { damping: 25, stiffness: 360 });
    footerY.value = withSpring(0, { damping: 25, stiffness: 360 });
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      // Never steal the chrome out from under an open lookup or options bar.
      if (!wordRef.current && !optionsRef.current) {
        hideChrome();
      }
    }, AUTO_HIDE_MS);
  }, [clearHideTimer, footerY, headerY, hideChrome, wordRef, optionsRef]);

  const headerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: headerY.value }] }));
  const footerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: footerY.value }] }));
  // Rides on the footer's own animation: lift equals how far the footer has
  // travelled into view, so the two can never sit on top of each other.
  // Clamped at 0 because footerY starts below footerH (chrome starts hidden),
  // which would otherwise push the button off the bottom of the screen until
  // the chrome had been shown once.
  const fabStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, footerH.value - footerY.value) }],
  }));
  const toastStyle = useAnimatedStyle(() => ({ opacity: toastOpacity.value }));

  return {
    headerY, footerY, headerH, footerH, toastOpacity,
    chromeVisible, setChromeVisible, optionsOpen, setOptionsOpen,
    mokuroMenu, setMokuroMenu, hideTimer,
    clearHideTimer, hideChrome, showChrome,
    headerStyle, footerStyle, fabStyle, toastStyle,
  };
}

function useScrubController(
  total: number,
  progress: number,
  showChrome: () => void,
  seekTo: (value: number) => void,
) {
  const [scrubTo, setScrubTo] = useState<number | null>(null);
  const trackW = useSharedValue(1);
  const scrubbing = useSharedValue(0);
  const scrubValue = useSharedValue(0);
  useEffect(() => {
    if (scrubTo === null) {
      scrubValue.value = progress;
    }
  }, [progress, scrubTo, scrubValue]);

  const previewAt = useCallback((value: number) => {
    if (total > 1) {
      const next = Math.round(clamp01(value) * (total - 1));
      // Gesture fires per frame — skip React re-render when the page hasn't changed.
      setScrubTo((prev) => (prev === next ? prev : next));
    } else {
      setScrubTo((prev) => (prev === null ? prev : null));
    }
  }, [total]);

  const endScrub = useCallback((value: number) => {
    setScrubTo(null);
    seekTo(value);
    showChrome();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [seekTo, showChrome]);

  const scrub = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin((event) => {
      scrubbing.value = 1;
      const value = clamp01(event.x / Math.max(1, trackW.value));
      scrubValue.value = value;
      runOnJS(previewAt)(value);
    })
    .onUpdate((event) => {
      const value = clamp01(event.x / Math.max(1, trackW.value));
      scrubValue.value = value;
      runOnJS(previewAt)(value);
    })
    .onEnd((event) => runOnJS(endScrub)(clamp01(event.x / Math.max(1, trackW.value))))
    .onFinalize(() => { scrubbing.value = 0; }), [endScrub, previewAt, scrubValue, scrubbing, trackW]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${scrubValue.value * 100}%` }));
  // No withSpring here: this style re-evaluates every gesture frame, and
  // spawning a spring per frame janks the scrub. Direct interpolation is
  // enough for a 1 -> 1.35 thumb pop.
  const thumbStyle = useAnimatedStyle(() => ({
    left: `${scrubValue.value * 100}%`,
    transform: [{ scale: scrubbing.value ? 1.35 : 1 }],
  }));

  return { scrubTo, setScrubTo, trackW, scrubbing, scrubValue, previewAt, endScrub, scrub, fillStyle, thumbStyle };
}

function ControlErrorText({ message }: { readonly message: string | null }) {
  if (!message) {
    return null;
  }
  return <Text style={s.controlError}>{message}</Text>;
}

function PageToast({ visible, text, bottom, style }: { readonly visible: boolean; readonly text: string; readonly bottom: number; readonly style: any }) {
  if (!visible) {
    return null;
  }
  return (
    <Animated.View pointerEvents="none" style={[s.toast, { bottom }, style]}>
      <Text style={s.toastText}>{text}</Text>
    </Animated.View>
  );
}

function WordOverlay({ word, onClose, onStateChange }: { readonly word: any; readonly onClose: () => void; readonly onStateChange: (vid: number, sid: number, state: string[]) => void }) {
  if (!word) {
    return null;
  }
  return (
    <WordSheet
      key={`${word.vid}/${word.sid}`}
      word={word}
      onClose={onClose}
      onStateChange={onStateChange}
      forceDark
    />
  );
}

function QuizOverlay({ words, onClose }: { readonly words: any[] | null; readonly onClose: () => void }) {
  if (!words) {
    return null;
  }
  return <QuizModal words={words} onClose={onClose} forceDark />;
}

function triggerPageToast(
  toastOpacity: { value: number },
  timerRef: { current: ReturnType<typeof setTimeout> | null },
): void {
  toastOpacity.value = withTiming(1, { duration: 90 });
  clearToastTimer(timerRef);
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    toastOpacity.value = withTiming(0, { duration: 260 });
  }, 650);
}

function useReaderBoot(
  progressUri: string,
  interactionRef: React.RefObject<{ showPopupOnHover: boolean; playSoundOnHover: boolean }>,
  setPrefs: (p: ReaderPreferences | null) => void,
  setZoomMode: (z: ZoomMode) => void,
  setPage: React.Dispatch<React.SetStateAction<{ index: number; total: number; paged: boolean; rtl: boolean; twoPage: boolean }>>,
  setResumePage: (n: number | null) => void,
): void {
  useEffect(() => {
    let cancelled = false;
    Promise.all([getSavedPage(progressUri), loadConfig(), loadReaderPreferences()]).then(([saved, config, savedPrefs]) => {
      if (cancelled) return;
      applyInteractionState(config, interactionRef as { current: { showPopupOnHover: boolean; playSoundOnHover: boolean } });
      setPrefs(savedPrefs);
      setZoomMode(savedPrefs.zoomMode);
      setPage((previous) => ({ ...previous, rtl: savedPrefs.rtl, twoPage: savedPrefs.twoPage }));
      setResumePage(saved ?? 0);
    });
    return () => { cancelled = true; };
  }, [progressUri, interactionRef, setPrefs, setZoomMode, setPage, setResumePage]);
}

function useReaderSystemEffects(): void {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void import('expo-navigation-bar')
      .then(({ NavigationBar }) => NavigationBar.setHidden(true))
      .catch(() => {});
    return () => {
      void import('expo-navigation-bar')
        .then(({ NavigationBar }) => NavigationBar.setHidden(false))
        .catch(() => {});
    };
  }, []);

  useEffect(() => {
    const applyRotationPolicy = Platform.OS === 'android'
      ? ScreenOrientation.lockPlatformAsync({ screenOrientationConstantAndroid: 2 })
      : ScreenOrientation.unlockAsync();

    void applyRotationPolicy.catch((error) => {
      console.warn('[Reader] could not apply rotation policy', error);
    });

    return () => {
      void ScreenOrientation.unlockAsync().catch((error) => {
        console.warn('[Reader] could not restore orientation policy', error);
      });
    };
  }, []);
}

function applyPageInfo(
  info: ReaderPageInfo,
  ctx: {
    progressUri: string;
    pageCount?: number;
    lastToastPage: React.RefObject<number>;
    chromeRef: React.RefObject<boolean>;
    setZoomMode: (z: ZoomMode) => void;
    setMokuroMenu: (b: boolean) => void;
    setPage: React.Dispatch<React.SetStateAction<{ index: number; total: number; paged: boolean; rtl: boolean; twoPage: boolean }>>;
    dismissWord: () => void;
    showPageToast: () => void;
  },
): void {
  if (info.zoomMode) {
    ctx.setZoomMode(info.zoomMode);
  }
  ctx.setMokuroMenu(info.menuOpen);
  ctx.setPage((previous) => mergePageState(previous, info));
  if (info.index >= 0) {
    savePage(ctx.progressUri, info.index, info.total || ctx.pageCount);
  }
  if (info.index < 0 || info.index === ctx.lastToastPage.current) {
    return;
  }
  const first = (ctx.lastToastPage.current ?? -1) < 0;
  ctx.lastToastPage.current = info.index;
  if (first) {
    return;
  }
  ctx.dismissWord();
  void Haptics.selectionAsync();
  if (!ctx.chromeRef.current) {
    ctx.showPageToast();
  }
}

function Chip({ label, active, onPress }: { readonly label: string; readonly active?: boolean; readonly onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [s.chip, active && s.chipActive, pressed && s.pressed]}
    >
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

// Zoom is one choice out of three, so it reads as a segmented control rather
// than three chips that look independently toggleable.
function Segmented({
  items,
  selected,
  onSelect,
}: {
  readonly items: readonly { readonly key: ZoomMode; readonly label: string }[];
  readonly selected: ZoomMode;
  readonly onSelect: (key: ZoomMode) => void;
}) {
  return (
    <View style={s.segment}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          onPress={() => onSelect(item.key)}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === item.key }}
          style={({ pressed }) => [s.segmentItem, selected === item.key && s.segmentItemActive, pressed && s.pressed]}
        >
          <Text style={[s.chipText, selected === item.key && s.chipTextActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

type UseReaderCallbacksParams = {
  readonly readerRef: { current: MokuroWebViewHandle | null };
  readonly wordRef: { current: any };
  readonly chromeRef: { current: boolean };
  readonly interactionRef: { current: { showPopupOnHover: boolean; playSoundOnHover: boolean } };
  readonly toastTimer: { current: ReturnType<typeof setTimeout> | null };
  readonly lastToastPage: { current: number };
  readonly toastOpacity: { value: number };
  readonly navigation: any;
  readonly volumePageCount?: number;
  readonly progressUri: string;
  readonly total: number;
  readonly mokuroMenu: boolean;
  readonly showChrome: () => void;
  readonly hideChrome: () => void;
  readonly setProgress: React.Dispatch<React.SetStateAction<number>>;
  readonly setWord: React.Dispatch<React.SetStateAction<any>>;
  readonly setOptionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setZoomMode: (mode: ZoomMode) => void;
  readonly setMokuroMenu: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setPage: React.Dispatch<React.SetStateAction<ReaderPageState>>;
  readonly setControlError: React.Dispatch<React.SetStateAction<string | null>>;
  readonly setQuizWords: React.Dispatch<React.SetStateAction<any[] | null>>;
  readonly cancelHoverAudio: (stop?: boolean) => void;
  readonly scheduleHoverAudio: (word: any) => void;
  readonly playWordAudio: (word: any) => void;
};

function useReaderCallbacks(params: UseReaderCallbacksParams) {
  const {
    readerRef,
    wordRef,
    chromeRef,
    interactionRef,
    toastTimer,
    lastToastPage,
    toastOpacity,
    navigation,
    volumePageCount,
    progressUri,
    total,
    mokuroMenu,
    showChrome,
    hideChrome,
    setProgress,
    setWord,
    setOptionsOpen,
    setZoomMode,
    setMokuroMenu,
    setPage,
    setControlError,
    setQuizWords,
    cancelHoverAudio,
    scheduleHoverAudio,
    playWordAudio,
  } = params;

  // The page reports progress on every scroll frame. Re-rendering the whole
  // reader chrome at 60fps drops frames — only commit visible changes.
  const handleProgress = useCallback((p: number) => {
    setProgress((prev) => nextProgressValue(prev, p));
  }, []);

  const dismissWord = useCallback(() => {
    cancelHoverAudio(true);
    // Guarded: onPage calls this on every turn, and injecting into the WebView
    // when nothing is anchored is pure waste.
    clearAnchoredWord(wordRef as React.RefObject<any>, readerRef);
    setWord(null);
  }, [cancelHoverAudio]);

  const onWordTap = useCallback((nextWord: any) => {
    cancelHoverAudio(true);
    setOptionsOpen(false);
    setWord(nextWord);
    // "Auto-play pronunciation" — a tap plays the word's audio immediately.
    maybePlayTapAudio(interactionRef.current.playSoundOnHover, nextWord, playWordAudio);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [cancelHoverAudio, playWordAudio]);

  const onWordHover = useCallback((nextWord: any) => {
    applyWordHover(nextWord, interactionRef.current, setOptionsOpen, setWord, scheduleHoverAudio, cancelHoverAudio);
  }, [cancelHoverAudio, scheduleHoverAudio]);

  // Panning or zooming moves the page under an open popup. Re-anchor to the
  // word's new position instead of leaving the card pointing at blank page.
  // The tap point is deliberately dropped: the finger has since moved, so it
  // no longer marks anything the popup needs to avoid.
  const onWordAnchor = useCallback((next: any) => {
    setWord((previous: any) => reanchorWord(previous, next));
  }, []);

  const handleCenterTap = useCallback(() => {
    decideCenterTap(!!wordRef.current, chromeRef.current, dismissWord, hideChrome, showChrome);
    void Haptics.selectionAsync();
  }, [dismissWord, hideChrome, showChrome]);

  const showPageToast = useCallback(() => {
    triggerPageToast(toastOpacity as { value: number }, toastTimer);
  }, [toastOpacity]);

  const onPage = useCallback((info: ReaderPageInfo) => {
    applyPageInfo(info, {
      progressUri,
      pageCount: volumePageCount,
      lastToastPage: lastToastPage as React.RefObject<number>,
      chromeRef: chromeRef as React.RefObject<boolean>,
      setZoomMode,
      setMokuroMenu,
      setPage,
      dismissWord,
      showPageToast,
    });
  }, [dismissWord, progressUri, volumePageCount, showPageToast, setMokuroMenu, setPage, setZoomMode]);

  const onControl = useCallback((info: ReaderControlInfo) => {
    handleControlInfo(info, setControlError, setZoomMode, setPage);
  }, []);

  const step = useCallback((delta: number) => {
    readerRef.current?.step(delta);
    void Haptics.selectionAsync();
    showChrome();
  }, [showChrome]);

  // Options bar actions — every one keeps the chrome alive so the bar does not
  // vanish mid-interaction.
  const act = useCallback((fn: () => void) => {
    void Haptics.selectionAsync();
    fn();
    showChrome();
  }, [showChrome]);

  const toggleOptions = useCallback(() => {
    void Haptics.selectionAsync();
    setOptionsOpen((open) => {
      const next = computeToggleOptionsNext(open, mokuroMenu);
      applyToggleOptionsSideEffects(next, mokuroMenu, setMokuroMenu, readerRef);
      return next;
    });
    showChrome();
  }, [mokuroMenu, showChrome]);

  // The page already holds every parsed card, so the quiz just asks for them.
  // quizWords stays null until the WebView answers, which is what opens it.
  const startQuiz = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    dismissWord();
    setOptionsOpen(false);
    readerRef.current?.collectWords();
  }, [dismissWord]);

  const onWords = useCallback((words: any[]) => {
    hideChrome();
    setQuizWords(words);
  }, [hideChrome]);

  const seekTo = useCallback((value: number) => {
    const pageIndex = computeSeekPage(total, value);
    if (pageIndex !== null) {
      readerRef.current?.goToPage(pageIndex);
    }
  }, [total]);

  const openSettings = useCallback(() => {
    void Haptics.selectionAsync();
    void flushProgress();
    navigation.navigate('Tabs', { screen: 'Settings' });
  }, [navigation]);

  const goBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return {
    handleProgress,
    dismissWord,
    onWordTap,
    onWordHover,
    onWordAnchor,
    handleCenterTap,
    showPageToast,
    onPage,
    onControl,
    step,
    act,
    toggleOptions,
    startQuiz,
    onWords,
    seekTo,
    openSettings,
    goBack,
  };
}

export default function ReaderScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const volume = route.params.volume as {
    htmlUri?: string;
    mokuroUri?: string;
    uri: string;
    title: string;
    series?: string;
    pageCount?: number;
    progressKey?: string;
  };
  const progressUri = volume.progressKey ?? volume.uri;

  const readerRef = useRef<MokuroWebViewHandle>(null);
  const [resumePage, setResumePage] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<ReaderPreferences | null>(null);
  const [word, setWord] = useState<any>(null);
  const [progress, setProgress] = useState(0);
  const [page, setPage] = useState({ index: -1, total: volume.pageCount ?? 0, paged: false, rtl: false, twoPage: false });
  const [zoomMode, setZoomMode] = useState<ZoomMode>(defaultReaderPreferences.zoomMode);
  const [controlError, setControlError] = useState<string | null>(null);
  const [quizWords, setQuizWords] = useState<any[] | null>(null);

  const interactionRef = useRef({ showPopupOnHover: true, playSoundOnHover: false });
  const wordRef = useRef<any>(null);
  const chromeRef = useRef(false);
  const optionsRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastToastPage = useRef(-1);

  const chrome = useChromeController(readerRef, wordRef, optionsRef);
  const {
    headerH, footerH, toastOpacity,
    chromeVisible, optionsOpen, setOptionsOpen,
    mokuroMenu, setMokuroMenu,
    clearHideTimer, hideChrome, showChrome,
    headerStyle, footerStyle, fabStyle, toastStyle,
  } = chrome;
  wordRef.current = word;
  chromeRef.current = chromeVisible;
  optionsRef.current = optionsOpen;

  const applyInteraction = useCallback(async (forceReload = false) => {
    const config = await loadConfig(forceReload);
    applyInteractionState(config, interactionRef as { current: { showPopupOnHover: boolean; playSoundOnHover: boolean } });
  }, []);

  useReaderBoot(progressUri, interactionRef as { current: { showPopupOnHover: boolean; playSoundOnHover: boolean } } as React.RefObject<{ showPopupOnHover: boolean; playSoundOnHover: boolean }>, setPrefs, setZoomMode, setPage, setResumePage);

  useEffect(() => navigation.addListener('focus', () => { void applyInteraction(false); }), [applyInteraction, navigation]);

  useReaderSystemEffects();

  const { cancel: cancelHoverAudio, scheduleHover: scheduleHoverAudio, playNow: playWordAudio } = useWordAudio();

  const total = page.total || volume.pageCount || 0;
  const canPage = page.paged && total > 1;

  const {
    handleProgress,
    dismissWord,
    onWordTap,
    onWordHover,
    onWordAnchor,
    handleCenterTap,
    onPage,
    onControl,
    step,
    act,
    toggleOptions,
    startQuiz,
    onWords,
    seekTo,
    openSettings,
    goBack,
  } = useReaderCallbacks({
    readerRef,
    wordRef,
    chromeRef,
    interactionRef,
    toastTimer,
    lastToastPage,
    toastOpacity,
    navigation,
    volumePageCount: volume.pageCount,
    progressUri,
    total,
    mokuroMenu,
    showChrome,
    hideChrome,
    setProgress,
    setWord,
    setOptionsOpen,
    setZoomMode,
    setMokuroMenu,
    setPage,
    setControlError,
    setQuizWords,
    cancelHoverAudio,
    scheduleHoverAudio,
    playWordAudio,
  });

  // A page turn only lives in memory until the 1200ms debounce fires — flush
  // on blur too, so navigating away fast never loses the last position.
  useEffect(() => navigation.addListener('blur', () => { dismissWord(); void flushProgress(); }), [dismissWord, navigation]);
  useEffect(() => () => {
    clearHideTimer();
    clearToastTimer(toastTimer);
    void flushProgress();
    void flushReaderPreferences();
  }, [clearHideTimer]);

  // Only the presence of a lookup should put the chrome away. Anchor updates
  // replace the word object on every pan, and hiding on each of those would
  // churn state for the whole gesture.
  const hasWord = !!word;
  useEffect(() => {
    hideChromeForWord(hasWord, hideChrome);
  }, [hideChrome, hasWord]);

  const scrubController = useScrubController(total, progress, showChrome, seekTo);
  const { scrubTo, trackW, scrub, fillStyle, thumbStyle } = scrubController;
  const currentIndex = currentIndexFor(scrubTo, page.index);
  const pageLabel = formatPageLabel(canPage, total, currentIndex, progress);

  if (!isReadableVolume(volume)) {
    return <ReaderEmptyState onBack={goBack} />;
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" hidden={!chromeVisible} animated />
      <View style={s.readerStage}>
        {shouldShowWebView(resumePage, prefs) ? (
          <MokuroWebView
            ref={readerRef}
            htmlUri={volume.htmlUri}
            mokuroUri={volume.mokuroUri}
            volumeDir={volume.uri}
            title={volume.title}
            series={volume.series}
            initialPage={resumePage as number}
            initialPreferences={prefs as ReaderPreferences}
            onOpenSettings={openSettings}
            onWordTap={onWordTap}
            onWordHover={onWordHover}
            onWordAnchor={onWordAnchor}
            onWordAnchorLost={dismissWord}
            onProgress={handleProgress}
            onPage={onPage}
            onControl={onControl}
            onWords={onWords}
            onTapBackground={handleCenterTap}
            onViewReset={() => { void Haptics.selectionAsync(); }}
          />
        ) : null}
      </View>

      <Animated.View
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          headerH.value = height + 10;
          // mokuro's own menu is position:fixed at top:0 and would sit under
          // our header; tell the page where the chrome ends.
          readerRef.current?.setChromeTop(height);
        }}
        style={[s.headerWrap, { paddingTop: insets.top + 6, pointerEvents: chromeVisible ? 'auto' : 'none' } as any, headerStyle]}
      >
        <BlurView intensity={34} tint="dark" style={s.headerBlur}>
          <Pressable
            onPress={() => { void Haptics.selectionAsync(); void flushProgress(); navigation.goBack(); }}
            style={({ pressed }) => [s.circleButton, pressed && s.pressed]}
            hitSlop={10}
            accessibilityLabel="Back"
          >
            <Icon name="chevronLeft" size={20} color="#fff" strokeWidth={2.4} />
          </Pressable>
          <Text numberOfLines={1} style={s.title}>{volume.title}</Text>
          <Text style={s.pageCount}>{pageLabel}</Text>
          <Pressable
            onPress={toggleOptions}
            style={({ pressed }) => [s.circleButton, optionsOpen && s.circleButtonActive, pressed && s.pressed]}
            hitSlop={10}
            accessibilityLabel="Reader options"
          >
            <Icon name="settings" size={18} color={optionsOpen ? '#fff' : 'rgba(255,255,255,0.92)'} strokeWidth={2} />
          </Pressable>
        </BlurView>

        {/* Options bar — zoom, layout and re-parse. Collapsed by default so the
            page stays unobstructed. */}
        {shouldShowOptions(optionsOpen, word) ? (
          <BlurView intensity={34} tint="dark" style={s.optionsBar}>
            <Segmented
              selected={zoomMode}
              items={[
                { key: 'screen', label: 'Fit screen' },
                { key: 'width', label: 'Fit width' },
                { key: 'original', label: '1:1' },
              ]}
              onSelect={(key) => act(() => {
                setZoomMode(key);
                setReaderPreferences({ zoomMode: key });
                readerRef.current?.setZoom(key);
              })}
            />
            <View style={s.chipRow}>
              <Chip label="Two pages" active={page.twoPage} onPress={() => act(() => readerRef.current?.toggle('twoPage'))} />
              <Chip label={page.rtl ? '右 → 左' : '左 → 右'} onPress={() => act(() => readerRef.current?.toggle('rtl'))} />
              <Chip label="Re-parse" onPress={() => act(() => readerRef.current?.retryParse())} />
              <Chip
                label="mokuro"
                active={mokuroMenu}
                onPress={() => act(() => {
                  const next = !mokuroMenu;
                  setMokuroMenu(next);
                  readerRef.current?.setMokuroMenu(next);
                })}
              />
            </View>
            <ControlErrorText message={controlError} />
          </BlurView>
        ) : null}
      </Animated.View>

      <Animated.View
        onLayout={(event) => { footerH.value = event.nativeEvent.layout.height + 10; }}
        style={[s.footerWrap, { bottom: Math.max(insets.bottom, 10), pointerEvents: chromeVisible && !word ? 'auto' : 'none' } as any, footerStyle]}
      >
        <BlurView intensity={32} tint="dark" style={s.footerBlur}>
          <Pressable
            onPress={() => step(-1)}
            disabled={!canPage}
            style={({ pressed }) => [s.stepButton, pressed && s.pressed, !canPage && s.stepDisabled]}
            hitSlop={8}
            accessibilityLabel="Previous page"
          >
            <Icon name="chevronLeft" size={18} color="rgba(255,255,255,0.92)" strokeWidth={2.3} />
          </Pressable>
          <GestureDetector gesture={scrub}>
            <View style={s.scrubHit} onLayout={(event) => { trackW.value = Math.max(1, event.nativeEvent.layout.width); }}>
              <View style={s.scrubTrack}>
                <Animated.View style={[s.scrubFill, fillStyle]} />
                <Animated.View style={[s.scrubThumb, thumbStyle]} />
              </View>
            </View>
          </GestureDetector>
          <Pressable
            onPress={() => step(1)}
            disabled={!canPage}
            style={({ pressed }) => [s.stepButton, pressed && s.pressed, !canPage && s.stepDisabled]}
            hitSlop={8}
            accessibilityLabel="Next page"
          >
            <Icon name="chevronRight" size={18} color="rgba(255,255,255,0.92)" strokeWidth={2.3} />
          </Pressable>
          <Text style={s.footerCount}>{pageLabel}</Text>
        </BlurView>
      </Animated.View>

      <PageToast visible={canPage} text={`${Math.min(total, page.index + 1)} / ${total}`} bottom={Math.max(insets.bottom, 12) + 4} style={toastStyle} />

      {/* Quiz is one tap from anywhere in the page, within thumb reach. It
          rides above the footer so the two never overlap. */}
      {shouldShowFab(word, quizWords) ? (
        <Animated.View style={[s.fab, { bottom: Math.max(insets.bottom, 12), right: Math.max(insets.right, 14) }, fabStyle]}>
          <BlurView intensity={30} tint="dark" style={s.fabSurface}>
            <Pressable
              onPress={startQuiz}
              style={({ pressed }) => [s.fabButton, pressed && s.fabPressed]}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Quiz the words on this page"
            >
              <Icon name="repeat" size={18} color="rgba(255,255,255,0.92)" strokeWidth={2} />
            </Pressable>
          </BlurView>
        </Animated.View>
      ) : null}

      <WordOverlay word={word} onClose={dismissWord} onStateChange={(vid, sid, state) => readerRef.current?.setCardState(vid, sid, state)} />

      <QuizOverlay words={quizWords} onClose={() => setQuizWords(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  readerStage: { flex: 1, backgroundColor: '#000' },
  headerWrap: { position: 'absolute', left: 12, right: 12, top: 0, zIndex: 10 },
  headerBlur: {
    minHeight: 48,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.13)',
    backgroundColor: 'rgba(18,18,20,0.76)',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.34)',
  },
  circleButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  circleButtonActive: { backgroundColor: '#0A84FF' },
  pressed: { opacity: 0.68, transform: [{ scale: 0.96 }] },
  optionsBar: {
    marginTop: 8,
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.13)',
    backgroundColor: 'rgba(18,18,20,0.78)',
    overflow: 'hidden',
    boxShadow: '0 8px 24px rgba(0,0,0,0.34)',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 11, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.09)' },
  chipActive: { backgroundColor: '#0A84FF' },
  chipText: { color: 'rgba(255,255,255,0.80)', fontFamily: 'System', fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },
  chipTextActive: { color: '#fff' },
  segment: { flexDirection: 'row', borderRadius: 9, padding: 2, gap: 2, backgroundColor: 'rgba(255,255,255,0.09)' },
  segmentItem: { flex: 1, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  segmentItemActive: { backgroundColor: 'rgba(255,255,255,0.20)' },
  controlError: { color: '#FF453A', fontFamily: 'System', fontSize: 11.5, lineHeight: 15, fontWeight: '500', paddingHorizontal: 2 },
  stepButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  stepDisabled: { opacity: 0.3 },
  title: { flex: 1, color: '#fff', fontFamily: 'System', fontSize: 14, lineHeight: 18, fontWeight: '600', letterSpacing: -0.2 },
  pageCount: { color: 'rgba(255,255,255,0.62)', fontFamily: 'System', fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  footerWrap: { position: 'absolute', left: 34, right: 34, zIndex: 10, alignItems: 'center' },
  footerBlur: {
    width: '100%',
    maxWidth: 360,
    minHeight: 42,
    paddingHorizontal: 13,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(18,18,20,0.78)',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    boxShadow: '0 7px 22px rgba(0,0,0,0.34)',
  },
  scrubHit: { flex: 1, paddingVertical: 18, justifyContent: 'center' },
  scrubTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center' },
  scrubFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: '#0A84FF' },
  scrubThumb: { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6, top: -4.5, backgroundColor: '#fff', boxShadow: '0 2px 5px rgba(0,0,0,0.28)' },
  footerCount: { minWidth: 48, textAlign: 'right', color: 'rgba(255,255,255,0.72)', fontFamily: 'System', fontSize: 11.5, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  toast: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.68)', zIndex: 9 },
  toastText: { color: 'rgba(255,255,255,0.92)', fontFamily: 'System', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  fab: { position: 'absolute', zIndex: 11 },
  fabSurface: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.13)',
    backgroundColor: 'rgba(18,18,20,0.66)',
    boxShadow: '0 6px 16px rgba(0,0,0,0.30)',
  },
  fabButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fabPressed: { opacity: 0.55 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 9 },
  emptyTitle: { color: '#fff', fontFamily: 'System', fontSize: 20, fontWeight: '700' },
  emptySub: { color: 'rgba(255,255,255,0.56)', fontFamily: 'System', fontSize: 14, textAlign: 'center', lineHeight: 19 },
  emptyButton: { marginTop: 10, height: 44, paddingHorizontal: 20, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A84FF' },
  emptyButtonText: { color: '#fff', fontFamily: 'System', fontSize: 15, fontWeight: '600' },
});
