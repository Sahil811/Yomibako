import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
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

const AUTO_HIDE_MS = 2200;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
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
  items: { key: ZoomMode; label: string }[];
  selected: ZoomMode;
  onSelect: (key: ZoomMode) => void;
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

export default function ReaderScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const colors = darkColors;
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
  const [chromeVisible, setChromeVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scrubTo, setScrubTo] = useState<number | null>(null);
  const [page, setPage] = useState({ index: -1, total: volume.pageCount ?? 0, paged: false, rtl: false, twoPage: false });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [mokuroMenu, setMokuroMenu] = useState(false);
  const [zoomMode, setZoomMode] = useState<ZoomMode>(defaultReaderPreferences.zoomMode);
  const [controlError, setControlError] = useState<string | null>(null);
  const [quizWords, setQuizWords] = useState<any[] | null>(null);

  const interactionRef = useRef({ showPopupOnHover: true, playSoundOnHover: false });
  const wordRef = useRef<any>(null);
  const chromeRef = useRef(false);
  const optionsRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastToastPage = useRef(-1);
  wordRef.current = word;
  chromeRef.current = chromeVisible;
  optionsRef.current = optionsOpen;

  const headerY = useSharedValue(-240);
  const footerY = useSharedValue(180);
  const headerH = useSharedValue(90);
  const footerH = useSharedValue(80);
  const toastOpacity = useSharedValue(0);

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
      if (open) readerRef.current?.setMokuroMenu(false);
      return false;
    });
    setChromeVisible(false);
  }, [clearHideTimer, footerH, footerY, headerH, headerY]);

  const showChrome = useCallback(() => {
    clearHideTimer();
    setChromeVisible(true);
    headerY.value = withSpring(0, { damping: 25, stiffness: 360 });
    footerY.value = withSpring(0, { damping: 25, stiffness: 360 });
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      // Never steal the chrome out from under an open lookup or options bar.
      if (!wordRef.current && !optionsRef.current) hideChrome();
    }, AUTO_HIDE_MS);
  }, [clearHideTimer, footerY, headerY, hideChrome]);

  const applyInteraction = useCallback(async (forceReload = false) => {
    const config = await loadConfig(forceReload);
    interactionRef.current = {
      showPopupOnHover: config.showPopupOnHover !== false,
      playSoundOnHover: !!config.playSoundOnHover,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSavedPage(progressUri), loadConfig(), loadReaderPreferences()]).then(([saved, config, savedPrefs]) => {
      if (cancelled) return;
      interactionRef.current = {
        showPopupOnHover: config.showPopupOnHover !== false,
        playSoundOnHover: !!config.playSoundOnHover,
      };
      setPrefs(savedPrefs);
      setZoomMode(savedPrefs.zoomMode);
      setPage((previous) => ({ ...previous, rtl: savedPrefs.rtl, twoPage: savedPrefs.twoPage }));
      setResumePage(saved ?? 0);
    });
    return () => { cancelled = true; };
  }, [progressUri]);

  useEffect(() => navigation.addListener('focus', () => { void applyInteraction(false); }), [applyInteraction, navigation]);

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
    // Respect the user's device rotation lock. SCREEN_ORIENTATION_USER (2) on
    // Android honours the system auto-rotate toggle, so the reader stays put
    // when auto-rotate is off. On iOS, DEFAULT already follows the lock.
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

  const { cancel: cancelHoverAudio, scheduleHover: scheduleHoverAudio, playNow: playWordAudio } = useWordAudio();

  // The page reports progress on every scroll frame. Re-rendering the whole
  // reader chrome at 60fps drops frames — only commit visible changes.
  const handleProgress = useCallback((p: number) => {
    setProgress((prev) => (Math.abs(prev - p) < 0.003 ? prev : p));
  }, []);

  const dismissWord = useCallback(() => {
    cancelHoverAudio(true);
    // Guarded: onPage calls this on every turn, and injecting into the WebView
    // when nothing is anchored is pure waste.
    if (wordRef.current) readerRef.current?.clearAnchor();
    setWord(null);
  }, [cancelHoverAudio]);

  useEffect(() => navigation.addListener('blur', dismissWord), [dismissWord, navigation]);
  useEffect(() => () => {
    clearHideTimer();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    void flushProgress();
    void flushReaderPreferences();
  }, [clearHideTimer]);

  // Only the presence of a lookup should put the chrome away. Anchor updates
  // replace the word object on every pan, and hiding on each of those would
  // churn state for the whole gesture.
  const hasWord = !!word;
  useEffect(() => {
    if (hasWord) hideChrome();
  }, [hideChrome, hasWord]);

  const onWordTap = useCallback((nextWord: any) => {
    cancelHoverAudio(true);
    setOptionsOpen(false);
    setWord(nextWord);
    // "Auto-play pronunciation" — a tap plays the word's audio immediately.
    if (interactionRef.current.playSoundOnHover) playWordAudio(nextWord);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [cancelHoverAudio, playWordAudio]);

  const onWordHover = useCallback((nextWord: any) => {
    const interaction = interactionRef.current;
    if (interaction.showPopupOnHover) {
      setOptionsOpen(false);
      setWord(nextWord);
    }
    if (interaction.playSoundOnHover) scheduleHoverAudio(nextWord);
    else cancelHoverAudio(true);
  }, [cancelHoverAudio, scheduleHoverAudio]);

  // Panning or zooming moves the page under an open popup. Re-anchor to the
  // word's new position instead of leaving the card pointing at blank page.
  // The tap point is deliberately dropped: the finger has since moved, so it
  // no longer marks anything the popup needs to avoid.
  const onWordAnchor = useCallback((next: any) => {
    setWord((previous: any) =>
      previous
        ? { ...previous, rect: next.rect, rects: next.rects, boxRect: next.boxRect, vertical: next.vertical, vw: next.vw, point: null }
        : previous
    );
  }, []);

  const handleCenterTap = useCallback(() => {
    if (wordRef.current) dismissWord();
    else if (chromeRef.current) hideChrome();
    else showChrome();
    void Haptics.selectionAsync();
  }, [dismissWord, hideChrome, showChrome]);

  const onPage = useCallback((info: ReaderPageInfo) => {
    if (info.zoomMode) setZoomMode(info.zoomMode);
    setMokuroMenu(info.menuOpen);
    setPage((previous) => previous.index === info.index && previous.total === info.total && previous.paged === info.paged
      && previous.rtl === info.rtl && previous.twoPage === info.twoPage
      ? previous
      : { index: info.index, total: info.total, paged: info.paged, rtl: info.rtl, twoPage: info.twoPage });
    if (info.index >= 0) savePage(progressUri, info.index, info.total || volume.pageCount);
    if (info.index >= 0 && info.index !== lastToastPage.current) {
      const first = lastToastPage.current < 0;
      lastToastPage.current = info.index;
      if (!first) {
        dismissWord();
        void Haptics.selectionAsync();
        if (!chromeRef.current) {
          toastOpacity.value = withTiming(1, { duration: 90 });
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => {
            toastTimer.current = null;
            toastOpacity.value = withTiming(0, { duration: 260 });
          }, 650);
        }
      }
    }
  }, [dismissWord, progressUri, toastOpacity, volume.pageCount]);

  const onControl = useCallback((info: ReaderControlInfo) => {
    if (!info.ok) {
      setControlError('This file does not expose that control.');
      return;
    }
    setControlError(null);
    if (info.key === 'zoom' && info.mode) {
      setZoomMode(info.mode);
      setReaderPreferences({ zoomMode: info.mode });
    }
    if (info.key === 'twoPage' && typeof info.value === 'boolean') {
      const value = info.value;
      setPage((previous) => ({ ...previous, twoPage: value }));
      setReaderPreferences({ twoPage: value });
    }
    if (info.key === 'rtl' && typeof info.value === 'boolean') {
      const value = info.value;
      setPage((previous) => ({ ...previous, rtl: value }));
      setReaderPreferences({ rtl: value });
    }
  }, []);

  const total = page.total || volume.pageCount || 0;
  const canPage = page.paged && total > 1;
  const currentIndex = Math.max(0, scrubTo ?? page.index);
  const pageLabel = canPage ? `${Math.min(total, currentIndex + 1)} / ${total}` : `${Math.round(progress * 100)}%`;

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
      const next = !open;
      if (!next && mokuroMenu) {
        setMokuroMenu(false);
        readerRef.current?.setMokuroMenu(false);
      }
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
    if (total > 1) readerRef.current?.goToPage(Math.round(clamp01(value) * (total - 1)));
  }, [total]);

  const trackW = useSharedValue(1);
  const scrubbing = useSharedValue(0);
  const scrubValue = useSharedValue(0);
  useEffect(() => {
    if (scrubTo === null) scrubValue.value = progress;
  }, [progress, scrubTo, scrubValue]);

  const previewAt = useCallback((value: number) => {
    setScrubTo(total > 1 ? Math.round(clamp01(value) * (total - 1)) : null);
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
  const fillStyle = useAnimatedStyle(() => ({ width: `${scrubValue.value * 100}%` }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: `${scrubValue.value * 100}%`,
    transform: [{ scale: withSpring(scrubbing.value ? 1.35 : 1, { damping: 18, stiffness: 320 }) }],
  }));
  const toastStyle = useAnimatedStyle(() => ({ opacity: toastOpacity.value }));

  const openSettings = useCallback(() => {
    void Haptics.selectionAsync();
    void flushProgress();
    navigation.navigate('Tabs', { screen: 'Settings' });
  }, [navigation]);

  if (!volume.htmlUri && !volume.mokuroUri) {
    return (
      <View style={[s.root, s.empty]}>
        <Icon name="book" size={28} color={colors.secondaryLabel} strokeWidth={1.6} />
        <Text style={s.emptyTitle}>No readable file</Text>
        <Text style={s.emptySub}>This volume has no HTML to display.</Text>
        <Pressable onPress={() => navigation.goBack()} style={s.emptyButton}>
          <Text style={s.emptyButtonText}>Back to Library</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" hidden={!chromeVisible} animated />
      <View style={s.readerStage}>
        {resumePage !== null && prefs ? (
          <MokuroWebView
            ref={readerRef}
            htmlUri={volume.htmlUri}
            mokuroUri={volume.mokuroUri}
            volumeDir={volume.uri}
            title={volume.title}
            series={volume.series}
            initialPage={resumePage}
            initialPreferences={prefs}
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
        {optionsOpen && !word ? (
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
            {controlError ? <Text style={s.controlError}>{controlError}</Text> : null}
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

      {canPage ? (
        <Animated.View pointerEvents="none" style={[s.toast, { bottom: Math.max(insets.bottom, 12) + 4 }, toastStyle]}>
          <Text style={s.toastText}>{`${Math.min(total, page.index + 1)} / ${total}`}</Text>
        </Animated.View>
      ) : null}

      {/* Quiz is one tap from anywhere in the page, within thumb reach. It
          rides above the footer so the two never overlap. */}
      {!word && !quizWords ? (
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

      {word ? (
        <WordSheet
          key={`${word.vid}/${word.sid}`}
          word={word}
          onClose={dismissWord}
          onStateChange={(vid, sid, state) => readerRef.current?.setCardState(vid, sid, state)}
          forceDark
        />
      ) : null}

      {quizWords ? (
        <QuizModal words={quizWords} onClose={() => setQuizWords(null)} forceDark />
      ) : null}
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
