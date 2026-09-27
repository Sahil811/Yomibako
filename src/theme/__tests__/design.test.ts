import test from 'node:test';
import assert from 'node:assert/strict';
import { brand, hankoFor, hankoSoftFor, indigoFor, sectionEyebrow } from '../design';
import { contrastRatio } from '../../features/reader/readerAccent';

test('readerAccent fills pass AA with white (chrome buttons)', () => {
  assert.ok(contrastRatio(brand.readerAccent.light, '#FFFFFF') >= 4.5, 'light');
  assert.ok(contrastRatio(brand.readerAccent.dark, '#FFFFFF') >= 4.5, 'dark');
});

test('bright hanko is glow-only, never a fill', () => {
  // Documents why readerAccent.dark is deepened, not brand.hanko.dark.
  assert.ok(contrastRatio(brand.hanko.dark, '#FFFFFF') < 4.5);
});

test('design helpers resolve per scheme', () => {
  assert.equal(hankoFor('light'), brand.hanko.light);
  assert.equal(hankoFor('dark'), brand.hanko.dark);
  assert.equal(hankoSoftFor('light'), brand.hankoSoft.light);
  assert.equal(indigoFor('dark'), brand.indigo.dark);
  assert.equal(sectionEyebrow(3, 'VOL'), 'VOL · 3');
  assert.equal(sectionEyebrow(undefined), 'SECTION');
});
