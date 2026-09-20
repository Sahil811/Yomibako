// The quiz must only ever ask about words the reader has not settled, and must
// always offer a real choice. Both rules were explicit product decisions, so
// they are pinned here rather than left to the UI to enforce.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUIZ_OPTIONS,
  askableWords,
  buildQuestions,
  isAskable,
  normalizeQuizWords,
  scoreMessage,
  secureRandomIndex,
  wordKey,
  type QuizWord,
} from '../quiz';

function word(vid: number, meaning: string, state: string[] = []): QuizWord {
  return { vid, sid: 1, spelling: `語${vid}`, meanings: [meaning], state };
}

test('a word with no state at all is in no deck, so it is asked', () => {
  assert.equal(isAskable(undefined), true);
  assert.equal(isAskable([]), true);
});

test('unknown and due states are asked', () => {
  for (const state of ['new', 'not-in-deck', 'due', 'failed']) {
    assert.equal(isAskable([state]), true, state);
  }
});

test('suppressed states are never asked', () => {
  for (const state of ['blacklisted', 'suspended', 'locked', 'redundant', 'never-forget']) {
    assert.equal(isAskable([state]), false, state);
  }
});

test('a suppressed tag wins even alongside an askable one', () => {
  assert.equal(isAskable(['due', 'blacklisted']), false);
  assert.equal(isAskable(['new', 'never-forget']), false);
});

test('a word being learned but not yet due is left alone', () => {
  assert.equal(isAskable(['learning']), false);
  assert.equal(isAskable(['known']), false);
});

test('askableWords keeps only the words that pass', () => {
  const words = [word(1, 'a', ['due']), word(2, 'b', ['known']), word(3, 'c', ['blacklisted'])];
  assert.deepEqual(askableWords(words).map((w) => w.vid), [1]);
});

test('wordKey pairs vid and sid', () => {
  assert.equal(wordKey({ vid: 12, sid: 3 }), '12/3');
});

test('normalize drops entries without an identity, spelling or meaning', () => {
  const raw = [
    { vid: 1, sid: 1, spelling: '本', meanings: [{ glosses: ['book'] }] },
    { vid: 'x', sid: 1, spelling: '本', meanings: [{ glosses: ['book'] }] },
    { vid: 2, sid: 1, spelling: '   ', meanings: [{ glosses: ['book'] }] },
    { vid: 3, sid: 1, spelling: '猫', meanings: [] },
  ];
  assert.deepEqual(normalizeQuizWords(raw).map((w) => w.vid), [1]);
});

test('normalize keeps the first of a repeated word', () => {
  const raw = [
    { vid: 1, sid: 1, spelling: '本', reading: 'ほん', meanings: [{ glosses: ['book'] }] },
    { vid: 1, sid: 1, spelling: '本', meanings: [{ glosses: ['different'] }] },
  ];
  const words = normalizeQuizWords(raw);
  assert.equal(words.length, 1);
  assert.equal(words[0].reading, 'ほん');
});

test('normalize accepts plain string meanings as well as gloss objects', () => {
  const words = normalizeQuizWords([{ vid: 1, sid: 1, spelling: '本', meanings: ['book'] }]);
  assert.deepEqual(words[0].meanings, ['book']);
});

test('normalize joins multiple glosses of one sense and drops duplicates', () => {
  const words = normalizeQuizWords([
    { vid: 1, sid: 1, spelling: '本', meanings: [{ glosses: ['book', 'volume'] }, { glosses: ['book', 'volume'] }] },
  ]);
  assert.deepEqual(words[0].meanings, ['book; volume']);
});

test('normalize tolerates a null list', () => {
  assert.deepEqual(normalizeQuizWords(null as any), []);
});

test('no askable words means no quiz', () => {
  assert.deepEqual(buildQuestions([]), []);
});

test('a single distinct meaning cannot make a question', () => {
  const only = [word(1, 'book', ['due'])];
  assert.deepEqual(buildQuestions(only), []);
});

test('a question offers four options including the right answer exactly once', () => {
  const words = [word(1, 'book'), word(2, 'cat'), word(3, 'dog'), word(4, 'tree'), word(5, 'river')];
  const [question] = buildQuestions(words);
  assert.equal(question.options.length, QUIZ_OPTIONS);
  assert.ok(question.options.includes(question.answer));
  assert.equal(question.options.filter((o) => o === question.answer).length, 1);
  assert.equal(new Set(question.options).size, question.options.length);
});

test('known words supply distractors without ever being asked', () => {
  const ask = [word(1, 'book', ['due'])];
  const pool = [...ask, word(2, 'cat', ['known']), word(3, 'dog', ['known']), word(4, 'tree', ['known'])];
  const questions = buildQuestions(ask, pool);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].word.vid, 1);
  assert.equal(questions[0].options.length, QUIZ_OPTIONS);
});

test('a one word retry still gets a full set of options', () => {
  const pool = [word(1, 'book'), word(2, 'cat'), word(3, 'dog'), word(4, 'tree')];
  const questions = buildQuestions([pool[0]], pool);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].options.length, QUIZ_OPTIONS);
});

test('the question count is capped', () => {
  const words = Array.from({ length: 40 }, (_, i) => word(i + 1, `meaning ${i}`));
  assert.equal(buildQuestions(words, words, 5).length, 5);
});

test('every askable word is asked once when under the cap', () => {
  const words = [word(1, 'book'), word(2, 'cat'), word(3, 'dog')];
  const asked = buildQuestions(words).map((q) => q.word.vid).sort();
  assert.deepEqual(asked, [1, 2, 3]);
});

test('score messages cover the whole range', () => {
  for (const percent of [0, 49, 50, 69, 70, 89, 90, 99, 100]) {
    assert.ok(scoreMessage(percent).length > 0, String(percent));
  }
  assert.notEqual(scoreMessage(100), scoreMessage(0));
});

test('secureRandomIndex stays inside the range', () => {
  assert.equal(secureRandomIndex(1), 0);
  for (let i = 0; i < 300; i++) {
    const v = secureRandomIndex(4);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 4, String(v));
  }
});

test('secureRandomIndex works without WebCrypto', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    for (let i = 0; i < 200; i++) {
      const v = secureRandomIndex(7);
      assert.ok(Number.isInteger(v) && v >= 0 && v < 7, String(v));
    }
  } finally {
    if (desc) Object.defineProperty(globalThis, 'crypto', desc);
  }
});
