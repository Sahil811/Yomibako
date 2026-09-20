import React from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, useColorScheme } from 'react-native';
import { darkColors, lightColors } from '../../theme/colors';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Icon } from '../ui/Icon';

export type BrowserEntry = { name: string; uri: string; isDir: boolean; size?: number };

import { formatSize } from './formatSize';

export { formatSize };

function Row({ item, colors, onOpen }: { item: BrowserEntry; colors: any; onOpen: (e: BrowserEntry) => void }) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const isFolder = item.isDir;
  const isHtml = item.name.endsWith('.html');

  return (
    <Pressable
      onPressIn={() => (scale.value = withSpring(0.985, { damping: 22, stiffness: 420 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 22, stiffness: 420 }))}
      onPress={() => {
        Haptics.selectionAsync();
        onOpen(item);
      }}
      style={({ pressed }) => [{ backgroundColor: pressed ? colors.systemFill : 'transparent' }]}
      accessibilityRole="button"
      accessibilityLabel={item.name}
    >
      <Animated.View style={[s.row, aStyle]}>
        {/* Files-style icon — blue folder, neutral document */}
        <View
          style={[
            s.icon,
            {
              backgroundColor: isFolder ? '#007AFF' : isHtml ? '#FF9500' : colors.tertiarySystemFill,
            },
          ]}
        >
          <Icon
            name={isFolder ? 'folder' : 'file'}
            size={isFolder ? 16 : 14}
            color={isFolder || isHtml ? '#fff' : colors.secondaryLabel}
            strokeWidth={2}
          />
        </View>

        <View style={{ flex: 1, gap: 1 }}>
          <Text numberOfLines={1} style={[s.name, { color: colors.onSurface }]}>
            {item.name}
          </Text>
          <Text style={[s.meta, { color: colors.secondaryLabel }]}>{isFolder ? 'Folder' : isHtml ? `HTML · ${formatSize(item.size ?? 0)}` : formatSize(item.size ?? 0)}</Text>
        </View>

        {isFolder ? (
          <Icon name="chevronRight" size={16} color={colors.tertiaryLabel} strokeWidth={2.2} />
        ) : (
          <View style={[s.badge, { backgroundColor: colors.quaternarySystemFill }]}>
            <Text style={[s.badgeText, { color: colors.secondaryLabel }]}>{isHtml ? 'HTML' : 'FILE'}</Text>
          </View>
        )}
      </Animated.View>
      <View style={[s.separator, { backgroundColor: colors.separator, marginLeft: 58 }]} />
    </Pressable>
  );
}

export function FileBrowser({
  entries,
  onOpen,
  onPickThisFolder,
}: {
  entries: BrowserEntry[];
  onOpen: (e: BrowserEntry) => void;
  onPickThisFolder: () => void;
}) {
  const scheme = useColorScheme();
  const colors = scheme === 'light' ? lightColors : darkColors;

  return (
    <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>

      <FlatList
        data={entries}
        keyExtractor={(e) => e.uri}
        contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 0 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={[s.emptyCard, { backgroundColor: colors.secondaryGroupedBackground }]}>
            <View style={[s.emptyIcon, { backgroundColor: colors.tertiarySystemFill }]}>
              <Icon name="browse" size={22} color={colors.secondaryLabel} strokeWidth={1.6} />
            </View>
            <Text style={[s.emptyTitle, { color: colors.onSurface }]}>Empty folder</Text>
            <Text style={[s.emptySub, { color: colors.secondaryLabel }]}>No manga files here</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              s.groupCard,
              {
                backgroundColor: colors.secondaryGroupedBackground,
                borderTopLeftRadius: index === 0 ? 12 : 0,
                borderTopRightRadius: index === 0 ? 12 : 0,
                borderBottomLeftRadius: index === entries.length - 1 ? 12 : 0,
                borderBottomRightRadius: index === entries.length - 1 ? 12 : 0,
                borderTopWidth: index === 0 ? StyleSheet.hairlineWidth : 0,
                marginTop: index === 0 ? 0 : -StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Row item={item} colors={colors} onOpen={onOpen} />
          </View>
        )}
      />

      {/* Bottom action — full-width prominent button, no shadow */}
      <View style={[s.footer, { backgroundColor: colors.secondaryGroupedBackground, borderTopColor: colors.separator }]}>
        <Text style={[s.footerHint, { color: colors.secondaryLabel }]}>Choose a series folder to add to Library</Text>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onPickThisFolder();
          }}
          style={({ pressed }) => [s.footerBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.84 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] }]}
        >
          <Text style={[s.footerBtnText, { color: '#fff' }]}>Use This Folder</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    height: 60,
    marginTop: 10,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
    borderCurve: 'continuous' as any,
  },
  upPill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, height: 30, borderRadius: 15 },
  upText: { fontFamily: 'System', fontSize: 14, fontWeight: '600' as const },
  path: { fontFamily: 'System', fontSize: 14, fontWeight: '600' as const, letterSpacing: -0.2 },
  pathSub: { fontFamily: 'System', fontSize: 12, fontWeight: '400' as const },
  countBadge: { minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  countText: { fontFamily: 'System', fontSize: 12, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as any },
  groupCard: { borderWidth: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 58, gap: 12 },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' as any },
  name: { fontFamily: 'System', fontSize: 16, lineHeight: 21, fontWeight: '400' as const, letterSpacing: -0.3 },
  meta: { fontFamily: 'System', fontSize: 12, lineHeight: 15, fontWeight: '400' as const, fontVariant: ['tabular-nums'] as any },
  badge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontFamily: 'System', fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.4 },
  separator: { height: StyleSheet.hairlineWidth, opacity: 0.9 },
  emptyCard: {
    marginTop: 24,
    borderRadius: 14,
    alignItems: 'center',
    padding: 28,
    gap: 6,
  },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'System', fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.4 },
  emptySub: { fontFamily: 'System', fontSize: 14, fontWeight: '400' as const },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    alignItems: 'center',
  },
  footerHint: { fontFamily: 'System', fontSize: 12, fontWeight: '400' as const, textAlign: 'center' as const },
  footerBtn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', paddingHorizontal: 20, borderCurve: 'continuous' as any },
  footerBtnText: { fontFamily: 'System', fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.4 },
});
