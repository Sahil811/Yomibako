// Pure Markdown parsing for short AI explanations — no react-native imports
// so it can be unit-tested headlessly. Extracted from Markdown.tsx.

export type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'number'; label: string; text: string }
  | { type: 'para'; text: string };

// Split one line of text into styled spans. Recurses so bold can contain italic.
export function parseInline(input: string): Span[] {
  const out: Span[] = [];
  const push = (text: string, style: Omit<Span, 'text'>) => {
    if (text) out.push({ text, ...style });
  };
  const wrap = (inner: string, style: Omit<Span, 'text'>) => {
    for (const seg of parseInline(inner)) {
      push(seg.text, { bold: seg.bold || style.bold, italic: seg.italic || style.italic, code: seg.code || style.code });
    }
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    if (ch === '`') {
      const end = input.indexOf('`', i + 1);
      if (end > i) { push(input.slice(i + 1, end), { code: true }); i = end + 1; continue; }
    }
    // ***bold italic***
    if (input.startsWith('***', i)) {
      const end = input.indexOf('***', i + 3);
      if (end > i) { wrap(input.slice(i + 3, end), { bold: true, italic: true }); i = end + 3; continue; }
    }
    // **bold**
    if (input.startsWith('**', i)) {
      const end = input.indexOf('**', i + 2);
      if (end > i) { wrap(input.slice(i + 2, end), { bold: true }); i = end + 2; continue; }
    }
    // *italic* or _italic_
    if (ch === '*' || ch === '_') {
      const end = input.indexOf(ch, i + 1);
      if (end > i + 1) { wrap(input.slice(i + 1, end), { italic: true }); i = end + 1; continue; }
    }

    // Plain run up to the next possible marker.
    let next = i + 1;
    while (next < input.length && input[next] !== '`' && input[next] !== '*' && input[next] !== '_') next++;
    // If we started on a lone marker with no partner, keep it as literal text.
    push(input.slice(i, next), {});
    i = next;
  }
  return out;
}

export function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() }); continue; }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) { blocks.push({ type: 'bullet', text: bullet[1].trim() }); continue; }

    const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (numbered) { blocks.push({ type: 'number', label: numbered[1], text: numbered[2].trim() }); continue; }

    blocks.push({ type: 'para', text: line.trim() });
  }
  return blocks;
}
