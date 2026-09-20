// Minimal, dependency-free Markdown renderer for short AI explanations.
//
// It deliberately supports only what the model emits — headings, bold, italic,
// inline code, bullet and numbered lists — and is tolerant of the malformed
// output LLMs often produce (stray or unbalanced * markers render literally
// instead of breaking the layout).
import React from 'react';
import { StyleSheet, Text, View, Platform } from 'react-native';

type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

// Split one line of text into styled spans. Recurses so bold can contain italic.
function parseInline(input: string): Span[] {
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

function Inline({ spans, color, codeColor, codeBg, size }: { spans: Span[]; color: string; codeColor: string; codeBg: string; size: number }) {
  return (
    <>
      {spans.map((span, index) =>
        span.code ? (
          <Text
            key={index}
            style={{ fontFamily: MONO, fontSize: size * 0.92, color: codeColor, backgroundColor: codeBg }}
          >
            {` ${span.text} `}
          </Text>
        ) : (
          <Text
            key={index}
            style={{
              color,
              fontWeight: span.bold ? '700' : '400',
              fontStyle: span.italic ? 'italic' : 'normal',
            }}
          >
            {span.text}
          </Text>
        )
      )}
    </>
  );
}

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'number'; label: string; text: string }
  | { type: 'para'; text: string };

function parseBlocks(content: string): Block[] {
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

export function Markdown({
  content,
  color,
  mutedColor,
  accentColor,
  codeBg,
  size = 14,
}: {
  content: string;
  color: string;
  mutedColor: string;
  accentColor: string;
  codeBg: string;
  size?: number;
}) {
  const blocks = React.useMemo(() => parseBlocks(content), [content]);
  const lineHeight = Math.round(size * 1.45);

  return (
    <View style={{ gap: 6 }}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const scale = block.level <= 1 ? 1.22 : block.level === 2 ? 1.1 : 1.0;
          return (
            <Text
              key={index}
              style={{ color, fontSize: Math.round(size * scale), fontWeight: '700', lineHeight: Math.round(size * scale * 1.3), marginTop: index === 0 ? 0 : 4 }}
            >
              <Inline spans={parseInline(block.text)} color={color} codeColor={accentColor} codeBg={codeBg} size={Math.round(size * scale)} />
            </Text>
          );
        }
        if (block.type === 'bullet') {
          return (
            <View key={index} style={s.row}>
              <Text style={{ color: accentColor, fontSize: size, lineHeight, width: 14 }}>•</Text>
              <Text style={{ flex: 1, color, fontSize: size, lineHeight }}>
                <Inline spans={parseInline(block.text)} color={color} codeColor={accentColor} codeBg={codeBg} size={size} />
              </Text>
            </View>
          );
        }
        if (block.type === 'number') {
          return (
            <View key={index} style={s.row}>
              <Text style={{ color: mutedColor, fontSize: size, lineHeight, minWidth: 16 }}>{block.label}.</Text>
              <Text style={{ flex: 1, color, fontSize: size, lineHeight }}>
                <Inline spans={parseInline(block.text)} color={color} codeColor={accentColor} codeBg={codeBg} size={size} />
              </Text>
            </View>
          );
        }
        return (
          <Text key={index} style={{ color, fontSize: size, lineHeight }}>
            <Inline spans={parseInline(block.text)} color={color} codeColor={accentColor} codeBg={codeBg} size={size} />
          </Text>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
});
