import React from 'react';
import { View, Text, Pressable, StyleSheet, useColorScheme, TextInput } from 'react-native';
import { BlurView } from 'expo-blur';
import { darkColors, lightColors } from '../../theme/colors';
import * as Haptics from 'expo-haptics';
import { Icon } from './Icon';

// Header with large title + subtitle, blur background — iOS 17 style
export function AppleHeader({ title, subtitle, right, insetsTop }: { title: string; subtitle?: string; right?: React.ReactNode; tint?: string; insetsTop?: number }) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = isDark ? darkColors : lightColors;
  return (
    <BlurView intensity={isDark ? 32 : 36} tint={isDark ? 'dark' : 'light'} style={[s.headerBlur, { paddingTop: (insetsTop ?? 0) + 12, borderBottomColor: colors.separator, backgroundColor: colors.blurTint }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.largeTitle, { color: colors.onSurface }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? <Text style={[s.headerSub, { color: colors.secondaryLabel }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </BlurView>
  );
}

// Inset grouped section — iOS Settings
export function AppleSection({ title, footnote, children, colors }: { title?: string; footnote?: string; children: React.ReactNode; colors: any }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ gap: 6 }}>
      {title ? <Text style={[s.sectionHeader, { color: colors.secondaryLabel }]}>{title}</Text> : null}
      <View style={[s.group, { backgroundColor: colors.secondaryGroupedBackground, borderColor: colors.separator }]}>
        {kids.map((child: any, idx) => (
          <View key={idx}>
            {child}
            {idx !== kids.length - 1 ? <View style={[s.separator, { backgroundColor: colors.separator, marginLeft: 52 }]} /> : null}
          </View>
        ))}
      </View>
      {footnote ? <Text style={[s.sectionFooter, { color: colors.secondaryLabel }]}>{footnote}</Text> : null}
    </View>
  );
}

export function AppleRow({ icon, iconBg, title, subtitle, value, onPress, right, colors, destructive }: any) {
  const content = (
    <View style={[s.row, { minHeight: 48 }]}>
      {icon ? (
        <View style={[s.rowIcon, { backgroundColor: iconBg || colors.primary }]}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{icon}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[s.rowTitle, { color: destructive ? colors.error : colors.onSurface }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[s.rowSubtitle, { color: colors.secondaryLabel }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={[s.rowValue, { color: colors.secondaryLabel }]}>{value}</Text> : null}
      {right}
      {onPress ? <Icon name="chevronRight" size={16} color={colors.tertiaryLabel} strokeWidth={2.2} /> : null}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={() => { Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => [{ backgroundColor: pressed ? colors.systemFill : 'transparent' }]}>
        {content}
      </Pressable>
    );
  }
  return content;
}

// Capsule button — iOS prominent. Flat, no drop shadow (Apple Buttons have none).
export function AppleButton({ title, onPress, variant = 'primary', colors, small }: { title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost'; colors: any; small?: boolean }) {
  const bg = variant === 'primary' ? colors.primary : variant === 'secondary' ? colors.secondarySystemFill : 'transparent';
  const fg = variant === 'primary' ? '#fff' : colors.primary;
  return (
    <Pressable onPress={() => { Haptics.impactAsync(variant === 'primary' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light); onPress?.(); }} style={({ pressed }) => [{ height: small ? 34 : 50, borderRadius: small ? 17 : 14, backgroundColor: bg, opacity: pressed ? 0.82 : 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: small ? 16 : 22, borderWidth: variant === 'ghost' ? StyleSheet.hairlineWidth : 0, borderColor: colors.separator, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <Text style={{ fontFamily: 'System', fontSize: small ? 13 : 17, fontWeight: '600' as const, color: fg, letterSpacing: small ? -0.08 : -0.4 }}>{title}</Text>
    </Pressable>
  );
}

// Search field — iOS Files/Books. Magnifier + xmark.circle.fill semantics.
export function AppleSearchBar({ value, onChangeText, onFocus, onBlur, placeholder, colors, onCancel }: any) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.groupedBackground }}>
      <View style={[s.searchBox, { backgroundColor: colors.secondaryGroupedBackground === '#FFFFFF' ? '#E8E8ED' : colors.surfaceContainer, borderColor: focused ? colors.primary : 'transparent' }]}>
        <Icon name="search" size={15} color={colors.secondaryLabel} strokeWidth={2} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => { setFocused(true); onFocus?.(); }}
          onBlur={() => { setFocused(false); onBlur?.(); }}
          placeholder={placeholder}
          placeholderTextColor={colors.tertiaryLabel}
          style={{ flex: 1, fontFamily: 'System', fontSize: 17, paddingVertical: 0, color: colors.onSurface }}
          clearButtonMode="never"
          returnKeyType="search"
          autoCorrect={false}
        />
        {value?.length ? (
          <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="Clear search">
            <View style={[s.clearBtn, { backgroundColor: colors.secondaryLabel }]}>
              <Icon name="close" size={10} color="#fff" strokeWidth={2.8} />
            </View>
          </Pressable>
        ) : null}
      </View>
      {(focused || value?.length) && onCancel ? (
        <Pressable onPress={onCancel} hitSlop={8}><Text style={{ color: colors.primary, fontSize: 17, fontWeight: '400' }}>Cancel</Text></Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  headerBlur: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  largeTitle: { fontFamily: 'System', fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: 0.4 },
  headerSub: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' },
  sectionHeader: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: -0.08, paddingHorizontal: 16, textTransform: 'uppercase' as any, marginTop: 20 },
  sectionFooter: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400', paddingHorizontal: 16, marginTop: 6 },
  group: { marginHorizontal: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' as any, borderCurve: 'continuous' as any },
  separator: { height: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 48 },
  rowIcon: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '400', letterSpacing: -0.4 },
  rowSubtitle: { fontFamily: 'System', fontSize: 13, lineHeight: 16, fontWeight: '400' },
  rowValue: { fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '400', color: '#8E8E93' },
  searchBox: { flex: 1, height: 36, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderWidth: 1.5 },
  clearBtn: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
