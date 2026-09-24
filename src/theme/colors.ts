// Yomibako — Apple-caliber Design System
// Built on iOS Human Interface Guidelines: Semantic colors, vibrancy, blur, systematic elevation.
// Inspired by Apple Books / Files / Safari — calm paper, not flat web gray.
//
// Both schemes share the same keys; each entry is a [light, dark] pair so the
// two palettes cannot drift apart (or be duplicated) unnoticed.
const COLOR_PAIRS = {
  // iOS semantic system
  background: ['#FFFFFF', '#000000'],
  surface: ['#FFFFFF', '#1C1C1E'],
  surfaceContainer: ['#F2F2F7', '#2C2C2E'],
  surfaceContainerHigh: ['#EFEFF4', '#3A3A3C'],
  surfaceContainerHighest: ['#E5E5EA', '#48484A'],
  surfaceDim: ['#F2F2F7', '#000000'],
  surfaceBright: ['#FFFFFF', '#2C2C2E'],
  // Tint — Apple systemBlue, precisely #007AFF
  primary: ['#007AFF', '#0A84FF'],
  onPrimary: ['#FFFFFF', '#FFFFFF'],
  primaryContainer: ['#E5F0FF', '#00376B'],
  onPrimaryContainer: ['#001D3D', '#D1E4FF'],
  secondary: ['#5856D6', '#5E5CE6'],
  secondaryContainer: ['#E9E9FF', '#2C2C6C'],
  onSecondaryContainer: ['#1C1C1E', '#E9E9FF'],
  tertiary: ['#FF3B30', '#FF453A'],
  tertiaryContainer: ['#FFE9E8', '#4A0D0A'],
  onTertiaryContainer: ['#410002', '#FFDAD6'],
  // Neutrals — Apple label hierarchy
  onSurface: ['#000000', '#FFFFFF'],
  onSurfaceVariant: ['#3C3C43', '#EBEBF5'],
  secondaryLabel: ['rgba(60,60,67,0.60)', 'rgba(235,235,245,0.60)'],
  tertiaryLabel: ['rgba(60,60,67,0.30)', 'rgba(235,235,245,0.30)'],
  quaternaryLabel: ['rgba(60,60,67,0.18)', 'rgba(235,235,245,0.18)'],
  outline: ['rgba(60,60,67,0.29)', 'rgba(84,84,88,0.60)'],
  outlineVariant: ['rgba(60,60,67,0.12)', 'rgba(84,84,88,0.30)'],
  separator: ['rgba(60,60,67,0.29)', 'rgba(84,84,88,0.60)'],
  separatorOpaque: ['#C6C6C8', '#38383A'],
  hairline: ['rgba(60,60,67,0.12)', 'rgba(84,84,88,0.30)'],
  // System fills
  systemFill: ['rgba(120,120,128,0.20)', 'rgba(120,120,128,0.36)'],
  secondarySystemFill: ['rgba(120,120,128,0.16)', 'rgba(120,120,128,0.32)'],
  tertiarySystemFill: ['rgba(120,120,128,0.12)', 'rgba(120,120,128,0.24)'],
  quaternarySystemFill: ['rgba(120,120,128,0.08)', 'rgba(120,120,128,0.18)'],
  // Grouped
  groupedBackground: ['#F2F2F7', '#000000'],
  secondaryGroupedBackground: ['#FFFFFF', '#1C1C1E'],
  tertiaryGroupedBackground: ['#F2F2F7', '#2C2C2E'],
  // Fixed
  inverseSurface: ['#1C1C1E', '#F2F2F7'],
  inverseOnSurface: ['#F2F2F7', '#1C1C1E'],
  error: ['#FF3B30', '#FF453A'],
  errorContainer: ['#FFDAD6', '#93000A'],
  onErrorContainer: ['#410002', '#FFDAD6'],
  success: ['#34C759', '#30D158'],
  warning: ['#FF9500', '#FF9F0A'],
  // Blur & scrims — Apple vibrancy
  scrim: ['rgba(0,0,0,0.28)', 'rgba(0,0,0,0.52)'],
  scrimStrong: ['rgba(0,0,0,0.44)', 'rgba(0,0,0,0.68)'],
  shadow: ['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.40)'],
  shadowStrong: ['rgba(0,0,0,0.12)', 'rgba(0,0,0,0.56)'],
  blurTint: ['rgba(255,255,255,0.72)', 'rgba(28,28,30,0.72)'],
  blurTintStrong: ['rgba(255,255,255,0.84)', 'rgba(44,44,46,0.84)'],
  // Card shadow
  cardShadow: ['rgba(0,0,0,0.06)', 'rgba(0,0,0,0.36)'],
} as const;

type ColorKey = keyof typeof COLOR_PAIRS;

function buildPalette(scheme: 0 | 1): { [K in ColorKey]: string } {
  const palette = {} as { [K in ColorKey]: string };
  for (const [key, pair] of Object.entries(COLOR_PAIRS) as [ColorKey, readonly [string, string]][]) {
    palette[key] = pair[scheme];
  }
  return palette;
}

export const lightColors = buildPalette(0);
export const darkColors = buildPalette(1);

export type AppColors = typeof lightColors | typeof darkColors;

// Semantic reader states — now Apple-tinted but calm
export const readerStateColors = {
  known: { light: 'rgba(60,60,67,0.60)', dark: 'rgba(235,235,245,0.60)' },
  new: { light: '#007AFF', dark: '#0A84FF' },
  learning: { light: '#34C759', dark: '#30D158' }, // systemGreen
  due: { light: '#FF9500', dark: '#FF9F0A' }, // systemOrange
  failed: { light: '#FF3B30', dark: '#FF453A' },
  blacklisted: { light: 'rgba(60,60,67,0.30)', dark: 'rgba(235,235,245,0.30)' },
  neverForget: { light: '#30D158', dark: '#40E0A0' },
} as const;

// Apple HIG radii — continuous corners
export const radii = {
  xs: 6, // caption
  sm: 8,
  md: 10,
  lg: 12, // cards
  xl: 16, // sheets
  '2xl': 20, // large cards
  '3xl': 28, // iOS sheets
  pill: 999,
} as const;

// iOS elevation — ultra-subtle, diffused. Uses boxShadow (RN 0.86 / web safe).
export const elevation = {
  0: { boxShadow: '0 0 0 rgba(0,0,0,0)', elevation: 0 },
  1: { boxShadow: '0 2px 6px rgba(0,0,0,0.05)', elevation: 2 },
  2: { boxShadow: '0 4px 10px rgba(0,0,0,0.06)', elevation: 4 },
  3: { boxShadow: '0 8px 18px rgba(0,0,0,0.08)', elevation: 8 },
  card: { boxShadow: '0 4px 12px rgba(0,0,0,0.06)', elevation: 3 },
  sheet: { boxShadow: '0 12px 32px rgba(0,0,0,0.14)', elevation: 12 },
} as const;

// Motion — Apple spring
export const motion = {
  springSnappy: { damping: 22, stiffness: 380, mass: 0.9 },
  springGentle: { damping: 24, stiffness: 260, mass: 1 },
  springBouncy: { damping: 18, stiffness: 340, mass: 1 },
  durationFast: 180,
  durationMedium: 260,
  durationSlow: 380,
} as const;

// Blur
export const blur = {
  regular: 20,
  prominent: 32,
  ultraThin: 12,
} as const;
