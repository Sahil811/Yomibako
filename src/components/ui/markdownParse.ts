// Pure Markdown parsing for short AI explanations — no react-native imports
// so it can be unit-tested headlessly. Extracted from Markdown.tsx.

export type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'number'; label: string; text: string }
  | { type: 'para'; text: string };

type InlineStyle = Omit<Span, 'text'>;
type PushFn = (text: string, style: InlineStyle) => void;
type WrapFn = (inner: string, style: InlineStyle) => void;

// Manual line-classifiers (no RegExp): linear scans with no backtracking.
function skipIndent(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i;
}

function parseHeadingLine(line: string): { level: number; text: string } | null {
  const start = skipIndent(line);
  let hashes = 0;
  while (hashes < 6 && line[start + hashes] === '#') hashes++;
  if (hashes === 0) return null;
  if (line[start + hashes] === '#') return null;
  const after = line[start + hashes];
  if (after !== ' ' && after !== '\t') return null;
  let t = start + hashes + 1;
  while (t < line.length && (line[t] === ' ' || line[t] === '\t')) t++;
  const text = line.slice(t).trim();
  if (!text) return null;
  return { level: hashes, text };
}

function parseBulletLine(line: string): { text: string } | null {
  const start = skipIndent(line);
  const marker = line[start];
  if (marker !== '-' && marker !== '*' && marker !== '+') return null;
  const after = line[start + 1];
  if (after !== ' ' && after !== '\t') return null;
  let t = start + 2;
  while (t < line.length && (line[t] === ' ' || line[t] === '\t')) t++;
  const text = line.slice(t).trim();
  if (!text) return null;
  return { text };
}

function parseNumberedLine(line: string): { label: string; text: string } | null {
  const start = skipIndent(line);
  let d = 0;
  while (d < 9 && line[start + d] >= '0' && line[start + d] <= '9') d++;
  if (d === 0) return null;
  if (line[start + d] !== '.') return null;
  const after = line[start + d + 1];
  if (after !== ' ' && after !== '\t') return null;
  let t = start + d + 2;
  while (t < line.length && (line[t] === ' ' || line[t] === '\t')) t++;
  const text = line.slice(t).trim();
  if (!text) return null;
  return { label: line.slice(start, start + d), text };
}

function tryConsumeCode(input: string, i: number, push: PushFn): number | null {
  if (input[i] !== '`') {
    return null;
  }
  const end = input.indexOf('`', i + 1);
  if (end <= i) {
    return null;
  }
  push(input.slice(i + 1, end), { code: true });
  return end + 1;
}

function tryConsumeTriple(input: string, i: number, wrap: WrapFn): number | null {
  if (!input.startsWith('***', i)) {
    return null;
  }
  const end = input.indexOf('***', i + 3);
  if (end <= i) {
    return null;
  }
  wrap(input.slice(i + 3, end), { bold: true, italic: true });
  return end + 3;
}

function tryConsumeBold(input: string, i: number, wrap: WrapFn): number | null {
  if (!input.startsWith('**', i)) {
    return null;
  }
  const end = input.indexOf('**', i + 2);
  if (end <= i) {
    return null;
  }
  wrap(input.slice(i + 2, end), { bold: true });
  return end + 2;
}

function tryConsumeItalic(input: string, i: number, wrap: WrapFn): number | null {
  const ch = input[i];
  if (ch !== '*' && ch !== '_') {
    return null;
  }
  const end = input.indexOf(ch, i + 1);
  if (end <= i + 1) {
    return null;
  }
  wrap(input.slice(i + 1, end), { italic: true });
  return end + 1;
}

function consumePlainRun(input: string, i: number, push: PushFn): number {
  let next = i + 1;
  while (next < input.length && input[next] !== '`' && input[next] !== '*' && input[next] !== '_') {
    next++;
  }
  // If we started on a lone marker with no partner, keep it as literal text.
  push(input.slice(i, next), {});
  return next;
}

// Split one line of text into styled spans. Recurses so bold can contain italic.
export function parseInline(input: string): Span[] {
  const out: Span[] = [];
  const push: PushFn = (text, style) => {
    if (text) {
      out.push({ text, ...style });
    }
  };
  const wrap: WrapFn = (inner, style) => {
    for (const seg of parseInline(inner)) {
      push(seg.text, { bold: seg.bold || style.bold, italic: seg.italic || style.italic, code: seg.code || style.code });
    }
  };

  let i = 0;
  while (i < input.length) {
    const codeNext = tryConsumeCode(input, i, push);
    if (codeNext !== null) {
      i = codeNext;
      continue;
    }
    const tripleNext = tryConsumeTriple(input, i, wrap);
    if (tripleNext !== null) {
      i = tripleNext;
      continue;
    }
    const boldNext = tryConsumeBold(input, i, wrap);
    if (boldNext !== null) {
      i = boldNext;
      continue;
    }
    const italicNext = tryConsumeItalic(input, i, wrap);
    if (italicNext !== null) {
      i = italicNext;
      continue;
    }
    i = consumePlainRun(input, i, push);
  }
  return out;
}

function parseLine(line: string, blocks: Block[]): void {
  const heading = parseHeadingLine(line);
  if (heading) {
    blocks.push({ type: 'heading', level: heading.level, text: heading.text });
    return;
  }
  const bullet = parseBulletLine(line);
  if (bullet) {
    blocks.push({ type: 'bullet', text: bullet.text });
    return;
  }
  const numbered = parseNumberedLine(line);
  if (numbered) {
    blocks.push({ type: 'number', label: numbered.label, text: numbered.text });
    return;
  }
  blocks.push({ type: 'para', text: line.trim() });
}

export function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }
    parseLine(line, blocks);
  }
  return blocks;
}
