import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseBlocks } from '../markdownParse';

test('plain text is a single span', () => {
  assert.deepEqual(parseInline('hello'), [{ text: 'hello' }]);
});

test('inline code splits out', () => {
  const spans = parseInline('a `b` c');
  assert.equal(spans.find((s) => s.code)?.text, 'b');
});

test('unclosed code marker stays literal', () => {
  assert.deepEqual(parseInline('a `b').map((s) => s.text).join(''), 'a `b');
});

test('bold, italic and bold-italic nest', () => {
  const bold = parseInline('**x**');
  assert.equal(bold[0].bold, true);
  const italic = parseInline('*x*');
  assert.equal(italic[0].italic, true);
  const bi = parseInline('***x***');
  assert.equal(bi[0].bold, true);
  assert.equal(bi[0].italic, true);
  const nested = parseInline('**a *b* c**');
  assert.ok(nested.every((s) => s.bold), 'outer bold propagates');
  assert.ok(nested.some((s) => s.italic), 'inner italic kept');
});

test('_italic_ works and lone markers stay literal', () => {
  assert.equal(parseInline('_x_')[0].italic, true);
  assert.ok(parseInline('*').some((s) => s.text.includes('*')));
  assert.ok(parseInline('a * b').some((s) => s.text.includes('*')));
});

test('empty italic (**) edge does not crash', () => {
  assert.ok(Array.isArray(parseInline('**')));
});

test('headings, bullets, numbers and paras parse', () => {
  const blocks = parseBlocks('# H1\n## H2\n- a\n* b\n+ c\n1. one\n2. two\nplain');
  assert.equal(blocks[0].type, 'heading');
  assert.equal((blocks[0] as any).level, 1);
  assert.equal((blocks[1] as any).level, 2);
  assert.equal(blocks[2].type, 'bullet');
  assert.equal(blocks[5].type, 'number');
  assert.equal((blocks[5] as any).label, '1');
  assert.equal(blocks[blocks.length - 1].type, 'para');
});

test('blank lines skipped, CRLF normalized, heading without space is para', () => {
  const blocks = parseBlocks('a\r\n\r\n#b\n\n   \n- x');
  assert.ok(blocks.some((b) => b.type === 'para' && (b as any).text === '#b'));
  assert.ok(blocks.some((b) => b.type === 'bullet'));
});

test('indented heading and deep levels', () => {
  const [h] = parseBlocks('   ### deep') as any[];
  assert.equal(h.level, 3);
});
