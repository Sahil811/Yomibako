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
