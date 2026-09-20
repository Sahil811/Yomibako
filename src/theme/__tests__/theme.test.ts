import test from 'node:test';
import assert from 'node:assert/strict';
import { lightColors, darkColors, readerStateColors, radii, elevation, motion, blur } from '../colors';
import { typography, jpFonts, monoNumbers, textStyleFor } from '../typography';
import { space, material, spring, duration, haptics, hitSlop, coverShadow, minTap } from '../apple';

test('light and dark palettes expose the same keys', () => {
  const l = Object.keys(lightColors).sort();
  const d = Object.keys(darkColors).sort();
  assert.deepEqual(l, d);
});

test('core brand colors are Apple system colors', () => {
  assert.equal(lightColors.primary, '#007AFF');
  assert.equal(darkColors.primary, '#0A84FF');
  assert.equal(lightColors.error, '#FF3B30');
  assert.equal(darkColors.error, '#FF453A');
  assert.equal(lightColors.success, '#34C759');
  assert.equal(darkColors.success, '#30D158');
});

test('reader states cover every quiz/card state', () => {
  for (const k of ['known', 'new', 'learning', 'due', 'failed', 'blacklisted', 'neverForget'] as const) {
    assert.ok(readerStateColors[k].light, k);
    assert.ok(readerStateColors[k].dark, k);
  }
});

test('radii/elevation/motion/blur constants are sane', () => {
  assert.ok(radii.pill > radii['3xl']);
  assert.ok(elevation.card.elevation > 0);
  assert.ok(elevation.sheet.elevation >= elevation.card.elevation);
  assert.ok(motion.durationFast < motion.durationMedium);
  assert.ok(motion.durationMedium < motion.durationSlow);
  assert.ok(blur.ultraThin < blur.regular);
  assert.ok(blur.regular < blur.prominent);
});

test('typography entries have font metrics and textStyleFor resolves', () => {
  for (const [key, v] of Object.entries(typography)) {
    assert.ok((v as any).fontSize > 0, key);
    assert.ok((v as any).lineHeight >= (v as any).fontSize, key);
  }
  assert.equal(textStyleFor('bodyLarge'), typography.bodyLarge);
  assert.equal(textStyleFor('caption2').fontSize, 11);
  assert.ok(jpFonts.sans.includes('Hiragino'));
  assert.ok(jpFonts.serif.includes('Mincho'));
  assert.deepEqual(monoNumbers, { fontVariant: ['tabular-nums'] });
});

test('apple 8pt grid, materials, springs, haptics', () => {
  assert.equal(space.sm, 8);
  assert.equal(space.md, 12);
  assert.ok(material.thin.blur < material.regular.blur);
  assert.ok(material.regular.blur < material.thick.blur);
  assert.ok(spring.snappy.stiffness > spring.gentle.stiffness);
  assert.equal(duration.fast, 180);
  assert.equal(haptics.selection, 'selection');
  assert.deepEqual(hitSlop, { top: 8, bottom: 8, left: 8, right: 8 });
  assert.equal(minTap, 44);
  assert.ok(coverShadow, 'coverShadow defined via Platform.select mock');
});
