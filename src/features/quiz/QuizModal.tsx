// Word quiz — a multiple-choice self-test over the unknown and due words on
// the page you are currently reading. Opened from the floating button in the
// reader and the browser.
//
// Cards come from the spans the bundles wrapped, so no JPDB call is needed.
// Nothing is scheduled or persisted: a round is scoped to the current page and
// the user's real deck is never touched.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { darkColors, lightColors } from '../../theme/colors';
import { Icon } from '../../components/ui/Icon';
import { playAudioForWord, stopAudio } from '../../services/jpdb/audio';
import { loadConfig } from '../../services/jpdb/config';
import { loadKanjiDetails, type KanjiDetail } from '../../services/jpdb/kanjiData';
import {
  askableWords,
  buildQuestions,
  normalizeQuizWords,
  scoreMessage,
  wordKey,
  type QuizQuestion,
  type QuizWord,
} from './quiz';

type Props = {
  /** Raw word payloads collected from the WebView, scoped to what is on screen. */
  words: any[];
  onClose: () => void;
  /** Reader chrome stays dark regardless of the system theme. */
  forceDark?: boolean;
};

export default function QuizModal({ words, onClose, forceDark }: Props) {
  const scheme = useColorScheme();
  const isDark = forceDark || scheme === 'dark';
  const c = isDark ? darkColors : lightColors;
  const insets = useSafeAreaInsets();

  const [ready, setReady] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const [missed, setMissed] = useState<QuizWord[]>([]);
  const [showHint, setShowHint] = useState(false);
  const [round, setRound] = useState(0);
  const [kanji, setKanji] = useState<KanjiDetail[]>([]);
  const [openKanji, setOpenKanji] = useState<string | null>(null);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const kanjiCfg = useRef({ showKanji: true, showRtk: true });

  const parsed = useMemo(() => normalizeQuizWords(words), [words]);
  // Only unknown or due-for-review words get asked about; everything on the
  // page still supplies plausible wrong answers.
  const pool = useMemo(() => askableWords(parsed), [parsed]);

  const start = useCallback(
    (subset?: QuizWord[]) => {
      // A retry re-asks only what was missed; distractors still come from the
      // whole page, so a one-word retry is still a real multiple choice.
      const ask = subset && subset.length ? subset : pool;
      setQuestions(buildQuestions(ask, parsed));
      setIndex(0);
      setPicked(null);
      setCorrect(0);
      setMissed([]);
      setShowHint(false);
      setRound((r) => r + 1);
    },
    [parsed, pool]
  );

  useEffect(() => {
    let cancelled = false;
    void loadConfig().then((config) => {
      if (cancelled) return;
      kanjiCfg.current = { showKanji: config.showKanji !== false, showRtk: !!config.showRtk };
      start();
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [start]);

  // The quiz owns pronunciation while it is open; leaving must not keep talking.
  useEffect(() => () => {
    stopAudio();
  }, []);

  const question = questions[index] ?? null;
  const total = questions.length;
  const finished = ready && total > 0 && index >= total;
  const revealed = picked !== null;
  const answeredRef = useRef(false);
  answeredRef.current = revealed;

  // Entrance for the card, and a small step for every question change.
  const enter = useSharedValue(0);
  const step = useSharedValue(1);
  useEffect(() => {
    enter.value = withSpring(1, { damping: 22, stiffness: 260 });
  }, [enter]);
  useEffect(() => {
    // Sequence rather than two assignments: a bare reset in the same tick can
    // be swallowed and the step would never play.
    step.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 220 }));
  }, [index, round, step]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.96 + enter.value * 0.04 }],
  }));
  const stepStyle = useAnimatedStyle(() => ({
    opacity: step.value,
    transform: [{ translateY: (1 - step.value) * 8 }],
  }));

  const progressPercent = total ? ((finished ? total : index) / total) * 100 : 0;
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(progressPercent, { duration: 280 });
  }, [progress, progressPercent]);
  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value}%` }));

  const speak = useCallback((word: QuizWord) => {
    void Haptics.selectionAsync();
    stopAudio();
    void playAudioForWord(word.vid, word.spelling);
  }, []);

  // Prompt audio plays automatically, and the kanji breakdown is fetched up
  // front (bundled data) so it is already there the moment the answer lands.
  useEffect(() => {
    if (!question) return;
    let cancelled = false;
    setKanji([]);
    setOpenKanji(null);
    setShowMnemonic(false);
    void playAudioForWord(question.word.vid, question.word.spelling);
    if (kanjiCfg.current.showKanji) {
      void loadKanjiDetails(question.word.spelling, { showRtk: kanjiCfg.current.showRtk })
        .then((details) => {
          if (cancelled) return;
          setKanji(details);
          // A single kanji needs no picking; open its breakdown straight away.
          if (details.length === 1) setOpenKanji(details[0].kanji);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      stopAudio();
    };
  }, [question]);

  const answer = useCallback(
    (option: string) => {
      if (!question || answeredRef.current) return;
      const ok = option === question.answer;
      setPicked(option);
      if (ok) setCorrect((n) => n + 1);
      else setMissed((list) => [...list, question.word]);
      void Haptics.notificationAsync(
        ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
      );
    },
    [question]
  );

  const next = useCallback(() => {
    setPicked(null);
    setShowHint(false);
    setIndex((i) => i + 1);
    void Haptics.selectionAsync();
  }, []);

  const dismiss = useCallback(() => {
    stopAudio();
    onClose();
  }, [onClose]);

  const percent = total ? Math.round((correct / total) * 100) : 0;

  const selectedKanji = kanji.find((d) => d.kanji === openKanji) ?? null;
  const wasRight = revealed && picked === question?.answer;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <View style={[s.backdrop, { backgroundColor: isDark ? 'rgba(0,0,0,0.74)' : 'rgba(0,0,0,0.46)' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close quiz" />
        <Animated.View
          style={[
            s.card,
            cardStyle,
            {
              backgroundColor: c.surface,
              borderColor: c.separator,
              marginTop: insets.top + 12,
              marginBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={[s.title, { color: c.onSurface }]}>Word quiz</Text>
              <Text numberOfLines={1} style={[s.subtitle, { color: c.secondaryLabel }]}>
                New and due words on this page
              </Text>
            </View>
            {ready && total > 0 && !finished ? (
              <View style={[s.counterChip, { backgroundColor: c.secondarySystemFill }]}>
                <Text style={[s.counterText, { color: c.secondaryLabel }]}>
                  {index + 1}/{total}
                </Text>
              </View>
            ) : null}
            <Pressable
              onPress={dismiss}
              hitSlop={12}
              accessibilityLabel="Close quiz"
              style={({ pressed }) => [s.closeButton, { backgroundColor: c.secondarySystemFill, opacity: pressed ? 0.6 : 1 }]}
            >
              <Icon name="close" size={15} color={c.secondaryLabel} strokeWidth={2.4} />
            </Pressable>
          </View>

          <View style={[s.track, { backgroundColor: c.tertiarySystemFill }]}>
            <Animated.View style={[s.trackFill, { backgroundColor: c.primary }, progressStyle]} />
          </View>

          {!ready ? (
            <View style={s.center}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : total === 0 ? (
            <>
              <View style={s.center}>
                <View style={[s.emptyIcon, { backgroundColor: c.secondarySystemFill }]}>
                  <Icon
                    name={parsed.length > 0 && pool.length === 0 ? 'checkCircle' : 'book'}
                    size={24}
                    color={c.secondaryLabel}
                    strokeWidth={1.7}
                  />
                </View>
                <Text style={[s.emptyTitle, { color: c.onSurface }]}>
                  {parsed.length === 0
                    ? 'Nothing parsed here yet'
                    : pool.length === 0
                      ? 'All caught up'
                      : 'Too few words here'}
                </Text>
                <Text style={[s.emptyBody, { color: c.secondaryLabel }]}>
                  {parsed.length === 0
                    ? 'No words on the current page have been parsed. Wait for parsing to finish, then try again.'
                    : pool.length === 0
                      ? `All ${parsed.length} words on this page are already known or not due for review.`
                      : 'This page needs at least two different meanings to make a real choice.'}
                </Text>
              </View>
              <View style={[s.footer, { borderTopColor: c.separator }]}>
                <Pressable
                  onPress={dismiss}
                  style={({ pressed }) => [s.primaryButton, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={s.primaryButtonText}>Back to reading</Text>
                </Pressable>
              </View>
            </>
          ) : finished ? (
            <>
              <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
                <View style={s.resultsHead}>
                  <Text style={[s.resultsScore, { color: c.primary }]}>{percent}%</Text>
                  <Text style={[s.resultsFraction, { color: c.secondaryLabel }]}>
                    {correct} of {total} correct
                  </Text>
                </View>
                <Text style={[s.resultsMessage, { color: c.onSurface }]}>{scoreMessage(percent)}</Text>

                {missed.length > 0 ? (
                  <View style={s.missedSection}>
                    <Text style={[s.sectionLabel, { color: c.secondaryLabel }]}>
                      Worth another look ({missed.length})
                    </Text>
                    <View style={[s.missedList, { backgroundColor: c.surfaceContainer }]}>
                      {missed.map((word, i) => (
                        <View
                          key={wordKey(word)}
                          style={[s.missedItem, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }]}
                        >
                          <View style={{ flexShrink: 0 }}>
                            <Text style={[s.missedWord, { color: c.onSurface }]}>{word.spelling}</Text>
                            {word.reading && word.reading !== word.spelling ? (
                              <Text style={[s.missedReading, { color: c.tertiaryLabel }]}>{word.reading}</Text>
                            ) : null}
                          </View>
                          <Text numberOfLines={2} style={[s.missedMeaning, { color: c.secondaryLabel }]}>
                            {word.meanings[0]}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </ScrollView>
              <View style={[s.footer, { borderTopColor: c.separator }]}>
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync();
                    start(missed.length > 0 ? missed : undefined);
                  }}
                  style={({ pressed }) => [s.primaryButton, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Icon name="repeat" size={16} color="#fff" strokeWidth={2.2} />
                  <Text style={s.primaryButtonText}>
                    {missed.length > 0 ? `Retry ${missed.length} missed` : 'Again'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={dismiss}
                  style={({ pressed }) => [s.ghostButton, { backgroundColor: c.secondarySystemFill, opacity: pressed ? 0.8 : 1 }]}
                >
                  <Text style={[s.ghostButtonText, { color: c.onSurface }]}>Done</Text>
                </Pressable>
              </View>
            </>
          ) : question ? (
            <>
              <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
                <Animated.View style={[{ gap: 14 }, stepStyle]}>
                  <View style={[s.wordCard, { backgroundColor: c.surfaceContainer }]}>
                    <Text style={[s.word, { color: c.onSurface }]}>{question.word.spelling}</Text>
                    {question.word.reading && question.word.reading !== question.word.spelling ? (
                      <Text style={[s.reading, { color: c.secondaryLabel }]}>{question.word.reading}</Text>
                    ) : null}
                    <View style={s.wordActions}>
                      <Pressable
                        onPress={() => speak(question.word)}
                        style={({ pressed }) => [s.wordAction, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}
                        accessibilityLabel="Play pronunciation"
                      >
                        <Icon name="audio" size={15} color={c.secondaryLabel} strokeWidth={2} />
                        <Text style={[s.wordActionText, { color: c.secondaryLabel }]}>Listen</Text>
                      </Pressable>
                      {!revealed && (question.word.meanings.length > 1 || question.word.reading) ? (
                        <Pressable
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setShowHint((v) => !v);
                          }}
                          style={({ pressed }) => [s.wordAction, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}
                        >
                          <Icon name="info" size={15} color={c.secondaryLabel} strokeWidth={2} />
                          <Text style={[s.wordActionText, { color: c.secondaryLabel }]}>{showHint ? 'Hide hint' : 'Hint'}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>

                  {showHint && !revealed ? (
                    <Text style={[s.hint, { color: c.secondaryLabel, borderColor: c.separator }]}>
                      {question.word.meanings.length > 1
                        ? `Also means: ${question.word.meanings.slice(1, 4).join(' · ')}`
                        : `Read as ${question.word.reading}`}
                    </Text>
                  ) : null}

                  <View style={s.options}>
                    {question.options.map((option, i) => {
                      const isAnswer = option === question.answer;
                      const isPicked = option === picked;
                      const showRight = revealed && isAnswer;
                      const showWrong = revealed && isPicked && !isAnswer;
                      return (
                        <Pressable
                          key={`${option}/${i}`}
                          onPress={() => answer(option)}
                          disabled={revealed}
                          accessibilityRole="button"
                          style={({ pressed }) => [
                            s.option,
                            {
                              backgroundColor: showRight
                                ? (isDark ? 'rgba(52,199,89,0.16)' : 'rgba(52,199,89,0.12)')
                                : showWrong
                                  ? (isDark ? 'rgba(255,59,48,0.16)' : 'rgba(255,59,48,0.10)')
                                  : c.surfaceContainer,
                              borderColor: showRight ? c.success : showWrong ? c.error : 'transparent',
                              opacity: pressed && !revealed ? 0.76 : revealed && !showRight && !showWrong ? 0.55 : 1,
                            },
                          ]}
                        >
                          <View
                            style={[
                              s.optionMark,
                              { backgroundColor: showRight ? c.success : showWrong ? c.error : c.tertiarySystemFill },
                            ]}
                          >
                            {showRight ? (
                              <Icon name="check" size={13} color="#fff" strokeWidth={3} />
                            ) : showWrong ? (
                              <Icon name="close" size={11} color="#fff" strokeWidth={3} />
                            ) : (
                              <Text style={[s.optionIndex, { color: c.secondaryLabel }]}>{i + 1}</Text>
                            )}
                          </View>
                          <Text style={[s.optionText, { color: c.onSurface }]}>{option}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {revealed ? (
                    <View
                      style={[
                        s.verdict,
                        {
                          backgroundColor: wasRight
                            ? (isDark ? 'rgba(52,199,89,0.14)' : 'rgba(52,199,89,0.10)')
                            : c.surfaceContainer,
                        },
                      ]}
                    >
                      <Icon
                        name={wasRight ? 'checkCircle' : 'info'}
                        size={17}
                        color={wasRight ? c.success : c.secondaryLabel}
                        strokeWidth={2}
                      />
                      <Text style={[s.verdictText, { color: wasRight ? c.success : c.onSurface }]}>
                        {wasRight ? 'Correct' : `${question.word.spelling} means ${question.answer}`}
                      </Text>
                    </View>
                  ) : null}

                  {/* Kanji breakdown only after the answer — the component
                      meanings would otherwise give the question away. */}
                  {revealed && kanji.length > 0 ? (
                    <View style={s.kanjiWrap}>
                      <Text style={[s.sectionLabel, { color: c.secondaryLabel }]}>Kanji breakdown</Text>
                      <View style={s.kanjiRow}>
                        {kanji.map((detail) => {
                          const active = openKanji === detail.kanji;
                          return (
                            <Pressable
                              key={detail.kanji}
                              onPress={() => {
                                void Haptics.selectionAsync();
                                setOpenKanji(active ? null : detail.kanji);
                                setShowMnemonic(false);
                              }}
                              style={({ pressed }) => [
                                s.kanjiChip,
                                {
                                  backgroundColor: active ? c.surfaceContainerHigh : c.surfaceContainer,
                                  borderColor: active ? c.primary : 'transparent',
                                  opacity: pressed ? 0.8 : 1,
                                },
                              ]}
                            >
                              <Text style={[s.kanjiChar, { color: c.primary }]}>{detail.kanji}</Text>
                              <Text numberOfLines={1} style={[s.kanjiMeaning, { color: c.onSurface }]}>
                                {detail.meanings || '—'}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      {selectedKanji ? (
                        <View style={[s.kanjiPanel, { backgroundColor: c.surfaceContainer }]}>
                          <View style={s.kanjiPanelHead}>
                            <Text style={[s.kanjiPanelChar, { color: c.primary }]}>{selectedKanji.kanji}</Text>
                            <Text numberOfLines={2} style={[s.kanjiPanelMeaning, { color: c.onSurface }]}>
                              {selectedKanji.meanings || '—'}
                            </Text>
                          </View>
                          {selectedKanji.components.length > 0 ? (
                            <View style={s.componentGrid}>
                              {selectedKanji.components.map((component) => (
                                <View
                                  key={component.component}
                                  style={[s.componentCard, { backgroundColor: c.surface, borderColor: c.separator }]}
                                >
                                  <Text style={[s.componentChar, { color: c.primary }]}>{component.component}</Text>
                                  <Text numberOfLines={2} style={[s.componentMeaning, { color: c.secondaryLabel }]}>
                                    {component.meaning || '—'}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                          {selectedKanji.rtk ? (
                            <>
                              <Pressable
                                onPress={() => {
                                  void Haptics.selectionAsync();
                                  setShowMnemonic((v) => !v);
                                }}
                                hitSlop={8}
                                style={s.mnemonicToggle}
                              >
                                <Text style={[s.mnemonicLabel, { color: c.secondaryLabel }]}>Mnemonic</Text>
                                <Icon
                                  name={showMnemonic ? 'chevronDown' : 'chevronRight'}
                                  size={13}
                                  color={c.tertiaryLabel}
                                  strokeWidth={2.2}
                                />
                              </Pressable>
                              {showMnemonic ? (
                                <Text style={[s.mnemonicText, { color: c.onSurface }]}>{selectedKanji.rtk}</Text>
                              ) : null}
                            </>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </Animated.View>
              </ScrollView>

              <View style={[s.footer, { borderTopColor: c.separator }]}>
                <Pressable
                  onPress={next}
                  disabled={!revealed}
                  style={({ pressed }) => [
                    s.primaryButton,
                    { backgroundColor: revealed ? c.primary : c.secondarySystemFill, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={[s.primaryButtonText, !revealed && { color: c.tertiaryLabel }]}>
                    {revealed ? (index >= total - 1 ? 'See results' : 'Next word') : 'Pick an answer'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: 14 },
  card: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous' as any,
    overflow: 'hidden',
    maxHeight: '92%',
    boxShadow: '0 24px 64px rgba(0,0,0,0.40)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 13,
  },
  title: { fontFamily: 'System', fontSize: 18, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { fontFamily: 'System', fontSize: 12.5, fontWeight: '500', marginTop: 1 },
  counterChip: { height: 26, paddingHorizontal: 10, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  counterText: { fontFamily: 'System', fontSize: 12.5, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  closeButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  track: { height: 3 },
  trackFill: { height: '100%' },
  center: { paddingVertical: 40, paddingHorizontal: 26, alignItems: 'center', gap: 9 },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  emptyTitle: { fontFamily: 'System', fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  emptyBody: { fontFamily: 'System', fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  body: { padding: 18, gap: 14 },
  wordCard: {
    borderRadius: 22,
    borderCurve: 'continuous' as any,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 3,
  },
  word: { fontFamily: 'System', fontSize: 42, lineHeight: 54, fontWeight: '700', letterSpacing: -0.6 },
  reading: { fontFamily: 'System', fontSize: 15.5, fontWeight: '500' },
  wordActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  wordAction: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18 },
  wordActionText: { fontFamily: 'System', fontSize: 13, fontWeight: '600' },
  hint: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 13,
    fontFamily: 'System',
    fontSize: 13,
    lineHeight: 18,
  },
  options: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 16,
    borderWidth: 1.5,
    borderCurve: 'continuous' as any,
  },
  optionMark: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionIndex: { fontFamily: 'System', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  optionText: { flex: 1, fontFamily: 'System', fontSize: 15, lineHeight: 20, fontWeight: '500' },
  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderRadius: 14,
    borderCurve: 'continuous' as any,
  },
  verdictText: { flex: 1, fontFamily: 'System', fontSize: 13.5, lineHeight: 18.5, fontWeight: '600' },
  sectionLabel: { fontFamily: 'System', fontSize: 12.5, fontWeight: '600' },
  kanjiWrap: { gap: 8 },
  kanjiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kanjiChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    maxWidth: '100%',
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  kanjiChar: { fontFamily: 'System', fontSize: 17, fontWeight: '700' },
  kanjiMeaning: { flexShrink: 1, fontFamily: 'System', fontSize: 12.5, fontWeight: '500' },
  kanjiPanel: { borderRadius: 16, borderCurve: 'continuous' as any, padding: 13, gap: 10 },
  kanjiPanelHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kanjiPanelChar: { fontFamily: 'System', fontSize: 30, lineHeight: 36, fontWeight: '700' },
  kanjiPanelMeaning: { flex: 1, fontFamily: 'System', fontSize: 14, lineHeight: 19, fontWeight: '600' },
  componentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  componentCard: {
    minWidth: 78,
    flexGrow: 1,
    flexBasis: 78,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 2,
  },
  componentChar: { fontFamily: 'System', fontSize: 19, lineHeight: 24, fontWeight: '700' },
  componentMeaning: { fontFamily: 'System', fontSize: 11.5, lineHeight: 15, fontWeight: '500', textAlign: 'center' },
  mnemonicToggle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mnemonicLabel: { fontFamily: 'System', fontSize: 12.5, fontWeight: '600' },
  mnemonicText: { fontFamily: 'System', fontSize: 13, lineHeight: 19, marginTop: -4 },
  footer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 50,
    borderRadius: 16,
    borderCurve: 'continuous' as any,
  },
  primaryButtonText: { color: '#fff', fontFamily: 'System', fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  ghostButton: { minWidth: 100, alignItems: 'center', justifyContent: 'center', height: 50, borderRadius: 16, borderCurve: 'continuous' as any },
  ghostButtonText: { fontFamily: 'System', fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  resultsHead: { alignItems: 'center', gap: 2, paddingTop: 8 },
  resultsScore: { fontFamily: 'System', fontSize: 56, lineHeight: 62, fontWeight: '800', letterSpacing: -1.8 },
  resultsFraction: { fontFamily: 'System', fontSize: 14, fontWeight: '500' },
  resultsMessage: { fontFamily: 'System', fontSize: 15.5, fontWeight: '600', textAlign: 'center' },
  missedSection: { gap: 7 },
  missedList: { borderRadius: 16, borderCurve: 'continuous' as any, paddingHorizontal: 13 },
  missedItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  missedWord: { fontFamily: 'System', fontSize: 17, fontWeight: '600' },
  missedReading: { fontFamily: 'System', fontSize: 11.5, fontWeight: '500' },
  missedMeaning: { flex: 1, textAlign: 'right', fontFamily: 'System', fontSize: 12.5, lineHeight: 17, fontWeight: '500' },
});
