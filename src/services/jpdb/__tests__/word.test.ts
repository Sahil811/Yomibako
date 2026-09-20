// Sentence extraction feeds the mining field and the popup context line, and
// pitch parsing drives the reading overlay. Both silently mangle text rather
// than throwing, so they need pinning.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getSentences, groupMeanings, parsePitch } from '../word';

function at(context: string, offset: number, width = 1) {
  return getSentences({ context, contextOffset: offset }, width);
}

test('a single sentence is returned whole', () => {
  assert.equal(at('猫が好きです。', 0), '猫が好きです。');
});

test('text with no terminator is still returned', () => {
  assert.equal(at('猫が好き', 0), '猫が好き');
});

test('only the sentence containing the offset is taken', () => {
  const context = '朝です。猫が鳴いた。犬も鳴いた。';
  assert.equal(at(context, context.indexOf('猫')), '猫が鳴いた。');
});

test('the first and last sentences are reachable', () => {
  const context = '朝です。猫が鳴いた。犬も鳴いた。';
  assert.equal(at(context, 0), '朝です。');
  assert.equal(at(context, context.indexOf('犬')), '犬も鳴いた。');
});

test('a wider context reaches backwards as well as forwards', () => {
  const context = '朝です。猫が鳴いた。犬も鳴いた。';
  assert.equal(at(context, context.indexOf('猫'), 2), context);
});

test('a context width beyond the text clamps instead of overrunning', () => {
  const context = '朝です。猫が鳴いた。';
  assert.equal(at(context, context.indexOf('猫'), 99), context);
});

test('question and exclamation marks end sentences too', () => {
  const context = '本当？すごい！';
  assert.equal(at(context, context.indexOf('すごい')), 'すごい！');
});

test('an empty context yields an empty string', () => {
  assert.equal(at('', 0), '');
});

test('a null context is tolerated rather than thrown on', () => {
  assert.equal(getSentences({ context: null as any, contextOffset: 0 }, 1), '');
});

test('precomputed boundaries are reused as given', () => {
  const context = '朝です。猫が鳴いた。';
  const data = { context, contextOffset: 0, sentenceBoundaries: [-1, 3, context.length], sentenceIndex: 1 };
  assert.equal(getSentences(data, 1), '朝です。');
});

test('pitch needs one more mora marker than reading characters', () => {
  assert.equal(parsePitch('ねこ', 'LH'), null);
  assert.equal(parsePitch('', 'LHL'), null);
  assert.equal(parsePitch('ねこ', ''), null);
});

test('a rising then falling pattern splits at each change', () => {
  const parts = parsePitch('はし', 'LHL');
  assert.ok(parts);
  assert.equal(parts!.map((p) => p.text).join(''), 'はし');
  assert.deepEqual(parts!.map((p) => p.isHigh), [false, true]);
});

test('a flat pattern produces a single final segment', () => {
  const parts = parsePitch('ねこ', 'LHH');
  assert.ok(parts);
  assert.equal(parts!.length, 2);
  assert.equal(parts![parts!.length - 1].isFinal, true);
});

test('segments always reconstruct the original reading', () => {
  for (const [reading, pitch] of [
    ['はし', 'LHL'],
    ['ねこ', 'LHH'],
    ['さくら', 'HLLL'],
    ['とうきょう', 'LHHHHH'],
  ] as const) {
    const parts = parsePitch(reading, pitch);
    assert.ok(parts, `${reading}/${pitch}`);
    assert.equal(parts!.map((p) => p.text).join(''), reading);
  }
});

test('consecutive senses sharing a part of speech are grouped', () => {
  const grouped = groupMeanings({
    meanings: [
      { partOfSpeech: ['n'], glosses: ['book'] },
      { partOfSpeech: ['n'], glosses: ['volume'] },
      { partOfSpeech: ['v5'], glosses: ['to read'] },
    ],
  });
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].partOfSpeech, ['n']);
  assert.equal(grouped[0].glosses.length, 2);
  assert.deepEqual(grouped[1].glosses, [['to read']]);
});

test('grouping records where each group starts, for numbering', () => {
  const grouped = groupMeanings({
    meanings: [
      { partOfSpeech: ['n'], glosses: ['a'] },
      { partOfSpeech: ['v5'], glosses: ['b'] },
      { partOfSpeech: ['v5'], glosses: ['c'] },
    ],
  });
  assert.deepEqual(grouped.map((g) => g.startIndex), [0, 1]);
});

test('the same part of speech seen again later starts a new group', () => {
  const grouped = groupMeanings({
    meanings: [
      { partOfSpeech: ['n'], glosses: ['a'] },
      { partOfSpeech: ['v5'], glosses: ['b'] },
      { partOfSpeech: ['n'], glosses: ['c'] },
    ],
  });
  assert.equal(grouped.length, 3);
});

test('no meanings yields no groups', () => {
  assert.deepEqual(groupMeanings({ meanings: [] }), []);
});
