import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, useColorScheme, Pressable, Alert } from 'react-native';
import { Directory } from 'expo-file-system';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { FileBrowser, BrowserEntry } from '../../components/system/FileBrowser';
import { scanSeries } from './scan';
import { lightColors, darkColors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { Icon } from '../../components/ui/Icon';
import * as Haptics from 'expo-haptics';

export default function BrowseScreen() {
  const scheme = useColorScheme();
  const colors = scheme === 'light' ? lightColors : darkColors;
  const isDark = scheme === 'dark';
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>(['On device']);
  const [entries, setEntries] = useState<BrowserEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [stack, setStack] = useState<string[]>([]);
  const loadId = React.useRef(0);

  const loadDir = useCallback(async (uri: string) => {
    const id = ++loadId.current;
    setLoading(true);
    try {
      // Expo SDK 57+: Directory.list() works for both file:// and content:// (SAF)
      // and returns proper child URIs — no manual `${uri}/${name}` concat.
      // NOTE: no per-file .size here — each is a SAF query and 400 of them jank.
      const dir = new Directory(uri);
      const items = dir.list();
      if (loadId.current !== id) return;
      const out: BrowserEntry[] = [];
      for (const item of items) {
        const isDir = item instanceof Directory;
        const name = item.name;
        const full = item.uri;
        if (
          isDir ||
          name.endsWith('.html') ||
          name.endsWith('.mokuro') ||
          name.endsWith('.jpeg') ||
          name.endsWith('.jpg') ||
          name.endsWith('.png') ||
          name.endsWith('.webp')
        ) {
          out.push({ name, uri: full, isDir, size: undefined });
        }
      }
      out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDir ? -1 : 1));
      setEntries(out);
    } catch (e) {
      if (loadId.current !== id) return;
      console.warn('loadDir', e);
      setEntries([]);
    }
    if (loadId.current === id) setLoading(false);
  }, []);

  const requestRoot = useCallback(async () => {
    await Haptics.selectionAsync();
    try {
      const dir = await Directory.pickDirectoryAsync();
      if (!dir?.uri) return;
      // Let the effect below do the actual listing — single source of truth,
      // avoids double-load race (direct loadDir + effect loadDir).
      loadId.current++;
      setEntries([]);
      setLoading(true);
      setCurrentUri(dir.uri);
      setPath(['On device', dir.name ?? 'Folder']);
      setStack([dir.uri]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    } catch (e: any) {
      setLoading(false);
      const msg = String(e?.message ?? e);
      if (/cancelled|canceled|abort|dismiss/i.test(msg)) return;
      console.warn(e);
      Alert.alert('Folder access', `Could not open folder: ${msg}`);
    }
  }, []);

  useEffect(() => {
    if (currentUri) loadDir(currentUri);
  }, [currentUri, loadDir]);

  const onUp = useCallback(() => {
    if (stack.length <= 1) return;
    const nextStack = stack.slice(0, -1);
    // Clear list immediately so header + list never show mismatched folders.
    loadId.current++;
    setEntries([]);
    setLoading(true);
    setStack(nextStack);
    setPath((p) => p.slice(0, -1));
    setCurrentUri(nextStack[nextStack.length - 1]);
    Haptics.selectionAsync();
  }, [stack]);

  const onOpen = useCallback(async (e: BrowserEntry) => {
    await Haptics.selectionAsync();
    if (e.isDir) {
      // Clear list immediately so header + list never show mismatched folders
      // (e.g. header "006" with parent's entries still visible).
      loadId.current++;
      setEntries([]);
      setLoading(true);
      setStack((s) => [...s, e.uri]);
      setPath((p) => [...p, e.name]);
      setCurrentUri(e.uri);
    } else {
      Alert.alert(e.name, e.uri);
    }
  }, []);

  const onPickThisFolder = useCallback(async () => {
    if (!currentUri) {
      requestRoot();
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    // list() is sync native and blocks — let any spinner paint first.
    await new Promise((r) => setTimeout(r, 60));
    try {
      const name = path[path.length - 1] ?? 'Library';
      const s = await scanSeries(currentUri, decodeURIComponent(name));
      if (s.volumes.length === 0) {
        // Don't offer OPEN on empty — tell user to go one level deeper.
        // Typical cause: picked outer "Detective Conan" that only contains
        // inner "Detective Conan" (double nesting).
        Alert.alert(
          'No volumes here',
          `This folder has no readable volumes.\n\nOpen the inner folder that contains volume folders like "Meitantei Konan 001" + .html files, then tap "Use This Folder".`,
          [{ text: 'OK' }]
        );
        return;
      }
      Alert.alert(`Found ${s.volumes.length} volumes`, `${s.totalPages.toLocaleString()} pages`, [
        { text: 'Open', onPress: () => (navigation as any).navigate('Library', { series: s }) },
        { text: 'OK' },
      ]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Scan failed', String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [currentUri, path, navigation, requestRoot]);

  if (!currentUri) {
    return (
      <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>
        <BlurView intensity={isDark ? 32 : 36} tint={isDark ? 'dark' : 'light'} style={[s.blurHeader, { paddingTop: insets.top + 12, borderBottomColor: colors.separator, backgroundColor: colors.blurTint }]}>
          <Text style={[s.largeTitle, { color: colors.onSurface }]}>Browse</Text>
          <Text style={[s.subhead, { color: colors.secondaryLabel }]}>On device · Reads in place</Text>
        </BlurView>

        <View style={s.empty}>
          <View style={[s.iconWrap, { backgroundColor: colors.primaryContainer }]}>
            <Icon name="browse" size={30} color={colors.primary} strokeWidth={1.6} />
          </View>
          <Text style={[s.emptyTitle, { color: colors.onSurface }]}>Browse files</Text>
          <Text style={[s.emptySub, { color: colors.secondaryLabel }]}>Pick a folder once. Your files stay where they are — nothing is copied or moved.</Text>
          <Pressable onPress={requestRoot} style={({ pressed }) => [s.primaryCapsule, { backgroundColor: colors.primary, opacity: pressed ? 0.84 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
            <Text style={[s.primaryText, { color: '#fff' }]}>Choose Folder</Text>
          </Pressable>
          <Text style={[s.caption, { color: colors.tertiaryLabel }]}>Files-style · Keeps access after restart</Text>
        </View>
      </View>
    );
  }

  if (loading && entries.length === 0) {
    return (
      <View style={[s.root, { backgroundColor: colors.groupedBackground, justifyContent: 'center', alignItems: 'center', gap: 10, paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[s.footnote, { color: colors.secondaryLabel }]}>Loading folder…</Text>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>
      {/* Single header: Up + title/breadcrumb + count + Change.
          FileBrowser no longer renders its own bar (was duplicated). */}
      <BlurView intensity={isDark ? 28 : 32} tint={isDark ? 'dark' : 'light'} style={[s.blurHeaderCompact, { paddingTop: insets.top + 10, borderBottomColor: colors.separator, backgroundColor: colors.blurTint }]}>
        <Pressable
          onPress={onUp}
          disabled={path.length <= 1}
          style={[s.smallPill, { backgroundColor: path.length > 1 ? colors.secondarySystemFill : 'transparent', opacity: path.length > 1 ? 1 : 0.4 }]}
          hitSlop={8}
        >
          <Text style={[s.smallPillText, { color: path.length > 1 ? colors.primary : colors.secondaryLabel }]}>‹ Up</Text>
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.title3, { color: colors.onSurface }]} numberOfLines={1}>
            {path[path.length - 1]}
          </Text>
          <Text style={[s.captionLeft, { color: colors.secondaryLabel }]} numberOfLines={1}>
            {path.join('  ›  ')}  ·  {entries.length}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            loadId.current++;
            setCurrentUri(null);
            setPath(['On device']);
            setStack([]);
            setEntries([]);
          }}
          style={({ pressed }) => [s.smallPill, { backgroundColor: pressed ? colors.systemFill : colors.secondarySystemFill }]}
          hitSlop={8}
        >
          <Text style={[s.smallPillText, { color: colors.primary }]}>Change</Text>
        </Pressable>
      </BlurView>

      <FileBrowser entries={entries} onOpen={onOpen} onPickThisFolder={onPickThisFolder} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  blurHeader: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  blurHeaderCompact: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  largeTitle: { ...typography.displayLarge },
  title3: { ...typography.headlineMedium },
  subhead: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: -0.08 },
  empty: { flex: 1, padding: 24, alignItems: 'center', gap: 12, paddingTop: 36 },
  iconWrap: { width: 76, height: 76, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' as any },
  emptyTitle: { ...typography.headlineMedium, marginTop: 6, letterSpacing: -0.4 },
  emptySub: { ...typography.bodySmall, textAlign: 'center' as const, maxWidth: 300, lineHeight: 20 },
  primaryCapsule: { marginTop: 8, paddingHorizontal: 28, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', minWidth: 200, borderCurve: 'continuous' as any },
  primaryText: { fontFamily: 'System', fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.4 },
  caption: { fontFamily: 'System', fontSize: 12, lineHeight: 16, fontWeight: '400' as const, textAlign: 'center' as const },
  captionLeft: { fontFamily: 'System', fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  footnote: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  smallPill: { paddingHorizontal: 14, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  smallPillText: { fontFamily: 'System', fontSize: 13, fontWeight: '600' as const },
});
