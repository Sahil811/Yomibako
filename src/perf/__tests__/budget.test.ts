import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mark,
  span,
  spanAsync,
  getBudgetEntries,
  summarizeBudget,
  clearBudget,
  setBudgetEnabled,
  __resetBudgetForTests,
  BUDGET_MAX,
} from '../budget';

test('mark records and summarizes', () => {
  __resetBudgetForTests();
  mark('list', 12, 3);
  mark('list', 8);
  const entries = getBudgetEntries();
  assert.equal(entries.length, 2);
  const sum = summarizeBudget();
  assert.equal(sum['list'].calls, 2);
  assert.equal(sum['list'].totalMs, 20);
});

test('span sync/async record timings', async () => {
  __resetBudgetForTests();
  const v = span('sync', () => 42);
  assert.equal(v, 42);
  const av = await spanAsync('async', async () => 'hi');
  assert.equal(av, 'hi');
  assert.equal(getBudgetEntries().length, 2);
});

test('ring buffer evicts oldest past max', () => {
  __resetBudgetForTests();
  for (let i = 0; i < BUDGET_MAX + 10; i++) mark('x', 1);
  assert.equal(getBudgetEntries().length, BUDGET_MAX);
});

test('disabled budget records nothing', () => {
  __resetBudgetForTests();
  setBudgetEnabled(false);
  mark('x', 5);
  assert.equal(getBudgetEntries().length, 0);
  assert.equal(span('y', () => 1), 1);
  setBudgetEnabled(true);
  mark('z', 1);
  assert.equal(getBudgetEntries().length, 1);
  clearBudget();
  assert.equal(getBudgetEntries().length, 0);
});

test('mark ignores non-finite and truncates extra', () => {
  __resetBudgetForTests();
  mark('bad', NaN);
  mark('e', 1, undefined, 'x'.repeat(500));
  const entries = getBudgetEntries();
  assert.equal(entries.length, 1);
  assert.ok((entries[0].extra?.length ?? 0) <= 160);
});
