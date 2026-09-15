// Apple HIG — Liquid Glass & Motion System
// iOS 18/26 materials, 8pt grid, SF spring
// Use this instead of ad-hoc colors/radii throughout the app.

import { Platform } from 'react-native';

// 8pt grid — Apple uses 8pt base, 4pt sub
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

// Liquid Glass materials — approximated with expo-blur + translucent fill
// ultraThin (12) < thin (20) < regular (28) < thick (40)
export const material = {
  ultraThin: { blur: 12, fillLight: 'rgba(255,255,255,0.62)', fillDark: 'rgba(28,28,30,0.62)' },
  thin: { blur: 20, fillLight: 'rgba(255,255,255,0.72)', fillDark: 'rgba(28,28,30,0.72)' },
  regular: { blur: 28, fillLight: 'rgba(255,255,255,0.78)', fillDark: 'rgba(28,28,30,0.78)' },
  thick: { blur: 40, fillLight: 'rgba(255,255,255,0.84)', fillDark: 'rgba(28,28,30,0.84)' },
  chrome: { blur: 36, fillLight: 'rgba(255,255,255,0.78)', fillDark: 'rgba(22,22,24,0.78)' },
} as const;

// Motion — iOS spring config (WWDC 23)
export const spring = {
  // snappy for buttons / tabs
  snappy: { damping: 22, stiffness: 420, mass: 0.85 },
  // gentle for sheets / cards
  gentle: { damping: 26, stiffness: 300, mass: 1 },
  // bouncy for playful (rare)
  bouncy: { damping: 18, stiffness: 360, mass: 0.95 },
  // sheet
  sheet: { damping: 28, stiffness: 380, mass: 1 },
} as const;

export const duration = {
  micro: 120,
  fast: 180,
  medium: 260,
  slow: 380,
} as const;

// Haptics taxonomy — maps to Taptic Engine
export const haptics = {
  selection: 'selection' as const, // navigation
  light: 'light' as const, // tap
  medium: 'medium' as const, // primary action
  success: 'success' as const, // mine added
  warning: 'warning' as const,
  error: 'error' as const,
};

// Content size — for Dynamic Type respect
export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };

// Apple Books–like cover shadow — boxShadow (RN 0.86 / web safe)
export const coverShadow = Platform.select({
  ios: {
    boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
  },
  android: { elevation: 4 },
  default: {
    boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
  },
});

// Accessibility — minimum touch target 44pt
export const minTap = 44;
