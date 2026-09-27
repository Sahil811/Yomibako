import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READER_ACCENT_DARK_FILL,
  READER_ACCENT_LIGHT_FILL,
  READER_ACCENT_ON_FILL,
  contrastRatio,
  passesAaNormalText,
  readerAccentFill,
  readerAccentOnFill,
} from '../readerAccent';

test('reader accent fills pass AA with white text (both schemes)', () => {
  assert.ok(contrastRatio(READER_ACCENT_LIGHT_FILL, '#FFFFFF') >= 4.5, `light ${READER_ACCENT_LIGHT_FILL}`);
  assert.ok(contrastRatio(READER_ACCENT_DARK_FILL, '#FFFFFF') >= 4.5, `dark ${READER_ACCENT_DARK_FILL}`);
  assert.ok(passesAaNormalText(readerAccentFill('light'), readerAccentOnFill()));
  assert.ok(passesAaNormalText(readerAccentFill('dark'), READER_ACCENT_ON_FILL));
});

test('legacy bright hanko + palette blue fail AA — why we use deepened fill', () => {
  // Documents Blocking-5: #FF6B4A (2.82) and #a8c7fa (1.72) must NOT be button fills.
  assert.ok(contrastRatio('#FF6B4A', '#FFFFFF') < 4.5);
  assert.ok(contrastRatio('#a8c7fa', '#FFFFFF') < 4.5);
});

test('contrast is symmetric and sane', () => {
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
  assert.ok(contrastRatio('#000000', '#FFFFFF') > 15);
  assert.equal(contrastRatio('#BE3A22', '#FFFFFF').toFixed(2), contrastRatio('#FFFFFF', '#BE3A22').toFixed(2));
});
