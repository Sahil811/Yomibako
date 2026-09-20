// Minimal, dependency-free Markdown renderer for short AI explanations.
//
// It deliberately supports only what the model emits — headings, bold, italic,
// inline code, bullet and numbered lists — and is tolerant of the malformed
// output LLMs often produce (stray or unbalanced * markers render literally
// instead of breaking the layout).
import React from 'react';
import { StyleSheet, Text, View, Platform } from 'react-native';
import { parseInline, parseBlocks, type Span } from './markdownParse';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function getHeadingScale(level: number): number {
  if (level <= 1) {
    return 1.22;
  }
  if (level === 2) {
    return 1.1;
  }
  return 1.0;
}

function spanKey(span: Span, index: number): string {
  const styleFlag = `${span.bold ? 'b' : ''}${span.italic ? 'i' : ''}${span.code ? 'c' : ''}`;
  return `span-${index}-${styleFlag}-${span.text.slice(0, 24)}-${span.text.length}`;
}

const Inline = React.memo(function Inline({ spans, color, codeColor, codeBg, size }: { readonly spans: Span[]; readonly color: string; readonly codeColor: string; readonly codeBg: string; readonly size: number }) {
  return (
    <>
      {spans.map((span, index) =>
        span.code ? (
          <Text
            key={spanKey(span, index)}
            style={{ fontFamily: MONO, fontSize: size * 0.92, color: codeColor, backgroundColor: codeBg }}
          >
            {` ${span.text} `}
          </Text>
        ) : (
          <Text
            key={spanKey(span, index)}
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
});

export function Markdown({
  content,
  color,
  mutedColor,
  accentColor,
  codeBg,
  size = 14,
}: {
  readonly content: string;
  readonly color: string;
  readonly mutedColor: string;
  readonly accentColor: string;
  readonly codeBg: string;
  readonly size?: number;
}) {
  const blocks = React.useMemo(() => {
    const parsed = parseBlocks(content);
    return parsed.map((block) => ({ ...block, spans: parseInline(block.text) }));
  }, [content]);
  const lineHeight = Math.round(size * 1.45);

  return (
    <View style={{ gap: 6 }}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const scale = getHeadingScale(block.level);
          return (
            <Text
              key={`heading-${index}-${block.text.slice(0, 32)}-${block.text.length}`}
              style={{ color, fontSize: Math.round(size * scale), fontWeight: '700', lineHeight: Math.round(size * scale * 1.3), marginTop: index === 0 ? 0 : 4 }}
            >
              <Inline spans={block.spans} color={color} codeColor={accentColor} codeBg={codeBg} size={Math.round(size * scale)} />
            </Text>
          );
        }
        if (block.type === 'bullet') {
          return (
            <View key={`bullet-${index}-${block.text.slice(0, 32)}-${block.text.length}`} style={s.row}>
              <Text style={{ color: accentColor, fontSize: size, lineHeight, width: 14 }}>•</Text>
              <Text style={{ flex: 1, color, fontSize: size, lineHeight }}>
                <Inline spans={block.spans} color={color} codeColor={accentColor} codeBg={codeBg} size={size} />
              </Text>
            </View>
          );
        }
        if (block.type === 'number') {
          return (
            <View key={`number-${index}-${block.label}-${block.text.slice(0, 32)}-${block.text.length}`} style={s.row}>
              <Text style={{ color: mutedColor, fontSize: size, lineHeight, minWidth: 16 }}>{block.label}.</Text>
              <Text style={{ flex: 1, color, fontSize: size, lineHeight }}>
                <Inline spans={block.spans} color={color} codeColor={accentColor} codeBg={codeBg} size={size} />
              </Text>
            </View>
          );
        }
        return (
          <Text key={`para-${index}-${block.text.slice(0, 32)}-${block.text.length}`} style={{ color, fontSize: size, lineHeight }}>
            <Inline spans={block.spans} color={color} codeColor={accentColor} codeBg={codeBg} size={size} />
          </Text>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
});
