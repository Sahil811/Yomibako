import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSize } from '../formatSize';

test('zero/undefined-ish is an em dash', () => {
  assert.equal(formatSize(0), '—');
  assert.equal(formatSize(NaN), '—');
});

test('bytes under 1KB', () => {
  assert.equal(formatSize(1), '1 B');
  assert.equal(formatSize(1023), '1023 B');
});

test('kilobytes round to whole KB', () => {
  assert.equal(formatSize(1024), '1 KB');
  assert.equal(formatSize(1536), '2 KB');
});

test('megabytes show one decimal', () => {
  assert.equal(formatSize(1024 * 1024), '1.0 MB');
  assert.ok(formatSize(5.5 * 1024 * 1024).startsWith('5.5 MB'));
});
