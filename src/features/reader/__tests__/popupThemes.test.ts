// Guards the ported theme table. A missing or malformed colour in one of eight
// palettes otherwise shows up as a single invisible label on a single theme,
// which is not something the type checker or a smoke test would catch.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POPUP_THEMES,
  POPUP_THEME_IDS,
  POPUP_THEME_LABELS,
  resolvePopupPalette,
  type PopupPalette,
} from '../../../theme/popupThemes';

const COLOUR_KEYS: (keyof PopupPalette)[] = [
  'surface',
  'surfaceContainer',
  'onSurface',
  'secondaryLabel',
  'tertiaryLabel',
  'separator',
  'systemFill',
  'tertiarySystemFill',
  'primary',
  'error',
];

const HEX = /^#[0-9a-f]{6}$/i;
const RGBA = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/;

/** Relative luminance of an #rrggbb colour, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const named = POPUP_THEME_IDS.filter((id) => id !== 'auto');

test('every pickable theme has a palette and a label', () => {
  for (const id of POPUP_THEME_IDS) {
    assert.ok(POPUP_THEME_LABELS[id], `${id} has no label`);
  }
  for (const id of named) {
    assert.ok((POPUP_THEMES as any)[id], `${id} is listed but has no palette`);
  }
  assert.equal(Object.keys(POPUP_THEMES).length, named.length, 'orphan palette with no picker entry');
});

test('every palette defines every colour, and each parses', () => {
  for (const id of named) {
    const palette = (POPUP_THEMES as any)[id] as PopupPalette;
    for (const key of COLOUR_KEYS) {
      const value = palette[key] as string;
      assert.ok(value !== undefined, `${id}.${String(key)} is undefined`);
      assert.ok(
        HEX.test(value) || RGBA.test(value),
        `${id}.${String(key)} = ${JSON.stringify(value)} is not a usable colour`
      );
    }
    assert.equal(typeof palette.isDark, 'boolean', `${id}.isDark missing`);
  }
});

test('isDark agrees with the surface it claims to describe', () => {
  // isDark drives the state badge and review pill helpers, so a palette that
  // lies about itself renders dark-on-dark text.
  for (const id of named) {
    const palette = (POPUP_THEMES as any)[id] as PopupPalette;
    const dark = luminance(palette.surface) < 0.4;
    assert.equal(palette.isDark, dark, `${id}.isDark=${palette.isDark} but surface is ${palette.surface}`);
  }
});

test('text has usable contrast against its own surface', () => {
  for (const id of named) {
    const palette = (POPUP_THEMES as any)[id] as PopupPalette;
    const surface = luminance(palette.surface);
    for (const key of ['onSurface', 'secondaryLabel', 'primary'] as const) {
      const text = luminance(palette[key]);
      const ratio = (Math.max(surface, text) + 0.05) / (Math.min(surface, text) + 0.05);
      assert.ok(ratio >= 3, `${id}.${key} contrast ${ratio.toFixed(2)}:1 against surface is unreadable`);
    }
  }
});

test('auto follows the system and never returns undefined', () => {
  assert.equal(resolvePopupPalette('auto', true), POPUP_THEMES.dark);
  assert.equal(resolvePopupPalette('auto', false), POPUP_THEMES.light);
  assert.equal(resolvePopupPalette(undefined, true), POPUP_THEMES.dark);
  // A theme id written by a newer build must not blank the card.
  assert.equal(resolvePopupPalette('nonsense' as any, true), POPUP_THEMES.dark);
});

test('a named theme ignores the system scheme', () => {
  assert.equal(resolvePopupPalette('sakura', true), POPUP_THEMES.sakura);
  assert.equal(resolvePopupPalette('sakura', false), POPUP_THEMES.sakura);
});
