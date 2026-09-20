// Shared pronunciation wiring for the reader and the in-app browser.
//
// Both screens drive the same three behaviours, and they had drifted into two
// near-identical copies:
//   - a tap plays immediately, because the user asked for it explicitly;
//   - mouse hover is debounced, so a pointer sliding across a line of text
//     does not machine-gun audio;
//   - switching or dismissing a word stops whatever is still playing.
//
// The generation counter is what makes the debounce safe: a scheduled play
// that loses its race is dropped rather than firing over a newer word.
import { useCallback, useEffect, useRef } from 'react';

import { playAudioForWord, stopAudio } from '../../services/jpdb/audio';

const HOVER_DEBOUNCE_MS = 120;

type AudioWord = { vid?: number; spelling?: string } | null | undefined;

export function useWordAudio() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = useRef(0);

  /** Drop any pending hover play. Pass true to also stop current playback. */
  const cancel = useCallback((stop = false) => {
    run.current++;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (stop) stopAudio();
  }, []);

  /** Hover only — taps must not wait out the debounce. */
  const scheduleHover = useCallback(
    (word: AudioWord) => {
      cancel(false);
      if (!word?.vid || !word?.spelling) return;
      const generation = run.current;
      const vid = word.vid;
      const spelling = word.spelling;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (run.current !== generation) return;
        void playAudioForWord(vid, spelling);
      }, HOVER_DEBOUNCE_MS);
    },
    [cancel]
  );

  /**
   * Play straight away. Callers cancel first when they are replacing a word,
   * so this deliberately does not stop anything itself.
   */
  const playNow = useCallback((word: AudioWord) => {
    if (!word?.vid || !word?.spelling) return;
    void playAudioForWord(word.vid, word.spelling);
  }, []);

  useEffect(() => () => cancel(true), [cancel]);

  return { cancel, scheduleHover, playNow };
}
