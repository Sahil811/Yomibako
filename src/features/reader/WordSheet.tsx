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
import { typography } from '../../theme/typography';
import { Icon } from '../../components/ui/Icon';
import { Markdown } from '../../components/ui/Markdown';
import { jpdbApi, geminiApi } from '../../services/jpdb/api';
import { loadKanjiDetails, type KanjiDetail } from '../../services/jpdb/kanjiData';
import { loadConfig } from '../../services/jpdb/config';
import { lastAudioError, playAudioForWord, playRemoteAudio, stopAudio } from '../../services/jpdb/audio';
import { fetchImmersionExamples, immersionText, type ImmersionExample } from '../../services/jpdb/immersionKit';
import { getSentences, PARTS_OF_SPEECH, groupMeanings, parsePitch } from '../../services/jpdb/word';
import { placePopup, type Rect, type Side } from './popupPlacement';
import { resolvePopupPalette, type PopupPalette } from '../../theme/popupThemes';
import * as Haptics from 'expo-haptics';

type Props = {
  word: any;
  onClose: () => void;
  /** Reader chrome is always dark; the browser follows the system theme. */
  forceDark?: boolean;
  /** Push a new card state back into the page so the word repaints in place. */
  onStateChange?: (vid: number, sid: number, state: string[]) => void;
  /** Native frame containing the WebView; browser word rects are local to it. */
  anchorFrame?: { x: number; y: number; width: number; height: number };
  /**
   * Settings preview. Renders the real card with the supplied config inside a
   * fixed box, with every effect and gesture disabled. Using the real component
   * is the point -- a hand-built mock would drift from what it previews.
   */
  preview?: { cfg: any; box: { width: number; maxHeight: number } };
};

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

// State badge fills mirror jpd-breader content/popup.css `.state span`.
function stateColors(st: string, isDark: boolean): { bg: string; fg: string } {
  switch (st) {
    case 'new':
    case 'not-in-deck':
      return isDark ? { bg: '#1c2f6b', fg: '#8ab4f8' } : { bg: '#e8f0fe', fg: '#1967d2' };
    case 'learning':
      return isDark ? { bg: '#0e3724', fg: '#81c995' } : { bg: '#e6f4ea', fg: '#137333' };
    case 'known':
      return isDark ? { bg: '#0d3b1e', fg: '#5bb974' } : { bg: '#ceead6', fg: '#0d652d' };
    case 'due':
    case 'failed':
      return isDark ? { bg: '#4a0c0a', fg: '#f28b82' } : { bg: '#fce8e6', fg: '#c5221f' };
    case 'never-forget':
      return isDark ? { bg: '#370d4f', fg: '#d7aefb' } : { bg: '#f3e8fd', fg: '#7b1fa2' };
    default:
      return isDark ? { bg: '#3c4043', fg: '#9aa0a6' } : { bg: '#f1f3f4', fg: '#5f6368' };
  }
}

// Review pills mirror popup.css solid traffic-light fills.
function reviewColor(r: string, primary: string, isDark: boolean): string {
  switch (r) {
    case 'nothing': return isDark ? '#a50e0e' : '#c62828';
    case 'something': return isDark ? '#b23c00' : '#d84315';
    case 'hard': return isDark ? '#c85f00' : '#e65100';
    case 'good': return isDark ? '#1a6b2d' : '#2e7d32';
    case 'easy': return isDark ? '#1a4e9e' : primary;
    default: return primary;
  }
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

  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [flagLoading, setFlagLoading] = useState<string | null>(null);
  const [localState, setLocalState] = useState<string[]>(word.state ?? []);
  const [sentence, setSentence] = useState('');
  const [translation, setTranslation] = useState('');
  const [forq, setForq] = useState(true);
  const [reviewLoading, setReviewLoading] = useState<string | null>(null);
  const [kanjiDetails, setKanjiDetails] = useState<KanjiDetail[] | null>(null);
  const [kanjiLoading, setKanjiLoading] = useState(false);
  const [ikExamples, setIkExamples] = useState<ImmersionExample[] | null>(null);
  const [ikLoading, setIkLoading] = useState(false);
  const [ikPlaying, setIkPlaying] = useState(false);
  const [ikLooping, setIkLooping] = useState(false);
  const [ikPlayingAll, setIkPlayingAll] = useState(false);
  const [ikIndex, setIkIndex] = useState(0);
  const [ikError, setIkError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const [geminiText, setGeminiText] = useState<string | null>(null);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [showKanjiPanel, setShowKanjiPanel] = useState<string | null>(null);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [showSentence, setShowSentence] = useState(false);
  const [showAllMeanings, setShowAllMeanings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const ikRequest = useRef(0);
  const ikPlaybackRun = useRef(0);
  const pronunciationRun = useRef(0);
  const pronunciationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { vid, sid, spelling, reading, meanings, frequencyRank, pitchAccent = [] } = word;

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
    return r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}` : 'none';
  }, [word.rect]);

  const onSheetLayout = useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      const h = Math.round(event.nativeEvent.layout.height);
      if (!h) return;
      // First measurement per state only. Re-placing on every content change
      // would both loop (height feeds maxHeight feeds height) and twitch the
      // card while it is being read.
      setHeights((prev) => (prev[measureKey] != null ? prev : { ...prev, [measureKey]: h }));
      setRevealed(true);
    },
    [measureKey]
  );

  const cap = Math.min(
    Math.round(winH * (popupExpanded ? 0.68 : 0.56)),
    popupExpanded ? 560 : 440
  );
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
      !p ? null : visual ? { ...p, x: p.x - visual.offsetLeft, y: p.y - visual.offsetTop } : p;
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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismiss = useCallback(() => {
    pronunciationRun.current++;
    if (pronunciationTimer.current) {
      clearTimeout(pronunciationTimer.current);
      pronunciationTimer.current = null;
    }
    ikRequest.current++;
    ikPlaybackRun.current++;
    stopAudio();
    onCloseRef.current();
  }, []);

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

  const stopExamplePlayback = () => {
    ikPlaybackRun.current++;
    stopAudio();
    setIkPlaying(false);
    setIkLooping(false);
    setIkPlayingAll(false);
  };

  const cancelAutomaticPronunciation = () => {
    pronunciationRun.current++;
    if (pronunciationTimer.current) {
      clearTimeout(pronunciationTimer.current);
      pronunciationTimer.current = null;
    }
    setPlaying(false);
  };

  const playExample = async (example?: ImmersionExample, loop = false) => {
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
    const ok = await playRemoteAudio(target.soundUrl, {
      loop,
      onFinished: (reason) => {
        if (ikPlaybackRun.current !== run) return;
        setIkPlaying(false);
        setIkLooping(false);
        if (reason === 'error') Alert.alert('Example audio unavailable', lastAudioError());
      },
    });
    if (!ok && ikPlaybackRun.current === run) {
      setIkPlaying(false);
      setIkLooping(false);
    }
  };

  const fetchImmersion = async (w: string, autoplay = true) => {
    const request = ++ikRequest.current;
    setShowExamples(true);
    setIkLoading(true);
    setIkError(null);
    try {
      const examples = await fetchImmersionExamples(w);
      if (request !== ikRequest.current) return;
      setIkExamples(examples);
      setIkIndex(0);
      if (!examples.length) setIkError('No examples found for this word.');
      else if (autoplay && examples[0].soundUrl) void playExample(examples[0]);
    } catch (error: any) {
      if (request !== ikRequest.current) return;
      setIkExamples([]);
      setIkError(error?.message ? String(error.message) : 'ImmersionKit is unavailable.');
    } finally {
      if (request === ikRequest.current) setIkLoading(false);
    }
  };

  const toggleExamples = () => {
    Haptics.selectionAsync();
    if (showExamples) {
      setShowExamples(false);
      stopExamplePlayback();
      return;
    }
    setShowExamples(true);
    if (ikExamples === null && !ikLoading) void fetchImmersion(spelling);
  };

  const moveExample = (delta: number) => {
    if (!ikExamples?.length) return;
    // Moving always cancels current, repeat, and play-all first. This also
    // handles examples with no sound, which previously left the old loop alive.
    stopExamplePlayback();
    const next = (ikIndex + delta + ikExamples.length) % ikExamples.length;
    setIkIndex(next);
    Haptics.selectionAsync();
    if (ikExamples[next].soundUrl) void playExample(ikExamples[next]);
  };

  const toggleExamplePlay = () => {
    if (ikPlaying || ikLooping || ikPlayingAll) {
      stopExamplePlayback();
      return;
    }
    void playExample();
  };

  const toggleExampleLoop = () => {
    if (ikLooping) {
      stopExamplePlayback();
      return;
    }
    void playExample(undefined, true);
  };

  const togglePlayAll = async () => {
    if (ikPlayingAll) {
      stopExamplePlayback();
      return;
    }
    if (!ikExamples?.length) return;

    cancelAutomaticPronunciation();
    const run = ++ikPlaybackRun.current;
    stopAudio();
    setIkLooping(false);
    setIkPlayingAll(true);
    Haptics.selectionAsync();

    for (let index = ikIndex; index < ikExamples.length; index++) {
      if (ikPlaybackRun.current !== run) return;
      setIkIndex(index);
      const example = ikExamples[index];
      setIkPlaying(!!example.soundUrl);

      if (example.soundUrl) {
        const reason = await new Promise<'ended' | 'stopped' | 'error'>((resolve) => {
          void playRemoteAudio(example.soundUrl, { onFinished: resolve }).then((ok) => {
            if (!ok) resolve('error');
          });
        });
        if (ikPlaybackRun.current !== run || reason !== 'ended') return;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 900));
        if (ikPlaybackRun.current !== run) return;
      }

      setIkPlaying(false);
      if (index < ikExamples.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }

    if (ikPlaybackRun.current === run) {
      setIkPlaying(false);
      setIkPlayingAll(false);
      setIkIndex(0);
    }
  };

  const explainWithGemini = async () => {
    if (geminiLoading) return;
    if (!cfg?.geminiApiKey) {
      Alert.alert('AI Explain', 'Add your Gemini API key in Settings → JPDB to use AI explanations.');
      return;
    }
    Haptics.selectionAsync();
    // Expand the sheet so the result is in view, and reset any previous run.
    setShowDetails(true);
    setGeminiError(null);
    setGeminiText(null);
    setGeminiLoading(true);
    try {
      const prompt = `Explain the Japanese word "${spelling}" (${reading}) — meanings: ${(meanings || []).map((m: any) => (m.glosses || []).join(', ')).join(' ; ')}. Pitch: ${pitchAccent.join(', ')}. Sentence: "${sentence}". Give a concise, learner-focused explanation with nuance, collocations, and one example.\n\nFormatting rules: reply in clean, simple Markdown. Use "## " for section headings, "**bold**" only for key terms, and "- " for bullet points. Do not stack markers like *** or ****, and never leave a * or ** unbalanced.`;
      const text = await geminiApi.explainWord({ apiKey: cfg.geminiApiKey, prompt });
      if (text && text.trim()) setGeminiText(text.trim());
      else setGeminiError('The AI returned an empty response. Please try again.');
    } catch (e: any) {
      console.warn('[wordsheet] gemini explain failed', e);
      setGeminiError(String(e?.message ?? e));
    } finally {
      setGeminiLoading(false);
    }
  };

  const mine = async (rating?: 'nothing' | 'something' | 'hard' | 'good' | 'easy') => {
    setAdding(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const token = cfg?.apiToken;
      if (!token) throw new Error('Missing JPDB token — open Settings');
      await jpdbApi.mine({ vid, sid, apiToken: token, sentence: sentence || undefined, translation: translation || undefined, forq, reviewRating: rating });
      setDone(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const st = await jpdbApi.getCardState({ vid, sid, apiToken: token });
      pushState(st);
      if (!rating) setTimeout(dismiss, 650);
    } catch (e: any) {
      Alert.alert('Mine failed', String(e.message));
    }
    setAdding(false);
  };

  const toggleFlag = async (flag: 'blacklist' | 'never-forget') => {
    setFlagLoading(flag);
    try {
      const token = cfg?.apiToken;
      if (!token) throw new Error('No token');
      const stateKey = flag === 'blacklist' ? 'blacklisted' : 'never-forget';
      const currently = localState.includes(stateKey);
      await jpdbApi.setFlag({ vid, sid, flag, state: !currently, apiToken: token });
      const st = await jpdbApi.getCardState({ vid, sid, apiToken: token });
      pushState(st);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      // Log the stack in dev so unlocatable TypeErrors become actionable.
      console.warn(`[wordsheet] flag ${flag} failed`, e);
      Alert.alert('Flag failed', String(e?.message ?? e));
    }
    setFlagLoading(null);
  };

  const review = async (rating: 'nothing' | 'something' | 'hard' | 'good' | 'easy') => {
    setReviewLoading(rating);
    try {
      await jpdbApi.review({ vid, sid, rating });
      const token = cfg?.apiToken;
      if (token) {
        const st = await jpdbApi.getCardState({ vid, sid, apiToken: token });
        pushState(st);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Review failed', String(e.message));
    }
    setReviewLoading(null);
  };

  const lastAudioAlert = useRef(0);
  const play = async () => {
    cancelAutomaticPronunciation();
    const run = ++pronunciationRun.current;
    setPlaying(true);
    Haptics.selectionAsync();
    const ok = await playAudioForWord(vid, spelling);
    if (pronunciationRun.current === run) setPlaying(false);
    if (!ok) {
      // Silent spinner-stop is indistinguishable from broken — say why,
      // throttled so repeated taps on unrecorded words don't nag.
      const reason = lastAudioError();
      const noisy = reason && reason !== 'No JPDB recording for this word';
      if (pronunciationRun.current === run && noisy && Date.now() - lastAudioAlert.current > 10000) {
        lastAudioAlert.current = Date.now();
        Alert.alert('Audio unavailable', reason);
      }
    }
  };

  // Defensive: malformed lookup payloads must never blank the sheet.
  let grouped: { partOfSpeech: string[]; glosses: string[][]; startIndex: number }[] = [];
  try {
    grouped = groupMeanings({ meanings: Array.isArray(meanings) ? meanings : [] });
  } catch {}
  const isBlacklisted = localState.includes('blacklisted');
  const isNeverForget = localState.includes('never-forget');

  // Trim the gloss list to the first few entries, keeping whole POS groups.
  const MAX_GLOSSES = showDetails ? 8 : 5;
  const totalGlosses = grouped.reduce((n, g) => n + g.glosses.length, 0);
  let visibleGroups = grouped;
  if (!showAllMeanings && totalGlosses > MAX_GLOSSES) {
    const out: typeof grouped = [];
    let used = 0;
    for (const g of grouped) {
      if (used >= MAX_GLOSSES) break;
      const take = Math.min(g.glosses.length, MAX_GLOSSES - used);
      out.push({ ...g, glosses: g.glosses.slice(0, take) });
      used += take;
    }
    visibleGroups = out;
  }
  const hiddenGlossCount = Math.max(0, totalGlosses - visibleGroups.reduce((n, g) => n + g.glosses.length, 0));

  const inDeck = localState.length > 0 && !localState.includes('not-in-deck');
  let pitchSegments: { text: string; isHigh: boolean; isFinal: boolean }[] | null = null;
  try {
    pitchSegments = pitchAccent?.length ? parsePitch(reading, pitchAccent[0]) : null;
  } catch {}

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
              {/* One clear first read: word, reading, status, audio, close. */}
              <View style={s.header}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.spelling, { color: colors.onSurface }]} numberOfLines={2}>{spelling}</Text>
                  <View style={s.metaRow}>
                    {frequencyRank ? (
                      <View style={[s.freqPill, { backgroundColor: isDark ? '#1c2f6b' : '#e8f0fe' }]}>
                        <Text style={[s.freqText, { color: colors.primary }]}>Top {frequencyRank}</Text>
                      </View>
                    ) : null}
                    {pitchSegments ? (
                      <View style={{ flexDirection: 'row' }}>
                        {pitchSegments.map((seg, i) => (
                          <Text key={i} style={{ color: colors.secondaryLabel, fontWeight: '600', borderStyle: 'solid', borderColor: seg.isHigh ? colors.primary : '#d93025', borderTopWidth: seg.isHigh ? 1.6 : 0, borderBottomWidth: seg.isHigh ? 0 : 1.6, paddingHorizontal: 1.5, fontSize: em(0.95) }}>
                            {seg.text}
                          </Text>
                        ))}
                      </View>
                    ) : reading && reading !== spelling ? (
                      <Text style={[s.metaText, { color: colors.secondaryLabel }]} numberOfLines={1}>{reading}</Text>
                    ) : null}
                  </View>
                </View>

                <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  {/* Only the two actions worth reaching for mid-sentence stay
                      up here; AI and blacklist live in the actions row so the
                      word itself is not squeezed into two lines. */}
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <Pressable onPress={play} hitSlop={8} style={({ pressed }) => [s.iconBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} accessibilityLabel="Play audio">
                      {playing ? <ActivityIndicator size="small" color={colors.secondaryLabel} /> : <Icon name="audio" size={17} color={colors.secondaryLabel} strokeWidth={2} />}
                    </Pressable>
                    <Pressable onPress={dismiss} hitSlop={10} style={({ pressed }) => [s.iconBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} accessibilityLabel="Close lookup">
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

              {/* Meanings. Common verbs carry 15+ glosses, so the tail is
                  collapsed behind a disclosure rather than filling the card. */}
              {grouped.length ? (
                <View style={s.section}>
                  {visibleGroups.map((g, idx) => (
                    <View key={idx} style={{ marginTop: idx === 0 ? 6 : 4 }}>
                      <Text style={[s.posText, { color: colors.secondaryLabel }]}>
                        {(g.partOfSpeech.map((p) => PARTS_OF_SPEECH[p] ?? p).filter(Boolean).join(', ') || '—')}
                      </Text>
                      <View style={{ gap: 2, marginTop: 2 }}>
                        {g.glosses.map((gl, i) => (
                          <View key={i} style={{ flexDirection: 'row', gap: 7 }}>
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
                        if (!showDetails) setShowDetails(true);
                        setShowAllMeanings((v) => !v);
                      }}
                      style={({ pressed }) => [s.moreBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]}
                      hitSlop={6}
                    >
                      <Text style={[s.moreText, { color: colors.primary }]}>
                        {showAllMeanings ? 'Show fewer meanings' : `${hiddenGlossCount} more meaning${hiddenGlossCount === 1 ? '' : 's'}`}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                  <Text style={[s.footnote, { color: colors.secondaryLabel }]}>No glosses yet</Text>
                </View>
              )}

              {/* Kanji breakdown — chip row (popup.css .kanji-breakdown).
                  Always visible: for a manga reader this is the most useful
                  thing in the card, and it sits right under the meanings so the
                  card reads word -> meaning -> kanji. */}
              {cfg?.showKanji !== false && (kanjiDetails || kanjiLoading) ? (
                <View style={s.kanjiWrap}>
                  {kanjiDetails && kanjiDetails.length > 3 ? (
                    <View style={s.kanjiHeader}>
                      <Text style={[s.posText, { color: colors.secondaryLabel }]}>Kanji</Text>
                      <View style={[s.countBadge, { backgroundColor: colors.systemFill }]}>
                        <Text style={[s.countText, { color: colors.primary }]}>{kanjiDetails.length}</Text>
                      </View>
                    </View>
                  ) : null}
                  {kanjiLoading && !kanjiDetails?.length ? (
                    <ActivityIndicator size="small" color={colors.secondaryLabel} style={{ alignSelf: 'flex-start' }} />
                  ) : kanjiDetails?.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {kanjiDetails.map((d) => {
                        const active = showKanjiPanel === d.kanji;
                        return (
                          <Pressable
                            key={d.kanji}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setShowKanjiPanel(active ? null : d.kanji);
                              setShowMnemonic(false);
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
                  ) : null}
                  {(() => {
                    const sel = kanjiDetails?.find((d) => d.kanji === showKanjiPanel);
                    if (!showKanjiPanel || !sel) return null;
                    return (
                      <View style={[s.kanjiDetail, { backgroundColor: colors.systemFill, borderColor: colors.separator }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.primary }}>{sel.kanji}</Text>
                          <Text style={[s.footnote, { color: colors.secondaryLabel }]}>·</Text>
                          <Text style={[s.bodySmall, { color: colors.onSurface, fontWeight: '600', flex: 1 }]} numberOfLines={2}>{sel.meanings || '—'}</Text>
                          <Pressable onPress={() => { setShowKanjiPanel(null); setShowMnemonic(false); }} hitSlop={8} style={[s.miniClose, { backgroundColor: colors.surface }]}>
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
                            <Pressable onPress={() => { Haptics.selectionAsync(); setShowMnemonic((v) => !v); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: sel.components?.length ? 8 : 4 }} hitSlop={6}>
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
              ) : null}

              {/* Frequent actions stay reachable; mining tools live behind Mine
                  so a lookup never opens as a miniature app. */}
              <View style={[s.quickActions, { borderTopColor: colors.separator }]}>
                {cfg?.showAddButton ? (
                  <Pressable
                    onPress={() => mine()}
                    disabled={adding}
                    style={({ pressed }) => [s.primaryAction, { backgroundColor: done || inDeck ? colors.systemFill : colors.primary, opacity: pressed ? 0.82 : 1 }]}
                  >
                    {adding
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <><Icon name={done || inDeck ? 'check' : 'plus'} size={14} color={done || inDeck ? colors.primary : '#fff'} strokeWidth={2.3} /><Text style={[s.quickActionText, { color: done || inDeck ? colors.primary : '#fff' }]}>{done || inDeck ? 'Added' : 'Add'}</Text></>}
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => toggleFlag('never-forget')}
                  style={({ pressed }) => [s.quickAction, { backgroundColor: isNeverForget ? ghostPurple.borderColor + '22' : pressed ? colors.systemFill : 'transparent' }]}
                >
                  {flagLoading === 'never-forget' ? <ActivityIndicator size="small" color={ghostPurple.fg} /> : <Text style={[s.quickActionText, { color: ghostPurple.fg }]}>{isNeverForget ? 'Remembering' : 'Remember'}</Text>}
                </Pressable>
                <Pressable
                  onPress={toggleExamples}
                  style={({ pressed }) => [s.quickAction, { backgroundColor: showExamples ? exampleAccent + '1F' : pressed ? colors.systemFill : 'transparent' }]}
                  accessibilityState={{ expanded: showExamples }}
                >
                  <Icon name="play" size={12} color={exampleAccent} strokeWidth={2} />
                  <Text style={[s.quickActionText, { color: exampleAccent }]}>Examples</Text>
                </Pressable>
                <Pressable
                  onPress={explainWithGemini}
                  style={({ pressed }) => [s.quickAction, { backgroundColor: pressed ? colors.systemFill : 'transparent', opacity: geminiLoading ? 0.6 : 1 }]}
                  accessibilityLabel="Explain with AI"
                >
                  {geminiLoading
                    ? <ActivityIndicator size="small" color={ghostPurple.fg} />
                    : <Text style={[s.quickActionText, { color: ghostPurple.fg }]}>AI</Text>}
                </Pressable>
                {cfg?.showBlacklistButton ? (
                  <Pressable
                    onPress={() => toggleFlag('blacklist')}
                    style={({ pressed }) => [s.quickAction, { backgroundColor: isBlacklisted ? colors.error + '1F' : pressed ? colors.systemFill : 'transparent' }]}
                    accessibilityLabel="Blacklist"
                  >
                    {flagLoading === 'blacklist'
                      ? <ActivityIndicator size="small" color={colors.error} />
                      : <Text style={[s.quickActionText, { color: colors.error }]}>Hide</Text>}
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); setShowDetails((v) => !v); }}
                  style={({ pressed }) => [s.quickAction, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]}
                >
                  <Text style={[s.quickActionText, { color: colors.primary }]}>{showDetails ? 'Less' : 'Mine'}</Text>
                  <Icon name={showDetails ? 'chevronDown' : 'chevronRight'} size={13} color={colors.primary} strokeWidth={2.2} />
                </Pressable>
              </View>

              {showExamples ? (
                <View style={[s.exampleCard, { backgroundColor: colors.systemFill, borderColor: colors.separator }]}>
                  <View style={s.exampleHeader}>
                    <Text numberOfLines={1} style={[s.exampleSource, { color: colors.secondaryLabel }]}>
                      {currentExample?.sourceTitle || 'ImmersionKit'}
                    </Text>
                    {ikExamples?.length ? (
                      <View style={s.exampleNav}>
                        <Pressable onPress={() => moveExample(-1)} disabled={ikExamples.length < 2} style={({ pressed }) => [s.exampleNavBtn, { backgroundColor: pressed ? colors.tertiarySystemFill : 'transparent', opacity: ikExamples.length < 2 ? 0.3 : 1 }]} accessibilityLabel="Previous example">
                          <Icon name="chevronLeft" size={14} color={colors.primary} strokeWidth={2.2} />
                        </Pressable>
                        <Text style={[s.exampleCounter, { color: colors.secondaryLabel }]}>{ikIndex + 1}/{ikExamples.length}</Text>
                        <Pressable onPress={() => moveExample(1)} disabled={ikExamples.length < 2} style={({ pressed }) => [s.exampleNavBtn, { backgroundColor: pressed ? colors.tertiarySystemFill : 'transparent', opacity: ikExamples.length < 2 ? 0.3 : 1 }]} accessibilityLabel="Next example">
                          <Icon name="chevronRight" size={14} color={colors.primary} strokeWidth={2.2} />
                        </Pressable>
                        <View style={[s.exampleControlDivider, { backgroundColor: colors.separator }]} />
                        <Pressable
                          onPress={toggleExamplePlay}
                          disabled={!currentExample?.soundUrl}
                          style={({ pressed }) => [s.exampleNavBtn, { backgroundColor: pressed ? colors.tertiarySystemFill : 'transparent', opacity: currentExample?.soundUrl ? 1 : 0.3 }]}
                          accessibilityLabel={ikPlaying && !ikLooping && !ikPlayingAll ? 'Stop example audio' : 'Play example audio'}
                        >
                          <Icon name={ikPlaying && !ikLooping && !ikPlayingAll ? 'pause' : 'play'} size={13} color={exampleAccent} strokeWidth={2} />
                        </Pressable>
                        <Pressable
                          onPress={toggleExampleLoop}
                          disabled={!currentExample?.soundUrl}
                          style={({ pressed }) => [s.exampleNavBtn, { backgroundColor: ikLooping ? exampleAccent + '26' : pressed ? colors.tertiarySystemFill : 'transparent', opacity: currentExample?.soundUrl ? 1 : 0.3 }]}
                          accessibilityLabel={ikLooping ? 'Stop repeating example' : 'Repeat current example'}
                          accessibilityState={{ selected: ikLooping }}
                        >
                          <Icon name="repeat" size={15} color={ikLooping ? exampleAccent : colors.secondaryLabel} strokeWidth={2} />
                        </Pressable>
                        <Pressable
                          onPress={() => void togglePlayAll()}
                          style={({ pressed }) => [s.exampleAllBtn, { backgroundColor: ikPlayingAll ? exampleAccent + '26' : pressed ? colors.tertiarySystemFill : 'transparent' }]}
                          accessibilityLabel={ikPlayingAll ? 'Stop all examples' : 'Play all examples'}
                          accessibilityState={{ selected: ikPlayingAll }}
                        >
                          <Text style={[s.exampleAllText, { color: ikPlayingAll ? exampleAccent : colors.secondaryLabel }]}>{ikPlayingAll ? 'Stop' : 'All'}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>

                  {ikLoading ? (
                    <View style={s.exampleLoading}>
                      <ActivityIndicator size="small" color={exampleAccent} />
                      <Text style={[s.footnote, { color: colors.secondaryLabel }]}>Finding natural examples…</Text>
                    </View>
                  ) : ikError ? (
                    <View style={s.exampleLoading}>
                      <Text style={[s.footnote, { color: colors.secondaryLabel, flex: 1 }]}>{ikError}</Text>
                      <Pressable onPress={() => fetchImmersion(spelling)} style={({ pressed }) => [s.exampleRetry, { backgroundColor: pressed ? colors.tertiarySystemFill : colors.secondarySystemFill }]}>
                        <Text style={[s.quickActionText, { color: colors.primary }]}>Retry</Text>
                      </Pressable>
                    </View>
                  ) : currentExample ? (
                    <>
                      {currentExample.imageUrl ? (
                        <Pressable onPress={toggleExamplePlay} style={s.exampleImageWrap} accessibilityLabel={ikPlaying ? 'Stop example audio' : 'Play example audio'}>
                          <Image source={{ uri: currentExample.imageUrl }} style={StyleSheet.absoluteFill as any} contentFit="cover" transition={180} cachePolicy="memory-disk" />
                          {currentExample.soundUrl ? (
                            <View style={s.examplePlayOverlay}>
                              <Icon name={ikPlaying ? 'pause' : 'audio'} size={17} color="#fff" strokeWidth={2.2} />
                            </View>
                          ) : null}
                        </Pressable>
                      ) : null}
                      <View style={s.exampleCopy}>
                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                          <Text style={[s.exampleSentence, { color: colors.onSurface }]}>{immersionText(currentExample.sentence) || '—'}</Text>
                          {!currentExample.imageUrl && currentExample.soundUrl ? (
                            <Pressable onPress={toggleExamplePlay} style={({ pressed }) => [s.exampleAudioBtn, { backgroundColor: pressed ? colors.tertiarySystemFill : colors.secondarySystemFill }]} accessibilityLabel={ikPlaying ? 'Stop example audio' : 'Play example audio'}>
                              <Icon name={ikPlaying ? 'pause' : 'audio'} size={16} color={colors.primary} strokeWidth={2.2} />
                            </Pressable>
                          ) : null}
                        </View>
                        {currentExample.translation ? <Text style={[s.exampleTranslation, { color: colors.secondaryLabel }]}>{immersionText(currentExample.translation)}</Text> : null}
                      </View>
                    </>
                  ) : null}
                </View>
              ) : null}

              {/* Review buttons — solid traffic-light pills, opt-in via Settings */}
              {showDetails && cfg?.showReviewButtons === true ? (
                <View style={[s.reviewRow, { borderBottomColor: colors.separator }]}>
                  {(['nothing', 'something', 'hard', 'good', 'easy'] as const).map((r) => (
                    <Pressable key={r} onPress={() => review(r)} style={({ pressed }) => [s.reviewBtn, { backgroundColor: reviewColor(r, colors.primary, isDark), opacity: pressed ? 0.8 : 1 }]}>
                      {reviewLoading === r
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={s.reviewText}>{r === 'nothing' ? 'Nothing' : r === 'something' ? 'Something' : r[0].toUpperCase() + r.slice(1)}</Text>}
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {/* Sentence — collapsed disclosure (auto-mined from context; tap to tweak) */}
              {showDetails ? <View style={[s.section, { marginTop: 8 }]}>
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); setShowSentence((v) => !v); }}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  hitSlop={6}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[s.posText, { color: colors.secondaryLabel }]}>Sentence</Text>
                    <Icon name={showSentence ? 'chevronDown' : 'chevronRight'} size={13} color={colors.tertiaryLabel} strokeWidth={2.2} />
                  </View>
                  <Pressable onPress={() => setForq((v) => !v)} style={[s.forqPill, { backgroundColor: forq ? colors.primary : 'transparent', borderColor: forq ? colors.primary : colors.separator }]}>
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
                        onPress={() => {
                          if (cfg && word.context) {
                            const wider = getSentences(word, Math.min(10, cfg.contextWidth + 1));
                            setSentence(wider);
                            Haptics.selectionAsync();
                          }
                        }}
                        hitSlop={6}
                      >
                        <Text style={[s.linkText, { color: colors.primary }]}>Expand context</Text>
                      </Pressable>
                    </View>
                    <TextInput
                      value={sentence}
                      onChangeText={setSentence}
                      placeholder="Sentence for mining"
                      placeholderTextColor={colors.tertiaryLabel}
                      multiline
                      textAlignVertical="top"
                      style={[s.textArea, { color: colors.onSurface, backgroundColor: colors.systemFill }]}
                    />
                    <TextInput
                      value={translation}
                      onChangeText={setTranslation}
                      placeholder="Translation (optional)"
                      placeholderTextColor={colors.tertiaryLabel}
                      multiline
                      textAlignVertical="top"
                      style={[s.textArea, { minHeight: 34, marginTop: 6, color: colors.onSurface, backgroundColor: colors.systemFill }]}
                    />
                  </>
                ) : null}
              </View> : null}

              {/* Gemini */}
              {geminiLoading || geminiText || geminiError ? (
                <View style={[s.aiBox, { backgroundColor: colors.systemFill, borderColor: geminiError ? colors.error : colors.separator }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={[s.posText, { color: geminiError ? colors.error : colors.primary }]}>AI explanation</Text>
                    {geminiLoading ? (
                      <ActivityIndicator size="small" color={colors.secondaryLabel} />
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                        {geminiError ? (
                          <Pressable onPress={explainWithGemini}>
                            <Text style={[s.linkText, { color: colors.primary }]}>Retry</Text>
                          </Pressable>
                        ) : null}
                        <Pressable onPress={() => { setGeminiText(null); setGeminiError(null); }}>
                          <Text style={[s.linkText, { color: colors.secondaryLabel }]}>Clear</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                  {geminiLoading && !geminiText ? (
                    <Text style={[s.bodySmall, { color: colors.secondaryLabel, lineHeight: 20, marginTop: 4 }]}>Thinking…</Text>
                  ) : geminiError ? (
                    <Text style={[s.bodySmall, { color: colors.error, lineHeight: 20, marginTop: 4 }]}>{geminiError}</Text>
                  ) : (
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
                  )}
                </View>
              ) : null}

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
