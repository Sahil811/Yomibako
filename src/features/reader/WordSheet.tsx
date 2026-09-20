import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  useColorScheme,
  useWindowDimensions,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { darkColors, lightColors } from '../../theme/colors';
import { Icon } from '../../components/ui/Icon';
import { Markdown } from '../../components/ui/Markdown';
import { jpdbApi, geminiApi } from '../../services/jpdb/api';
import { loadKanjiDetails, type KanjiDetail } from '../../services/jpdb/kanjiData';
import { loadConfig } from '../../services/jpdb/config';
import { lastAudioError, playAudioForWord, playRemoteAudio, stopAudio } from '../../services/jpdb/audio';
import { fetchImmersionExamples, immersionText, type ImmersionExample } from '../../services/jpdb/immersionKit';
import { getSentences, PARTS_OF_SPEECH } from '../../services/jpdb/word';
import { placePopup, type Rect, type Side } from './popupPlacement';
import { resolvePopupPalette, type PopupPalette } from '../../theme/popupThemes';
import * as Haptics from 'expo-haptics';
import {
  applyFetchedExamples,
  buildGeminiPrompt,
  canStartPlayAll,
  isAnyExamplePlaying,
  isPlayAllCancelled,
  meaningsToggleLabel,
  mineButtonBg,
  mineButtonContent,
  mineButtonFg,
  nextExampleIndex,
  playPauseA11y,
  playPauseLabel,
  quickActionBg,
  reviewColor,
  reviewLabel,
  safeGroupMeanings,
  safeParsePitch,
  shiftPoint,
  shouldAutoFetchExamples,
  stateColors,
  trimGlossGroups,
  type GroupedMeanings,
  type SheetColors,
} from './wordSheetHelpers';

type Props = {
  readonly word: any;
  readonly onClose: () => void;
  /** Reader chrome is always dark; the browser follows the system theme. */
  readonly forceDark?: boolean;
  /** Push a new card state back into the page so the word repaints in place. */
  readonly onStateChange?: (vid: number, sid: number, state: string[]) => void;
  /** Native frame containing the WebView; browser word rects are local to it. */
  readonly anchorFrame?: { x: number; y: number; width: number; height: number };
  /**
   * Settings preview. Renders the real card with the supplied config inside a
   * fixed box, with every effect and gesture disabled. Using the real component
   * is the point -- a hand-built mock would drift from what it previews.
   */
  readonly preview?: { cfg: any; box: { width: number; maxHeight: number } };
};

type FlagName = 'blacklist' | 'never-forget';

// Proportions ported from jpd-breader content/popup.css, which sizes everything
// in em off a 13px base (`font-size: clamp(13px, 0.85vw, 16px)`), card
// `width: min(380px, 90vw)`, `max-height: min(62vh, 520px)`.
// jpd-breader scales the whole card with a CSS `zoom`; the equivalent here is
// scaling that base, since every dimension is already expressed in em().
const BASE = 13;
const POPUP_W = 380;
// Height to assume for the very first frame, before onLayout reports the real
// one. Only ever off by a frame. Collapsed now includes the kanji row.
const ESTIMATED_H = { collapsed: 380, expanded: 520 };
const em = (n: number) => Math.round(BASE * n * 10) / 10;

function MeaningsSection(props: {
  readonly grouped: GroupedMeanings;
  readonly visibleGroups: GroupedMeanings;
  readonly hiddenGlossCount: number;
  readonly showAllMeanings: boolean;
  readonly onShowDetails: () => void;
  readonly onToggleMeanings: () => void;
  readonly colors: SheetColors;
}): React.ReactElement | null {
  const { grouped, visibleGroups, hiddenGlossCount, showAllMeanings, colors, onShowDetails, onToggleMeanings } = props;
  if (!grouped.length) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        <Text style={[s.footnote, { color: colors.secondaryLabel }]}>No glosses yet</Text>
      </View>
    );
  }
  return (
    <View style={s.section}>
      {visibleGroups.map((g, idx) => (
        <View key={`meaning-${g.startIndex}-${g.partOfSpeech.join('|')}-${idx}`} style={{ marginTop: idx === 0 ? 6 : 4 }}>
          <Text style={[s.posText, { color: colors.secondaryLabel }]}>
            {(g.partOfSpeech.map((p) => PARTS_OF_SPEECH[p] ?? p).filter(Boolean).join(', ') || '—')}
          </Text>
          <View style={{ gap: 2, marginTop: 2 }}>
            {g.glosses.map((gl, i) => (
              <View key={`gloss-${g.startIndex}-${i}-${gl.join('; ').slice(0, 32)}`} style={{ flexDirection: 'row', gap: 7 }}>
                <Text style={[s.glossIndex, { color: colors.tertiaryLabel }]}>{g.startIndex + i + 1}.</Text>
                <Text style={[s.gloss, { color: colors.onSurface }]}>{gl.join('; ')}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
      {hiddenGlossCount > 0 ? (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            onShowDetails();
            onToggleMeanings();
          }}
          style={({ pressed }) => [s.moreBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]}
          hitSlop={6}
        >
          <Text style={[s.moreText, { color: colors.primary }]}>
            {meaningsToggleLabel(showAllMeanings, hiddenGlossCount)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type ReviewRating = 'nothing' | 'something' | 'hard' | 'good' | 'easy';

function ReviewSection(props: {
  readonly showDetails: boolean;
  readonly showReviewButtons: boolean | undefined;
  readonly reviewLoading: string | null;
  readonly onReview: (rating: ReviewRating) => void;
  readonly colors: SheetColors;
  readonly primary: string;
  readonly isDark: boolean;
}): React.ReactElement | null {
  const { showDetails, showReviewButtons, reviewLoading, onReview, colors, primary, isDark } = props;
  if (!showDetails || showReviewButtons !== true) {
    return null;
  }
  return (
    <View style={[s.reviewRow, { borderBottomColor: colors.separator }]}>
      {(['nothing', 'something', 'hard', 'good', 'easy'] as const).map((r) => (
        <Pressable key={r} onPress={() => onReview(r)} style={({ pressed }) => [s.reviewBtn, { backgroundColor: reviewColor(r, primary, isDark), opacity: pressed ? 0.8 : 1 }]}>
          {(() => {
            if (reviewLoading === r) {
              return <ActivityIndicator size="small" color="#fff" />;
            }
            return <Text style={s.reviewText}>{reviewLabel(r)}</Text>;
          })()}
        </Pressable>
      ))}
    </View>
  );
}

function usePlacementController(
  word: any,
  preview: Props['preview'],
  anchorFrame: Props['anchorFrame'],
  showDetails: boolean,
  showExamples: boolean,
  insets: { top: number; right: number; bottom: number; left: number },
) {
  // Placement is pure geometry and lives in popupPlacement.ts so it can be
  // exercised headlessly -- see npm run test:placement. The short version: the
  // popup avoids the whole speech bubble (not just the glyph) and the patch of
  // screen the reader's fingertip is already hiding, then hugs the word.
  const { width: winW, height: winH } = useWindowDimensions();
  const popupExpanded = showDetails || showExamples;
  const measureKey = popupExpanded ? 'expanded' : 'collapsed';

  // Two-pass: lay out against an estimate, measure the real card, re-place.
  // The old code positioned against the *max* height (360/560) as though that
  // were the card, which shoved short cards far away from their word.
  const [heights, setHeights] = useState<{ collapsed?: number; expanded?: number }>({});
  const [revealed, setRevealed] = useState(false);
  // Sticky side, tied to the rect it was chosen for. Growing the card keeps its
  // side; a pan that moves the word must re-solve from scratch, or the popup
  // clings to a side that no longer suits where the word ended up.
  const stickyRef = useRef<{ key: string; side: Side } | null>(null);
  const anchorKey = useMemo(() => {
    const r = word.rect;
    if (!r) {
      return 'none';
    }
    return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
  }, [word.rect]);

  const onSheetLayout = useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      const h = Math.round(event.nativeEvent.layout.height);
      if (!h) {
        return;
      }
      // First measurement per state only. Re-placing on every content change
      // would both loop (height feeds maxHeight feeds height) and twitch the
      // card while it is being read.
      setHeights((prev) => (prev[measureKey] != null ? prev : { ...prev, [measureKey]: h }));
      setRevealed(true);
    },
    [measureKey]
  );

  const cap = computeCap(winH, popupExpanded);
  const desiredH = Math.min(heights[measureKey] ?? ESTIMATED_H[measureKey], cap);
  // One width for both states, so opening Details grows the card downward
  // instead of also shunting it sideways. The rule is jpd-breader's own
  // `width: min(380px, 90vw)` -- full 380 on a tablet, a little breathing room
  // at the screen edges on a phone.
  const desiredW = Math.min(POPUP_W, Math.round(winW * 0.9));

  const placement = useMemo(() => {
    if (preview) {
      return {
        width: preview.box.width,
        maxHeight: preview.box.maxHeight,
        side: 'center' as Side,
        originX: 0.5,
        originY: 0.5,
      };
    }
    // getBoundingClientRect is layout-viewport relative. On a pinch-zoomed web
    // page the reader only sees the visual viewport, so shift into it first.
    const visual = word.visual;
    const shift = <T extends { x: number; y: number }>(p: T | null | undefined): T | null =>
      shiftPoint(p, visual);
    const rects: Rect[] | null = Array.isArray(word.rects)
      ? (word.rects.map(shift).filter(Boolean) as Rect[])
      : null;

    const result = placePopup({
      wordRect: shift<Rect>(word.rect),
      wordRects: rects,
      boxRect: shift<Rect>(word.boxRect),
      point: shift<{ x: number; y: number }>(word.point),
      pointerType: word.pointerType === 'mouse' ? 'mouse' : 'touch',
      vertical: !!word.vertical,
      vw: visual?.width || word.vw,
      viewport: { width: winW, height: winH },
      safe: insets,
      anchorFrame,
      desired: { width: desiredW, height: desiredH },
      cap,
      prefer: stickyRef.current?.key === anchorKey ? stickyRef.current.side : undefined,
    });
    stickyRef.current = { key: anchorKey, side: result.side };
    return result;
  }, [preview, word, anchorKey, winW, winH, insets, anchorFrame, desiredW, desiredH, cap]);

  const { originX, originY, width: boxW } = placement;
  const boxH = Math.min(desiredH, placement.maxHeight);

  const enter = useSharedValue(0);

  // Grows out of the edge facing the word rather than out of its own centre,
  // so the card visibly belongs to the thing that was tapped. Scaling about an
  // arbitrary origin is a centre scale plus a translation of origin * (1 - s).
  const animatedSheetStyle = useAnimatedStyle(() => {
    const scale = 0.92 + enter.value * 0.08;
    const rest = 1 - scale;
    return {
      opacity: enter.value,
      transform: [
        { translateX: (originX - 0.5) * boxW * rest },
        { translateY: (originY - 0.5) * boxH * rest },
        { scale },
      ],
    };
  }, [originX, originY, boxW, boxH]);

  return {
    winW, winH, popupExpanded, measureKey,
    heights, revealed, setRevealed,
    anchorKey, onSheetLayout, cap, desiredH, desiredW,
    placement, originX, originY, boxW, boxH,
    enter, animatedSheetStyle,
  };
}

function computeCap(winH: number, popupExpanded: boolean): number {
  if (popupExpanded) {
    return Math.min(Math.round(winH * 0.68), 560);
  }
  return Math.min(Math.round(winH * 0.56), 440);
}

function buildDismiss(
  pronunciationRun: React.RefObject<number>,
  pronunciationTimer: React.RefObject<ReturnType<typeof setTimeout> | null>,
  ikRequest: React.RefObject<number>,
  ikPlaybackRun: React.RefObject<number>,
  onCloseRef: React.RefObject<() => void>,
): () => void {
  return () => {
    pronunciationRun.current++;
    if (pronunciationTimer.current) {
      clearTimeout(pronunciationTimer.current);
      pronunciationTimer.current = null;
    }
    ikRequest.current++;
    ikPlaybackRun.current++;
    stopAudio();
    onCloseRef.current();
  };
}

function ImmersionLoading({ accent, labelColor }: { readonly accent: string; readonly labelColor: string }) {
  return (
    <View style={s.exampleLoading}>
      <ActivityIndicator size="small" color={accent} />
      <Text style={[s.footnote, { color: labelColor }]}>Finding natural examples…</Text>
    </View>
  );
}

function ImmersionError({
  message,
  colors,
  onRetry,
}: {
  readonly message: string;
  readonly colors: any;
  readonly onRetry: () => void;
}) {
  return (
    <View style={s.exampleLoading}>
      <Text style={[s.footnote, { color: colors.secondaryLabel, flex: 1 }]}>{message}</Text>
      <Pressable onPress={onRetry} style={({ pressed }) => [s.exampleRetry, { backgroundColor: pressed ? colors.tertiarySystemFill : colors.secondarySystemFill }]}>
        <Text style={[s.quickActionText, { color: colors.primary }]}>Retry</Text>
      </Pressable>
    </View>
  );
}

function ExampleImage({
  example,
  playing,
  onTogglePlay,
}: {
  readonly example: ImmersionExample;
  readonly playing: boolean;
  readonly onTogglePlay: () => void;
}) {
  if (!example.imageUrl) {
    return null;
  }
  return (
    <Pressable onPress={onTogglePlay} style={s.exampleImageWrap} accessibilityLabel={playing ? 'Stop example audio' : 'Play example audio'}>
      <Image source={{ uri: example.imageUrl }} style={StyleSheet.absoluteFill as any} contentFit="cover" transition={180} cachePolicy="memory-disk" />
      {example.soundUrl ? (
        <View style={s.examplePlayOverlay}>
          <Icon name={playing ? 'pause' : 'audio'} size={17} color="#fff" strokeWidth={2.2} />
        </View>
      ) : null}
    </Pressable>
  );
}

function ExampleCopy({
  example,
  playing,
  colors,
  onTogglePlay,
}: {
  readonly example: ImmersionExample;
  readonly playing: boolean;
  readonly colors: any;
  readonly onTogglePlay: () => void;
}) {
  return (
    <View style={s.exampleCopy}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <Text style={[s.exampleSentence, { color: colors.onSurface }]}>{immersionText(example.sentence) || '—'}</Text>
        {!example.imageUrl && example.soundUrl ? (
          <Pressable onPress={onTogglePlay} style={({ pressed }) => [s.exampleAudioBtn, { backgroundColor: pressed ? colors.tertiarySystemFill : colors.secondarySystemFill }]} accessibilityLabel={playing ? 'Stop example audio' : 'Play example audio'}>
            <Icon name={playing ? 'pause' : 'audio'} size={16} color={colors.primary} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>
      {example.translation ? <Text style={[s.exampleTranslation, { color: colors.secondaryLabel }]}>{immersionText(example.translation)}</Text> : null}
    </View>
  );
}

function ImmersionBody({
  loading,
  error,
  example,
  playing,
  colors,
  accent,
  onRetry,
  onTogglePlay,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly example: ImmersionExample | undefined;
  readonly playing: boolean;
  readonly colors: any;
  readonly accent: string;
  readonly onRetry: () => void;
  readonly onTogglePlay: () => void;
}) {
  if (loading) {
    return <ImmersionLoading accent={accent} labelColor={colors.secondaryLabel} />;
  }
  if (error) {
    return <ImmersionError message={error} colors={colors} onRetry={onRetry} />;
  }
  if (!example) {
    return null;
  }
  return (
    <>
      <ExampleImage example={example} playing={playing} onTogglePlay={onTogglePlay} />
      <ExampleCopy example={example} playing={playing} colors={colors} onTogglePlay={onTogglePlay} />
    </>
  );
}

async function awaitExampleAudio(soundUrl: string): Promise<'ended' | 'stopped' | 'error'> {
  return new Promise<'ended' | 'stopped' | 'error'>((resolve) => {
    void playRemoteAudio(soundUrl, { onFinished: resolve }).then((ok) => {
      if (!ok) resolve('error');
    });
  });
}

async function runPlayAllSequence(
  examples: ImmersionExample[],
  startIndex: number,
  run: number,
  ctx: {
    runRef: { current: number };
    setIkIndex: (i: number) => void;
    setIkPlaying: (b: boolean) => void;
    setIkPlayingAll: (b: boolean) => void;
  },
): Promise<void> {
  for (let index = startIndex; index < examples.length; index++) {
    if (isPlayAllCancelled(ctx.runRef, run)) return;
    ctx.setIkIndex(index);
    const example = examples[index];
    ctx.setIkPlaying(!!example.soundUrl);
    if (example.soundUrl) {
      const reason = await awaitExampleAudio(example.soundUrl);
      if (isPlayAllCancelled(ctx.runRef, run) || reason !== 'ended') return;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 900));
      if (isPlayAllCancelled(ctx.runRef, run)) return;
    }
    ctx.setIkPlaying(false);
    if (index < examples.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  if (!isPlayAllCancelled(ctx.runRef, run)) {
    ctx.setIkPlaying(false);
    ctx.setIkPlayingAll(false);
    ctx.setIkIndex(0);
  }
}

async function startExampleAudio(
  target: ImmersionExample,
  loop: boolean,
  run: number,
  runRef: { current: number },
  setters: {
    setPlaying: (b: boolean) => void;
    setLooping: (b: boolean) => void;
    setPlayingAll: (b: boolean) => void;
  },
): Promise<boolean> {
  const ok = await playRemoteAudio(target.soundUrl as string, {
    loop,
    onFinished: (reason) => {
      if (runRef.current !== run) return;
      setters.setPlaying(false);
      setters.setLooping(false);
      if (reason === 'error') Alert.alert('Example audio unavailable', lastAudioError());
    },
  });
  if (!ok && runRef.current === run) {
    setters.setPlaying(false);
    setters.setLooping(false);
  }
  return ok;
}

function useImmersionController(
  spelling: string,
  cancelAutomaticPronunciation: () => void,
) {
  const [ikExamples, setIkExamples] = useState<ImmersionExample[] | null>(null);
  const [ikLoading, setIkLoading] = useState(false);
  const [ikPlaying, setIkPlaying] = useState(false);
  const [ikLooping, setIkLooping] = useState(false);
  const [ikPlayingAll, setIkPlayingAll] = useState(false);
  const [ikIndex, setIkIndex] = useState(0);
  const [ikError, setIkError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const ikRequest = useRef(0);
  const ikPlaybackRun = useRef(0);

  const stopExamplePlayback = useCallback(() => {
    ikPlaybackRun.current++;
    stopAudio();
    setIkPlaying(false);
    setIkLooping(false);
    setIkPlayingAll(false);
  }, []);

  const playExample = useCallback(async (example?: ImmersionExample, loop = false) => {
    const target = example ?? ikExamples?.[ikIndex];
    if (!target?.soundUrl) {
      Alert.alert('No example audio', 'This ImmersionKit example only contains text.');
      return;
    }
    cancelAutomaticPronunciation();
    const run = ++ikPlaybackRun.current;
    stopAudio();
    setIkPlaying(true);
    setIkLooping(loop);
    setIkPlayingAll(false);
    Haptics.selectionAsync();
    await startExampleAudio(target, loop, run, ikPlaybackRun, {
      setPlaying: setIkPlaying,
      setLooping: setIkLooping,
      setPlayingAll: setIkPlayingAll,
    });
  }, [ikExamples, ikIndex, cancelAutomaticPronunciation]);

  const fetchImmersion = useCallback(async (w: string, autoplay = true) => {
    const request = ++ikRequest.current;
    setShowExamples(true);
    setIkLoading(true);
    setIkError(null);
    try {
      const examples = await fetchImmersionExamples(w);
      if (request !== ikRequest.current) return;
      applyFetchedExamples(examples, autoplay, {
        setExamples: setIkExamples,
        setIndex: setIkIndex,
        setError: setIkError,
      }, (first) => { void playExample(first); });
    } catch (error: any) {
      if (request !== ikRequest.current) return;
      setIkExamples([]);
      setIkError(error?.message ? String(error.message) : 'ImmersionKit is unavailable.');
    } finally {
      if (request === ikRequest.current) setIkLoading(false);
    }
  }, [playExample]);

  const toggleExamples = useCallback(() => {
    Haptics.selectionAsync();
    if (showExamples) {
      setShowExamples(false);
      stopExamplePlayback();
      return;
    }
    setShowExamples(true);
    if (shouldAutoFetchExamples(ikExamples, ikLoading)) void fetchImmersion(spelling);
  }, [showExamples, ikExamples, ikLoading, fetchImmersion, spelling, stopExamplePlayback]);

  const moveExample = useCallback((delta: number) => {
    if (!ikExamples?.length) return;
    stopExamplePlayback();
    const next = nextExampleIndex(ikIndex, delta, ikExamples.length);
    setIkIndex(next);
    Haptics.selectionAsync();
    if (ikExamples[next].soundUrl) void playExample(ikExamples[next]);
  }, [ikExamples, ikIndex, playExample, stopExamplePlayback]);

  const toggleExamplePlay = useCallback(() => {
    if (isAnyExamplePlaying(ikPlaying, ikLooping, ikPlayingAll)) {
      stopExamplePlayback();
      return;
    }
    void playExample();
  }, [ikPlaying, ikLooping, ikPlayingAll, playExample, stopExamplePlayback]);

  const toggleExampleLoop = useCallback(() => {
    if (ikLooping) {
      stopExamplePlayback();
      return;
    }
    void playExample(undefined, true);
  }, [ikLooping, playExample, stopExamplePlayback]);

  const togglePlayAll = useCallback(async () => {
    if (!canStartPlayAll(ikPlayingAll, ikExamples)) {
      if (ikPlayingAll) {
        stopExamplePlayback();
      }
      return;
    }
    cancelAutomaticPronunciation();
    const run = ++ikPlaybackRun.current;
    stopAudio();
    setIkLooping(false);
    setIkPlayingAll(true);
    Haptics.selectionAsync();
    await runPlayAllSequence(ikExamples, ikIndex, run, {
      runRef: ikPlaybackRun,
      setIkIndex,
      setIkPlaying,
      setIkPlayingAll,
    });
  }, [ikPlayingAll, ikExamples, ikIndex, cancelAutomaticPronunciation, stopExamplePlayback]);

  return {
    ikExamples, setIkExamples, ikLoading, ikPlaying, ikLooping, ikPlayingAll,
    ikIndex, setIkIndex, ikError, showExamples, setShowExamples,
    ikRequest, ikPlaybackRun,
    stopExamplePlayback, playExample, fetchImmersion,
    toggleExamples, moveExample, toggleExamplePlay, toggleExampleLoop, togglePlayAll,
  };
}

function useWordActions(args: {
  vid: number;
  sid: number;
  spelling: string;
  reading: string;
  meanings: any[];
  pitchAccent: string[];
  sentence: string;
  translation: string;
  forq: boolean;
  cfg: any;
  pushState: (st: string[]) => void;
  dismiss: () => void;
  setPlaying: (b: boolean) => void;
  pronunciationRun: { current: number };
  setShowDetails: (b: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);
  const [flagLoading, setFlagLoading] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState<string | null>(null);
  const [geminiText, setGeminiText] = useState<string | null>(null);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const lastAudioAlert = useRef(0);

  const explainWithGemini = useCallback(async () => {
    if (geminiLoading) return;
    if (!args.cfg?.geminiApiKey) {
      Alert.alert('AI Explain', 'Add your Gemini API key in Settings → JPDB to use AI explanations.');
      return;
    }
    Haptics.selectionAsync();
    args.setShowDetails(true);
    setGeminiError(null);
    setGeminiText(null);
    setGeminiLoading(true);
    try {
      const prompt = buildGeminiPrompt(args.spelling, args.reading, args.meanings, args.pitchAccent, args.sentence);
      const text = await geminiApi.explainWord({ apiKey: args.cfg.geminiApiKey, prompt });
      const trimmed = text?.trim();
      if (trimmed) {
        setGeminiText(trimmed);
      } else {
        setGeminiError('The AI returned an empty response. Please try again.');
      }
    } catch (e: any) {
      console.warn('[wordsheet] gemini explain failed', e);
      setGeminiError(String(e?.message ?? e));
    } finally {
      setGeminiLoading(false);
    }
  }, [geminiLoading, args]);

  const mine = useCallback(async (rating?: ReviewRating) => {
    setAdding(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const token = args.cfg?.apiToken;
      if (!token) throw new Error('Missing JPDB token — open Settings');
      await jpdbApi.mine({ vid: args.vid, sid: args.sid, apiToken: token, sentence: args.sentence || undefined, translation: args.translation || undefined, forq: args.forq, reviewRating: rating });
      setDone(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const st = await jpdbApi.getCardState({ vid: args.vid, sid: args.sid, apiToken: token });
      args.pushState(st);
      if (!rating) setTimeout(args.dismiss, 650);
    } catch (e: any) {
      Alert.alert('Mine failed', String(e.message));
    }
    setAdding(false);
  }, [args]);

  const toggleFlag = useCallback(async (flag: FlagName, localState: string[]) => {
    setFlagLoading(flag);
    try {
      const token = args.cfg?.apiToken;
      if (!token) throw new Error('No token');
      const stateKey = flag === 'blacklist' ? 'blacklisted' : 'never-forget';
      const currently = localState.includes(stateKey);
      await jpdbApi.setFlag({ vid: args.vid, sid: args.sid, flag, state: !currently, apiToken: token });
      const st = await jpdbApi.getCardState({ vid: args.vid, sid: args.sid, apiToken: token });
      args.pushState(st);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      console.warn(`[wordsheet] flag ${flag} failed`, e);
      Alert.alert('Flag failed', String(e?.message ?? e));
    }
    setFlagLoading(null);
  }, [args]);

  const review = useCallback(async (rating: ReviewRating) => {
    setReviewLoading(rating);
    try {
      await jpdbApi.review({ vid: args.vid, sid: args.sid, rating });
      const token = args.cfg?.apiToken;
      if (token) {
        const st = await jpdbApi.getCardState({ vid: args.vid, sid: args.sid, apiToken: token });
        args.pushState(st);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Review failed', String(e.message));
    }
    setReviewLoading(null);
  }, [args]);

  const play = useCallback(async () => {
    args.setPlaying(true);
    Haptics.selectionAsync();
    const run = ++args.pronunciationRun.current;
    const ok = await playAudioForWord(args.vid, args.spelling);
    if (args.pronunciationRun.current === run) args.setPlaying(false);
    if (!ok) {
      const reason = lastAudioError();
      const noisy = reason && reason !== 'No JPDB recording for this word';
      if (args.pronunciationRun.current === run && noisy && Date.now() - lastAudioAlert.current > 10000) {
        lastAudioAlert.current = Date.now();
        Alert.alert('Audio unavailable', reason);
      }
    }
  }, [args]);

  return {
    adding, done, flagLoading, reviewLoading,
    geminiText, setGeminiText, geminiError, setGeminiError, geminiLoading,
    explainWithGemini, mine, toggleFlag, review, play,
  };
}

function WordHeader(props: {
  readonly spelling: string;
  readonly reading: string;
  readonly frequencyRank: number | null | undefined;
  readonly pitchSegments: { text: string; isHigh: boolean; isFinal: boolean }[] | null;
  readonly playing: boolean;
  readonly localState: string[];
  readonly isDark: boolean;
  readonly colors: SheetColors;
  readonly onPlay: () => void;
  readonly onDismiss: () => void;
}): React.ReactElement {
  const { spelling, reading, frequencyRank, pitchSegments, playing, localState, isDark, colors, onPlay, onDismiss } = props;
  return (
    <View style={s.header}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.spelling, { color: colors.onSurface }]} numberOfLines={2}>{spelling}</Text>
        <View style={s.metaRow}>
          {frequencyRank ? (
            <View style={[s.freqPill, { backgroundColor: isDark ? '#1c2f6b' : '#e8f0fe' }]}>
              <Text style={[s.freqText, { color: colors.primary }]}>Top {frequencyRank}</Text>
            </View>
          ) : null}
          {(() => {
            if (pitchSegments) {
              return (
                <View style={{ flexDirection: 'row' }}>
                  {pitchSegments.map((seg, i) => (
                    <Text key={`${seg.text}-${seg.isHigh ? 'high' : 'low'}-${seg.isFinal ? 'final' : 'mid'}-${i}`} style={{ color: colors.secondaryLabel, fontWeight: '600', borderStyle: 'solid', borderColor: seg.isHigh ? colors.primary : '#d93025', borderTopWidth: seg.isHigh ? 1.6 : 0, borderBottomWidth: seg.isHigh ? 0 : 1.6, paddingHorizontal: 1.5, fontSize: em(0.95) }}>
                      {seg.text}
                    </Text>
                  ))}
                </View>
              );
            }
            if (reading && reading !== spelling) {
              return (
                <Text style={[s.metaText, { color: colors.secondaryLabel }]} numberOfLines={1}>{reading}</Text>
              );
            }
            return null;
          })()}
        </View>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        {/* Only the two actions worth reaching for mid-sentence stay
            up here; AI and blacklist live in the actions row so the
            word itself is not squeezed into two lines. */}
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Pressable onPress={onPlay} hitSlop={8} style={({ pressed }) => [s.iconBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} accessibilityLabel="Play audio">
            {playing ? <ActivityIndicator size="small" color={colors.secondaryLabel} /> : <Icon name="audio" size={17} color={colors.secondaryLabel} strokeWidth={2} />}
          </Pressable>
          <Pressable onPress={onDismiss} hitSlop={10} style={({ pressed }) => [s.iconBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} accessibilityLabel="Close lookup">
            <Icon name="close" size={15} color={colors.secondaryLabel} strokeWidth={2.2} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {(localState.length ? localState : ['not-in-deck']).map((st) => {
            const c = stateColors(st, isDark);
            return (
              <View key={st} style={[s.statePill, { backgroundColor: c.bg }]}>
                <Text style={[s.statePillText, { color: c.fg }]}>{st}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function KanjiSection(props: {
  readonly cfg: any;
  readonly kanjiDetails: KanjiDetail[] | null;
  readonly kanjiLoading: boolean;
  readonly showKanjiPanel: string | null;
  readonly showMnemonic: boolean;
  readonly colors: SheetColors;
  readonly onToggleKanji: (next: string | null) => void;
  readonly onToggleMnemonic: () => void;
}): React.ReactElement | null {
  const { cfg, kanjiDetails, kanjiLoading, showKanjiPanel, showMnemonic, colors, onToggleKanji, onToggleMnemonic } = props;
  if (cfg?.showKanji === false || (!kanjiDetails && !kanjiLoading)) {
    return null;
  }
  return (
    <View style={s.kanjiWrap}>
      {kanjiDetails && kanjiDetails.length > 3 ? (
        <View style={s.kanjiHeader}>
          <Text style={[s.posText, { color: colors.secondaryLabel }]}>Kanji</Text>
          <View style={[s.countBadge, { backgroundColor: colors.systemFill }]}>
            <Text style={[s.countText, { color: colors.primary }]}>{kanjiDetails.length}</Text>
          </View>
        </View>
      ) : null}
      {(() => {
        if (kanjiLoading && !kanjiDetails?.length) {
          return (
            <ActivityIndicator size="small" color={colors.secondaryLabel} style={{ alignSelf: 'flex-start' }} />
          );
        }
        if (kanjiDetails?.length) {
          return (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {kanjiDetails.map((d) => {
                const active = showKanjiPanel === d.kanji;
                return (
                  <Pressable
                    key={d.kanji}
                    onPress={() => {
                      Haptics.selectionAsync();
                      onToggleKanji(active ? null : d.kanji);
                    }}
                    style={({ pressed }) => [s.kanjiChip, { backgroundColor: active ? colors.systemFill : colors.tertiarySystemFill, borderColor: active ? colors.primary : colors.separator, opacity: pressed ? 0.85 : 1 }]}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '800', color: colors.primary }}>{d.kanji}</Text>
                    <Text style={[s.kanjiMean, { color: colors.onSurface }]} numberOfLines={1}>
                      {d.meanings?.slice(0, 28) || '—'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        }
        return null;
      })()}
      {(() => {
        const sel = kanjiDetails?.find((d) => d.kanji === showKanjiPanel);
        if (!showKanjiPanel || !sel) return null;
        return (
          <View style={[s.kanjiDetail, { backgroundColor: colors.systemFill, borderColor: colors.separator }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: colors.primary }}>{sel.kanji}</Text>
              <Text style={[s.footnote, { color: colors.secondaryLabel }]}>·</Text>
              <Text style={[s.bodySmall, { color: colors.onSurface, fontWeight: '600', flex: 1 }]} numberOfLines={2}>{sel.meanings || '—'}</Text>
              <Pressable onPress={() => { onToggleKanji(null); }} hitSlop={8} style={[s.miniClose, { backgroundColor: colors.surface }]}>
                <Icon name="close" size={12} color={colors.secondaryLabel} strokeWidth={2.2} />
              </Pressable>
            </View>
            {sel.components?.length ? (
              <View style={s.compGrid}>
                {sel.components.map((c) => (
                  <View key={c.component} style={[s.compCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
                    <Text style={[s.compChar, { color: colors.primary }]}>{c.component}</Text>
                    <Text style={[s.compMean, { color: colors.secondaryLabel }]} numberOfLines={2}>{c.meaning || '—'}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {cfg?.showRtk && sel.rtk ? (
              <>
                <Pressable onPress={() => { Haptics.selectionAsync(); onToggleMnemonic(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: sel.components?.length ? 8 : 4 }} hitSlop={6}>
                  <Text style={[s.footnote, { color: colors.secondaryLabel, fontWeight: '600' }]}>✦ Mnemonic</Text>
                  <Icon name={showMnemonic ? 'chevronDown' : 'chevronRight'} size={12} color={colors.tertiaryLabel} strokeWidth={2.2} />
                </Pressable>
                {showMnemonic ? (
                  <Text style={[s.footnote, { color: colors.onSurface, lineHeight: 19, marginTop: 4 }]}>{sel.rtk}</Text>
                ) : null}
              </>
            ) : null}
          </View>
        );
      })()}
    </View>
  );
}

function ActionsSection(props: {
  readonly cfg: any;
  readonly adding: boolean;
  readonly doneOrInDeck: boolean;
  readonly isNeverForget: boolean;
  readonly isBlacklisted: boolean;
  readonly flagLoading: string | null;
  readonly showExamples: boolean;
  readonly geminiLoading: boolean;
  readonly showDetails: boolean;
  readonly colors: SheetColors;
  readonly ghostPurple: { readonly borderColor: string; readonly fg: string };
  readonly exampleAccent: string;
  readonly onMine: () => void;
  readonly onToggleFlag: (flag: FlagName) => void;
  readonly onToggleExamples: () => void;
  readonly onExplain: () => void;
  readonly onToggleDetails: () => void;
}): React.ReactElement {
  const { cfg, adding, doneOrInDeck, isNeverForget, isBlacklisted, flagLoading, showExamples, geminiLoading, showDetails, colors, ghostPurple, exampleAccent, onMine, onToggleFlag, onToggleExamples, onExplain, onToggleDetails } = props;
  return (
    <View style={[s.quickActions, { borderTopColor: colors.separator }]}>
      {cfg?.showAddButton ? (
        <Pressable
          onPress={onMine}
          disabled={adding}
          style={({ pressed }) => [s.primaryAction, { backgroundColor: mineButtonBg(doneOrInDeck, colors.systemFill, colors.primary), opacity: pressed ? 0.82 : 1 }]}
        >
          {(() => {
            if (adding) {
              return <ActivityIndicator size="small" color="#fff" />;
            }
            const content = mineButtonContent(false, doneOrInDeck);
            const fg = mineButtonFg(doneOrInDeck, colors.primary);
            return <><Icon name={content.icon} size={14} color={fg} strokeWidth={2.3} /><Text style={[s.quickActionText, { color: fg }]}>{content.label}</Text></>;
          })()}
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => onToggleFlag('never-forget')}
        style={({ pressed }) => [s.quickAction, { backgroundColor: quickActionBg(isNeverForget, ghostPurple.borderColor + '22', pressed, colors.systemFill) }]}
      >
        {(() => {
          if (flagLoading === 'never-forget') {
            return <ActivityIndicator size="small" color={ghostPurple.fg} />;
          }
          if (isNeverForget) {
            return <Text style={[s.quickActionText, { color: ghostPurple.fg }]}>Remembering</Text>;
          }
          return <Text style={[s.quickActionText, { color: ghostPurple.fg }]}>Remember</Text>;
        })()}
      </Pressable>
      <Pressable
        onPress={onToggleExamples}
        style={({ pressed }) => [s.quickAction, { backgroundColor: quickActionBg(showExamples, exampleAccent + '1F', pressed, colors.systemFill) }]}
        accessibilityState={{ expanded: showExamples }}
      >
        <Icon name="play" size={12} color={exampleAccent} strokeWidth={2} />
        <Text style={[s.quickActionText, { color: exampleAccent }]}>Examples</Text>
      </Pressable>
      <Pressable
        onPress={onExplain}
        style={({ pressed }) => [s.quickAction, { backgroundColor: pressed ? colors.systemFill : 'transparent', opacity: geminiLoading ? 0.6 : 1 }]}
        accessibilityLabel="Explain with AI"
      >
        {geminiLoading
          ? <ActivityIndicator size="small" color={ghostPurple.fg} />
          : <Text style={[s.quickActionText, { color: ghostPurple.fg }]}>AI</Text>}
      </Pressable>
      {cfg?.showBlacklistButton ? (
        <Pressable
          onPress={() => onToggleFlag('blacklist')}
          style={({ pressed }) => [s.quickAction, { backgroundColor: quickActionBg(isBlacklisted, colors.error + '1F', pressed, colors.systemFill) }]}
          accessibilityLabel="Blacklist"
        >
          {(() => {
            if (flagLoading === 'blacklist') {
              return <ActivityIndicator size="small" color={colors.error} />;
            }
            return <Text style={[s.quickActionText, { color: colors.error }]}>Hide</Text>;
          })()}
        </Pressable>
      ) : null}
      <Pressable
        onPress={onToggleDetails}
        style={({ pressed }) => [s.quickAction, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]}
      >
        <Text style={[s.quickActionText, { color: colors.primary }]}>{showDetails ? 'Less' : 'Mine'}</Text>
        <Icon name={showDetails ? 'chevronDown' : 'chevronRight'} size={13} color={colors.primary} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

function ExampleNav(props: {
  readonly examples: ImmersionExample[];
  readonly index: number;
  readonly currentSoundUrl: string | undefined;
  readonly playing: boolean;
  readonly looping: boolean;
  readonly playingAll: boolean;
  readonly colors: SheetColors;
  readonly accent: string;
  readonly onMove: (delta: number) => void;
  readonly onTogglePlay: () => void;
  readonly onToggleLoop: () => void;
  readonly onTogglePlayAll: () => void;
}): React.ReactElement {
  const { examples, index, currentSoundUrl, playing, looping, playingAll, colors, accent, onMove, onTogglePlay, onToggleLoop, onTogglePlayAll } = props;
  const navDisabled = examples.length < 2;
  return (
    <View style={s.exampleNav}>
      <Pressable onPress={() => onMove(-1)} disabled={navDisabled} style={({ pressed }) => [s.exampleNavBtn, { backgroundColor: pressed ? colors.tertiarySystemFill : 'transparent', opacity: navDisabled ? 0.3 : 1 }]} accessibilityLabel="Previous example">
        <Icon name="chevronLeft" size={14} color={colors.primary} strokeWidth={2.2} />
      </Pressable>
      <Text style={[s.exampleCounter, { color: colors.secondaryLabel }]}>{index + 1}/{examples.length}</Text>
      <Pressable onPress={() => onMove(1)} disabled={navDisabled} style={({ pressed }) => [s.exampleNavBtn, { backgroundColor: pressed ? colors.tertiarySystemFill : 'transparent', opacity: navDisabled ? 0.3 : 1 }]} accessibilityLabel="Next example">
        <Icon name="chevronRight" size={14} color={colors.primary} strokeWidth={2.2} />
      </Pressable>
      <View style={[s.exampleControlDivider, { backgroundColor: colors.separator }]} />
      <Pressable
        onPress={onTogglePlay}
        disabled={!currentSoundUrl}
        style={({ pressed }) => [s.exampleNavBtn, { backgroundColor: pressed ? colors.tertiarySystemFill : 'transparent', opacity: currentSoundUrl ? 1 : 0.3 }]}
        accessibilityLabel={playPauseA11y(playing, looping, playingAll)}
      >
        <Icon name={playPauseLabel(playing, looping, playingAll)} size={13} color={accent} strokeWidth={2} />
      </Pressable>
      <Pressable
        onPress={onToggleLoop}
        disabled={!currentSoundUrl}
        style={({ pressed }) => [s.exampleNavBtn, { backgroundColor: quickActionBg(looping, accent + '26', pressed, colors.tertiarySystemFill), opacity: currentSoundUrl ? 1 : 0.3 }]}
        accessibilityLabel={looping ? 'Stop repeating example' : 'Repeat current example'}
        accessibilityState={{ selected: looping }}
      >
        <Icon name="repeat" size={15} color={looping ? accent : colors.secondaryLabel} strokeWidth={2} />
      </Pressable>
      <Pressable
        onPress={() => { onTogglePlayAll(); }}
        style={({ pressed }) => [s.exampleAllBtn, { backgroundColor: quickActionBg(playingAll, accent + '26', pressed, colors.tertiarySystemFill) }]}
        accessibilityLabel={playingAll ? 'Stop all examples' : 'Play all examples'}
        accessibilityState={{ selected: playingAll }}
      >
        <Text style={[s.exampleAllText, { color: playingAll ? accent : colors.secondaryLabel }]}>{playingAll ? 'Stop' : 'All'}</Text>
      </Pressable>
    </View>
  );
}

function ExamplesSection(props: {
  readonly showExamples: boolean;
  readonly currentExample: ImmersionExample | undefined;
  readonly ikExamples: ImmersionExample[] | null;
  readonly ikIndex: number;
  readonly ikLoading: boolean;
  readonly ikError: string | null;
  readonly ikPlaying: boolean;
  readonly ikLooping: boolean;
  readonly ikPlayingAll: boolean;
  readonly colors: SheetColors;
  readonly exampleAccent: string;
  readonly onMove: (delta: number) => void;
  readonly onTogglePlay: () => void;
  readonly onToggleLoop: () => void;
  readonly onTogglePlayAll: () => void;
  readonly onRetry: () => void;
}): React.ReactElement | null {
  const { showExamples, currentExample, ikExamples, ikIndex, ikLoading, ikError, ikPlaying, ikLooping, ikPlayingAll, colors, exampleAccent, onMove, onTogglePlay, onToggleLoop, onTogglePlayAll, onRetry } = props;
  if (!showExamples) {
    return null;
  }
  return (
    <View style={[s.exampleCard, { backgroundColor: colors.systemFill, borderColor: colors.separator }]}>
      <View style={s.exampleHeader}>
        <Text numberOfLines={1} style={[s.exampleSource, { color: colors.secondaryLabel }]}>
          {currentExample?.sourceTitle || 'ImmersionKit'}
        </Text>
        {ikExamples?.length ? (
          <ExampleNav
            examples={ikExamples}
            index={ikIndex}
            currentSoundUrl={currentExample?.soundUrl}
            playing={ikPlaying}
            looping={ikLooping}
            playingAll={ikPlayingAll}
            colors={colors}
            accent={exampleAccent}
            onMove={onMove}
            onTogglePlay={onTogglePlay}
            onToggleLoop={onToggleLoop}
            onTogglePlayAll={onTogglePlayAll}
          />
        ) : null}
      </View>

      <ImmersionBody
        loading={ikLoading}
        error={ikError}
        example={currentExample ?? undefined}
        playing={ikPlaying}
        colors={colors}
        accent={exampleAccent}
        onRetry={onRetry}
        onTogglePlay={onTogglePlay}
      />
    </View>
  );
}

function SentenceSection(props: {
  readonly showDetails: boolean;
  readonly showSentence: boolean;
  readonly sentence: string;
  readonly translation: string;
  readonly forq: boolean;
  readonly colors: SheetColors;
  readonly onToggleSentence: () => void;
  readonly onToggleForq: () => void;
  readonly onExpandContext: () => void;
  readonly onChangeSentence: (text: string) => void;
  readonly onChangeTranslation: (text: string) => void;
}): React.ReactElement | null {
  const { showDetails, showSentence, sentence, translation, forq, colors, onToggleSentence, onToggleForq, onExpandContext, onChangeSentence, onChangeTranslation } = props;
  if (!showDetails) {
    return null;
  }
  return (
    <View style={[s.section, { marginTop: 8 }]}>
      <Pressable
        onPress={onToggleSentence}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        hitSlop={6}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[s.posText, { color: colors.secondaryLabel }]}>Sentence</Text>
          <Icon name={showSentence ? 'chevronDown' : 'chevronRight'} size={13} color={colors.tertiaryLabel} strokeWidth={2.2} />
        </View>
        <Pressable onPress={onToggleForq} style={[s.forqPill, { backgroundColor: forq ? colors.primary : 'transparent', borderColor: forq ? colors.primary : colors.separator }]}>
          <Text style={[s.forqText, { color: forq ? '#fff' : colors.secondaryLabel }]}>{forq ? '✓ FORQ' : 'FORQ'}</Text>
        </Pressable>
      </Pressable>
      {!showSentence && sentence ? (
        <Text style={[s.footnote, { color: colors.secondaryLabel, marginTop: 3 }]} numberOfLines={2}>{sentence}</Text>
      ) : null}
      {showSentence ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 }}>
            <Pressable
              onPress={onExpandContext}
              hitSlop={6}
            >
              <Text style={[s.linkText, { color: colors.primary }]}>Expand context</Text>
            </Pressable>
          </View>
          <TextInput
            value={sentence}
            onChangeText={onChangeSentence}
            placeholder="Sentence for mining"
            placeholderTextColor={colors.tertiaryLabel}
            multiline
            textAlignVertical="top"
            style={[s.textArea, { color: colors.onSurface, backgroundColor: colors.systemFill }]}
          />
          <TextInput
            value={translation}
            onChangeText={onChangeTranslation}
            placeholder="Translation (optional)"
            placeholderTextColor={colors.tertiaryLabel}
            multiline
            textAlignVertical="top"
            style={[s.textArea, { minHeight: 34, marginTop: 6, color: colors.onSurface, backgroundColor: colors.systemFill }]}
          />
        </>
      ) : null}
    </View>
  );
}

function GeminiSection(props: {
  readonly geminiLoading: boolean;
  readonly geminiText: string | null;
  readonly geminiError: string | null;
  readonly colors: SheetColors;
  readonly onRetry: () => void;
  readonly onClear: () => void;
}): React.ReactElement | null {
  const { geminiLoading, geminiText, geminiError, colors, onRetry, onClear } = props;
  if (!geminiLoading && !geminiText && !geminiError) {
    return null;
  }
  return (
    <View style={[s.aiBox, { backgroundColor: colors.systemFill, borderColor: geminiError ? colors.error : colors.separator }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[s.posText, { color: geminiError ? colors.error : colors.primary }]}>AI explanation</Text>
        {(() => {
          if (geminiLoading) {
            return (
              <ActivityIndicator size="small" color={colors.secondaryLabel} />
            );
          }
          return (
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              {geminiError ? (
                <Pressable onPress={onRetry}>
                  <Text style={[s.linkText, { color: colors.primary }]}>Retry</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClear}>
                <Text style={[s.linkText, { color: colors.secondaryLabel }]}>Clear</Text>
              </Pressable>
            </View>
          );
        })()}
      </View>
      {(() => {
        if (geminiLoading && !geminiText) {
          return (
            <Text style={[s.bodySmall, { color: colors.secondaryLabel, lineHeight: 20, marginTop: 4 }]}>Thinking…</Text>
          );
        }
        if (geminiError) {
          return (
            <Text style={[s.bodySmall, { color: colors.error, lineHeight: 20, marginTop: 4 }]}>{geminiError}</Text>
          );
        }
        return (
          <View style={{ marginTop: 6 }}>
            <Markdown
              content={geminiText ?? ''}
              color={colors.onSurface}
              mutedColor={colors.secondaryLabel}
              accentColor={colors.primary}
              codeBg={colors.tertiarySystemFill}
              size={14}
            />
          </View>
        );
      })()}
    </View>
  );
}

export default function WordSheet({ word, onClose, forceDark, onStateChange, anchorFrame, preview }: Props) {
  const scheme = useColorScheme();
  const [loadedCfg, setLoadedCfg] = useState<any>(null);
  // In preview mode the config is driven from outside, so read it straight off
  // the prop -- state would lag a frame behind every Settings change.
  const cfg = preview ? preview.cfg : loadedCfg;
  // `auto` keeps the pre-theme behaviour: reader forces dark, browser follows
  // the system. Any named theme is an explicit opt-in.
  const palette: PopupPalette = useMemo(
    () => resolvePopupPalette(cfg?.popupTheme, forceDark || scheme === 'dark'),
    [cfg?.popupTheme, forceDark, scheme]
  );
  const isDark = palette.isDark;
  const colors = useMemo(() => {
    const { isDark: _drop, ...tokens } = palette;
    return { ...(isDark ? darkColors : lightColors), ...tokens };
  }, [isDark, palette]);
  const insets = useSafeAreaInsets();

  const [playing, setPlaying] = useState(false);
  const [localState, setLocalState] = useState<string[]>(word.state ?? []);
  const [sentence, setSentence] = useState('');
  const [translation, setTranslation] = useState('');
  const [forq, setForq] = useState(true);
  const [kanjiDetails, setKanjiDetails] = useState<KanjiDetail[] | null>(null);
  const [kanjiLoading, setKanjiLoading] = useState(false);
  const [showKanjiPanel, setShowKanjiPanel] = useState<string | null>(null);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [showSentence, setShowSentence] = useState(false);
  const [showAllMeanings, setShowAllMeanings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const pronunciationRun = useRef(0);
  const pronunciationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { vid, sid, spelling, reading, meanings, frequencyRank, pitchAccent = [] } = word;

  const cancelAutomaticPronunciation = useCallback(() => {
    pronunciationRun.current++;
    if (pronunciationTimer.current) {
      clearTimeout(pronunciationTimer.current);
      pronunciationTimer.current = null;
    }
    setPlaying(false);
  }, []);

  const {
    ikExamples, ikLoading, ikPlaying, ikLooping, ikPlayingAll,
    ikIndex, ikError, showExamples,
    ikRequest, ikPlaybackRun,
    fetchImmersion,
    toggleExamples, moveExample, toggleExamplePlay, toggleExampleLoop, togglePlayAll,
  } = useImmersionController(spelling, cancelAutomaticPronunciation);

  const {
    revealed, setRevealed, onSheetLayout,
    placement,
    enter, animatedSheetStyle,
  } = usePlacementController(word, preview, anchorFrame, showDetails, showExamples, insets);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismiss = useCallback(
    buildDismiss(pronunciationRun, pronunciationTimer, ikRequest, ikPlaybackRun, onCloseRef),
    [pronunciationRun, pronunciationTimer, ikRequest, ikPlaybackRun, onCloseRef],
  );

  useEffect(() => {
    // Hold the first frame back until onLayout has reported the real card size,
    // so the popup is never seen in its estimated position. The timer is a
    // safety net: a popup that somehow never lays out must still appear.
    if (preview) {
      enter.value = 1;
      return;
    }
    if (revealed) {
      enter.value = withSpring(1, { damping: 22, stiffness: 340, mass: 0.7 });
      return;
    }
    const t = setTimeout(() => setRevealed(true), 200);
    return () => clearTimeout(t);
  }, [enter, revealed, preview]);

  // Report state changes back to the page so the word recolours in place.
  const pushState = useCallback(
    (st: string[]) => {
      setLocalState(st);
      onStateChange?.(vid, sid, st);
    },
    [onStateChange, vid, sid]
  );

  const {
    adding, done, flagLoading, reviewLoading,
    geminiText, setGeminiText, geminiError, setGeminiError, geminiLoading,
    explainWithGemini, mine, toggleFlag, review, play,
  } = useWordActions({
    vid, sid, spelling, reading, meanings, pitchAccent,
    sentence, translation, forq, cfg,
    pushState, dismiss, setPlaying,
    pronunciationRun, setShowDetails,
  });

  useEffect(() => {
    if (preview) {
      // Kanji comes from bundled offline data, so the preview can show it.
      // ImmersionKit and the sentence miner are network/context work and stay
      // out of Settings entirely.
      if (preview.cfg?.showKanji) fetchKanji();
      return;
    }
    loadConfig().then((c) => {
      setLoadedCfg(c);
      setForq(!!c.forqOnMine);
      if (word.context != null && word.contextOffset != null) {
        try {
          const s = getSentences(word, c.contextWidth);
          setSentence(s);
        } catch {}
      }
      // Reveal examples automatically without racing their audio against the
      // pronunciation controlled by Sound on touch / hover.
      if (c.showExamplesAutomatically) fetchImmersion(word.spelling, false);
      if (c.showKanji) fetchKanji();
    });
  }, []);

  useEffect(() => () => {
    pronunciationRun.current++;
    if (pronunciationTimer.current) clearTimeout(pronunciationTimer.current);
    ikRequest.current++;
    ikPlaybackRun.current++;
    // Deliberately NOT stopAudio() here. Tapping another word unmounts this
    // sheet (its key changes) a beat AFTER the parent already began the next
    // word's pronunciation, so stopping here would cancel that fresh playback
    // and the sound would never play. Reader and browser both stop audio on
    // dismiss and before switching words, so nothing leaks.
  }, []);

  const fetchKanji = async () => {
    if (!word.spelling) return;
    setKanjiLoading(true);
    try {
      // Bundled offline data (meanings + components + RTK), network fallback inside.
      const details = await loadKanjiDetails(word.spelling, { showRtk: true });
      setKanjiDetails(details);
    } catch {}
    setKanjiLoading(false);
  };

  const handleToggleFlag = (flag: FlagName) => {
    void toggleFlag(flag, localState);
  };

  // Defensive: malformed lookup payloads must never blank the sheet.
  const grouped = safeGroupMeanings(meanings);
  const isBlacklisted = localState.includes('blacklisted');
  const isNeverForget = localState.includes('never-forget');

  // Trim the gloss list to the first few entries, keeping whole POS groups.
  const { visibleGroups, hiddenGlossCount } = trimGlossGroups(grouped, showDetails, showAllMeanings);

  const inDeck = localState.length > 0 && !localState.includes('not-in-deck');
  const pitchSegments = safeParsePitch(reading, pitchAccent);

  // Popup visual language mirrors jpd-breader content/popup.css: compact
  // floating card, single surface, small ghost buttons + traffic-light
  // review pills, tinted state badges — not a fullscreen iOS grouped sheet.
  const ghostPurple = { borderColor: isDark ? '#d7aefb' : '#7b1fa2', fg: isDark ? '#d7aefb' : '#7b1fa2' };
  const currentExample = ikExamples?.[ikIndex];
  const exampleAccent = isDark ? '#FFB340' : '#C65D00';

  return (
    <View
      pointerEvents={preview ? 'none' : 'box-none'}
      style={preview ? { width: placement.width } : (StyleSheet.absoluteFill as any)}
    >
      {/* No backdrop on purpose: like Yomitan, the page stays live underneath so
          you can read on or tap straight through to the next word. */}
      <Animated.View
        onLayout={onSheetLayout}
        style={[
          s.sheet,
          preview
            ? { position: 'relative', width: placement.width, maxHeight: placement.maxHeight }
            : {
                width: placement.width,
                maxHeight: placement.maxHeight,
                left: placement.left,
                right: placement.right,
                top: placement.top,
                bottom: placement.bottom,
              },
          {
            backgroundColor: colors.surface,
            borderColor: colors.separator,
            boxShadow: '0 6px 24px rgba(0,0,0,0.34), 0 2px 8px rgba(0,0,0,0.24)',
          },
          animatedSheetStyle,
        ]}
      >
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            showsVerticalScrollIndicator
            contentContainerStyle={{ paddingBottom: em(0.62) }}
            bounces
            keyboardShouldPersistTaps="handled"
          >
              <WordHeader
                spelling={spelling}
                reading={reading}
                frequencyRank={frequencyRank}
                pitchSegments={pitchSegments}
                playing={playing}
                localState={localState}
                isDark={isDark}
                colors={colors}
                onPlay={play}
                onDismiss={dismiss}
              />

              {/* Meanings. Common verbs carry 15+ glosses, so the tail is
                  collapsed behind a disclosure rather than filling the card. */}
              <MeaningsSection
                grouped={grouped}
                visibleGroups={visibleGroups}
                hiddenGlossCount={hiddenGlossCount}
                showAllMeanings={showAllMeanings}
                onShowDetails={() => {
                  if (!showDetails) {
                    setShowDetails(true);
                  }
                }}
                onToggleMeanings={() => setShowAllMeanings((v) => !v)}
                colors={colors}
              />

              <KanjiSection
                cfg={cfg}
                kanjiDetails={kanjiDetails}
                kanjiLoading={kanjiLoading}
                showKanjiPanel={showKanjiPanel}
                showMnemonic={showMnemonic}
                colors={colors}
                onToggleKanji={(next) => {
                  setShowKanjiPanel(next);
                  setShowMnemonic(false);
                }}
                onToggleMnemonic={() => setShowMnemonic((v) => !v)}
              />

              <ActionsSection
                cfg={cfg}
                adding={adding}
                doneOrInDeck={done || inDeck}
                isNeverForget={isNeverForget}
                isBlacklisted={isBlacklisted}
                flagLoading={flagLoading}
                showExamples={showExamples}
                geminiLoading={geminiLoading}
                showDetails={showDetails}
                colors={colors}
                ghostPurple={ghostPurple}
                exampleAccent={exampleAccent}
                onMine={() => { void mine(); }}
                onToggleFlag={handleToggleFlag}
                onToggleExamples={toggleExamples}
                onExplain={explainWithGemini}
                onToggleDetails={() => { Haptics.selectionAsync(); setShowDetails((v) => !v); }}
              />

              <ExamplesSection
                showExamples={showExamples}
                currentExample={currentExample ?? undefined}
                ikExamples={ikExamples}
                ikIndex={ikIndex}
                ikLoading={ikLoading}
                ikError={ikError}
                ikPlaying={ikPlaying}
                ikLooping={ikLooping}
                ikPlayingAll={ikPlayingAll}
                colors={colors}
                exampleAccent={exampleAccent}
                onMove={moveExample}
                onTogglePlay={toggleExamplePlay}
                onToggleLoop={toggleExampleLoop}
                onTogglePlayAll={togglePlayAll}
                onRetry={() => fetchImmersion(spelling)}
              />

              {/* Review buttons — solid traffic-light pills, opt-in via Settings */}
              <ReviewSection
                showDetails={showDetails}
                showReviewButtons={cfg?.showReviewButtons}
                reviewLoading={reviewLoading}
                onReview={(r) => review(r)}
                colors={colors}
                primary={colors.primary}
                isDark={isDark}
              />

              <SentenceSection
                showDetails={showDetails}
                showSentence={showSentence}
                sentence={sentence}
                translation={translation}
                forq={forq}
                colors={colors}
                onToggleSentence={() => { Haptics.selectionAsync(); setShowSentence((v) => !v); }}
                onToggleForq={() => setForq((v) => !v)}
                onExpandContext={() => {
                  if (cfg && word.context) {
                    const wider = getSentences(word, Math.min(10, cfg.contextWidth + 1));
                    setSentence(wider);
                    Haptics.selectionAsync();
                  }
                }}
                onChangeSentence={setSentence}
                onChangeTranslation={setTranslation}
              />

              <GeminiSection
                geminiLoading={geminiLoading}
                geminiText={geminiText}
                geminiError={geminiError}
                colors={colors}
                onRetry={explainWithGemini}
                onClear={() => { setGeminiText(null); setGeminiError(null); }}
              />

          </ScrollView>
        </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  // Popup anchored to the tapped word (see `placement`), not a docked sheet.
  sheet: {
    position: 'absolute',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous' as any,
    overflow: 'hidden',
    elevation: 24,
  },
  // popup.css #header: padding 0.77em 0.92em 0.31em, gap 0.62em
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: em(0.62), paddingHorizontal: em(0.92), paddingTop: em(0.77), paddingBottom: em(0.31) },
  spelling: { fontFamily: 'System', fontSize: em(1.85), lineHeight: em(1.85) * 1.25, fontWeight: '700' as const, letterSpacing: -0.6 },
  // popup.css .metainfo: gap 0.46em, font 0.88em
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: em(0.46), paddingTop: em(0.15) },
  metaText: { fontFamily: 'System', fontSize: em(0.88), fontWeight: '500' as const },
  freqPill: { borderRadius: 999, paddingHorizontal: em(0.62), paddingVertical: em(0.08) },
  freqText: { fontFamily: 'System', fontSize: em(0.85), fontWeight: '700' as const, fontVariant: ['tabular-nums'] as any },
  // popup.css .state span: 0.73em, 700, uppercase, letter-spacing 0.08em
  statePill: { paddingHorizontal: em(0.62), paddingVertical: em(0.15), borderRadius: 999 },
  statePillText: { fontFamily: 'System', fontSize: em(0.73), fontWeight: '700' as const, letterSpacing: em(0.73) * 0.08, textTransform: 'uppercase' as const },
  iconBtn: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  moreBtn: { alignSelf: 'flex-start', marginTop: em(0.3), paddingVertical: em(0.3), paddingHorizontal: em(0.4), borderRadius: 6 },
  moreText: { fontFamily: 'System', fontSize: em(0.88), fontWeight: '600' as const },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 7, paddingHorizontal: em(0.7), paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth },
  quickAction: { minHeight: 32, paddingHorizontal: 9, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  primaryAction: { minHeight: 32, paddingHorizontal: 12, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  quickActionText: { fontFamily: 'System', fontSize: 12.5, fontWeight: '700' as const, letterSpacing: -0.1 },
  // Review pills (popup.css #review-buttons)
  // popup.css pads each section rather than the scroll container, so dividers
  // and the review row can run full-bleed.
  section: { paddingHorizontal: em(0.92) },
  reviewRow: { flexDirection: 'row', gap: 5, paddingTop: 8, paddingBottom: 8, paddingHorizontal: em(0.92), borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  reviewBtn: { flex: 1, minHeight: 30, paddingVertical: 5, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  reviewText: { fontFamily: 'System', fontSize: 11, fontWeight: '600' as const, color: '#fff' },
  kanjiWrap: { paddingTop: 8, paddingHorizontal: em(0.92), gap: 6 },
  kanjiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countBadge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  countText: { fontFamily: 'System', fontSize: 11, fontWeight: '800' as const, fontVariant: ['tabular-nums'] as any },
  kanjiChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  kanjiMean: { fontFamily: 'System', fontSize: 12, fontWeight: '500' as const, maxWidth: 110 },
  kanjiDetail: { marginTop: 2, borderRadius: 10, borderWidth: 1, padding: 10, gap: 2 },
  miniClose: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  compGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  compCard: { flexGrow: 1, flexBasis: '30%', minWidth: 86, borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center', gap: 2, borderCurve: 'continuous' as any },
  compChar: { fontSize: 22, fontWeight: '800' as const, lineHeight: 26 },
  compMean: { fontSize: 11, lineHeight: 14, fontWeight: '400' as const, textAlign: 'center' as const },
  posText: { fontFamily: 'System', fontSize: em(0.68), fontWeight: '700' as const, letterSpacing: em(0.68) * 0.09, textTransform: 'uppercase' as const },
  gloss: { fontFamily: 'System', fontSize: em(1), lineHeight: em(1) * 1.5, fontWeight: '400' as const, flex: 1 },
  glossIndex: { fontFamily: 'System', fontSize: em(0.85), fontWeight: '500' as const, minWidth: 14, textAlign: 'right' as const, marginTop: 2 },
  bodySmall: { fontFamily: 'System', fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  footnote: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontFamily: 'System', fontSize: 12, lineHeight: 15, fontWeight: '400' as const },
  textArea: { minHeight: 44, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontFamily: 'System', fontSize: 14, lineHeight: 19, fontWeight: '400' as const, textAlignVertical: 'top' as any, marginTop: 6 },
  linkText: { fontFamily: 'System', fontSize: 13, fontWeight: '500' as const },
  forqPill: { paddingHorizontal: 9, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  forqText: { fontFamily: 'System', fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.3 },
  aiBox: { marginTop: 8, marginHorizontal: em(0.92), borderRadius: 10, borderWidth: 1, padding: 10 },
  exampleCard: { marginHorizontal: em(0.7), marginTop: 2, marginBottom: 6, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  exampleHeader: { minHeight: 38, paddingHorizontal: 8, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5 },
  exampleSource: { flex: 1, minWidth: 0, fontFamily: 'System', fontSize: 11, lineHeight: 14, fontWeight: '600' as const },
  exampleNav: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  exampleNavBtn: { width: 26, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  exampleCounter: { minWidth: 30, textAlign: 'center', fontFamily: 'System', fontSize: 10.5, fontWeight: '700' as const, fontVariant: ['tabular-nums'] as any },
  exampleControlDivider: { width: StyleSheet.hairlineWidth, height: 18, marginHorizontal: 3 },
  exampleAllBtn: { minWidth: 34, height: 28, paddingHorizontal: 5, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  exampleAllText: { fontFamily: 'System', fontSize: 10.5, fontWeight: '800' as const },
  exampleLoading: { minHeight: 72, paddingHorizontal: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  exampleRetry: { minHeight: 30, paddingHorizontal: 11, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  exampleImageWrap: { height: 148, backgroundColor: '#111', overflow: 'hidden' },
  examplePlayOverlay: { position: 'absolute', right: 10, bottom: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.68)', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)' },
  exampleCopy: { paddingHorizontal: 11, paddingVertical: 9, gap: 4 },
  exampleSentence: { flex: 1, fontFamily: 'System', fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  exampleTranslation: { fontFamily: 'System', fontSize: 12.5, lineHeight: 18, fontWeight: '400' as const },
  exampleAudioBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
