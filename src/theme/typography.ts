// Apple HIG Typography — SF Pro Dynamic Type
// Every size/weight maps to iOS 17 text styles. Rounded, tracked, legible.

export const typography = {
  // Display — rare, hero
  displayLarge: { fontFamily: 'System', fontSize: 34, lineHeight: 41, fontWeight: '700' as const, letterSpacing: 0.4 }, // largeTitle
  displaySmall: { fontFamily: 'System', fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: 0.36 },

  // Headlines
  headlineLarge: { fontFamily: 'System', fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: 0.35 }, // title2
  headlineMedium: { fontFamily: 'System', fontSize: 20, lineHeight: 25, fontWeight: '600' as const, letterSpacing: 0.38 }, // title3
  headlineSmall: { fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.41 }, // headline

  // Titles
  titleLarge: { fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.41 },
  titleMedium: { fontFamily: 'System', fontSize: 16, lineHeight: 21, fontWeight: '600' as const, letterSpacing: -0.31 },
  titleSmall: { fontFamily: 'System', fontSize: 15, lineHeight: 20, fontWeight: '600' as const, letterSpacing: -0.23 },
  titleMicro: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '600' as const, letterSpacing: -0.08 },

  // Body
  bodyLarge: { fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '400' as const, letterSpacing: -0.41 },
  bodyMedium: { fontFamily: 'System', fontSize: 15, lineHeight: 20, fontWeight: '400' as const, letterSpacing: -0.23 },
  bodySmall: { fontFamily: 'System', fontSize: 14, lineHeight: 18, fontWeight: '400' as const, letterSpacing: -0.15 },
  footnote: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: -0.08 },
  caption1: { fontFamily: 'System', fontSize: 12, lineHeight: 16, fontWeight: '400' as const, letterSpacing: 0 },
  caption2: { fontFamily: 'System', fontSize: 11, lineHeight: 13, fontWeight: '400' as const, letterSpacing: 0.07 },

  // Labels — Apple button/label
  labelLarge: { fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.41 },
  labelMedium: { fontFamily: 'System', fontSize: 15, lineHeight: 20, fontWeight: '600' as const, letterSpacing: -0.23 },
  labelSmall: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '600' as const, letterSpacing: -0.08 },
  labelMicro: { fontFamily: 'System', fontSize: 11, lineHeight: 13, fontWeight: '600' as const, letterSpacing: 0.06 },

  // iOS grouped header/footer
  sectionHeader: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: -0.08, textTransform: 'uppercase' as const },
  sectionFooter: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: -0.08 },

  // Mono
  monoCaption: { fontFamily: 'System', fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.2, fontVariant: ['tabular-nums'] as any },
} as const;

// For convenience aliases matching old keys
export const jpFonts = {
  sans: '"SF Pro Text", "SF Pro Display", "Hiragino Sans", "Noto Sans JP", System',
  serif: '"New York", "Hiragino Mincho ProN", "Noto Serif JP", serif',
  mono: '"SF Mono", "Noto Sans Mono", monospace',
  rounded: '"SF Pro Rounded", System',
} as const;

export const monoNumbers = { fontVariant: ['tabular-nums'] as any } as const;

// Apple text style helpers
export const textStyleFor = (style: keyof typeof typography) => typography[style];
