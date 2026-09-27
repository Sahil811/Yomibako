// AppState flush — F6 of Final Vetted Plan.
//
// Hard kill within 800ms of a scan (libraryCache) or 1200ms of a page turn
// (progress) silently lost that data: all persists were debounced with no
// background flush. This hook flushes everything when the app backgrounds
// and cancels session jobs so they don't linger.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { flush as flushProgress } from '../features/reader/progress';
import { flushReaderPreferences } from '../features/reader/preferences';
import { cancelAllSessionJobs } from '../services/jpdb/session';

export function useAppStateFlush(): void {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: string) => {
      if (state === 'background') {
        // Fire-and-forget: background time is limited, don't await.
        void flushProgress().catch(() => {});
        void flushReaderPreferences().catch(() => {});
        try {
          cancelAllSessionJobs();
        } catch {}
      }
    });
    return () => {
      sub.remove();
    };
  }, []);
}
