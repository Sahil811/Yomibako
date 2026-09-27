import test from 'node:test';
import assert from 'node:assert/strict';
import { WordCache, wordCacheKey } from '../wordCache';

test('key is spelling|reading, stable for empty reading', () => {
  assert.equal(wordCacheKey('読書', 'どくしょ'), '読書｜どくしょ');
  assert.equal(wordCacheKey('猫', ''), '猫｜');
});

test('hit refreshes recency, LRU evicts oldest', () => {
  const c = new WordCache(2);
  c.set('a', '', { meanings: 1 });
  c.set('b', '', { meanings: 2 });
  assert.equal(c.size, 2);
  c.get('a', '');
  c.set('c', '', { meanings: 3 });
  assert.equal(c.has('a', ''), true);
  assert.equal(c.has('b', ''), false);
  assert.equal(c.has('c', ''), true);
});

test('same spelling different reading does not cross-contaminate', () => {
  const c = new WordCache(10);
  c.set('橋', 'はし', { pitch: 'a' });
  c.set('橋', 'ばし', { pitch: 'b' });
  assert.equal(c.get('橋', 'はし')?.pitch, 'a');
  assert.equal(c.get('橋', 'ばし')?.pitch, 'b');
});

test('clear empties for token change invalidation', () => {
  const c = new WordCache(10);
  c.set('a', '', { meanings: 1 });
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.get('a', ''), undefined);
});
