// Scoped reader accent — hanko vermillion without repainting the app.
// design.ts declares hanko (#BE3A22 light / #FF6B4A dark) but #FF6B4A + white
// is 2.82:1 (fails AA) and popup palettes own `primary` inside the card.
// This module is the single reader-chrome accent: scrub fill, jump Go,
// active chips, Mine footer, progress hairline. Reader is always dark, so
// the dark fill is deepened to pass 4.5:1 with white text (verified by test).
// Pure + dependency-free so it runs under node:test.

export type ReaderScheme = 'light' | 'dark';

export const READER_ACCENT_LIGHT_FILL = '#BE3A22';
export const READER_ACCENT_DARK_FILL = '#A62A12';
export const READER_ACCENT_ON_FILL = '#FFFFFF';

export const READER_ACCENT_SOFT = {
  light: 'rgba(190,58,34,0.12)',
  dark: 'rgba(166,42,18,0.28)',
} as const;

export function readerAccentFill(scheme: ReaderScheme): string {
  return scheme === 'dark' ? READER_ACCENT_DARK_FILL : READER_ACCENT_LIGHT_FILL;
}

export function readerAccentOnFill(): string {
  return READER_ACCENT_ON_FILL;
}

export function readerAccentSoft(scheme: ReaderScheme): string {
  return scheme === 'dark' ? READER_ACCENT_SOFT.dark : READER_ACCENT_SOFT.light;
}

function hexToLinearChannel(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const rgb = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
  return rgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToLinearChannel(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for normal text — the gate the Mine/Go buttons must pass. */
export function passesAaNormalText(fill: string, onFill: string): boolean {
  return contrastRatio(fill, onFill) >= 4.5;
}
