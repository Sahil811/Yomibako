import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
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
  // Plain ref: the scrub bar no longer uses the native gesture handler
  // (Gesture.Pan hard-crashed the app on touch on some devices). Touch
  // coordinates are plain numbers, so no shared value is needed here.
  // scrubValue/scrubbing stay shared because the fill/thumb styles animate
  // on the UI thread — shared values can be set from plain JS handlers.
  // Absolute track geometry: locationX goes unreliable when the finger moves
  // fast or leaves the track (it swings out of range, the clamp then pins
  // every preview to page 1 / last page). pageX is screen-absolute, so
  // subtract the measured track origin instead.
  const trackW = useRef(1);
  const trackView = useRef<any>(null);
  const trackLeft = useRef(0);
  const measureTrack = useCallback(() => {
    try {
      trackView.current?.measureInWindow((x: number, _y: number, w: number, _h: number) => {
        trackLeft.current = x;
        trackW.current = Math.max(1, w);
      });
    } catch {}
  }, []);
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

  // The fill bar tracks the finger live on the UI thread, but pushing every
  // micro-jitter into React state makes the page number chatter at page
  // boundaries. Gate label commits to ~8/s; the bar stays exact and release
  // still lands on the true finger position.
  const lastPreviewCommit = useRef(0);
  const previewAtSettled = useCallback((value: number) => {
    if (total <= 1) {
      previewAt(value);
      return;
    }
    const next = Math.round(clamp01(value) * (total - 1));
    setScrubTo((prev) => {
      if (prev === next) return prev;
      const now = Date.now();
      if (now - lastPreviewCommit.current < 120) return prev;
      lastPreviewCommit.current = now;
      return next;
    });
  }, [total, previewAt]);

  const endScrub = useCallback((value: number) => {
    setScrubTo(null);
    seekTo(value);
    showChrome();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [seekTo, showChrome]);

  // PanResponder (React Native core) instead of Gesture.Pan: same tap-to-seek
  // and drag-to-preview behavior, with no native gesture/worklet activation.
  const valueAtPageX = useCallback((pageX: number) => clamp01((pageX - trackLeft.current) / Math.max(1, trackW.current)), []);
  const scrubResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => total > 1,
    onMoveShouldSetPanResponder: () => total > 1,
    onPanResponderGrant: (event) => {
      measureTrack();
      scrubbing.value = 1;
      lastPreviewCommit.current = 0; // first preview lands instantly
      const value = valueAtPageX(event.nativeEvent.pageX);
      scrubValue.value = value;
      previewAtSettled(value);
    },
    onPanResponderMove: (event) => {
      const value = valueAtPageX(event.nativeEvent.pageX);
      scrubValue.value = value;
      previewAtSettled(value);
    },
    onPanResponderRelease: (event) => {
      scrubbing.value = 0;
      endScrub(valueAtPageX(event.nativeEvent.pageX));
    },
    onPanResponderTerminate: () => {
      scrubbing.value = 0;
      setScrubTo(null);
      showChrome();
    },
  }), [total, valueAtPageX, previewAtSettled, endScrub, showChrome, measureTrack, scrubValue, scrubbing]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${scrubValue.value * 100}%` }));
  // No withSpring here: this style re-evaluates every gesture frame, and
  // spawning a spring per frame janks the scrub. Direct interpolation is
  // enough for a 1 -> 1.35 thumb pop.
  const thumbStyle = useAnimatedStyle(() => ({
    left: `${scrubValue.value * 100}%`,
    transform: [{ scale: scrubbing.value ? 1.35 : 1 }],
  }));

  return { scrubTo, setScrubTo, trackW, trackView, measureTrack, scrubbing, scrubValue, previewAt, endScrub, scrubResponder, fillStyle, thumbStyle };
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

// Direct page jump — the scrub bar can't land on an exact page like 80.
// The footer count opens this; input is 1-based, clamped to 1..total.
function PageJumpDialog({ visible, total, current, onClose, onGo }: {
  readonly visible: boolean;
  readonly total: number;
  readonly current: number;
  readonly onClose: () => void;
  readonly onGo: (pageIndex: number) => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) {
      setText('');
    }
  }, [visible]);
  if (!visible) {
    return null;
  }
  const submit = () => {
    const n = Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(n)) {
      return;
    }
    onGo(Math.max(1, Math.min(total, n)) - 1);
    onClose();
  };
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={s.jumpOverlay}>
        <Pressable style={StyleSheet.absoluteFill as any} onPress={onClose} accessibilityLabel="Dismiss go to page" />
        <View style={s.jumpCard}>
          <Text style={s.jumpTitle}>Go to page</Text>
          <Text style={s.jumpSub}>1 – {total} · now on {current}</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={String(current)}
            placeholderTextColor="rgba(255,255,255,0.35)"
            keyboardType="number-pad"
            returnKeyType="go"
            autoFocus
            onSubmitEditing={submit}
            style={s.jumpInput}
            accessibilityLabel="Page number"
          />
          <View style={s.jumpRow}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [s.jumpButton, s.jumpCancel, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={s.jumpCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              style={({ pressed }) => [s.jumpButton, s.jumpGo, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Go to page"
            >
              <Text style={s.jumpGoText}>Go</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
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

  // Exact page jump (dialog supplies a 0-based index, clamped here).
  const jumpToPage = useCallback((pageIndex: number) => {
    if (total <= 1) {
      return;
    }
    readerRef.current?.goToPage(Math.max(0, Math.min(total - 1, Math.round(pageIndex))));
    void Haptics.selectionAsync();
    showChrome();
  }, [total, showChrome]);  // Options bar actions — every one keeps the chrome alive so the bar does not
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
    jumpToPage,
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
  const [jumpOpen, setJumpOpen] = useState(false);

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
    jumpToPage,
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
  const { scrubTo, trackView, measureTrack, scrubResponder, fillStyle, thumbStyle } = scrubController;
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
          <View
            ref={trackView}
            {...scrubResponder.panHandlers}
            style={s.scrubHit}
            onLayout={measureTrack}
            accessibilityRole="adjustable"
            accessibilityLabel="Seek through pages"
          >
            <View style={s.scrubTrack}>
              <Animated.View style={[s.scrubFill, fillStyle]} />
              <Animated.View style={[s.scrubThumb, thumbStyle]} />
            </View>
          </View>
          <Pressable
            onPress={() => step(1)}
            disabled={!canPage}
            style={({ pressed }) => [s.stepButton, pressed && s.pressed, !canPage && s.stepDisabled]}
            hitSlop={8}
            accessibilityLabel="Next page"
          >
            <Icon name="chevronRight" size={18} color="rgba(255,255,255,0.92)" strokeWidth={2.3} />
          </Pressable>
          <Pressable
            onPress={() => { void Haptics.selectionAsync(); setJumpOpen(true); }}
            disabled={!canPage}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go to page"
            style={({ pressed }) => [pressed && s.pressed, !canPage && s.stepDisabled]}
          >
            <Text style={s.footerCount}>{pageLabel}</Text>
          </Pressable>
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

      <PageJumpDialog
        visible={jumpOpen && canPage}
        total={total}
        current={Math.min(total, page.index + 1)}
        onClose={() => setJumpOpen(false)}
        onGo={jumpToPage}
      />
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
  jumpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  jumpCard: { width: '100%', maxWidth: 300, borderRadius: 18, padding: 18, gap: 4, backgroundColor: 'rgba(24,24,27,0.97)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.13)' },
  jumpTitle: { color: '#fff', fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '700' },
  jumpSub: { color: 'rgba(255,255,255,0.60)', fontFamily: 'System', fontSize: 13, lineHeight: 17, fontVariant: ['tabular-nums'] as any },
  jumpInput: { marginTop: 10, height: 48, borderRadius: 12, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.09)', color: '#fff', fontFamily: 'System', fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  jumpRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  jumpButton: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  jumpCancel: { backgroundColor: 'rgba(255,255,255,0.10)' },
  jumpGo: { backgroundColor: '#0A84FF' },
  jumpCancelText: { color: '#fff', fontFamily: 'System', fontSize: 15, fontWeight: '600' },
  jumpGoText: { color: '#fff', fontFamily: 'System', fontSize: 15, fontWeight: '700' },
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
