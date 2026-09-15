import React, { useCallback, useState, useMemo } from 'react';
import { FlatList, Pressable, Text, View, StyleSheet, ActivityIndicator, useColorScheme, TextInput, ScrollView, Platform, LayoutAnimation, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Directory } from 'expo-file-system';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { scanSeries } from './scan';
import { saveRoot } from '../../services/fs/saf';
import type { Volume, Series } from './types';
import { darkColors, lightColors } from '../../theme/colors';
import { Icon } from '../../components/ui/Icon';
import * as Haptics from 'expo-haptics';

// ——— Apple Books card — content first, quiet chrome ———
function AppleCard({ item, colors, onPress, layout }: any) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const isList = layout === 'list';
  const pct = Math.round((item.progress ?? 0) * 100);
  if (isList) {
    return (
      <Pressable
        onPressIn={() => (scale.value = withSpring(0.985, { damping: 22, stiffness: 420 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 22, stiffness: 420 }))}
        onPress={onPress}
        style={{ flex: 1 }}
        accessibilityRole="button"
        accessibilityLabel={item.title}
      >
        <Animated.View style={[s.listRow, { backgroundColor: colors.secondaryGroupedBackground }, aStyle]}>
          <View style={[s.listCover, { backgroundColor: colors.tertiarySystemFill }]}>
            <Image source={item.coverUri ? { uri: item.coverUri } : require('../../../assets/icon.png')} style={StyleSheet.absoluteFill as any} contentFit="cover" transition={200} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text numberOfLines={1} style={[s.listTitle, { color: colors.onSurface }]}>{item.title}</Text>
            <Text style={[s.listSub, { color: colors.secondaryLabel }]}>{item.pageCount} pages · {item.progress ? `${pct}%` : 'Not started'}</Text>
            <View style={[s.progressTrack, { backgroundColor: colors.quaternarySystemFill, marginTop: 6 }]}>
              <View style={[s.progressFill, { backgroundColor: colors.primary, width: `${(item.progress ?? 0) * 100}%` }]} />
            </View>
          </View>
          <Icon name="chevronRight" size={16} color={colors.tertiaryLabel} strokeWidth={2.2} />
        </Animated.View>
      </Pressable>
    );
  }
  return (
    <Pressable onPressIn={() => (scale.value = withSpring(0.97, { damping: 20, stiffness: 420 }))} onPressOut={() => (scale.value = withSpring(1, { damping: 20, stiffness: 380 }))} onPress={onPress} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={item.title}>
      <Animated.View style={[s.card, aStyle]}>
        <View style={[s.cover, { backgroundColor: colors.surfaceContainer, borderColor: colors.separator }]}>
          <Image source={item.coverUri ? { uri: item.coverUri } : require('../../../assets/icon.png')} style={StyleSheet.absoluteFill as any} contentFit="cover" transition={220} cachePolicy="memory-disk" />
          <View style={s.pageBadge}><Text style={s.pageBadgeText}>{item.pageCount}</Text></View>
          {item.progress ? <View style={[s.readingDot, { backgroundColor: colors.primary }]} /> : null}
        </View>
        <View style={{ paddingHorizontal: 2, paddingTop: 8, gap: 3 }}>
          <Text numberOfLines={1} style={[s.cardTitle, { color: colors.onSurface }]}>{item.title}</Text>
          <Text style={[s.cardSub, { color: colors.secondaryLabel }]}>{pct > 0 ? `${pct}% · ` : ''}{item.pageCount} pages</Text>
          <View style={[s.progressTrack, { backgroundColor: colors.quaternarySystemFill }]}>
            <View style={[s.progressFill, { backgroundColor: colors.primary, width: `${(item.progress ?? 0) * 100}%` }]} />
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

type Filter = 'all' | 'reading' | 'unread';
type Sort = 'title' | 'progress';

export default function LibraryScreen() {
  const [series, setSeries] = useState<Series | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [query, setQuery] = useState('');
  const [isSearchFocused, setSearchFocused] = useState(false);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('title');

  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const colors = scheme === 'light' ? lightColors : darkColors;
  const isDark = scheme === 'dark';

  React.useEffect(() => { if (route.params?.series) setSeries(route.params.series as Series); }, [route.params]);

  const pickFolder = useCallback(async () => {
    await Haptics.selectionAsync();
    // 1) Pick — only THIS block treats cancel as silent.
    let dir;
    try {
      // Expo SDK 57+: system folder picker (SAF on Android, UIDocumentPicker on iOS).
      // Throws when the user dismisses — treat that as a silent cancel.
      dir = await Directory.pickDirectoryAsync();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/cancelled|canceled|abort|dismiss/i.test(msg)) return;
      console.warn('pickFolder pick', e);
      Alert.alert('Could not open picker', msg);
      return;
    }
    if (!dir?.uri) return;
    console.log('[Library] picked', dir.uri, dir.name);
    // 2) Scan — NEVER silent. Any failure must surface, otherwise the user
    // is stuck on the empty box with zero feedback (the current bug).
    setLoading(true);
    setScanProgress('');
    // list() is sync native and blocks — let the spinner paint first.
    await new Promise((r) => setTimeout(r, 60));
    try {
      try {
        await saveRoot(dir.uri);
      } catch {}
      let seriesName = dir.name ?? 'Library';
      try {
        seriesName = decodeURIComponent(seriesName);
      } catch {}
      const s = await scanSeries(
        dir.uri,
        seriesName,
        (done, totalDirs) => {
          setScanProgress(totalDirs > 0 ? `${done}/${totalDirs} folders` : `${done}`);
        },
        (shell) => {
          // Instant UI: shells (all pageCount 0) show names right after the
          // 1 root listing; snapshots (counts > 0) stream in behind.
          // Either way, stop showing the spinner — the library is visible.
          setSeries((prev) => {
            const isShell = shell.volumes.every((v) => !v.pageCount);
            if (isShell && prev && prev.rootUri === shell.rootUri) return prev;
            return shell;
          });
          setLoading(false);
        }
      );
      console.log('[Library] scan', s.volumes.length, 'volumes');
      if (s.volumes.length === 0) {
        Alert.alert(
          'No volumes here',
          `This folder has no readable volumes.\n\nOpen the inner folder that contains volume folders like "Meitantei Konan 001" + .html files, then choose again.`
        );
        return;
      }
      const withProgress = { ...s, volumes: s.volumes.map((v, i) => ({ ...v, progress: i === 1 ? 0.42 : i === 2 ? 0.08 : 0, lastOpened: i === 1 ? Date.now() - 1000 * 60 * 20 : undefined })) };
      setSeries(withProgress);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      console.warn('pickFolder scan', e);
      Alert.alert('Scan failed', msg);
    } finally {
      setLoading(false);
      setScanProgress('');
    }
  }, []);

  const openVolume = useCallback((v: Volume) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (series) {
      const next = { ...series, volumes: series.volumes.map((x) => (x.id === v.id ? { ...x, progress: Math.max(x.progress ?? 0, 0.08), lastOpened: Date.now() } : x)) } as Series;
      setSeries(next);
    }
    nav.navigate('Reader', { volume: v, series });
  }, [nav, series]);

  const filtered = useMemo(() => {
    if (!series) return [];
    let list = [...series.volumes];
    if (filter === 'reading') list = list.filter((v) => (v.progress ?? 0) > 0 && (v.progress ?? 0) < 1);
    if (filter === 'unread') list = list.filter((v) => !(v.progress ?? 0));
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((v) => v.title.toLowerCase().includes(q));
    }
    if (sort === 'progress') list.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
    else list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    return list;
  }, [series, query, filter, sort]);

  const continueReading = useMemo(() => {
    if (!series) return [];
    return [...series.volumes].filter((v) => (v.progress ?? 0) > 0 && (v.progress ?? 0) < 1).sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0)).slice(0, 5);
  }, [series]);

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: colors.groupedBackground, paddingTop: insets.top }]}>
        <View style={[s.navHeader, { borderBottomColor: colors.separator }]}>
          <Text style={[s.largeTitle, { color: colors.onSurface }]}>Library</Text>
        </View>
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[s.footnote, { color: colors.secondaryLabel, marginTop: 12 }]}>Scanning your folder…{scanProgress ? ` ${scanProgress}` : ''}</Text>
          <Text style={[s.caption, { color: colors.tertiaryLabel }]}>Reads in place — nothing is copied</Text>
        </View>
      </View>
    );
  }

  if (!series) {
    return (
      <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>
        <BlurView intensity={isDark ? 32 : 36} tint={isDark ? 'dark' : 'light'} style={[s.blurHeader, { paddingTop: insets.top + 12, borderBottomColor: colors.separator, backgroundColor: colors.blurTint }]}>
          <Text style={[s.largeTitle, { color: colors.onSurface }]}>Yomibako</Text>
          <Text style={[s.subhead, { color: colors.secondaryLabel }]}>よみばこ — Read manga where it lives</Text>
        </BlurView>
        <ScrollView contentContainerStyle={s.empty} showsVerticalScrollIndicator={false} bounces>
          <View style={[s.heroIcon, { backgroundColor: colors.primaryContainer, borderColor: 'transparent' }]}>
            <Icon name="bookOpen" size={34} color={colors.primary} strokeWidth={1.6} />
          </View>
          <Text style={[s.headline, { color: colors.onSurface }]}>Your reading box is empty</Text>
          <Text style={[s.body, { color: colors.secondaryLabel }]}>Choose a folder with your manga. Yomibako reads <Text style={{ fontWeight: '600', color: colors.onSurface }}>in place</Text> — no duplicates, no waiting. Access stays after restart.</Text>
          <Pressable onPress={pickFolder} style={({ pressed }) => [s.primaryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.84 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
            <Text style={s.primaryBtnText}>Choose Folder</Text>
          </Pressable>
          <View style={[s.tipCard, { backgroundColor: colors.secondaryGroupedBackground }]}>
            <Text style={[s.captionSemibold, { color: colors.onSurface }]}>Try</Text>
            <Text style={[s.mono, { color: colors.secondaryLabel }]}>/mokuro/Detective Conan</Text>
            <Text style={[s.caption, { color: colors.tertiaryLabel }]}>100 volumes · 37k pages · instant</Text>
          </View>
          <Text style={[s.footnote, { color: colors.tertiaryLabel, marginTop: 4 }]}>.mobile.html · .html · .mokuro + _ocr</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>
      <BlurView intensity={isDark ? 28 : 36} tint={isDark ? 'dark' : 'light'} style={[s.blurHeader, { paddingTop: insets.top + 10, borderBottomColor: colors.separator, backgroundColor: colors.blurTint }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.largeTitle, { color: colors.onSurface }]} numberOfLines={1}>{series.name}</Text>
            <Text style={[s.subhead, { color: colors.secondaryLabel }]}>{series.volumes.length} volumes · {series.totalPages.toLocaleString()} pages</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Pressable
              onPress={() => { Haptics.selectionAsync(); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setLayout((p) => (p === 'grid' ? 'list' : 'grid')); }}
              style={({ pressed }) => [s.iconBtn, { backgroundColor: pressed ? colors.systemFill : colors.secondarySystemFill }]}
              hitSlop={8}
              accessibilityLabel={layout === 'grid' ? 'Switch to list' : 'Switch to grid'}
            >
              <Icon name={layout === 'grid' ? 'list' : 'grid'} size={16} color={colors.primary} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={pickFolder} style={({ pressed }) => [s.smallCapsule, { backgroundColor: pressed ? colors.systemFill : colors.secondarySystemFill }]}>
              <Text style={[s.smallCapsuleText, { color: colors.primary }]}>Change</Text>
            </Pressable>
          </View>
        </View>
      </BlurView>

      <View style={[s.searchContainer, { backgroundColor: colors.groupedBackground }]}>
        <View style={[s.searchBar, { backgroundColor: isDark ? colors.surfaceContainer : '#E8E8ED', borderColor: isSearchFocused ? colors.primary : 'transparent' }]}>
          <Icon name="search" size={15} color={colors.secondaryLabel} strokeWidth={2} />
          <TextInput value={query} onChangeText={setQuery} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="Search" placeholderTextColor={colors.secondaryLabel} style={[s.searchInput, { color: colors.onSurface }]} clearButtonMode="never" returnKeyType="search" autoCorrect={false} />
          {query.length ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
              <View style={[s.clearBtn, { backgroundColor: colors.secondaryLabel }]}>
                <Icon name="close" size={10} color="#fff" strokeWidth={2.8} />
              </View>
            </Pressable>
          ) : null}
        </View>
        {(isSearchFocused || query.length) ? <Pressable onPress={() => { setQuery(''); setSearchFocused(false); Haptics.selectionAsync(); }} hitSlop={8}><Text style={[s.cancelText, { color: colors.primary }]}>Cancel</Text></Pressable> : null}
      </View>

      {/* Segmented filter — iOS UISegmentedControl */}
      <View style={[s.filterBar, { backgroundColor: colors.groupedBackground }]}>
        <View style={[s.segmented, { backgroundColor: colors.secondarySystemFill }]}>
          {(['all', 'reading', 'unread'] as Filter[]).map((f) => {
            const active = filter === f;
            return (
              <Pressable key={f} onPress={() => { Haptics.selectionAsync(); setFilter(f); }} style={[s.segItem, active && { backgroundColor: colors.secondaryGroupedBackground, boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }]}>
                <Text style={[s.segText, { color: active ? colors.onSurface : colors.secondaryLabel }]}>{f === 'all' ? 'All' : f === 'reading' ? 'Reading' : 'Unread'}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => { Haptics.selectionAsync(); setSort((p) => (p === 'title' ? 'progress' : 'title')); }} style={[s.sortBtn, { backgroundColor: colors.secondaryGroupedBackground }]} hitSlop={6} accessibilityLabel="Change sort">
          <Icon name="sort" size={13} color={colors.secondaryLabel} strokeWidth={2} />
          <Text style={{ color: colors.secondaryLabel, fontSize: 12, fontWeight: '600' }}>{sort === 'title' ? 'A–Z' : '%'}</Text>
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        key={String(layout)}
        keyExtractor={(v) => v.id}
        numColumns={layout === 'grid' ? 2 : 1}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: layout === 'grid' ? 18 : 8 }}
        columnWrapperStyle={layout === 'grid' ? { gap: 16 } : undefined}
        ListHeaderComponent={
          continueReading.length ? (
            <View style={{ gap: 10, marginBottom: 10 }}>
              <Text style={[s.sectionHeader, { color: colors.secondaryLabel }]}>Continue Reading</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingRight: 16 }} snapToInterval={134} decelerationRate="fast">
                {continueReading.map((v) => (
                  <Pressable key={v.id} onPress={() => openVolume(v)} style={({ pressed }) => [{ opacity: pressed ? 0.86 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
                    <View style={{ width: 120 }}>
                      <View style={[s.continueCover, { backgroundColor: colors.surfaceContainer, borderColor: colors.separator }]}>
                        <Image source={v.coverUri ? { uri: v.coverUri } : require('../../../assets/icon.png')} style={StyleSheet.absoluteFill as any} contentFit="cover" />
                        <View style={[s.continueProgress, { backgroundColor: 'rgba(120,120,128,0.24)' }]}>
                          <View style={{ height: 2.5, backgroundColor: colors.primary, width: `${(v.progress ?? 0) * 100}%` }} />
                        </View>
                      </View>
                      <Text numberOfLines={1} style={[s.continueTitle, { color: colors.onSurface }]}>{v.title}</Text>
                      <Text style={[s.continueSub, { color: colors.secondaryLabel }]}>{Math.round((v.progress ?? 0) * 100)}% · {v.pageCount} p</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={[s.divider, { backgroundColor: colors.separator, marginTop: 6 }]} />
            </View>
          ) : null
        }
        ListEmptyComponent={<View style={s.center}><Text style={[s.body, { color: colors.secondaryLabel }]}>No matches</Text></View>}
        renderItem={({ item }) => <AppleCard item={item} colors={colors} onPress={() => openVolume(item)} layout={layout} />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  blurHeader: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  largeTitle: { fontFamily: 'System', fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: 0.4 },
  subhead: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400', marginTop: 2, letterSpacing: -0.08 },
  headline: { fontFamily: 'System', fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center' as const, letterSpacing: 0.35 },
  body: { fontFamily: 'System', fontSize: 16, lineHeight: 22, fontWeight: '400', textAlign: 'center' as const, maxWidth: 320, letterSpacing: -0.3 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, lineHeight: 16 },
  footnote: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontFamily: 'System', fontSize: 12, lineHeight: 16, fontWeight: '400' },
  captionSemibold: { fontFamily: 'System', fontSize: 12, lineHeight: 16, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6 },
  empty: { padding: 24, alignItems: 'center', gap: 14, paddingTop: 32, paddingBottom: 40 },
  heroIcon: { width: 88, height: 88, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' as any },
  primaryBtn: { marginTop: 6, paddingHorizontal: 28, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', minWidth: 200, borderCurve: 'continuous' as any },
  primaryBtnText: { fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.4, color: '#fff' },
  tipCard: { marginTop: 8, width: '100%', maxWidth: 340, borderRadius: 14, padding: 14, gap: 3, borderCurve: 'continuous' as any },
  navHeader: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  smallCapsule: { paddingHorizontal: 14, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  smallCapsuleText: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  searchBar: { flex: 1, height: 36, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderWidth: 1.5, borderCurve: 'continuous' as any },
  searchInput: { flex: 1, fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '400', paddingVertical: 0 },
  clearBtn: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '400', marginLeft: 2 },
  filterBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  segmented: { flex: 1, flexDirection: 'row', borderRadius: 9, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: 'System', fontSize: 13, fontWeight: '600', letterSpacing: -0.08 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 32, borderRadius: 16 },
  sectionHeader: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' as const },
  card: { flex: 1, gap: 0 },
  cover: { aspectRatio: 0.72, borderRadius: 12, overflow: 'hidden', borderCurve: 'continuous' as any, borderWidth: StyleSheet.hairlineWidth, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' },
  pageBadge: { position: 'absolute', bottom: 8, left: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)' },
  pageBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600', letterSpacing: 0.2, fontVariant: ['tabular-nums'] as any },
  readingDot: { position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: '#fff' },
  cardTitle: { fontFamily: 'System', fontSize: 13, lineHeight: 17, fontWeight: '600', letterSpacing: -0.08 },
  cardSub: { fontFamily: 'System', fontSize: 12, lineHeight: 15, fontWeight: '400', fontVariant: ['tabular-nums'] as any },
  progressTrack: { height: 3, borderRadius: 1.5, overflow: 'hidden', marginTop: 6 },
  progressFill: { height: 3, borderRadius: 1.5 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, overflow: 'hidden', borderCurve: 'continuous' as any },
  listCover: { width: 44, height: 62, borderRadius: 7, overflow: 'hidden' },
  listTitle: { fontFamily: 'System', fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.3 },
  listSub: { fontFamily: 'System', fontSize: 13, lineHeight: 16, fontWeight: '400', fontVariant: ['tabular-nums'] as any },
  continueCover: { aspectRatio: 0.72, borderRadius: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderCurve: 'continuous' as any },
  continueProgress: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2.5 },
  continueTitle: { fontFamily: 'System', fontSize: 13, lineHeight: 16, fontWeight: '600', marginTop: 6, letterSpacing: -0.08 },
  continueSub: { fontFamily: 'System', fontSize: 12, lineHeight: 15, fontWeight: '400', fontVariant: ['tabular-nums'] as any },
  divider: { height: StyleSheet.hairlineWidth },
});
