import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring } from 'react-native-reanimated';
import { darkColors, lightColors } from '../../theme/colors';
import { Icon } from '../../components/ui/Icon';
import MokuroWebView from './MokuroWebView';
import WordSheet from './WordSheet';
import * as Haptics from 'expo-haptics';

export default function ReaderScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = isDark ? darkColors : lightColors;
  const volume = route.params.volume as { htmlUri?: string; mokuroUri?: string; uri: string; title: string; series?: string; pageCount?: number };
  const [word, setWord] = useState<any>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  const hideTimer = useRef<any>(null);
  const headerY = useSharedValue(0);
  const footerY = useSharedValue(0);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    headerY.value = withSpring(0, { damping: 24, stiffness: 340 });
    footerY.value = withSpring(0, { damping: 24, stiffness: 340 });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!word) {
        headerY.value = withTiming(-80, { duration: 280 });
        footerY.value = withTiming(80, { duration: 280 });
        setChromeVisible(false);
      }
    }, 3200);
  }, [word, headerY, footerY]);

  useEffect(() => {
    showChrome();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [showChrome]);

  useEffect(() => {
    if (word) {
      headerY.value = withSpring(0, { damping: 24, stiffness: 340 });
      footerY.value = withSpring(0, { damping: 24, stiffness: 340 });
      setChromeVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else showChrome();
  }, [word, showChrome, headerY, footerY]);

  const headerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: headerY.value }] }));
  const footerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: footerY.value }] }));

  const handleTap = useCallback(() => {
    if (chromeVisible) {
      headerY.value = withTiming(-80, { duration: 260 });
      footerY.value = withTiming(80, { duration: 260 });
      setChromeVisible(false);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else showChrome();
    Haptics.selectionAsync();
  }, [chromeVisible, headerY, footerY, showChrome]);

  if (!volume?.htmlUri && !volume?.mokuroUri) {
    return (
      <View style={[s.root, { backgroundColor: colors.groupedBackground, paddingTop: insets.top + 24, alignItems: 'center', padding: 24 }]}>
        <View style={[s.emptyIcon, { backgroundColor: colors.secondaryGroupedBackground }]}>
          <Icon name="book" size={24} color={colors.secondaryLabel} strokeWidth={1.6} />
        </View>
        <Text style={[s.emptyTitle, { color: colors.onSurface }]}>No readable file</Text>
        <Text style={[s.emptySub, { color: colors.secondaryLabel }]}>This volume has no HTML to display.</Text>
        <Pressable onPress={() => navigation.goBack()} style={({ pressed }) => [s.capsule, { backgroundColor: colors.primary, opacity: pressed ? 0.84 : 1 }]}>
          <Text style={[s.capsuleText, { color: '#fff' }]}>Back to Library</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: '#000' }]}>
      <View style={{ flex: 1 }}>
        <MokuroWebView
          htmlUri={volume.htmlUri}
          mokuroUri={volume.mokuroUri}
          volumeDir={volume.uri}
          title={volume.title}
          series={volume.series}
          onOpenSettings={() => (navigation as any).navigate('Tabs', { screen: 'Settings' })}
          onWordTap={(w) => { setWord(w); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          onProgress={setProgress}
          onTapBackground={handleTap}
        />
      </View>

      {/* Header — Apple Books chrome, blur + hairline */}
      <Animated.View style={[s.headerWrap, { paddingTop: insets.top, top: 0, pointerEvents: chromeVisible ? 'auto' : 'none' } as any, headerStyle]}>
        <BlurView intensity={isDark ? 30 : 36} tint={isDark ? 'dark' : 'light'} style={[s.headerBlur, { backgroundColor: colors.blurTint, borderBottomColor: colors.separator }]}>
          <Pressable onPress={() => { Haptics.selectionAsync(); navigation.goBack(); }} style={({ pressed }) => [s.backCircle, { backgroundColor: pressed ? colors.systemFill : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)') }]} hitSlop={8} accessibilityLabel="Back">
            <Icon name="chevronLeft" size={20} color={colors.primary} strokeWidth={2.4} />
          </Pressable>
          <View style={{ flex: 1, gap: 1, marginHorizontal: 6 }}>
            <Text numberOfLines={1} style={[s.title, { color: colors.onSurface }]}>{volume.title}</Text>
            <Text numberOfLines={1} style={[s.sub, { color: colors.secondaryLabel }]}>{volume.series ?? 'Library'} · {volume.pageCount ?? '—'} pages</Text>
          </View>
          <Pressable onPress={() => { Haptics.selectionAsync(); setWord(null); }} style={({ pressed }) => [s.actionPill, { backgroundColor: word ? colors.primary : (pressed ? colors.systemFill : colors.secondarySystemFill) }]} hitSlop={6}>
            <Text style={[s.actionText, { color: word ? '#fff' : colors.primary }]}>{word ? 'Done' : 'Aa'}</Text>
          </Pressable>
        </BlurView>
      </Animated.View>

      {/* Footer scrubber — thin track, white thumb */}
      <Animated.View style={[s.footerWrap, { paddingBottom: Math.max(insets.bottom, 10) }, footerStyle, { pointerEvents: chromeVisible ? 'auto' : 'none' } as any]}>
        <BlurView intensity={isDark ? 28 : 34} tint={isDark ? 'dark' : 'light'} style={[s.footerBlur, { backgroundColor: colors.blurTint, borderTopColor: colors.separator }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={[s.pageText, { color: colors.secondaryLabel }]}>{Math.round(progress * 100)}%</Text>
            <View style={[s.scrubTrack, { backgroundColor: colors.quaternarySystemFill }]}>
              <View style={[s.scrubFill, { backgroundColor: colors.primary, width: `${progress * 100}%` }]} />
              <View style={[s.scrubThumb, { backgroundColor: '#fff', left: `${progress * 100}%` }]} />
            </View>
            <Pressable onPress={() => Haptics.selectionAsync()} style={({ pressed }) => [s.tocBtn, { backgroundColor: pressed ? colors.systemFill : 'transparent' }]} hitSlop={8} accessibilityLabel="Contents">
              <Icon name="list" size={16} color={colors.primary} strokeWidth={2} />
            </Pressable>
          </View>
          <Text style={[s.footerHint, { color: colors.tertiaryLabel }]}>Tap centre to hide · Tap a word to look it up</Text>
        </BlurView>
      </Animated.View>

      {word ? <WordSheet word={word} onClose={() => setWord(null)} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  headerWrap: { position: 'absolute', left: 0, right: 0, zIndex: 10 },
  headerBlur: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  footerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10 },
  footerBlur: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  backCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'System', fontSize: 16, lineHeight: 20, fontWeight: '600', letterSpacing: -0.3 },
  sub: { fontFamily: 'System', fontSize: 12, lineHeight: 15, fontWeight: '400' },
  actionPill: { paddingHorizontal: 14, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', minWidth: 48 },
  actionText: { fontFamily: 'System', fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  scrubTrack: { flex: 1, height: 3, borderRadius: 1.5, justifyContent: 'center' },
  scrubFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 1.5 },
  scrubThumb: { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6, top: -4.5, boxShadow: '0 2px 5px rgba(0,0,0,0.25)' },
  tocBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pageText: { fontFamily: 'System', fontSize: 12, fontWeight: '600', minWidth: 36, textAlign: 'right' as const, fontVariant: ['tabular-nums'] as any },
  footerHint: { fontFamily: 'System', fontSize: 11, fontWeight: '400', textAlign: 'center' as const },
  emptyIcon: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontFamily: 'System', fontSize: 20, fontWeight: '700', letterSpacing: 0.3 },
  emptySub: { fontFamily: 'System', fontSize: 14, fontWeight: '400', textAlign: 'center' as const, marginTop: 6, maxWidth: 300, lineHeight: 19 },
  capsule: { marginTop: 18, paddingHorizontal: 22, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' as any },
  capsuleText: { fontFamily: 'System', fontSize: 16, fontWeight: '600', letterSpacing: -0.3 },
});
