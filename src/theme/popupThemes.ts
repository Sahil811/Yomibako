// Popup colour themes, ported from jpd-breader's themes.css.
//
// Deliberately a plain data table with no react-native imports, so the palettes
// can be validated headlessly -- see src/features/reader/__tests__.
//
// Only the subset of colours WordSheet actually consumes is modelled. The app
// chrome keeps using src/theme/colors.ts; this drives the lookup card alone,
// because the reader chrome must stay dark even when the popup is sakura.

export type PopupThemeId =
  | 'auto'
  | 'light'
  | 'dark'
  | 'sakura'
  | 'ocean'
  | 'forest'
  | 'sunset'
  | 'amoled'
  | 'high-contrast';

export type PopupPalette = {
  /** Drives the state badge / review pill helpers and the status bar feel. */
  isDark: boolean;
  /** Card background. */
  surface: string;
  /** Inset panels: example card, kanji detail, AI box, text inputs. */
  surfaceContainer: string;
  /** Primary text. */
  onSurface: string;
  secondaryLabel: string;
  tertiaryLabel: string;
  separator: string;
  systemFill: string;
  tertiarySystemFill: string;
  /** Accent: links, Add button, kanji glyphs, frequency pill. */
  primary: string;
  error: string;
};

/** Themes the user can actually pick, in the order they appear in Settings. */
export const POPUP_THEME_IDS: PopupThemeId[] = [
  'auto',
  'light',
  'dark',
  'sakura',
  'ocean',
  'forest',
  'sunset',
  'amoled',
  'high-contrast',
];

export const POPUP_THEME_LABELS: Record<PopupThemeId, string> = {
  auto: 'Automatic',
  light: 'Light',
  dark: 'Dark',
  sakura: 'Sakura',
  ocean: 'Ocean',
  forest: 'Forest',
  sunset: 'Sunset',
  amoled: 'AMOLED',
  'high-contrast': 'High contrast',
};

// Hex values are taken verbatim from JPDB_breader/themes.css so a user who runs
// both sees the same popup. jpd-breader names them with Material 3 tokens:
//   surface -> surface, surfaceContainer -> surface-container,
//   onSurface -> on-surface, secondaryLabel -> on-surface-variant,
//   separator -> outline-variant, primary -> primary, error -> error.
export const POPUP_THEMES: Record<Exclude<PopupThemeId, 'auto'>, PopupPalette> = {
  light: {
    isDark: false,
    surface: '#f8f9fa',
    surfaceContainer: '#ececec',
    onSurface: '#1f1f1f',
    secondaryLabel: '#444746',
    tertiaryLabel: '#747775',
    separator: '#c4c7c5',
    systemFill: 'rgba(31,31,31,0.08)',
    tertiarySystemFill: 'rgba(31,31,31,0.05)',
    primary: '#0b57d0',
    error: '#b3261e',
  },
  dark: {
    isDark: true,
    surface: '#1e1e1e',
    surfaceContainer: '#282828',
    onSurface: '#e3e3e3',
    secondaryLabel: '#c4c7c5',
    tertiaryLabel: '#8e918f',
    separator: '#444746',
    systemFill: 'rgba(227,227,227,0.10)',
    tertiarySystemFill: 'rgba(227,227,227,0.06)',
    primary: '#a8c7fa',
    error: '#f2b8b5',
  },
  sakura: {
    isDark: false,
    surface: '#fff8f8',
    surfaceContainer: '#fbe9ec',
    onSurface: '#201a1b',
    secondaryLabel: '#534349',
    tertiaryLabel: '#85737a',
    separator: '#d7c1c6',
    systemFill: 'rgba(32,26,27,0.07)',
    tertiarySystemFill: 'rgba(32,26,27,0.04)',
    primary: '#b4255a',
    error: '#ba1a1a',
  },
  ocean: {
    isDark: false,
    surface: '#f4fbfb',
    surfaceContainer: '#e5eded',
    onSurface: '#161d1d',
    secondaryLabel: '#3f4949',
    tertiaryLabel: '#6f7979',
    separator: '#bec8c8',
    systemFill: 'rgba(22,29,29,0.07)',
    tertiarySystemFill: 'rgba(22,29,29,0.04)',
    primary: '#006a6a',
    error: '#ba1a1a',
  },
  forest: {
    isDark: false,
    surface: '#f8faf0',
    surfaceContainer: '#e8ece1',
    onSurface: '#1a1c18',
    secondaryLabel: '#434840',
    tertiaryLabel: '#73796f',
    separator: '#c3c8bc',
    systemFill: 'rgba(26,28,24,0.07)',
    tertiarySystemFill: 'rgba(26,28,24,0.04)',
    primary: '#386a20',
    error: '#ba1a1a',
  },
  sunset: {
    isDark: false,
    surface: '#fff8f4',
    surfaceContainer: '#f8ebe3',
    onSurface: '#211a13',
    secondaryLabel: '#51453b',
    tertiaryLabel: '#83746a',
    separator: '#d5c4b6',
    systemFill: 'rgba(33,26,19,0.07)',
    tertiarySystemFill: 'rgba(33,26,19,0.04)',
    primary: '#8b5000',
    error: '#ba1a1a',
  },
  amoled: {
    isDark: true,
    surface: '#000000',
    surfaceContainer: '#0d0d0d',
    onSurface: '#e0e0e0',
    secondaryLabel: '#a0a0a0',
    tertiaryLabel: '#6e6e6e',
    separator: '#2a2a2a',
    systemFill: 'rgba(224,224,224,0.10)',
    tertiarySystemFill: 'rgba(224,224,224,0.06)',
    primary: '#a8c7fa',
    error: '#f2b8b5',
  },
  'high-contrast': {
    isDark: false,
    surface: '#ffffff',
    surfaceContainer: '#f0f0f0',
    onSurface: '#000000',
    secondaryLabel: '#333333',
    tertiaryLabel: '#666666',
    separator: '#666666',
    systemFill: 'rgba(0,0,0,0.10)',
    tertiarySystemFill: 'rgba(0,0,0,0.06)',
    primary: '#0040dd',
    error: '#cc0000',
  },
};

/**
 * `auto` keeps the pre-theme behaviour exactly: the reader forces dark (its
 * chrome is always dark and a white card beside it looks broken), the browser
 * follows the system. Anything else is an explicit opt-in.
 */
export function resolvePopupPalette(id: PopupThemeId | undefined, systemIsDark: boolean): PopupPalette {
  if (!id || id === 'auto') return systemIsDark ? POPUP_THEMES.dark : POPUP_THEMES.light;
  return POPUP_THEMES[id] ?? (systemIsDark ? POPUP_THEMES.dark : POPUP_THEMES.light);
}
