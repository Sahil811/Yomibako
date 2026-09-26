// Yomibako design language v2 — "Reading Box"
// Identity: washi paper warmth, sumi ink type, ONE vermillion hanko accent.
// Hanko is the product's signature — progress, active states, primary actions,
// continue-reading, quiz scores. Indigo ink is the depth color (shelves, hero).
// System blue is retired from chrome; it survives only inside web content.
//
// Expensive-whitespace rules (enforced):
// - 4/8pt base. Screen gutters 20 (24 on large). Section gap 32–40.
// - Related = 8–12. Unrelated = 28–40. Never 14–20 no-man's-land.
// - One accent per screen. One primary action per screen.
// - Covers float (soft diffused shadow). Chrome blurs. Sheets lift.

export const brand = {
  // Hanko vermillion — THE Yomibako color. Buttons, progress, active pill, dots.
  // Light is deepened to #BE3A22 so white text passes 4.5:1 (was #E1482B).
  hanko: { light: '#BE3A22', dark: '#FF6B4A' },
  hankoBright: { light: '#E1482B', dark: '#FF7A57' },
  hankoSoft: { light: 'rgba(190,58,34,0.12)', dark: 'rgba(255,107,74,0.18)' },
  hankoFaint: { light: 'rgba(190,58,34,0.07)', dark: 'rgba(255,107,74,0.10)' },
  hankoContainer: { light: '#FFE7DC', dark: '#4D2016' },
  onHankoContainer: { light: '#5C1F12', dark: '#FFDAD2' },
  // Deep indigo from the app mark — shelves, onboarding glow, header ink.
  indigo: { light: '#2B2F6B', dark: '#9AA3D6' },
  indigoSoft: { light: 'rgba(43,47,107,0.08)', dark: 'rgba(154,163,214,0.16)' },
  indigoContainer: { light: '#E3E5FF', dark: '#2E3270' },
  // Washi paper — warms light grouped surfaces without hurting contrast.
  washi: { light: '#F6F1E8', dark: '#0B0B0F' },
  washiDeep: { light: '#EFE7D8', dark: '#131316' },
  // Sumi ink — display text.
  sumi: { light: '#14141A', dark: '#F5F3EE' },
} as const;

export const spacing = {
  hair: 2,
  xs: 4,
  sm: 8,
  md: 12,
  ml: 14,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
  '5xl': 40,
  '6xl': 48,
  hero: 64,
  giant: 80,
} as const;

// Section rhythm — the expensive whitespace system.
// screenPad: page gutters. sectionGap: between unrelated sections.
// cardGap: inside cards. headerGap: title → subtitle → content.
export const rhythm = {
  screenPad: 20,
  screenPadLarge: 24,
  sectionGap: 36,
  sectionGapLarge: 48,
  cardPad: 18,
  cardPadLarge: 22,
  cardGap: 12,
  headerGap: 6,
  rowGap: 8,
  heroGap: 16,
} as const;

export const shape = {
  xs: 6,
  sm: 8,
  md: 10,
  mdLarge: 12,
  card: 16,
  cardLarge: 20,
  cover: 14,
  sheet: 24,
  sheetLarge: 32,
  pill: 999,
} as const;

// Soft book shadows — covers float like paper, chrome hovers, sheets lift.
// Hanko-tinted FAB shadow makes the primary action glow vermillion.
export const shadow = {
  cover: '0 10px 24px rgba(16,16,24,0.18), 0 2px 6px rgba(16,16,24,0.10)',
  coverLarge: '0 18px 40px rgba(16,16,24,0.22), 0 4px 12px rgba(16,16,24,0.12)',
  card: '0 6px 18px rgba(16,16,24,0.08), 0 1px 4px rgba(16,16,24,0.05)',
  cardLarge: '0 10px 28px rgba(16,16,24,0.10), 0 2px 8px rgba(16,16,24,0.06)',
  chrome: '0 12px 32px rgba(0,0,0,0.30), 0 2px 8px rgba(0,0,0,0.20)',
  fab: '0 12px 28px rgba(190,58,34,0.38), 0 4px 12px rgba(0,0,0,0.20)',
  fabDark: '0 12px 28px rgba(255,107,74,0.34), 0 4px 12px rgba(0,0,0,0.36)',
  sheet: '0 28px 72px rgba(0,0,0,0.36), 0 4px 16px rgba(0,0,0,0.18)',
  tabBar: '0 12px 36px rgba(16,16,24,0.18), 0 2px 8px rgba(16,16,24,0.10)',
} as const;

export const typeScale = {
  display: { fontSize: 34, lineHeight: 40, weight: '800' as const, tracking: -0.8 },
  displaySmall: { fontSize: 30, lineHeight: 36, weight: '800' as const, tracking: -0.7 },
  title: { fontSize: 24, lineHeight: 30, weight: '700' as const, tracking: -0.5 },
  titleSmall: { fontSize: 20, lineHeight: 25, weight: '700' as const, tracking: -0.45 },
  section: { fontSize: 16, lineHeight: 21, weight: '700' as const, tracking: -0.3 },
  eyebrow: { fontSize: 11, lineHeight: 14, weight: '800' as const, tracking: 1.2 },
  body: { fontSize: 15.5, lineHeight: 23, weight: '400' as const, tracking: -0.25 },
  bodySmall: { fontSize: 14, lineHeight: 20, weight: '400' as const, tracking: -0.2 },
  caption: { fontSize: 12.5, lineHeight: 17, weight: '500' as const, tracking: -0.1 },
  mono: { fontSize: 12, lineHeight: 17, weight: '500' as const, tracking: 0.2 },
} as const;

export const motionScale = {
  tap: 0.96,
  cardTap: 0.97,
  pillTap: 0.95,
  springSnappy: { damping: 24, stiffness: 460, mass: 0.85 },
  springSoft: { damping: 28, stiffness: 320, mass: 1 },
  springBouncy: { damping: 20, stiffness: 360, mass: 0.95 },
  fadeFast: 140,
  fadeBase: 220,
  fadeSlow: 320,
} as const;

// Vertical rhythm helpers — use instead of magic numbers.
export const layout = {
  minTouch: 44,
  appBarMinHeight: 64,
  heroMinHeight: 84,
  cardMinHeight: 56,
  fabSize: 58,
  fabExtendedHeight: 58,
  tabBarHeight: 68,
  coverAspect: 0.714,
} as const;

export const z = {
  content: 1,
  stickyHeader: 10,
  chrome: 20,
  fab: 30,
  sheet: 50,
  toast: 60,
  modal: 100,
} as const;

export function hankoFor(scheme: 'light' | 'dark'): string {
  return scheme === 'dark' ? brand.hanko.dark : brand.hanko.light;
}

export function hankoSoftFor(scheme: 'light' | 'dark'): string {
  return scheme === 'dark' ? brand.hankoSoft.dark : brand.hankoSoft.light;
}

export function indigoFor(scheme: 'light' | 'dark'): string {
  return scheme === 'dark' ? brand.indigo.dark : brand.indigo.light;
}

/** One-line section header copy: eyebrow + title pair. */
export function sectionEyebrow(count?: number, label = 'SECTION'): string {
  if (typeof count === 'number') return `${label} · ${count}`;
  return label;
}
