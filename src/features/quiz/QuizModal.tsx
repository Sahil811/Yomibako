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
  readonly words: any[];
  readonly onClose: () => void;
  /** Reader chrome stays dark regardless of the system theme. */
  readonly forceDark?: boolean;
};

function getProgressPercent(total: number, finished: boolean, index: number): number {
  if (total <= 0) {
    return 0;
  }
  if (finished) {
    return 100;
  }
  return (index / total) * 100;
}

function getEmptyIconName(parsedLength: number, poolLength: number): 'checkCircle' | 'book' {
  if (parsedLength > 0 && poolLength === 0) {
    return 'checkCircle';
  }
  return 'book';
}

function getEmptyTitle(parsedLength: number, poolLength: number): string {
  if (parsedLength === 0) {
    return 'Nothing parsed here yet';
  }
  if (poolLength === 0) {
    return 'All caught up';
  }
  return 'Too few words here';
}

function getEmptyBody(parsedLength: number, poolLength: number): string {
  if (parsedLength === 0) {
    return 'No words on the current page have been parsed. Wait for parsing to finish, then try again.';
  }
  if (poolLength === 0) {
    return `All ${parsedLength} words on this page are already known or not due for review.`;
  }
  return 'This page needs at least two different meanings to make a real choice.';
}

function getOptionBackground(showRight: boolean, showWrong: boolean, isDark: boolean, colors: any): string {
  if (showRight) {
    if (isDark) {
      return 'rgba(52,199,89,0.16)';
    }
    return 'rgba(52,199,89,0.12)';
  }
  if (showWrong) {
    if (isDark) {
      return 'rgba(255,59,48,0.16)';
    }
    return 'rgba(255,59,48,0.10)';
  }
  return colors.surfaceContainer;
}

function getOptionBorderColor(showRight: boolean, showWrong: boolean, colors: any): string {
  if (showRight) {
    return colors.success;
  }
  if (showWrong) {
    return colors.error;
  }
  return 'transparent';
}

function getOptionOpacity(pressed: boolean, revealed: boolean, showRight: boolean, showWrong: boolean): number {
  if (pressed && !revealed) {
    return 0.76;
  }
  if (revealed && !showRight && !showWrong) {
    return 0.55;
  }
  return 1;
}

function getOptionMarkBackground(showRight: boolean, showWrong: boolean, colors: any): string {
  if (showRight) {
    return colors.success;
  }
  if (showWrong) {
    return colors.error;
  }
  return colors.tertiarySystemFill;
}

function getVerdictBackground(wasRight: boolean, isDark: boolean, colors: any): string {
  if (wasRight) {
    if (isDark) {
      return 'rgba(52,199,89,0.14)';
    }
    return 'rgba(52,199,89,0.10)';
  }
  return colors.surfaceContainer;
}

function getNextLabel(revealed: boolean, index: number, total: number): string {
  if (!revealed) {
    return 'Pick an answer';
  }
  if (index >= total - 1) {
    return 'See results';
  }
  return 'Next word';
}

function getHintText(word: QuizWord): string {
  if (word.meanings.length > 1) {
    return `Also means: ${word.meanings.slice(1, 4).join(' · ')}`;
  }
  return `Read as ${word.reading}`;
}

function canShowHintButton(revealed: boolean, word: QuizWord): boolean {
  if (revealed) {
    return false;
  }
  return word.meanings.length > 1 || Boolean(word.reading);
}

function getVerdictIcon(wasRight: boolean): 'checkCircle' | 'info' {
  if (wasRight) {
    return 'checkCircle';
  }
  return 'info';
}

function QuizHeader({
  ready,
  total,
  finished,
  index,
  colors,
  onDismiss,
}: {
  readonly ready: boolean;
  readonly total: number;
  readonly finished: boolean;
  readonly index: number;
  readonly colors: any;
  readonly onDismiss: () => void;
}) {
  const showCounter = ready && total > 0 && !finished;
  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <Text style={[s.title, { color: colors.onSurface }]}>Word quiz</Text>
        <Text numberOfLines={1} style={[s.subtitle, { color: colors.secondaryLabel }]}>
          New and due words on this page
        </Text>
      </View>
      {showCounter ? (
        <View style={[s.counterChip, { backgroundColor: colors.secondarySystemFill }]}>
          <Text style={[s.counterText, { color: colors.secondaryLabel }]}>
            {index + 1}/{total}
          </Text>
        </View>
      ) : null}
      <Pressable
        onPress={onDismiss}
        hitSlop={12}
        accessibilityLabel="Close quiz"
        style={({ pressed }) => [s.closeButton, { backgroundColor: colors.secondarySystemFill, opacity: pressed ? 0.6 : 1 }]}
      >
        <Icon name="close" size={15} color={colors.secondaryLabel} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

function QuizEmptyBody({
  parsedLength,
  poolLength,
  colors,
  onDismiss,
}: {
  readonly parsedLength: number;
  readonly poolLength: number;
  readonly colors: any;
  readonly onDismiss: () => void;
}) {
  return (
    <>
      <View style={s.center}>
        <View style={[s.emptyIcon, { backgroundColor: colors.secondarySystemFill }]}>
          <Icon
            name={getEmptyIconName(parsedLength, poolLength)}
            size={24}
            color={colors.secondaryLabel}
            strokeWidth={1.7}
          />
        </View>
        <Text style={[s.emptyTitle, { color: colors.onSurface }]}>{getEmptyTitle(parsedLength, poolLength)}</Text>
        <Text style={[s.emptyBody, { color: colors.secondaryLabel }]}>{getEmptyBody(parsedLength, poolLength)}</Text>
      </View>
      <View style={[s.footer, { borderTopColor: colors.separator }]}>
        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [s.primaryButton, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={s.primaryButtonText}>Back to reading</Text>
        </Pressable>
      </View>
    </>
  );
}

function QuizResultsBody({
  percent,
  correct,
  total,
  missed,
  colors,
  onRetry,
  onDismiss,
}: {
  readonly percent: number;
  readonly correct: number;
  readonly total: number;
  readonly missed: QuizWord[];
  readonly colors: any;
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
}) {
  const hasMissed = missed.length > 0;
  const retryLabel = hasMissed ? `Retry ${missed.length} missed` : 'Again';
  return (
    <>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.resultsHead}>
          <Text style={[s.resultsScore, { color: colors.primary }]}>{percent}%</Text>
          <Text style={[s.resultsFraction, { color: colors.secondaryLabel }]}>
            {correct} of {total} correct
          </Text>
        </View>
        <Text style={[s.resultsMessage, { color: colors.onSurface }]}>{scoreMessage(percent)}</Text>

        {hasMissed ? (
          <View style={s.missedSection}>
            <Text style={[s.sectionLabel, { color: colors.secondaryLabel }]}>
              Worth another look ({missed.length})
            </Text>
            <View style={[s.missedList, { backgroundColor: colors.surfaceContainer }]}>
              {missed.map((word, i) => (
                <View
                  key={wordKey(word)}
                  style={[s.missedItem, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }]}
                >
                  <View style={{ flexShrink: 0 }}>
                    <Text style={[s.missedWord, { color: colors.onSurface }]}>{word.spelling}</Text>
                    {word.reading && word.reading !== word.spelling ? (
                      <Text style={[s.missedReading, { color: colors.tertiaryLabel }]}>{word.reading}</Text>
                    ) : null}
                  </View>
                  <Text numberOfLines={2} style={[s.missedMeaning, { color: colors.secondaryLabel }]}>
                    {word.meanings[0]}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
      <View style={[s.footer, { borderTopColor: colors.separator }]}>
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [s.primaryButton, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Icon name="repeat" size={16} color="#fff" strokeWidth={2.2} />
          <Text style={s.primaryButtonText}>{retryLabel}</Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [s.ghostButton, { backgroundColor: colors.secondarySystemFill, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[s.ghostButtonText, { color: colors.onSurface }]}>Done</Text>
        </Pressable>
      </View>
    </>
  );
}

function OptionMarkContent({
  showRight,
  showWrong,
  optionIndex,
  colors,
}: {
  readonly showRight: boolean;
  readonly showWrong: boolean;
  readonly optionIndex: number;
  readonly colors: any;
}) {
  if (showRight) {
    return <Icon name="check" size={13} color="#fff" strokeWidth={3} />;
  }
  if (showWrong) {
    return <Icon name="close" size={11} color="#fff" strokeWidth={3} />;
  }
  return <Text style={[s.optionIndex, { color: colors.secondaryLabel }]}>{optionIndex + 1}</Text>;
}

function QuizOptionItem({
  option,
  optionIndex,
  answer,
  picked,
  revealed,
  isDark,
  colors,
  onAnswer,
}: {
  readonly option: string;
  readonly optionIndex: number;
  readonly answer: string;
  readonly picked: string | null;
  readonly revealed: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly onAnswer: (option: string) => void;
}) {
  const isAnswer = option === answer;
  const isPicked = option === picked;
  const showRight = revealed && isAnswer;
  const showWrong = revealed && isPicked && !isAnswer;
  return (
    <Pressable
      key={`${option}/${optionIndex}`}
      onPress={() => onAnswer(option)}
      disabled={revealed}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.option,
        {
          backgroundColor: getOptionBackground(showRight, showWrong, isDark, colors),
          borderColor: getOptionBorderColor(showRight, showWrong, colors),
          opacity: getOptionOpacity(pressed, revealed, showRight, showWrong),
        },
      ]}
    >
      <View
        style={[
          s.optionMark,
          { backgroundColor: getOptionMarkBackground(showRight, showWrong, colors) },
        ]}
      >
        <OptionMarkContent showRight={showRight} showWrong={showWrong} optionIndex={optionIndex} colors={colors} />
      </View>
      <Text style={[s.optionText, { color: colors.onSurface }]}>{option}</Text>
    </Pressable>
  );
}

function QuizWordCard({
  word,
  revealed,
  showHint,
  colors,
  onSpeak,
  onToggleHint,
}: {
  readonly word: QuizWord;
  readonly revealed: boolean;
  readonly showHint: boolean;
  readonly colors: any;
  readonly onSpeak: () => void;
  readonly onToggleHint: () => void;
}) {
  const showReading = Boolean(word.reading) && word.reading !== word.spelling;
  const showHintButton = canShowHintButton(revealed, word);
  const hintLabel = showHint ? 'Hide hint' : 'Hint';
  return (
    <View style={[s.wordCard, { backgroundColor: colors.surfaceContainer }]}>
      <Text style={[s.word, { color: colors.onSurface }]}>{word.spelling}</Text>
      {showReading ? (
        <Text style={[s.reading, { color: colors.secondaryLabel }]}>{word.reading}</Text>
      ) : null}
      <View style={s.wordActions}>
        <Pressable
          onPress={onSpeak}
          style={({ pressed }) => [s.wordAction, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
          accessibilityLabel="Play pronunciation"
        >
          <Icon name="audio" size={15} color={colors.secondaryLabel} strokeWidth={2} />
          <Text style={[s.wordActionText, { color: colors.secondaryLabel }]}>Listen</Text>
        </Pressable>
        {showHintButton ? (
          <Pressable
            onPress={onToggleHint}
            style={({ pressed }) => [s.wordAction, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
          >
            <Icon name="info" size={15} color={colors.secondaryLabel} strokeWidth={2} />
            <Text style={[s.wordActionText, { color: colors.secondaryLabel }]}>{hintLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function QuizVerdict({
  wasRight,
  question,
  isDark,
  colors,
}: {
  readonly wasRight: boolean;
  readonly question: QuizQuestion;
  readonly isDark: boolean;
  readonly colors: any;
}) {
  const verdictText = wasRight ? 'Correct' : `${question.word.spelling} means ${question.answer}`;
  const verdictColor = wasRight ? colors.success : colors.onSurface;
  return (
    <View
      style={[
        s.verdict,
        {
          backgroundColor: getVerdictBackground(wasRight, isDark, colors),
        },
      ]}
    >
      <Icon
        name={getVerdictIcon(wasRight)}
        size={17}
        color={wasRight ? colors.success : colors.secondaryLabel}
        strokeWidth={2}
      />
      <Text style={[s.verdictText, { color: verdictColor }]}>{verdictText}</Text>
    </View>
  );
}

function QuizKanjiBreakdown({
  kanji,
  openKanji,
  selectedKanji,
  showMnemonic,
  colors,
  onSelectKanji,
  onToggleMnemonic,
}: {
  readonly kanji: KanjiDetail[];
  readonly openKanji: string | null;
  readonly selectedKanji: KanjiDetail | null;
  readonly showMnemonic: boolean;
  readonly colors: any;
  readonly onSelectKanji: (kanji: string | null) => void;
  readonly onToggleMnemonic: () => void;
}) {
  const showPanel = selectedKanji !== null;
  const hasComponents = showPanel && selectedKanji.components.length > 0;
  const hasRtk = showPanel && Boolean(selectedKanji.rtk);
  return (
    <View style={s.kanjiWrap}>
      <Text style={[s.sectionLabel, { color: colors.secondaryLabel }]}>Kanji breakdown</Text>
      <View style={s.kanjiRow}>
        {kanji.map((detail) => {
          const active = openKanji === detail.kanji;
          return (
            <Pressable
              key={detail.kanji}
              onPress={() => onSelectKanji(active ? null : detail.kanji)}
              style={({ pressed }) => [
                s.kanjiChip,
                {
                  backgroundColor: active ? colors.surfaceContainerHigh : colors.surfaceContainer,
                  borderColor: active ? colors.primary : 'transparent',
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[s.kanjiChar, { color: colors.primary }]}>{detail.kanji}</Text>
              <Text numberOfLines={1} style={[s.kanjiMeaning, { color: colors.onSurface }]}>
                {detail.meanings || '—'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {showPanel ? (
        <View style={[s.kanjiPanel, { backgroundColor: colors.surfaceContainer }]}>
          <View style={s.kanjiPanelHead}>
            <Text style={[s.kanjiPanelChar, { color: colors.primary }]}>{selectedKanji.kanji}</Text>
            <Text numberOfLines={2} style={[s.kanjiPanelMeaning, { color: colors.onSurface }]}>
              {selectedKanji.meanings || '—'}
            </Text>
          </View>
          {hasComponents ? (
            <View style={s.componentGrid}>
              {selectedKanji.components.map((component) => (
                <View
                  key={component.component}
                  style={[s.componentCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}
                >
                  <Text style={[s.componentChar, { color: colors.primary }]}>{component.component}</Text>
                  <Text numberOfLines={2} style={[s.componentMeaning, { color: colors.secondaryLabel }]}>
                    {component.meaning || '—'}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {hasRtk ? (
            <>
              <Pressable onPress={onToggleMnemonic} hitSlop={8} style={s.mnemonicToggle}>
                <Text style={[s.mnemonicLabel, { color: colors.secondaryLabel }]}>Mnemonic</Text>
                <Icon
                  name={showMnemonic ? 'chevronDown' : 'chevronRight'}
                  size={13}
                  color={colors.tertiaryLabel}
                  strokeWidth={2.2}
                />
              </Pressable>
              {showMnemonic ? (
                <Text style={[s.mnemonicText, { color: colors.onSurface }]}>{selectedKanji.rtk}</Text>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function QuizQuestionBody({
  question,
  revealed,
  picked,
  showHint,
  kanji,
  openKanji,
  selectedKanji,
  showMnemonic,
  isDark,
  colors,
  stepStyle,
  onSpeak,
  onToggleHint,
  onAnswer,
  onSelectKanji,
  onToggleMnemonic,
}: {
  readonly question: QuizQuestion;
  readonly revealed: boolean;
  readonly picked: string | null;
  readonly showHint: boolean;
  readonly kanji: KanjiDetail[];
  readonly openKanji: string | null;
  readonly selectedKanji: KanjiDetail | null;
  readonly showMnemonic: boolean;
  readonly isDark: boolean;
  readonly colors: any;
  readonly stepStyle: any;
  readonly onSpeak: () => void;
  readonly onToggleHint: () => void;
  readonly onAnswer: (option: string) => void;
  readonly onSelectKanji: (kanji: string | null) => void;
  readonly onToggleMnemonic: () => void;
}) {
  const wasRight = revealed && picked === question.answer;
  const showHintText = showHint && !revealed;
  const showVerdict = revealed;
  const showKanji = revealed && kanji.length > 0;
  return (
    <Animated.View style={[{ gap: 14 }, stepStyle]}>
      <QuizWordCard
        word={question.word}
        revealed={revealed}
        showHint={showHint}
        colors={colors}
        onSpeak={onSpeak}
        onToggleHint={onToggleHint}
      />

      {showHintText ? (
        <Text style={[s.hint, { color: colors.secondaryLabel, borderColor: colors.separator }]}>
          {getHintText(question.word)}
        </Text>
      ) : null}

      <View style={s.options}>
        {question.options.map((option, i) => (
          <QuizOptionItem
            key={`${option}/${i}`}
            option={option}
            optionIndex={i}
            answer={question.answer}
            picked={picked}
            revealed={revealed}
            isDark={isDark}
            colors={colors}
            onAnswer={onAnswer}
          />
        ))}
      </View>

      {showVerdict ? (
        <QuizVerdict wasRight={wasRight} question={question} isDark={isDark} colors={colors} />
      ) : null}

      {/* Kanji breakdown only after the answer — the component
          meanings would otherwise give the question away. */}
      {showKanji ? (
        <QuizKanjiBreakdown
          kanji={kanji}
          openKanji={openKanji}
          selectedKanji={selectedKanji}
          showMnemonic={showMnemonic}
          colors={colors}
          onSelectKanji={onSelectKanji}
          onToggleMnemonic={onToggleMnemonic}
        />
      ) : null}
    </Animated.View>
  );
}

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
      const ask = subset?.length ? subset : pool;
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
      if (cancelled) {
        return;
      }
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

  const progressPercent = getProgressPercent(total, finished, index);
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
    if (!question) {
      return;
    }
    let cancelled = false;
    setKanji([]);
    setOpenKanji(null);
    setShowMnemonic(false);
    void playAudioForWord(question.word.vid, question.word.spelling);
    if (kanjiCfg.current.showKanji) {
      void loadKanjiDetails(question.word.spelling, { showRtk: kanjiCfg.current.showRtk })
        .then((details) => {
          if (cancelled) {
            return;
          }
          setKanji(details);
          // A single kanji needs no picking; open its breakdown straight away.
          if (details.length === 1 && details[0]) {
            setOpenKanji(details[0].kanji);
          }
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
      if (!question || answeredRef.current) {
        return;
      }
      const ok = option === question.answer;
      setPicked(option);
      if (ok) {
        setCorrect((n) => n + 1);
      } else {
        setMissed((list) => [...list, question.word]);
      }
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

  const handleSpeakCurrent = useCallback(() => {
    if (question) {
      speak(question.word);
    }
  }, [question, speak]);

  const handleToggleHint = useCallback(() => {
    void Haptics.selectionAsync();
    setShowHint((v) => !v);
  }, []);

  const handleRetry = useCallback(() => {
    void Haptics.selectionAsync();
    start(missed.length > 0 ? missed : undefined);
  }, [missed, start]);

  const handleSelectKanji = useCallback((value: string | null) => {
    void Haptics.selectionAsync();
    setOpenKanji(value);
    setShowMnemonic(false);
  }, []);

  const handleToggleMnemonic = useCallback(() => {
    void Haptics.selectionAsync();
    setShowMnemonic((v) => !v);
  }, []);

  const nextLabel = getNextLabel(revealed, index, total);
  const nextDisabled = !revealed;
  const nextBg = revealed ? c.primary : c.secondarySystemFill;

  let body: React.ReactNode = null;
  if (!ready) {
    body = (
      <View style={s.center}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  } else if (total === 0) {
    body = (
      <QuizEmptyBody parsedLength={parsed.length} poolLength={pool.length} colors={c} onDismiss={dismiss} />
    );
  } else if (finished) {
    body = (
      <QuizResultsBody
        percent={percent}
        correct={correct}
        total={total}
        missed={missed}
        colors={c}
        onRetry={handleRetry}
        onDismiss={dismiss}
      />
    );
  } else if (question) {
    body = (
      <>
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          <QuizQuestionBody
            question={question}
            revealed={revealed}
            picked={picked}
            showHint={showHint}
            kanji={kanji}
            openKanji={openKanji}
            selectedKanji={selectedKanji}
            showMnemonic={showMnemonic}
            isDark={isDark}
            colors={c}
            stepStyle={stepStyle}
            onSpeak={handleSpeakCurrent}
            onToggleHint={handleToggleHint}
            onAnswer={answer}
            onSelectKanji={handleSelectKanji}
            onToggleMnemonic={handleToggleMnemonic}
          />
        </ScrollView>

        <View style={[s.footer, { borderTopColor: c.separator }]}>
          <Pressable
            onPress={next}
            disabled={nextDisabled}
            style={({ pressed }) => [
              s.primaryButton,
              { backgroundColor: nextBg, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[s.primaryButtonText, !revealed && { color: c.tertiaryLabel }]}>{nextLabel}</Text>
          </Pressable>
        </View>
      </>
    );
  }

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
          <QuizHeader ready={ready} total={total} finished={finished} index={index} colors={c} onDismiss={dismiss} />

          <View style={[s.track, { backgroundColor: c.tertiarySystemFill }]}>
            <Animated.View style={[s.trackFill, { backgroundColor: c.primary }, progressStyle]} />
          </View>

          {body}
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
