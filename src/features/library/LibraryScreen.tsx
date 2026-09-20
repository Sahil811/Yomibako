import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Directory } from 'expo-file-system';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, {
  Easing,
  FadeIn,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { scanLibrary } from './scan';
import { getRoots, removeRoot, saveRoot } from '../../services/fs/saf';
import { loadLibraryIndex, saveLibraryIndex } from './libraryCache';
import { clearRemoved, loadRemoved, markRemoved, restoreRemoved, withoutRemoved } from './removed';
import { getSavedReading } from '../reader/progress';
import type { Volume, Series } from './types';
import { darkColors, lightColors } from '../../theme/colors';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Logo } from '../../components/ui/Logo';
import * as Haptics from 'expo-haptics';

type Filter = 'all' | 'reading' | 'unread';
type Sort = 'title' | 'progress' | 'recent';
type SnackState = { id: number; text: string; undo?: () => void } | null;

type SheetAction = {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  selected?: boolean;
  dividerBefore?: boolean;
  onPress: () => void;
};

const SORT_LABEL: Record<Sort, string> = {
  title: 'name',
  progress: 'progress',
  recent: 'recently read',
};

// Cached collator: String.localeCompare with { numeric: true } allocates a new
// collator per comparison — brutal when re-sorting 100+ volumes on every
// streaming scan update. One shared instance does the same ordering.
const titleCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const compareTitle = (a: { title: string }, b: { title: string }) => titleCollator.compare(a.title, b.title);

// Deterministic muted tint so volumes without cover art still read as distinct books.
function tintFor(seed: string, isDark: boolean): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return isDark ? `hsl(${hue}, 26%, 24%)` : `hsl(${hue}, 46%, 87%)`;
}

function coverInitial(title: string): string {
  const trailingNumber = title.match(/(\d{1,4})\s*$/);
  if (trailingNumber) return String(Number(trailingNumber[1]));
  return title.trim().slice(0, 2) || '本';
}

const CoverArt = React.memo(function CoverArt({ volume, isDark, radius }: { volume: Volume; isDark: boolean; radius: number }) {
  if (volume.coverUri) {
    return (
      <Image
        source={{ uri: volume.coverUri }}
        style={StyleSheet.absoluteFill as any}
        contentFit="cover"
        // No fade-in: transition re-animates every recycled cell during scroll.
        transition={0}
        cachePolicy="memory-disk"
        recyclingKey={volume.id}
      />
    );
  }
  return (
    <View
      style={[
        StyleSheet.absoluteFill as any,
        { backgroundColor: tintFor(volume.title, isDark), borderRadius: radius, alignItems: 'center', justifyContent: 'center' },
      ]}
    >
      <Text numberOfLines={1} style={[s.coverInitial, { color: isDark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.50)' }]}>
        {coverInitial(volume.title)}
      </Text>
    </View>
  );
});

const IconButton = React.memo(function IconButton({ icon, onPress, tint, label }: { icon: IconName; onPress: () => void; tint: string; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: 'rgba(120,120,128,0.24)', radius: 22, borderless: true }}
      style={({ pressed }) => [s.iconButton, { opacity: pressed && Platform.OS !== 'android' ? 0.5 : 1 }]}
    >
      <Icon name={icon} size={20} color={tint} strokeWidth={1.9} />
    </Pressable>
  );
});

type VolumeCardProps = {
  volume: Volume;
  colors: any;
  isDark: boolean;
  layout: 'grid' | 'list';
  selecting: boolean;
  selected: boolean;
  onPress: (volume: Volume) => void;
  onLongPress: (volume: Volume) => void;
  onMenu: (volume: Volume) => void;
};

// Custom equality: streaming scans replace every object identity on each batch,
// so a default shallow memo would still re-render all 100+ cards. Only the
// fields actually painted are compared — unrelated batches skip render.
function volumeCardEqual(prev: VolumeCardProps, next: VolumeCardProps): boolean {
  return (
    prev.volume.id === next.volume.id &&
    prev.volume.title === next.volume.title &&
    prev.volume.coverUri === next.volume.coverUri &&
    prev.volume.pageCount === next.volume.pageCount &&
    (prev.volume.progress ?? 0) === (next.volume.progress ?? 0) &&
    prev.selecting === next.selecting &&
    prev.selected === next.selected &&
    prev.layout === next.layout &&
    prev.isDark === next.isDark &&
    prev.colors === next.colors &&
    prev.onPress === next.onPress &&
    prev.onLongPress === next.onLongPress &&
    prev.onMenu === next.onMenu
  );
}

const VolumeCard = React.memo(function VolumeCard({ volume, colors, isDark, layout, selecting, selected, onPress, onLongPress, onMenu }: VolumeCardProps) {
  const progress = volume.progress ?? 0;
  const pct = Math.round(progress * 100);
  const meta = volume.pageCount
    ? `${volume.pageCount} pages${progress > 0 ? ` · ${pct}%` : ''}`
    : progress > 0
      ? `${pct}%`
      : 'Not started';
  // NOTE: no Reanimated shared values here on purpose. The old per-card scale
  // animation kept 100+ animated nodes alive and remounted them on every scroll
  // frame — the main source of the "large list slow to update" warning.
  // Pressable opacity feedback is free by comparison.
  const press = {
    onPress: () => onPress(volume),
    onLongPress: () => onLongPress(volume),
    delayLongPress: 260,
    accessibilityRole: 'button' as const,
    accessibilityLabel: volume.title,
    accessibilityState: { selected },
  };

  if (layout === 'list') {
    return (
      <Pressable {...press} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.7 : 1 }]}>
        <View style={[s.listRow, { backgroundColor: selected ? colors.primaryContainer : colors.secondaryGroupedBackground }]}>
          <View style={[s.listCover, { backgroundColor: colors.tertiarySystemFill }]}>
            <CoverArt volume={volume} isDark={isDark} radius={8} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text numberOfLines={1} style={[s.listTitle, { color: colors.onSurface }]}>{volume.title}</Text>
            <Text style={[s.listSub, { color: colors.secondaryLabel }]}>{meta}</Text>
            {progress > 0 ? (
              <View style={[s.track, { backgroundColor: colors.quaternarySystemFill, marginTop: 5 }]}>
                <View style={[s.fill, { backgroundColor: colors.primary, width: `${Math.max(3, pct)}%` }]} />
              </View>
            ) : null}
          </View>
          {selecting ? (
            <Icon name={selected ? 'checkCircle' : 'circle'} size={24} color={selected ? colors.primary : colors.tertiaryLabel} strokeWidth={1.8} />
          ) : (
            <IconButton icon="more" onPress={() => onMenu(volume)} tint={colors.secondaryLabel} label={`Options for ${volume.title}`} />
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable {...press} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.86 : 1 }]}>
      <View style={{ flex: 1 }}>
        <View style={[s.cover, { backgroundColor: colors.surfaceContainer, borderColor: selected ? colors.primary : colors.separator, borderWidth: selected ? 2 : StyleSheet.hairlineWidth }]}>
          <CoverArt volume={volume} isDark={isDark} radius={13} />
          {volume.pageCount ? (
            <View style={s.pageBadge}>
              <Text style={s.pageBadgeText}>{volume.pageCount}</Text>
            </View>
          ) : null}
          {selecting ? (
            <View style={[StyleSheet.absoluteFill as any, { backgroundColor: selected ? 'rgba(0,0,0,0.26)' : 'transparent' }]}>
              <View style={s.cornerSlot}>
                <Icon name={selected ? 'checkCircle' : 'circle'} size={24} color={selected ? colors.primary : 'rgba(255,255,255,0.92)'} strokeWidth={1.8} />
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => onMenu(volume)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Options for ${volume.title}`}
              style={({ pressed }) => [s.cardMenu, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Icon name="more" size={16} color="#FFFFFF" strokeWidth={2} />
            </Pressable>
          )}
          {progress > 0 ? (
            <View style={s.coverProgress}>
              <View style={{ height: 3, backgroundColor: colors.primary, width: `${Math.max(3, pct)}%` }} />
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[s.cardTitle, { color: colors.onSurface }]}>{volume.title}</Text>
        <Text numberOfLines={1} style={[s.cardSub, { color: colors.secondaryLabel }]}>{meta}</Text>
      </View>
    </Pressable>
  );
}, volumeCardEqual);

const SkeletonGrid = React.memo(function SkeletonGrid({ colors }: { colors: any }) {
  const pulse = useSharedValue(0.45);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 820, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View style={s.skeletonWrap} pointerEvents="none">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Animated.View key={index} style={[s.skeletonCard, animated]}>
          <View style={[s.skeletonCover, { backgroundColor: colors.tertiarySystemFill }]} />
          <View style={[s.skeletonLine, { backgroundColor: colors.tertiarySystemFill, width: '80%' }]} />
          <View style={[s.skeletonLine, { backgroundColor: colors.quaternarySystemFill, width: '52%' }]} />
        </Animated.View>
      ))}
    </View>
  );
});

const ScanBar = React.memo(function ScanBar({ colors }: { colors: any }) {
  const { width } = useWindowDimensions();
  const offset = useSharedValue(-0.45);
  useEffect(() => {
    offset.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [offset]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value * width }] }));
  return (
    <View style={[s.scanTrack, { backgroundColor: colors.quaternarySystemFill }]}>
      <Animated.View style={[{ width: width * 0.42, height: 2.5, backgroundColor: colors.primary }, animated]} />
    </View>
  );
});

// Android: BlurView over a scrolling list forces a full-screen blur re-composite
// every scroll frame. A solid surface is visually near-identical here and far cheaper.
function AppBar({ colors, isDark, topPad, children }: { colors: any; isDark: boolean; topPad: number; children: React.ReactNode }) {
  if (Platform.OS === 'android') {
    return (
      <View style={[s.appBar, { paddingTop: topPad, borderBottomColor: colors.separator, backgroundColor: colors.secondaryGroupedBackground }]}>
        {children}
      </View>
    );
  }
  return (
    <BlurView intensity={isDark ? 28 : 36} tint={isDark ? 'dark' : 'light'} style={[s.appBar, { paddingTop: topPad, borderBottomColor: colors.separator, backgroundColor: colors.blurTint }]}>
      {children}
    </BlurView>
  );
}

const ActionSheet = React.memo(function ActionSheet({ title, subtitle, actions, onClose, colors, insetBottom }: {
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
  onClose: () => void;
  colors: any;
  insetBottom: number;
}) {
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(140)} style={[StyleSheet.absoluteFill as any, { backgroundColor: colors.scrimStrong }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss menu" />
      </Animated.View>
      <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.springify().damping(26).stiffness(280)}
          style={[s.sheet, { backgroundColor: colors.secondaryGroupedBackground, paddingBottom: Math.max(insetBottom, 10) + 8 }]}
        >
          <View style={[s.grabber, { backgroundColor: colors.tertiaryLabel }]} />
          {title ? (
            <View style={s.sheetHead}>
              <Text numberOfLines={2} style={[s.sheetTitle, { color: colors.onSurface }]}>{title}</Text>
              {subtitle ? <Text numberOfLines={1} style={[s.sheetSub, { color: colors.secondaryLabel }]}>{subtitle}</Text> : null}
            </View>
          ) : null}
          {actions.map((action) => (
            <View key={action.key}>
              {action.dividerBefore ? <View style={[s.sheetDivider, { backgroundColor: colors.separator }]} /> : null}
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  onClose();
                  requestAnimationFrame(action.onPress);
                }}
                android_ripple={{ color: colors.systemFill }}
                style={({ pressed }) => [s.sheetItem, { backgroundColor: pressed && Platform.OS !== 'android' ? colors.systemFill : 'transparent' }]}
              >
                <Icon name={action.icon} size={20} color={action.destructive ? colors.error : colors.onSurface} strokeWidth={1.9} />
                <Text style={[s.sheetItemText, { color: action.destructive ? colors.error : colors.onSurface }]}>{action.label}</Text>
                {action.selected ? <Icon name="check" size={18} color={colors.primary} strokeWidth={2.4} /> : null}
              </Pressable>
            </View>
          ))}
        </Animated.View>
      </View>
    </Modal>
  );
});

function seriesKey(series: Series): string {
  return series.rootUri;
}

const seriesCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function mergeSeries(current: Series[], incoming: Series[]): Series[] {
  const byRoot = new Map(current.map((item) => [seriesKey(item), item]));
  for (const item of incoming) byRoot.set(seriesKey(item), item);
  return [...byRoot.values()].sort((a, b) => seriesCollator.compare(a.name, b.name));
}

function recount(series: Series, volumes: Volume[]): Series {
  return { ...series, volumes, totalPages: volumes.reduce((count, volume) => count + volume.pageCount, 0) };
}

async function withSavedProgress(items: Series[]): Promise<Series[]> {
  return Promise.all(items.map(async (series) => {
    const volumes = await Promise.all(series.volumes.map(async (volume) => {
      const saved = await getSavedReading(volume.progressKey ?? volume.uri);
      if (!saved) return { ...volume, progress: 0, lastOpened: undefined };
      const total = volume.pageCount || saved.total || 1;
      const denominator = Math.max(1, total - 1);
      return {
        ...volume,
        pageCount: total,
        progress: Math.max(0, Math.min(1, saved.page / denominator)),
        lastOpened: saved.updatedAt,
      };
    }));
    return recount(series, volumes);
  }));
}

export default function LibraryScreen() {
  const [library, setLibrary] = useState<Series[]>([]);
  const [activeSeriesUri, setActiveSeriesUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('title');
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [menuVolume, setMenuVolume] = useState<Volume | null>(null);
  const [menuSeries, setMenuSeries] = useState<Series | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [snack, setSnack] = useState<SnackState>(null);
  const [removedCount, setRemovedCount] = useState(0);

  const restored = useRef(false);
  const libraryRef = useRef<Series[]>([]);
  const removedRef = useRef<Set<string>>(new Set());
  const scanningRef = useRef(false);
  const goneRef = useRef(false);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  libraryRef.current = library;

  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const colors = scheme === 'light' ? lightColors : darkColors;
  const isDark = scheme === 'dark';

  const series = useMemo(
    () => library.find((item) => seriesKey(item) === activeSeriesUri) ?? library[0] ?? null,
    [library, activeSeriesUri]
  );

  // Typing must not re-sort + re-render 100+ cards per keystroke. The input
  // stays immediate; filtering follows a deferred value instead.
  const deferredQuery = React.useDeferredValue(query);
  const selectionSet = useMemo(() => new Set(selection), [selection]);

  const setRemoved = useCallback((next: Set<string>) => {
    removedRef.current = next;
    setRemovedCount(next.size);
  }, []);

  const showSnack = useCallback((text: string, undo?: () => void) => {
    if (snackTimer.current) clearTimeout(snackTimer.current);
    setSnack({ id: Date.now(), text, undo });
    snackTimer.current = setTimeout(() => setSnack(null), 6000);
  }, []);

  useEffect(() => {
    goneRef.current = false;
    return () => {
      goneRef.current = true;
      if (snackTimer.current) clearTimeout(snackTimer.current);
    };
  }, []);

  // Single funnel for scan results, so a removed series can never be
  // resurrected by a streaming update that started before the removal.
  const absorb = useCallback((incoming: Series[]) => {
    const visible = withoutRemoved(incoming, removedRef.current);
    if (!visible.length) return;
    setLibrary((current) => mergeSeries(current, visible));
    setActiveSeriesUri((current) => current ?? visible[0].rootUri);
  }, []);

  useEffect(() => {
    const incoming = route.params?.series as Series | undefined;
    if (!incoming) return;
    absorb([incoming]);
    setActiveSeriesUri(seriesKey(incoming));
  }, [route.params?.series, absorb]);

  // Walks every granted root. Also used by "Rescan folders", so volumes added
  // on the device show up without restarting the app.
  const rescan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setLoading(true);
    try {
      const roots = await getRoots().catch(() => [] as string[]);
      for (const uri of roots) {
        if (goneRef.current) break;
        let name = 'Manga';
        try { name = new Directory(uri).name || name; } catch {}
        try { name = decodeURIComponent(name); } catch {}
        try {
          const found = await scanLibrary(
            uri,
            name,
            (seriesName, done, total) => !goneRef.current && setScanProgress(`${seriesName} · ${done}/${total} folders`),
            (draft) => {
              if (goneRef.current) return;
              absorb(draft);
              if (draft.length) setLoading(false);
            }
          );
          const hydrated = await withSavedProgress(found);
          if (!goneRef.current) absorb(hydrated);
        } catch (error) {
          console.warn('[Library] scan root failed', uri, error);
        }
      }
      // Snapshot the finished scan so the next cold start paints instantly.
      if (!goneRef.current) saveLibraryIndex(libraryRef.current, roots);
    } finally {
      scanningRef.current = false;
      setLoading(false);
      setScanProgress('');
    }
  }, [absorb]);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      setRemoved(await loadRemoved().catch(() => new Set<string>()));
      // Show the last known shelf first — covers and page counts included —
      // then let the live scan below reconcile. absorb() still applies the
      // removal set, so hidden series cannot return from the cache.
      const roots = await getRoots().catch(() => [] as string[]);
      if (roots.length && !goneRef.current) {
        const cached = await loadLibraryIndex(roots);
        if (cached.length && !goneRef.current) absorb(await withSavedProgress(cached));
      }
      await rescan();
    })();
  }, [absorb, rescan, setRemoved]);

  useEffect(() => nav.addListener('focus', () => {
    const current = libraryRef.current;
    if (!current.length) return;
    void withSavedProgress(current).then((hydrated) => {
      setLibrary((latest) => {
        const live = new Set(latest.map(seriesKey));
        return mergeSeries(latest, hydrated.filter((item) => live.has(seriesKey(item))));
      });
    });
  }), [nav]);

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
      // Re-adding a folder is an explicit undo of a previous removal.
      setRemoved(await restoreRemoved([dir.uri]).catch(() => removedRef.current));
      let seriesName = dir.name ?? 'Library';
      try {
        seriesName = decodeURIComponent(seriesName);
      } catch {}
      const found = await scanLibrary(
        dir.uri,
        seriesName,
        (activeName, done, totalDirs) => {
          setScanProgress(totalDirs > 0 ? `${activeName} · ${done}/${totalDirs} folders` : activeName);
        },
        (detected) => {
          // Instant UI: shells (all pageCount 0) show names right after the
          // 1 root listing; snapshots (counts > 0) stream in behind.
          // Either way, stop showing the spinner — the library is visible.
          absorb(detected);
          setLoading(false);
        }
      );
      const volumeCount = found.reduce((count, item) => count + item.volumes.length, 0);
      console.log('[Library] scan', found.length, 'series', volumeCount, 'volumes');
      if (volumeCount === 0) {
        Alert.alert(
          'No readable manga here',
          'Choose either a manga series folder containing its volumes, or a shelf folder containing several series.'
        );
        return;
      }
      const hydrated = await withSavedProgress(found);
      const visible = withoutRemoved(hydrated, removedRef.current);
      setLibrary((current) => mergeSeries(current, visible));
      setActiveSeriesUri(visible[0]?.rootUri ?? null);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      console.warn('pickFolder scan', e);
      Alert.alert('Scan failed', msg);
    } finally {
      setLoading(false);
      setScanProgress('');
    }
  }, [absorb, setRemoved]);

  const openVolume = useCallback((volume: Volume) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (series) {
      const next = recount(series, series.volumes.map((item) => (item.id === volume.id ? { ...item, lastOpened: Date.now() } : item)));
      setLibrary((current) => mergeSeries(current, [next]));
    }
    nav.navigate('Reader', { volume, series });
  }, [nav, series]);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelection([]);
  }, []);

  const toggleSelected = useCallback((id: string) => {
    Haptics.selectionAsync();
    setSelection((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }, []);

  // Stable volume-keyed handlers so memoised VolumeCards keep their props
  // identity across list re-renders. Inline closures here would defeat memo.
  const handlePressVolume = useCallback((volume: Volume) => {
    if (selecting) toggleSelected(volume.id);
    else openVolume(volume);
  }, [selecting, toggleSelected, openVolume]);

  const handleLongPressVolume = useCallback((volume: Volume) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (selecting) toggleSelected(volume.id);
    else {
      setSelecting(true);
      setSelection([volume.id]);
    }
  }, [selecting, toggleSelected]);

  const handleMenuVolume = useCallback((volume: Volume) => {
    Haptics.selectionAsync();
    setMenuVolume(volume);
  }, []);

  // Removing never touches the files on disk — it only hides them, and the
  // choice is persisted so the next scan does not bring them back.
  const removeVolumes = useCallback(async (volumes: Volume[]) => {
    if (!volumes.length) return;
    const ids = volumes.map((volume) => volume.id);
    const idSet = new Set(ids);
    const snapshot = libraryRef.current;
    const previousActive = activeSeriesUri;
    exitSelection();
    setLibrary((current) => current
      .map((item) => (item.volumes.some((volume) => idSet.has(volume.id))
        ? recount(item, item.volumes.filter((volume) => !idSet.has(volume.id)))
        : item))
      .filter((item) => item.volumes.length > 0));
    setRemoved(await markRemoved(ids));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    showSnack(volumes.length === 1 ? `Removed “${volumes[0].title}”` : `Removed ${volumes.length} volumes`, () => {
      void restoreRemoved(ids).then(setRemoved);
      setLibrary(snapshot);
      setActiveSeriesUri(previousActive);
      setSnack(null);
    });
  }, [activeSeriesUri, exitSelection, setRemoved, showSnack]);

  const removeSeries = useCallback((target: Series) => {
    Alert.alert(
      `Remove “${target.name}”?`,
      `${target.volumes.length} ${target.volumes.length === 1 ? 'volume' : 'volumes'} will leave your library. Nothing is deleted from this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const snapshot = libraryRef.current;
            const previousActive = activeSeriesUri;
            const rest = snapshot.filter((item) => seriesKey(item) !== seriesKey(target));
            const sourceRoot = target.sourceRootUri ?? target.rootUri;
            // Only forget the granted folder when no other shelf still needs it.
            const rootStillUsed = rest.some((item) => (item.sourceRootUri ?? item.rootUri) === sourceRoot);
            exitSelection();
            setLibrary(rest);
            setActiveSeriesUri(rest.length ? seriesKey(rest[0]) : null);
            setRemoved(await markRemoved([target.rootUri]));
            if (!rootStillUsed) await removeRoot(sourceRoot).catch(() => {});
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            showSnack(`Removed “${target.name}”`, () => {
              void restoreRemoved([target.rootUri]).then(setRemoved);
              if (!rootStillUsed) void saveRoot(sourceRoot).catch(() => {});
              setLibrary(snapshot);
              setActiveSeriesUri(previousActive);
              setSnack(null);
            });
          },
        },
      ]
    );
  }, [activeSeriesUri, exitSelection, setRemoved, showSnack]);

  const restoreEverything = useCallback(async () => {
    setRemoved(await clearRemoved());
    await rescan();
    showSnack('Restored removed manga');
  }, [rescan, setRemoved, showSnack]);

  const filtered = useMemo(() => {
    if (!series) return [];
    let list = [...series.volumes];
    if (filter === 'reading') list = list.filter((v) => (v.progress ?? 0) > 0 && (v.progress ?? 0) < 1);
    if (filter === 'unread') list = list.filter((v) => !(v.progress ?? 0));
    const q = deferredQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((v) => v.title.toLowerCase().includes(q));
    }
    if (sort === 'progress') list.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
    else if (sort === 'recent') list.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
    else list.sort(compareTitle);
    return list;
  }, [series, deferredQuery, filter, sort]);

  const continueReading = useMemo(() => {
    if (!series) return [];
    return [...series.volumes]
      .filter((v) => (v.progress ?? 0) > 0 && (v.progress ?? 0) < 1)
      .sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
      .slice(0, 8);
  }, [series]);

  const libraryVolumeCount = useMemo(
    () => library.reduce((count, item) => count + item.volumes.length, 0),
    [library]
  );

  const selectedVolumes = useMemo(
    () => (series ? series.volumes.filter((volume) => selectionSet.has(volume.id)) : []),
    [series, selectionSet]
  );

  const renderVolume = useCallback(({ item }: { item: Volume }) => (
    <VolumeCard
      volume={item}
      colors={colors}
      isDark={isDark}
      layout={layout}
      selecting={selecting}
      selected={selectionSet.has(item.id)}
      onPress={handlePressVolume}
      onLongPress={handleLongPressVolume}
      onMenu={handleMenuVolume}
    />
  ), [colors, isDark, layout, selecting, selectionSet, handlePressVolume, handleLongPressVolume, handleMenuVolume]);

  // ——— Onboarding: nothing in the library yet ———
  if (!series && !loading) {
    return (
      <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>
        <AppBar colors={colors} isDark={isDark} topPad={insets.top + 10}>
          <View style={s.barRow}>
            <Text style={[s.title, { color: colors.onSurface }]}>Library</Text>
          </View>
        </AppBar>
        <ScrollView contentContainerStyle={s.empty} showsVerticalScrollIndicator={false}>
          <View style={s.heroIcon}>
            <Logo size={96} />
          </View>
          <Text style={[s.emptyTitle, { color: colors.onSurface }]}>Add your manga folder</Text>
          <Text style={[s.emptyBody, { color: colors.secondaryLabel }]}>
            Pick a single series, or a shelf holding several. Yomibako reads them in place — nothing is copied or moved.
          </Text>
          <Pressable
            onPress={pickFolder}
            android_ripple={{ color: 'rgba(255,255,255,0.22)' }}
            style={({ pressed }) => [s.primaryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 }]}
          >
            <Icon name="plus" size={18} color="#FFFFFF" strokeWidth={2.4} />
            <Text style={s.primaryBtnText}>Choose folder</Text>
          </Pressable>
          <Text style={[s.emptyHint, { color: colors.tertiaryLabel }]}>.mobile.html · .html · .mokuro + _ocr</Text>
        </ScrollView>
      </View>
    );
  }

  const headerTitle = library.length > 1 ? 'Library' : series?.name ?? 'Library';
  const headerSub = !series
    ? 'Scanning…'
    : library.length > 1
      ? `${library.length} series · ${libraryVolumeCount} volumes`
      : `${series.volumes.length} volumes · ${series.totalPages.toLocaleString()} pages`;

  const overflowActions: SheetAction[] = series ? [
    { key: 'add', label: 'Add folder…', icon: 'plus', onPress: () => void pickFolder() },
    { key: 'select', label: 'Select volumes', icon: 'check', onPress: () => setSelecting(true) },
    { key: 'rescan', label: 'Rescan folders', icon: 'reload', onPress: () => void rescan() },
    ...(removedCount > 0
      ? [{ key: 'restore', label: 'Restore removed manga', icon: 'repeat' as IconName, onPress: () => void restoreEverything() }]
      : []),
    { key: 'sort-title', label: 'Sort by name', icon: 'sort', selected: sort === 'title', dividerBefore: true, onPress: () => setSort('title') },
    { key: 'sort-progress', label: 'Sort by progress', icon: 'sort', selected: sort === 'progress', onPress: () => setSort('progress') },
    { key: 'sort-recent', label: 'Sort by recently read', icon: 'sort', selected: sort === 'recent', onPress: () => setSort('recent') },
    { key: 'remove', label: `Remove “${series.name}”`, icon: 'trash', destructive: true, dividerBefore: true, onPress: () => removeSeries(series) },
  ] : [];

  return (
    <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>
      <AppBar colors={colors} isDark={isDark} topPad={insets.top + 8}>
        {selecting ? (
          <View style={s.barRow}>
            <IconButton icon="close" onPress={exitSelection} tint={colors.onSurface} label="Leave selection mode" />
            <Text style={[s.barTitle, { color: colors.onSurface }]}>
              {selection.length ? `${selection.length} selected` : 'Select volumes'}
            </Text>
            <IconButton
              icon="check"
              onPress={() => {
                Haptics.selectionAsync();
                setSelection(selection.length === filtered.length ? [] : filtered.map((volume) => volume.id));
              }}
              tint={colors.primary}
              label="Select all"
            />
            <IconButton
              icon="trash"
              onPress={() => void removeVolumes(selectedVolumes)}
              tint={selection.length ? colors.error : colors.tertiaryLabel}
              label="Remove selected"
            />
          </View>
        ) : searching ? (
          <View style={s.barRow}>
            <IconButton
              icon="chevronLeft"
              onPress={() => { setSearching(false); setQuery(''); }}
              tint={colors.onSurface}
              label="Close search"
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoFocus
              placeholder={series ? `Search ${series.name}` : 'Search'}
              placeholderTextColor={colors.tertiaryLabel}
              style={[s.searchInput, { color: colors.onSurface }]}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length ? <IconButton icon="close" onPress={() => setQuery('')} tint={colors.secondaryLabel} label="Clear search" /> : null}
          </View>
        ) : (
          <View style={s.barRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[s.title, { color: colors.onSurface }]}>{headerTitle}</Text>
              <Text numberOfLines={1} style={[s.subtitle, { color: colors.secondaryLabel }]}>{headerSub}</Text>
            </View>
            <IconButton icon="search" onPress={() => setSearching(true)} tint={colors.onSurface} label="Search library" />
            <IconButton
              icon={layout === 'grid' ? 'list' : 'grid'}
              onPress={() => { Haptics.selectionAsync(); setLayout((current) => (current === 'grid' ? 'list' : 'grid')); }}
              tint={colors.onSurface}
              label={layout === 'grid' ? 'Switch to list' : 'Switch to grid'}
            />
            <IconButton icon="more" onPress={() => setOverflowOpen(true)} tint={colors.onSurface} label="Library options" />
          </View>
        )}
      </AppBar>

      {loading ? <ScanBar colors={colors} /> : null}
      {loading && scanProgress ? (
        <View style={s.scanRow}>
          <ActivityIndicator size="small" color={colors.secondaryLabel} />
          <Text numberOfLines={1} style={[s.scanText, { color: colors.secondaryLabel }]}>{scanProgress}</Text>
        </View>
      ) : null}

      {!series ? (
        <SkeletonGrid colors={colors} />
      ) : (
        <FlatList
          data={filtered}
          key={String(layout)}
          keyExtractor={(volume) => volume.id}
          renderItem={renderVolume}
          numColumns={layout === 'grid' ? 2 : 1}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          // Fewer simultaneous mounts + longer batch window = no dropped frames
          // on mid-range Android. removeClippedSubviews recycles off-screen
          // cells (Android-only; it can blank on iOS).
          removeClippedSubviews={Platform.OS === 'android'}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={80}
          windowSize={7}
          initialNumToRender={10}
          contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: layout === 'grid' ? 20 : 8 }}
          columnWrapperStyle={layout === 'grid' ? { gap: 16 } : undefined}
          ListHeaderComponent={
            <View>
              {library.length > 1 ? (
                <View style={{ marginBottom: 18 }}>
                  <Text style={[s.sectionTitle, { color: colors.onSurface }]}>Shelves</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.shelfRail}>
                    {library.map((item) => {
                      const active = seriesKey(item) === seriesKey(series);
                      const cover = item.volumes.find((volume) => volume.coverUri)?.coverUri;
                      return (
                        <Pressable
                          key={seriesKey(item)}
                          onPress={() => { Haptics.selectionAsync(); setActiveSeriesUri(seriesKey(item)); setQuery(''); exitSelection(); }}
                          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setMenuSeries(item); }}
                          delayLongPress={260}
                          accessibilityRole="tab"
                          accessibilityState={{ selected: active }}
                          style={({ pressed }) => [
                            s.shelfChip,
                            {
                              backgroundColor: active ? colors.primaryContainer : colors.secondaryGroupedBackground,
                              borderColor: active ? colors.primary : colors.separator,
                              opacity: pressed ? 0.85 : 1,
                            },
                          ]}
                        >
                          <View style={[s.shelfCover, { backgroundColor: colors.tertiarySystemFill }]}>
                            {cover ? (
                              <Image source={{ uri: cover }} style={StyleSheet.absoluteFill as any} contentFit="cover" cachePolicy="memory-disk" transition={0} />
                            ) : (
                              <Icon name="book" size={14} color={colors.secondaryLabel} strokeWidth={1.7} />
                            )}
                          </View>
                          <View style={{ minWidth: 0, flexShrink: 1 }}>
                            <Text numberOfLines={1} style={[s.shelfName, { color: active ? colors.primary : colors.onSurface }]}>{item.name}</Text>
                            <Text style={[s.shelfMeta, { color: colors.secondaryLabel }]}>{item.volumes.length} volumes</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              {continueReading.length > 0 && !query && !selecting ? (
                <View style={{ marginBottom: 18 }}>
                  <Text style={[s.sectionTitle, { color: colors.onSurface }]}>Continue reading</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingRight: 16 }} snapToInterval={134} decelerationRate="fast">
                    {continueReading.map((volume) => (
                      <Pressable
                        key={volume.id}
                        onPress={() => openVolume(volume)}
                        onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setMenuVolume(volume); }}
                        delayLongPress={260}
                        style={({ pressed }) => [{ width: 120, opacity: pressed ? 0.86 : 1 }]}
                      >
                        <View style={[s.continueCover, { backgroundColor: colors.surfaceContainer, borderColor: colors.separator }]}>
                          <CoverArt volume={volume} isDark={isDark} radius={11} />
                          <View style={s.coverProgress}>
                            <View style={{ height: 3, backgroundColor: colors.primary, width: `${Math.max(3, Math.round((volume.progress ?? 0) * 100))}%` }} />
                          </View>
                        </View>
                        <Text numberOfLines={1} style={[s.cardTitle, { color: colors.onSurface }]}>{volume.title}</Text>
                        <Text numberOfLines={1} style={[s.cardSub, { color: colors.secondaryLabel }]}>{Math.round((volume.progress ?? 0) * 100)}% read</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {series.volumes.length > 2 ? (
                <View style={s.filterRow}>
                  <View style={[s.segmented, { backgroundColor: colors.secondarySystemFill }]}>
                    {(['all', 'reading', 'unread'] as Filter[]).map((option) => {
                      const active = filter === option;
                      return (
                        <Pressable
                          key={option}
                          onPress={() => { Haptics.selectionAsync(); setFilter(option); }}
                          style={[s.segItem, active && { backgroundColor: colors.secondaryGroupedBackground }]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[s.segText, { color: active ? colors.onSurface : colors.secondaryLabel }]}>
                            {option === 'all' ? 'All' : option === 'reading' ? 'Reading' : 'Unread'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={[s.countText, { color: colors.tertiaryLabel }]}>{filtered.length}</Text>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={s.listEmpty}>
              <Icon name="search" size={26} color={colors.tertiaryLabel} strokeWidth={1.7} />
              <Text style={[s.listEmptyText, { color: colors.secondaryLabel }]}>
                {query.trim()
                  ? `No volumes match “${query.trim()}”`
                  : filter === 'reading'
                    ? 'Nothing in progress yet'
                    : filter === 'unread'
                      ? 'Every volume has been started'
                      : 'No volumes here'}
              </Text>
            </View>
          }
        />
      )}

      {!selecting && !searching ? (
        <Pressable
          onPress={pickFolder}
          accessibilityRole="button"
          accessibilityLabel="Add folder"
          android_ripple={{ color: 'rgba(255,255,255,0.24)' }}
          style={({ pressed }) => [
            s.fab,
            { backgroundColor: colors.primary, bottom: snack ? 84 : 20, transform: [{ scale: pressed ? 0.94 : 1 }] },
          ]}
        >
          <Icon name="plus" size={24} color="#FFFFFF" strokeWidth={2.4} />
        </Pressable>
      ) : null}

      {snack ? (
        <Animated.View
          key={snack.id}
          entering={SlideInDown.springify().damping(24).stiffness(240)}
          style={[s.snack, { backgroundColor: colors.inverseSurface }]}
        >
          <Text numberOfLines={2} style={[s.snackText, { color: colors.inverseOnSurface }]}>{snack.text}</Text>
          {snack.undo ? (
            <Pressable onPress={() => { Haptics.selectionAsync(); snack.undo?.(); }} hitSlop={12}>
              <Text style={[s.snackAction, { color: colors.primary }]}>Undo</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}

      {menuVolume ? (
        <ActionSheet
          title={menuVolume.title}
          subtitle={menuVolume.pageCount ? `${menuVolume.pageCount} pages` : undefined}
          colors={colors}
          insetBottom={insets.bottom}
          onClose={() => setMenuVolume(null)}
          actions={[
            { key: 'open', label: (menuVolume.progress ?? 0) > 0 ? 'Continue reading' : 'Open', icon: 'bookOpen', onPress: () => openVolume(menuVolume) },
            { key: 'select', label: 'Select volumes', icon: 'check', onPress: () => { setSelecting(true); setSelection([menuVolume.id]); } },
            { key: 'remove', label: 'Remove from library', icon: 'trash', destructive: true, dividerBefore: true, onPress: () => void removeVolumes([menuVolume]) },
          ]}
        />
      ) : null}

      {menuSeries ? (
        <ActionSheet
          title={menuSeries.name}
          subtitle={`${menuSeries.volumes.length} volumes`}
          colors={colors}
          insetBottom={insets.bottom}
          onClose={() => setMenuSeries(null)}
          actions={[
            { key: 'show', label: 'Show this shelf', icon: 'library', onPress: () => { setActiveSeriesUri(seriesKey(menuSeries)); setQuery(''); } },
            { key: 'remove', label: 'Remove from library', icon: 'trash', destructive: true, dividerBefore: true, onPress: () => removeSeries(menuSeries) },
          ]}
        />
      ) : null}

      {overflowOpen && series ? (
        <ActionSheet
          title={series.name}
          subtitle={`${series.volumes.length} volumes · sorted by ${SORT_LABEL[sort]}`}
          colors={colors}
          insetBottom={insets.bottom}
          onClose={() => setOverflowOpen(false)}
          actions={overflowActions}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  // App bar
  appBar: { paddingHorizontal: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingLeft: 8 },
  title: { fontFamily: 'System', fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: 0.2 },
  subtitle: { fontFamily: 'System', fontSize: 13, lineHeight: 17, fontWeight: '400', marginTop: 1 },
  barTitle: { flex: 1, fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '600', marginLeft: 6 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  searchInput: { flex: 1, fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '400', paddingVertical: 0, marginLeft: 2 },

  // Scan feedback
  scanTrack: { height: 2.5, overflow: 'hidden' },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingTop: 10 },
  scanText: { flex: 1, fontFamily: 'System', fontSize: 12, lineHeight: 16 },

  // Sections
  sectionTitle: { fontFamily: 'System', fontSize: 15, lineHeight: 20, fontWeight: '700', letterSpacing: -0.2, marginBottom: 10 },
  shelfRail: { gap: 9, paddingRight: 16 },
  shelfChip: { maxWidth: 200, minWidth: 136, height: 56, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 9, borderCurve: 'continuous' as any },
  shelfCover: { width: 32, height: 42, borderRadius: 7, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  shelfName: { fontFamily: 'System', fontSize: 13, lineHeight: 17, fontWeight: '700', letterSpacing: -0.15 },
  shelfMeta: { fontFamily: 'System', fontSize: 11, lineHeight: 14, fontWeight: '400', fontVariant: ['tabular-nums'] as any },

  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  segmented: { flex: 1, flexDirection: 'row', borderRadius: 10, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: 'System', fontSize: 13, fontWeight: '600', letterSpacing: -0.08 },
  countText: { fontFamily: 'System', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] as any, minWidth: 22, textAlign: 'right' },

  // Grid card — no boxShadow on purpose: software shadows on 100+ scrolling
  // cards are a major Android frame-drop source. Depth comes from the border.
  cover: { aspectRatio: 0.72, borderRadius: 13, overflow: 'hidden', borderCurve: 'continuous' as any },
  coverInitial: { fontFamily: 'System', fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  coverProgress: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(120,120,128,0.32)' },
  pageBadge: { position: 'absolute', bottom: 10, left: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)' },
  pageBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600', letterSpacing: 0.2, fontVariant: ['tabular-nums'] as any },
  cardMenu: { position: 'absolute', top: 6, right: 6, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)' },
  cornerSlot: { position: 'absolute', top: 7, right: 7 },
  cardTitle: { fontFamily: 'System', fontSize: 13.5, lineHeight: 18, fontWeight: '600', letterSpacing: -0.08, marginTop: 8 },
  cardSub: { fontFamily: 'System', fontSize: 12, lineHeight: 16, fontWeight: '400', fontVariant: ['tabular-nums'] as any, marginTop: 1 },

  // List row
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, overflow: 'hidden', borderCurve: 'continuous' as any },
  listCover: { width: 46, height: 64, borderRadius: 8, overflow: 'hidden' },
  listTitle: { fontFamily: 'System', fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.3 },
  listSub: { fontFamily: 'System', fontSize: 13, lineHeight: 17, fontWeight: '400', fontVariant: ['tabular-nums'] as any },
  track: { height: 3, borderRadius: 1.5, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 1.5 },

  continueCover: { aspectRatio: 0.72, borderRadius: 11, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderCurve: 'continuous' as any },

  // Skeleton
  skeletonWrap: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 16 },
  skeletonCard: { width: '47%', gap: 8 },
  skeletonCover: { width: '100%', aspectRatio: 0.72, borderRadius: 13 },
  skeletonLine: { height: 10, borderRadius: 5 },

  // Empty states
  empty: { padding: 28, alignItems: 'center', gap: 14, paddingTop: 44 },
  heroIcon: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 26px rgba(0,0,0,0.22)', borderRadius: 22, borderCurve: 'continuous' as any },
  emptyTitle: { fontFamily: 'System', fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center', letterSpacing: 0.2 },
  emptyBody: { fontFamily: 'System', fontSize: 15, lineHeight: 21, fontWeight: '400', textAlign: 'center', maxWidth: 320, letterSpacing: -0.2 },
  emptyHint: { fontFamily: 'System', fontSize: 12, lineHeight: 16, textAlign: 'center', marginTop: 2 },
  primaryBtn: { marginTop: 8, flexDirection: 'row', gap: 8, paddingHorizontal: 24, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 6px 16px rgba(0,0,0,0.16)' },
  primaryBtnText: { fontFamily: 'System', fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.2, color: '#fff' },
  listEmpty: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 56 },
  listEmptyText: { fontFamily: 'System', fontSize: 15, lineHeight: 20, textAlign: 'center' },

  // Add-folder FAB
  fab: { position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderCurve: 'continuous' as any, boxShadow: '0 8px 20px rgba(0,0,0,0.24)', elevation: 6 },

  // Snackbar
  snack: { position: 'absolute', left: 12, right: 12, bottom: 20, minHeight: 48, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 16, borderCurve: 'continuous' as any, boxShadow: '0 8px 24px rgba(0,0,0,0.28)', elevation: 8 },
  snackText: { flex: 1, fontFamily: 'System', fontSize: 14, lineHeight: 19, fontWeight: '400' },
  snackAction: { fontFamily: 'System', fontSize: 14, lineHeight: 19, fontWeight: '700', letterSpacing: 0.2 },

  // Action sheet
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, borderCurve: 'continuous' as any },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 8, opacity: 0.6 },
  sheetHead: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, gap: 2 },
  sheetTitle: { fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3 },
  sheetSub: { fontFamily: 'System', fontSize: 13, lineHeight: 17, fontWeight: '400' },
  sheetDivider: { height: StyleSheet.hairlineWidth, marginVertical: 6, marginHorizontal: 20 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, minHeight: 52 },
  sheetItemText: { flex: 1, fontFamily: 'System', fontSize: 16, lineHeight: 21, fontWeight: '500', letterSpacing: -0.2 },
});
