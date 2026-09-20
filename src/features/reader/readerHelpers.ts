// Pure reader helpers — dependency-free so they can be unit-tested headlessly
// (see __tests__/readerHelpers.test.ts). Extracted from ReaderScreen.tsx,
// which cannot run under node:test (react-native / expo imports).

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ReaderPreferences, ZoomMode } from './preferences';
import { setReaderPreferences } from './preferences';

// Minimal structural views of the WebView handle — kept local (instead of
// importing them from MokuroWebView.tsx) so this module stays compilable
// under tsconfig.test.json, which cannot typecheck .tsx sources.
export type ReaderPageInfoLike = {
  index: number;
  total: number;
  paged: boolean;
  rtl: boolean;
  twoPage: boolean;
};

export type WebViewHandleLike = {
  clearAnchor: () => void;
  setMokuroMenu: (show: boolean) => void;
};

export type ReaderPageState = {
  index: number;
  total: number;
  paged: boolean;
  rtl: boolean;
  twoPage: boolean;
};

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function formatPageLabel(canPage: boolean, total: number, currentIndex: number, progress: number): string {
  if (canPage) {
    return `${Math.min(total, currentIndex + 1)} / ${total}`;
  }
  return `${Math.round(progress * 100)}%`;
}

export function currentIndexFor(scrubTo: number | null, pageIndex: number): number {
  return Math.max(0, scrubTo ?? pageIndex);
}

export function mergePageState(
  previous: { index: number; total: number; paged: boolean; rtl: boolean; twoPage: boolean },
  info: ReaderPageInfoLike,
): { index: number; total: number; paged: boolean; rtl: boolean; twoPage: boolean } {
  if (
    previous.index === info.index &&
    previous.total === info.total &&
    previous.paged === info.paged &&
    previous.rtl === info.rtl &&
    previous.twoPage === info.twoPage
  ) {
    return previous;
  }
  return { index: info.index, total: info.total, paged: info.paged, rtl: info.rtl, twoPage: info.twoPage };
}

export function applyZoomControl(
  info: { key: string; mode?: ZoomMode },
  setZoomMode: (mode: ZoomMode) => void,
): void {
  if (info.key !== 'zoom') {
    return;
  }
  if (!info.mode) {
    return;
  }
  setZoomMode(info.mode);
  setReaderPreferences({ zoomMode: info.mode });
}

export function applyToggleControl(
  info: { key: string; value?: boolean | null },
  key: 'twoPage' | 'rtl',
  setPage: Dispatch<SetStateAction<{ index: number; total: number; paged: boolean; rtl: boolean; twoPage: boolean }>>,
): void {
  if (info.key !== key) {
    return;
  }
  if (typeof info.value !== 'boolean') {
    return;
  }
  const value = info.value;
  setPage((previous) => ({ ...previous, [key]: value }));
  setReaderPreferences({ [key]: value } as Partial<ReaderPreferences>);
}

export function applyWordHover(
  nextWord: any,
  interaction: { showPopupOnHover: boolean; playSoundOnHover: boolean },
  setOptionsOpen: (b: boolean) => void,
  setWord: (w: any) => void,
  scheduleHoverAudio: (w: any) => void,
  cancelHoverAudio: (force?: boolean) => void,
): void {
  if (interaction.showPopupOnHover) {
    setOptionsOpen(false);
    setWord(nextWord);
  }
  if (interaction.playSoundOnHover) {
    scheduleHoverAudio(nextWord);
  } else {
    cancelHoverAudio(true);
  }
}

export function decideCenterTap(
  hasWord: boolean,
  chromeVisible: boolean,
  dismissWord: () => void,
  hideChrome: () => void,
  showChrome: () => void,
): void {
  if (hasWord) {
    dismissWord();
    return;
  }
  if (chromeVisible) {
    hideChrome();
    return;
  }
  showChrome();
}

export function handleControlInfo(
  info: { ok: boolean; key: string; mode?: ZoomMode; value?: boolean | null },
  setControlError: (s: string | null) => void,
  setZoomMode: (z: ZoomMode) => void,
  setPage: Dispatch<SetStateAction<{ index: number; total: number; paged: boolean; rtl: boolean; twoPage: boolean }>>,
): void {
  if (!info.ok) {
    setControlError('This file does not expose that control.');
    return;
  }
  setControlError(null);
  applyZoomControl(info, setZoomMode);
  applyToggleControl(info, 'twoPage', setPage);
  applyToggleControl(info, 'rtl', setPage);
}

export function computeToggleOptionsNext(open: boolean, mokuroMenu: boolean): boolean {
  const next = !open;
  return next;
}

export function applyToggleOptionsSideEffects(
  next: boolean,
  mokuroMenu: boolean,
  setMokuroMenu: (b: boolean) => void,
  readerRef: RefObject<WebViewHandleLike | null>,
): void {
  if (!next && mokuroMenu) {
    setMokuroMenu(false);
    readerRef.current?.setMokuroMenu(false);
  }
}

export function computeSeekPage(total: number, value: number): number | null {
  if (total <= 1) {
    return null;
  }
  return Math.round(clamp01(value) * (total - 1));
}

export function isReadableVolume(volume: { htmlUri?: string; mokuroUri?: string }): boolean {
  return !!volume.htmlUri || !!volume.mokuroUri;
}

export function shouldShowWebView(resumePage: number | null, prefs: ReaderPreferences | null): boolean {
  return resumePage !== null && prefs !== null;
}

export function shouldShowOptions(optionsOpen: boolean, word: any): boolean {
  return optionsOpen && !word;
}

export function shouldShowFab(word: any, quizWords: any[] | null): boolean {
  return !word && !quizWords;
}

export function nextProgressValue(previous: number, next: number): number {
  if (Math.abs(previous - next) < 0.003) {
    return previous;
  }
  return next;
}

export function clearAnchoredWord(wordRef: RefObject<any>, readerRef: RefObject<WebViewHandleLike | null>): void {
  if (wordRef.current) {
    readerRef.current?.clearAnchor();
  }
}

export function maybePlayTapAudio(playSoundOnHover: boolean, nextWord: any, playWordAudio: (w: any) => void): void {
  if (playSoundOnHover) {
    playWordAudio(nextWord);
  }
}

export function clearToastTimer(timerRef: { current: ReturnType<typeof setTimeout> | null }): void {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
  }
}

export function reanchorWord(previous: any, next: any): any {
  if (!previous) {
    return previous;
  }
  return { ...previous, rect: next.rect, rects: next.rects, boxRect: next.boxRect, vertical: next.vertical, vw: next.vw, point: null };
}

export function hideChromeForWord(hasWord: boolean, hideChrome: () => void): void {
  if (hasWord) {
    hideChrome();
  }
}

export function applyInteractionState(config: { showPopupOnHover?: boolean; playSoundOnHover?: boolean }, ref: { current: { showPopupOnHover: boolean; playSoundOnHover: boolean } }): void {
  ref.current = {
    showPopupOnHover: config.showPopupOnHover !== false,
    playSoundOnHover: !!config.playSoundOnHover,
  };
}
