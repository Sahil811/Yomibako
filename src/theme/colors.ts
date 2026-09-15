// Yomibako — Apple-caliber Design System
// Built on iOS Human Interface Guidelines: Semantic colors, vibrancy, blur, systematic elevation.
// Inspired by Apple Books / Files / Safari — calm paper, not flat web gray.

export const lightColors = {
  // iOS semantic system
  background: '#FFFFFF', // systemBackground
  surface: '#FFFFFF', // systemBackground
  surfaceContainer: '#F2F2F7', // secondarySystemBackground — cards, search
  surfaceContainerHigh: '#EFEFF4', // tertiarySystemBackground
  surfaceContainerHighest: '#E5E5EA', // systemGray5
  surfaceDim: '#F2F2F7',
  surfaceBright: '#FFFFFF',

  // Tint — Apple systemBlue, precisely #007AFF
  primary: '#007AFF',
  onPrimary: '#FFFFFF',
  primaryContainer: '#E5F0FF',
  onPrimaryContainer: '#001D3D',

  secondary: '#5856D6', // systemPurple secondary action hint
  secondaryContainer: '#E9E9FF',
  onSecondaryContainer: '#1C1C1E',

  tertiary: '#FF3B30', // systemRed for destructive subtle
  tertiaryContainer: '#FFE9E8',
  onTertiaryContainer: '#410002',

  // Neutrals — Apple label hierarchy
  onSurface: '#000000', // label
  onSurfaceVariant: '#3C3C43', // secondaryLabel 60% — rendered as #8E8E93 for opacity-safe
  secondaryLabel: 'rgba(60,60,67,0.60)',
  tertiaryLabel: 'rgba(60,60,67,0.30)',
  quaternaryLabel: 'rgba(60,60,67,0.18)',

  outline: 'rgba(60,60,67,0.29)', // separator  — #C6C6C8 @29%
  outlineVariant: 'rgba(60,60,67,0.12)', // separator non-opaque lighter
  separator: 'rgba(60,60,67,0.29)',
  separatorOpaque: '#C6C6C8',
  hairline: 'rgba(60,60,67,0.12)',

  // System fills
  systemFill: 'rgba(120,120,128,0.20)',
  secondarySystemFill: 'rgba(120,120,128,0.16)',
  tertiarySystemFill: 'rgba(120,120,128,0.12)',
  quaternarySystemFill: 'rgba(120,120,128,0.08)',

  // Grouped
  groupedBackground: '#F2F2F7',
  secondaryGroupedBackground: '#FFFFFF',
  tertiaryGroupedBackground: '#F2F2F7',

  // Fixed
  inverseSurface: '#1C1C1E',
  inverseOnSurface: '#F2F2F7',
  error: '#FF3B30',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  success: '#34C759',
  warning: '#FF9500',

  // Blur & scrims — Apple vibrancy
  scrim: 'rgba(0,0,0,0.28)',
  scrimStrong: 'rgba(0,0,0,0.44)',
  shadow: 'rgba(0,0,0,0.08)',
  shadowStrong: 'rgba(0,0,0,0.12)',
  blurTint: 'rgba(255,255,255,0.72)',
  blurTintStrong: 'rgba(255,255,255,0.84)',
  // Card shadow
  cardShadow: 'rgba(0,0,0,0.06)',
} as const;

export const darkColors = {
  background: '#000000', // systemBackground dark
  surface: '#1C1C1E', // secondarySystemBackground dark
  surfaceContainer: '#2C2C2E', // tertiarySystemBackground
  surfaceContainerHigh: '#3A3A3C', // systemGray4
  surfaceContainerHighest: '#48484A',
  surfaceDim: '#000000',
  surfaceBright: '#2C2C2E',

  primary: '#0A84FF', // systemBlue dark
  onPrimary: '#FFFFFF',
  primaryContainer: '#00376B',
  onPrimaryContainer: '#D1E4FF',

  secondary: '#5E5CE6',
  secondaryContainer: '#2C2C6C',
  onSecondaryContainer: '#E9E9FF',

  tertiary: '#FF453A',
  tertiaryContainer: '#4A0D0A',
  onTertiaryContainer: '#FFDAD6',

  onSurface: '#FFFFFF',
  onSurfaceVariant: '#EBEBF5',
  secondaryLabel: 'rgba(235,235,245,0.60)',
  tertiaryLabel: 'rgba(235,235,245,0.30)',
  quaternaryLabel: 'rgba(235,235,245,0.18)',

  outline: 'rgba(84,84,88,0.60)', // separator dark
  outlineVariant: 'rgba(84,84,88,0.30)',
  separator: 'rgba(84,84,88,0.60)',
  separatorOpaque: '#38383A',
  hairline: 'rgba(84,84,88,0.30)',

  systemFill: 'rgba(120,120,128,0.36)',
  secondarySystemFill: 'rgba(120,120,128,0.32)',
  tertiarySystemFill: 'rgba(120,120,128,0.24)',
  quaternarySystemFill: 'rgba(120,120,128,0.18)',

  groupedBackground: '#000000',
  secondaryGroupedBackground: '#1C1C1E',
  tertiaryGroupedBackground: '#2C2C2E',

  inverseSurface: '#F2F2F7',
  inverseOnSurface: '#1C1C1E',
  error: '#FF453A',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  success: '#30D158',
  warning: '#FF9F0A',

  scrim: 'rgba(0,0,0,0.52)',
  scrimStrong: 'rgba(0,0,0,0.68)',
  shadow: 'rgba(0,0,0,0.40)',
  shadowStrong: 'rgba(0,0,0,0.56)',
  blurTint: 'rgba(28,28,30,0.72)',
  blurTintStrong: 'rgba(44,44,46,0.84)',
  cardShadow: 'rgba(0,0,0,0.36)',
} as const;

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
