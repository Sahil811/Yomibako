import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  useColorScheme,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { runOnJS, useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { darkColors, lightColors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { Icon } from '../../components/ui/Icon';
import { jpdbApi, immersionKitApi, geminiApi } from '../../services/jpdb/api';
import { loadKanjiDetails, type KanjiDetail } from '../../services/jpdb/kanjiData';
import { loadConfig } from '../../services/jpdb/config';
import { lastAudioError, playAudioForWord } from '../../services/jpdb/audio';
import { getSentences, PARTS_OF_SPEECH, groupMeanings, parsePitch } from '../../services/jpdb/word';
import * as Haptics from 'expo-haptics';

type Props = {
  word: any;
  onClose: () => void;
};

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

export default function WordSheet({ word, onClose }: Props) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = isDark ? darkColors : lightColors;
  const insets = useSafeAreaInsets();

  const [cfg, setCfg] = useState<any>(null);
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
  const [ikExamples, setIkExamples] = useState<any[] | null>(null);
  const [ikLoading, setIkLoading] = useState(false);
  const [geminiText, setGeminiText] = useState<string | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [showKanjiPanel, setShowKanjiPanel] = useState<string | null>(null);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [showSentence, setShowSentence] = useState(false);

  const { vid, sid, spelling, reading, meanings, frequencyRank, pitchAccent = [] } = word;

  const sheetY = useSharedValue(0);
  const backdropOpacity = useSharedValue(1);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismiss = useCallback(() => {
    onCloseRef.current();
  }, []);

  useEffect(() => {
    loadConfig().then((c) => {
      setCfg(c);
      setForq(!!c.forqOnMine);
      if (word.context != null && word.contextOffset != null) {
        try {
          const s = getSentences(word, c.contextWidth);
          setSentence(s);
        } catch {}
      }
      if (c.showExamplesAutomatically && c.showKanji !== false) fetchImmersion(word.spelling, c);
      if (c.showKanji) fetchKanji();
    });
  }, []);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) sheetY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 800) {
        backdropOpacity.value = withTiming(0, { duration: 180 });
        sheetY.value = withTiming(600, { duration: 220 }, (finished) => {
          if (finished) runOnJS(dismiss)();
        });
      } else {
        sheetY.value = withSpring(0, { damping: 24, stiffness: 360 });
      }
    });

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));
  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

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

  const fetchImmersion = async (w: string, cfgOverride?: any) => {
    const c = cfgOverride ?? cfg;
    if (!c) return;
    setIkLoading(true);
    try {
      const data = await immersionKitApi.search(w);
      const raw = (data as any)?.examples ?? (data as any)?.data ?? [];
      setIkExamples(raw.slice(0, 5));
    } catch {
      setIkExamples([]);
    }
    setIkLoading(false);
  };

  const explainWithGemini = async () => {
    if (!cfg?.geminiApiKey) {
      Alert.alert('AI Explain', 'Add your Gemini API key in Settings → JPDB to use AI explanations.');
      return;
    }
    setGeminiLoading(true);
    Haptics.selectionAsync();
    try {
      const prompt = `Explain Japanese word "${spelling}" (${reading}) — meanings: ${(meanings || []).map((m: any) => (m.glosses || []).join(', ')).join(' ; ')}. Pitch: ${pitchAccent.join(', ')}. Sentence: "${sentence}". Provide concise learner-focused explanation with nuance, collocations, and example.`;
      const text = await geminiApi.explainWord({ apiKey: cfg.geminiApiKey, prompt });
      setGeminiText(text);
    } catch (e: any) {
      setGeminiText('Failed: ' + String(e.message));
    }
    setGeminiLoading(false);
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
      setLocalState(st);
      if (!rating) setTimeout(onClose, 650);
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
      setLocalState(st);
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
        setLocalState(st);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Review failed', String(e.message));
    }
    setReviewLoading(null);
  };

  const lastAudioAlert = useRef(0);
  const play = async () => {
    setPlaying(true);
    Haptics.selectionAsync();
    const ok = await playAudioForWord(vid, spelling);
    setPlaying(false);
    if (!ok) {
      // Silent spinner-stop is indistinguishable from broken — say why,
      // throttled so repeated taps on unrecorded words don't nag.
      const reason = lastAudioError();
      const noisy = reason && reason !== 'No JPDB recording for this word';
      if (noisy && Date.now() - lastAudioAlert.current > 10000) {
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
  let pitchSegments: { text: string; isHigh: boolean; isFinal: boolean }[] | null = null;
  try {
    pitchSegments = pitchAccent?.length ? parsePitch(reading, pitchAccent[0]) : null;
  } catch {}

  // Popup visual language mirrors jpd-breader content/popup.css: compact
  // floating card, single surface, small ghost buttons + traffic-light
  // review pills, tinted state badges — not a fullscreen iOS grouped sheet.
  const ghostPrimary = { borderColor: colors.primary, fg: colors.primary };
  const ghostPurple = { borderColor: isDark ? '#d7aefb' : '#7b1fa2', fg: isDark ? '#d7aefb' : '#7b1fa2' };

  return (
    <View style={[StyleSheet.absoluteFill as any, { justifyContent: 'center', alignItems: 'center', padding: 16 }]}>
      {/* Backdrop — light veil only (no blur): the page stays visible around
          the floating card, tap outside dismisses. */}
      <Animated.View style={[StyleSheet.absoluteFill as any, { backgroundColor: 'rgba(0,0,0,0.30)' }, animatedBackdropStyle]}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill as any} />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[s.sheet, { backgroundColor: colors.surface, borderColor: colors.separator, boxShadow: '0 4px 16px rgba(0,0,0,0.12), 0 8px 32px rgba(0,0,0,0.16)' }, animatedSheetStyle]}>
          {/* NOTE: no KeyboardAvoidingView wrapper — behavior is a no-op on
              Android but its flex:1 collapsed the sheet to ~0 height inside
              this wrap-content parent (grey backdrop, no card = "stuck").
              The ScrollView sizes to content up to the sheet maxHeight. */}
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 13, paddingTop: 11, paddingBottom: 13, gap: 0 }}
            bounces
            keyboardShouldPersistTaps="handled"
          >
              {/* Header — word + state + utility icons (popup.css #header) */}
              <View style={s.header}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.spelling, { color: colors.onSurface }]} numberOfLines={2}>{spelling}</Text>
                  {!pitchSegments && reading !== spelling ? <Text style={[s.reading, { color: colors.secondaryLabel }]}>{reading}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                    {frequencyRank ? (
                      <View style={[s.freqPill, { backgroundColor: isDark ? '#1c2f6b' : '#e8f0fe' }]}>
                        <Text style={[s.freqText, { color: colors.primary }]}>Top {frequencyRank}</Text>
                      </View>
                    ) : null}
                    {pitchSegments ? (
                      <View style={{ flexDirection: 'row' }}>
                        {pitchSegments.map((seg, i) => (
                          <Text key={i} style={{ color: colors.onSurface, fontWeight: '600', borderStyle: 'solid', borderColor: seg.isHigh ? colors.primary : '#d93025', borderTopWidth: seg.isHigh ? 1.6 : 0, borderBottomWidth: seg.isHigh ? 0 : 1.6, paddingHorizontal: 1.5, fontSize: 13 }}>
                            {seg.text}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>

                <View style={{ alignItems: 'flex-end', gap: 4, marginLeft: 8, flexShrink: 0 }}>
                  <View style={{ flexDirection: 'row', gap: 2 }}>
                    <Pressable onPress={play} style={({ pressed }) => [s.utilBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent', borderColor: 'transparent' }]} hitSlop={8} accessibilityLabel="Play audio">
                      {playing ? <ActivityIndicator size="small" color={colors.secondaryLabel} /> : <Icon name="audio" size={16} color={colors.secondaryLabel} strokeWidth={2} />}
                    </Pressable>
                    <Pressable onPress={explainWithGemini} style={({ pressed }) => [s.utilBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent', borderColor: 'transparent', opacity: geminiLoading ? 0.6 : 1 }]} hitSlop={6} accessibilityLabel="Explain with AI">
                      {geminiLoading ? <ActivityIndicator size="small" color={colors.secondaryLabel} /> : <Text style={{ fontSize: 12, fontWeight: '800', color: colors.secondaryLabel }}>AI</Text>}
                    </Pressable>
                    {cfg?.showBlacklistButton ? (
                      <Pressable onPress={() => toggleFlag('blacklist')} style={({ pressed }) => [s.utilBtn, { backgroundColor: isBlacklisted ? colors.systemFill : (pressed ? colors.systemFill : 'transparent'), borderColor: 'transparent' }]} hitSlop={6} accessibilityLabel="Blacklist">
                        {flagLoading === 'blacklist' ? <ActivityIndicator size="small" color={colors.secondaryLabel} /> : <Icon name="close" size={14} color={isBlacklisted ? colors.error : colors.secondaryLabel} strokeWidth={2.2} />}
                      </Pressable>
                    ) : null}
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

              {/* Top actions — Never forget | Examples always (inspiration card);
                  Add only when enabled in Settings → Behavior. */}
              <View style={s.mineRow}>
                {cfg?.showAddButton ? (
                  <Pressable onPress={() => mine()} style={({ pressed }) => [s.ghostBtn, { borderColor: ghostPrimary.borderColor, backgroundColor: pressed ? colors.systemFill : 'transparent' }]}>
                    {adding ? <ActivityIndicator size="small" color={ghostPrimary.fg} /> : <Text style={[s.ghostText, { color: ghostPrimary.fg }]}>{done ? 'Added' : 'Add'}</Text>}
                  </Pressable>
                ) : null}
                <Pressable onPress={() => toggleFlag('never-forget')} style={({ pressed }) => [s.ghostBtn, { borderColor: ghostPurple.borderColor, backgroundColor: pressed ? colors.systemFill : 'transparent', flex: cfg?.showAddButton ? 0 : 1 }]}>
                  {flagLoading === 'never-forget' ? <ActivityIndicator size="small" color={ghostPurple.fg} /> : <Text style={[s.ghostText, { color: ghostPurple.fg }]}>{isNeverForget ? 'Unmark' : 'Never forget'}</Text>}
                </Pressable>
                <Pressable onPress={() => { Haptics.selectionAsync(); fetchImmersion(spelling); }} style={({ pressed }) => [s.ghostBtn, { borderColor: ghostPrimary.borderColor, backgroundColor: pressed ? colors.systemFill : 'transparent', flex: cfg?.showAddButton ? 0 : 1 }]}>
                  <Text style={[s.ghostText, { color: ghostPrimary.fg }]}>{ikLoading ? '…' : 'Examples'}</Text>
                </Pressable>
              </View>

              {/* Review buttons — solid traffic-light pills, opt-in via Settings */}
              {cfg?.showReviewButtons === true ? (
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

              {/* Kanji breakdown — chip row (popup.css .kanji-breakdown) */}
              {cfg?.showKanji !== false && (kanjiDetails || kanjiLoading) ? (
                <View style={s.kanjiWrap}>
                  {kanjiDetails && kanjiDetails.length > 3 ? (
                    <View style={s.kanjiHeader}>
                      <Text style={[s.posText, { color: colors.secondaryLabel }]}>KANJI</Text>
                      <View style={[s.countBadge, { backgroundColor: isDark ? '#1c2f6b' : '#e8f0fe' }]}>
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
                            style={({ pressed }) => [s.kanjiChip, { backgroundColor: active ? (isDark ? '#1c2f6b' : '#e8f0fe') : colors.systemFill, borderColor: active ? colors.primary : colors.separator, opacity: pressed ? 0.85 : 1 }]}
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

              {/* Meanings — POS headings + numbered list (popup.css h2 + ol) */}
              {grouped.length ? (
                <View>
                  {grouped.map((g, idx) => (
                    <View key={idx} style={{ marginTop: idx === 0 ? 6 : 4 }}>
                      <Text style={[s.posText, { color: colors.secondaryLabel }]}>
                        {(g.partOfSpeech.map((p) => PARTS_OF_SPEECH[p] ?? p).filter(Boolean).join(', ') || '—').toUpperCase()}
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
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                  <Text style={[s.footnote, { color: colors.secondaryLabel }]}>No glosses yet</Text>
                </View>
              )}

              {/* Sentence — collapsed disclosure (auto-mined from context; tap to tweak) */}
              <View style={{ marginTop: 8 }}>
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); setShowSentence((v) => !v); }}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  hitSlop={6}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[s.posText, { color: colors.secondaryLabel }]}>SENTENCE</Text>
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
              </View>

              {/* Gemini */}
              {geminiText ? (
                <View style={[s.aiBox, { backgroundColor: colors.systemFill, borderColor: colors.separator }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={[s.posText, { color: colors.primary }]}>✦ AI EXPLANATION</Text>
                    <Pressable onPress={() => setGeminiText(null)}>
                      <Text style={[s.linkText, { color: colors.secondaryLabel }]}>Clear</Text>
                    </Pressable>
                  </View>
                  <Text style={[s.bodySmall, { color: colors.onSurface, lineHeight: 20, marginTop: 4 }]}>{geminiText}</Text>
                </View>
              ) : null}

              {/* ImmersionKit examples — compact rows, only on demand */}
              {ikLoading ? (
                <View style={{ paddingVertical: 10 }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : ikExamples?.length ? (
                <View style={[s.examplesWrap, { borderTopColor: colors.separator }]}>
                  {ikExamples.map((ex, i) => (
                    <View key={i} style={[s.exampleRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }]}>
                      <Text style={[s.ikSentence, { color: colors.onSurface }]} numberOfLines={2}>
                        {ex.sentence ?? ex.text ?? '—'}
                      </Text>
                      {ex.title ? <Text style={[s.caption, { color: colors.secondaryLabel }]} numberOfLines={1}>{ex.title}</Text> : null}
                    </View>
                  ))}
                </View>
              ) : null}
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  // Floating popup card (popup.css article): compact, single surface,
  // 1px border + soft shadow, capped well below fullscreen.
  sheet: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous' as any,
    maxHeight: '80%',
    elevation: 22,
  },
  header: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingTop: 2 },
  spelling: { fontFamily: 'System', fontSize: 27, lineHeight: 33, fontWeight: '700' as const, letterSpacing: -0.4 },
  reading: { fontFamily: 'System', fontSize: 14, lineHeight: 19, fontWeight: '400' as const, marginTop: 1 },
  freqPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2.5 },
  freqText: { fontFamily: 'System', fontSize: 11, fontWeight: '700' as const, fontVariant: ['tabular-nums'] as any },
  statePill: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 999 },
  statePillText: { fontFamily: 'System', fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  utilBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  // Ghost mine row (popup.css #mine-buttons button)
  mineRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingTop: 10 },
  ghostBtn: { minHeight: 30, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: 'System', fontSize: 12.5, fontWeight: '600' as const },
  // Review pills (popup.css #review-buttons)
  reviewRow: { flexDirection: 'row', gap: 5, paddingTop: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  reviewBtn: { flex: 1, minHeight: 30, paddingVertical: 5, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  reviewText: { fontFamily: 'System', fontSize: 11, fontWeight: '600' as const, color: '#fff' },
  kanjiWrap: { paddingTop: 8, gap: 6 },
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
  posText: { fontFamily: 'System', fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8 },
  gloss: { fontFamily: 'System', fontSize: 15, lineHeight: 21, fontWeight: '400' as const, flex: 1 },
  glossIndex: { fontFamily: 'System', fontSize: 12, fontWeight: '500' as const, minWidth: 14, textAlign: 'right' as const, marginTop: 2 },
  bodySmall: { fontFamily: 'System', fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  footnote: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontFamily: 'System', fontSize: 12, lineHeight: 15, fontWeight: '400' as const },
  textArea: { minHeight: 44, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontFamily: 'System', fontSize: 14, lineHeight: 19, fontWeight: '400' as const, textAlignVertical: 'top' as any, marginTop: 6 },
  linkText: { fontFamily: 'System', fontSize: 13, fontWeight: '500' as const },
  forqPill: { paddingHorizontal: 9, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  forqText: { fontFamily: 'System', fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.3 },
  aiBox: { marginTop: 8, borderRadius: 10, borderWidth: 1, padding: 10 },
  examplesWrap: { marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
  exampleRow: { paddingVertical: 7, gap: 1 },
  ikSentence: { fontFamily: 'System', fontSize: 13.5, lineHeight: 18, fontWeight: '400' as const },
});
