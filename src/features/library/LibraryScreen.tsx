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
  for (let i = 0; i < seed.length; i++) hash = Math.trunc(hash * 31 + (seed.codePointAt(i) ?? 0));
  const hue = Math.abs(hash) % 360;
  if (isDark) {
    return `hsl(${hue}, 26%, 24%)`;
  }
  return `hsl(${hue}, 46%, 87%)`;
}

const TRAILING_NUMBER_RE = /(\d{1,4})\s*$/;

function coverInitial(title: string): string {
  const trailingNumber = TRAILING_NUMBER_RE.exec(title);
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

function volumeMetaText(pageCount: number, progress: number, pct: number): string {
  if (pageCount > 0) {
    if (progress > 0) {
      const suffix = ` · ${pct}%`;
      return `${pageCount} pages${suffix}`;
    }
    return `${pageCount} pages`;
  }
  if (progress > 0) {
    return `${pct}%`;
  }
  return 'Not started';
}

function filterOptionLabel(option: Filter): string {
  if (option === 'all') {
    return 'All';
  }
  if (option === 'reading') {
    return 'Reading';
  }
  return 'Unread';
}

function headerTitleFor(libraryLength: number, seriesName: string | undefined): string {
  if (libraryLength > 1) {
    return 'Library';
  }
  if (seriesName) {
    return seriesName;
  }
  return 'Library';
}

function headerSubFor(args: {
  hasSeries: boolean;
  libraryLength: number;
  libraryVolumeCount: number;
  volumeCount: number;
  totalPages: number;
}): string {
  if (!args.hasSeries) {
    return 'Scanning…';
  }
  if (args.libraryLength > 1) {
    return `${args.libraryLength} series · ${args.libraryVolumeCount} volumes`;
  }
  return `${args.volumeCount} volumes · ${args.totalPages.toLocaleString()} pages`;
}

function emptyListMessage(query: string, filter: Filter): string {
  if (query.trim()) {
    return `No volumes match “${query.trim()}”`;
  }
  if (filter === 'reading') {
    return 'Nothing in progress yet';
  }
  if (filter === 'unread') {
    return 'Every volume has been started';
  }
  return 'No volumes here';
}

type PressConfig = {
  onPress: () => void;
  onLongPress: () => void;
  delayLongPress: number;
  accessibilityRole: 'button';
  accessibilityLabel: string;
  accessibilityState: { selected: boolean };
};

function makeVolumePress(volume: Volume, selected: boolean, onPress: (v: Volume) => void, onLongPress: (v: Volume) => void): PressConfig {
  return {
    onPress: () => onPress(volume),
    onLongPress: () => onLongPress(volume),
    delayLongPress: 260,
    accessibilityRole: 'button' as const,
    accessibilityLabel: volume.title,
    accessibilityState: { selected },
  };
}

const VolumeCard = React.memo(function VolumeCard({ volume, colors, isDark, layout, selecting, selected, onPress, onLongPress, onMenu }: VolumeCardProps) {
  const progress = volume.progress ?? 0;
  const pct = Math.round(progress * 100);
  const meta = volumeMetaText(volume.pageCount, progress, pct);
  // NOTE: no Reanimated shared values here on purpose. The old per-card scale
  // animation kept 100+ animated nodes alive and remounted them on every scroll
  // frame — the main source of the "large list slow to update" warning.
  // Pressable opacity feedback is free by comparison.
  const press = makeVolumePress(volume, selected, onPress, onLongPress);

  if (layout === 'list') {
    return (
      <VolumeListCard
        volume={volume}
        colors={colors}
        isDark={isDark}
        selecting={selecting}
        selected={selected}
        progress={progress}
        pct={pct}
        meta={meta}
        press={press}
        onMenu={onMenu}
      />
    );
  }

  return (
    <VolumeGridCard
      volume={volume}
      colors={colors}
      isDark={isDark}
      selecting={selecting}
      selected={selected}
      progress={progress}
      pct={pct}
      meta={meta}
      press={press}
      onMenu={onMenu}
    />
  );
}, volumeCardEqual);

function VolumeListCard({ volume, colors, isDark, selecting, selected, progress, pct, meta, press, onMenu }: {
  readonly volume: Volume;
  readonly colors: any;
  readonly isDark: boolean;
  readonly selecting: boolean;
  readonly selected: boolean;
  readonly progress: number;
  readonly pct: number;
  readonly meta: string;
  readonly press: PressConfig;
  readonly onMenu: (volume: Volume) => void;
}) {
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

function VolumeGridCard({ volume, colors, isDark, selecting, selected, progress, pct, meta, press, onMenu }: {
  readonly volume: Volume;
  readonly colors: any;
  readonly isDark: boolean;
  readonly selecting: boolean;
  readonly selected: boolean;
  readonly progress: number;
  readonly pct: number;
  readonly meta: string;
  readonly press: PressConfig;
  readonly onMenu: (volume: Volume) => void;
}) {
  return (
    <Pressable {...press} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.86 : 1 }]}>
      <View style={{ flex: 1 }}>
        <VolumeGridCover volume={volume} colors={colors} isDark={isDark} selecting={selecting} selected={selected} progress={progress} pct={pct} onMenu={onMenu} />
        <Text numberOfLines={1} style={[s.cardTitle, { color: colors.onSurface }]}>{volume.title}</Text>
        <Text numberOfLines={1} style={[s.cardSub, { color: colors.secondaryLabel }]}>{meta}</Text>
      </View>
    </Pressable>
  );
}

function VolumeGridCover({ volume, colors, isDark, selecting, selected, progress, pct, onMenu }: {
  readonly volume: Volume;
  readonly colors: any;
  readonly isDark: boolean;
  readonly selecting: boolean;
  readonly selected: boolean;
  readonly progress: number;
  readonly pct: number;
  readonly onMenu: (volume: Volume) => void;
}) {
  return (
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
  );
}

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
function AppBar({ colors, isDark, topPad, children }: { readonly colors: any; readonly isDark: boolean; readonly topPad: number; readonly children: React.ReactNode }) {
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

function filterHydratedToLive(latest: Series[], hydrated: Series[]): Series[] {
  const live = new Set(latest.map(seriesKey));
  return hydrated.filter((item) => live.has(seriesKey(item)));
}

function mergeHydratedIntoLibrary(latest: Series[], hydrated: Series[]): Series[] {
  return mergeSeries(latest, filterHydratedToLive(latest, hydrated));
}

function refreshLibraryOnFocus(
  libraryRef: React.RefObject<Series[]>,
  setLibrary: React.Dispatch<React.SetStateAction<Series[]>>
): void {
  const current = libraryRef.current;
  if (!current.length) {
    return;
  }
  void withSavedProgress(current).then((hydrated) => {
    setLibrary((latest) => mergeHydratedIntoLibrary(latest, hydrated));
  });
}

function applyProgressFilter(list: Volume[], filter: Filter): Volume[] {
  if (filter === 'reading') {
    return list.filter((v) => (v.progress ?? 0) > 0 && (v.progress ?? 0) < 1);
  }
  if (filter === 'unread') {
    return list.filter((v) => !(v.progress ?? 0));
  }
  return list;
}

function applyQueryFilter(list: Volume[], deferredQuery: string): Volume[] {
  const q = deferredQuery.trim().toLowerCase();
  if (!q) {
    return list;
  }
  return list.filter((v) => v.title.toLowerCase().includes(q));
}

function sortVolumeList(list: Volume[], sort: Sort): Volume[] {
  if (sort === 'progress') {
    list.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
    return list;
  }
  if (sort === 'recent') {
    list.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
    return list;
  }
  list.sort(compareTitle);
  return list;
}

function getFilteredVolumes(series: Series | null, deferredQuery: string, filter: Filter, sort: Sort): Volume[] {
  if (!series) {
    return [];
  }
  const base = [...series.volumes];
  const byState = applyProgressFilter(base, filter);
  const byQuery = applyQueryFilter(byState, deferredQuery);
  return sortVolumeList(byQuery, sort);
}

function getContinueReading(series: Series | null): Volume[] {
  if (!series) {
    return [];
  }
  return [...series.volumes]
    .filter((v) => (v.progress ?? 0) > 0 && (v.progress ?? 0) < 1)
    .sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
    .slice(0, 8);
}

function getLibraryVolumeCount(library: Series[]): number {
  return library.reduce((count, item) => count + item.volumes.length, 0);
}

function getSelectedVolumes(series: Series | null, selectionSet: Set<string>): Volume[] {
  if (!series) {
    return [];
  }
  return series.volumes.filter((volume) => selectionSet.has(volume.id));
}

function selectionTitle(selectionLength: number): string {
  if (selectionLength > 0) {
    return `${selectionLength} selected`;
  }
  return 'Select volumes';
}

function searchPlaceholder(seriesName: string | undefined): string {
  if (seriesName) {
    return `Search ${seriesName}`;
  }
  return 'Search';
}

function toggleIdInSelection(current: string[], id: string): string[] {
  if (current.includes(id)) {
    return current.filter((item) => item !== id);
  }
  return [...current, id];
}

function removeVolumesFromLibrary(current: Series[], idSet: Set<string>): Series[] {
  return current
    .map((item) =>
      item.volumes.some((volume) => idSet.has(volume.id))
        ? recount(item, item.volumes.filter((volume) => !idSet.has(volume.id)))
        : item
    )
    .filter((item) => item.volumes.length > 0);
}

function removeSnackText(volumes: Volume[]): string {
  if (volumes.length === 1) {
    return `Removed “${volumes[0].title}”`;
  }
  return `Removed ${volumes.length} volumes`;
}

function decodeRootName(raw: string, fallback: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return fallback;
  }
}

async function resolveRootDisplayName(uri: string, fallback: string): Promise<string> {
  let name = fallback;
  try {
    name = new Directory(uri).name || name;
  } catch {
    // Keep fallback.
  }
  return decodeRootName(name, fallback);
}

type ScanRefs = {
  goneRef: React.RefObject<boolean>;
  libraryRef: React.RefObject<Series[]>;
  removedRef: React.RefObject<Set<string>>;
};

async function scanOneRoot(
  uri: string,
  refs: ScanRefs,
  setScanProgress: (v: string) => void,
  setLoading: (v: boolean) => void,
  absorb: (incoming: Series[]) => void
): Promise<void> {
  if (refs.goneRef.current) {
    return;
  }
  const name = await resolveRootDisplayName(uri, 'Manga');
  try {
    const found = await scanLibrary(
      uri,
      name,
      (seriesName, done, total) => {
        if (!refs.goneRef.current) {
          setScanProgress(`${seriesName} · ${done}/${total} folders`);
        }
      },
      (draft) => {
        if (refs.goneRef.current) {
          return;
        }
        absorb(draft);
        if (draft.length) {
          setLoading(false);
        }
      }
    );
    const hydrated = await withSavedProgress(found);
    if (!refs.goneRef.current) {
      absorb(hydrated);
    }
  } catch (error) {
    console.warn('[Library] scan root failed', uri, error);
  }
}

function buildOverflowActions(args: {
  series: Series;
  sort: Sort;
  removedCount: number;
  onAdd: () => void;
  onSelect: () => void;
  onRescan: () => void;
  onRestore: () => void;
  onSort: (s: Sort) => void;
  onRemove: (s: Series) => void;
}): SheetAction[] {
  const { series, sort, removedCount, onAdd, onSelect, onRescan, onRestore, onSort, onRemove } = args;
  const actions: SheetAction[] = [
    { key: 'add', label: 'Add folder…', icon: 'plus', onPress: onAdd },
    { key: 'select', label: 'Select volumes', icon: 'check', onPress: onSelect },
    { key: 'rescan', label: 'Rescan folders', icon: 'reload', onPress: onRescan },
  ];
  if (removedCount > 0) {
    actions.push({ key: 'restore', label: 'Restore removed manga', icon: 'repeat' as IconName, onPress: onRestore });
  }
  actions.push(
    { key: 'sort-title', label: 'Sort by name', icon: 'sort', selected: sort === 'title', dividerBefore: true, onPress: () => onSort('title') },
    { key: 'sort-progress', label: 'Sort by progress', icon: 'sort', selected: sort === 'progress', onPress: () => onSort('progress') },
    { key: 'sort-recent', label: 'Sort by recently read', icon: 'sort', selected: sort === 'recent', onPress: () => onSort('recent') },
    { key: 'remove', label: `Remove “${series.name}”`, icon: 'trash', destructive: true, dividerBefore: true, onPress: () => onRemove(series) }
  );
  return actions;
}

function menuVolumeActions(volume: Volume, openVolume: (v: Volume) => void, onSelectVolume: (v: Volume) => void, onRemoveVolumes: (v: Volume[]) => void): SheetAction[] {
  let openLabel = 'Open';
  if ((volume.progress ?? 0) > 0) {
    openLabel = 'Continue reading';
  }
  return [
    { key: 'open', label: openLabel, icon: 'bookOpen', onPress: () => openVolume(volume) },
    { key: 'select', label: 'Select volumes', icon: 'check', onPress: () => onSelectVolume(volume) },
    { key: 'remove', label: 'Remove from library', icon: 'trash', destructive: true, dividerBefore: true, onPress: () => { onRemoveVolumes([volume]); } },
  ];
}

const PICK_CANCEL_RE = /cancelled|canceled|abort|dismiss/i;

async function pickDirectoryOrNull(): Promise<{ uri: string; name?: string | null } | null> {
  try {
    // Expo SDK 57+: system folder picker (SAF on Android, UIDocumentPicker on iOS).
    // Throws when the user dismisses — treat that as a silent cancel.
    const dir = await Directory.pickDirectoryAsync();
    if (!dir?.uri) {
      return null;
    }
    return dir;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (PICK_CANCEL_RE.test(msg)) {
      return null;
    }
    console.warn('pickFolder pick', e);
    Alert.alert('Could not open picker', msg);
    return null;
  }
}

function pickScanProgressText(activeName: string, done: number, totalDirs: number): string {
  if (totalDirs > 0) {
    return `${activeName} · ${done}/${totalDirs} folders`;
  }
  return activeName;
}

async function persistPickedRoot(uri: string, removedRef: React.RefObject<Set<string>>, setRemoved: (n: Set<string>) => void): Promise<void> {
  try {
    await saveRoot(uri);
  } catch {
    // Best effort.
  }
  // Re-adding a folder is an explicit undo of a previous removal.
  setRemoved(await restoreRemoved([uri]).catch(() => removedRef.current));
}

async function scanPickedDirectory(
  uri: string,
  seriesName: string,
  absorb: (incoming: Series[]) => void,
  setScanProgress: (v: string) => void,
  setLoading: (v: boolean) => void
): Promise<Series[]> {
  return scanLibrary(
    uri,
    seriesName,
    (activeName, done, totalDirs) => {
      setScanProgress(pickScanProgressText(activeName, done, totalDirs));
    },
    (detected) => {
      // Instant UI: shells (all pageCount 0) show names right after the
      // 1 root listing; snapshots (counts > 0) stream in behind.
      // Either way, stop showing the spinner — the library is visible.
      absorb(detected);
      setLoading(false);
    }
  );
}

function markVolumeOpened(series: Series, volumeId: string): Series {
  return recount(
    series,
    series.volumes.map((item) => (item.id === volumeId ? { ...item, lastOpened: Date.now() } : item))
  );
}

type PickFolderDeps = {
  removedRef: React.RefObject<Set<string>>;
  setLoading: (v: boolean) => void;
  setScanProgress: (v: string) => void;
  setRemoved: (n: Set<string>) => void;
  setLibrary: React.Dispatch<React.SetStateAction<Series[]>>;
  setActiveSeriesUri: (v: string | null) => void;
  absorb: (incoming: Series[]) => void;
};

async function runPickFolderFlow(deps: PickFolderDeps): Promise<void> {
  await Haptics.selectionAsync();
  // 1) Pick — only THIS block treats cancel as silent.
  const dir = await pickDirectoryOrNull();
  if (!dir) {
    return;
  }
  await scanPickedRoot(dir, deps);
}

async function scanPickedRoot(dir: { uri: string; name?: string | null }, deps: PickFolderDeps): Promise<void> {
  console.log('[Library] picked', dir.uri, dir.name);
  // 2) Scan — NEVER silent. Any failure must surface, otherwise the user
  // is stuck on the empty box with zero feedback (the current bug).
  deps.setLoading(true);
  deps.setScanProgress('');
  // list() is sync native and blocks — let the spinner paint first.
  await new Promise((r) => setTimeout(r, 60));
  try {
    await persistPickedRoot(dir.uri, deps.removedRef, deps.setRemoved);
    const seriesName = decodeRootName(dir.name ?? 'Library', 'Library');
    const found = await scanPickedDirectory(dir.uri, seriesName, deps.absorb, deps.setScanProgress, deps.setLoading);
    await finishPickedScan(found, deps);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.warn('pickFolder scan', e);
    Alert.alert('Scan failed', msg);
  } finally {
    deps.setLoading(false);
    deps.setScanProgress('');
  }
}

async function finishPickedScan(found: Series[], deps: PickFolderDeps): Promise<void> {
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
  const visible = withoutRemoved(hydrated, deps.removedRef.current);
  deps.setLibrary((current) => mergeSeries(current, visible));
  deps.setActiveSeriesUri(visible[0]?.rootUri ?? null);
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

async function rescanAllRoots(
  refs: ScanRefs & { scanningRef: React.RefObject<boolean> },
  setLoading: (v: boolean) => void,
  setScanProgress: (v: string) => void,
  absorb: (incoming: Series[]) => void
): Promise<void> {
  if (refs.scanningRef.current) {
    return;
  }
  refs.scanningRef.current = true;
  setLoading(true);
  try {
    const roots = await getRoots().catch(() => [] as string[]);
    for (const uri of roots) {
      if (refs.goneRef.current) {
        break;
      }
      await scanOneRoot(uri, refs, setScanProgress, setLoading, absorb);
    }
    // Snapshot the finished scan so the next cold start paints instantly.
    if (!refs.goneRef.current) {
      saveLibraryIndex(refs.libraryRef.current, roots);
    }
  } finally {
    refs.scanningRef.current = false;
    setLoading(false);
    setScanProgress('');
  }
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

function SelectionAppBar({ colors, selectionLength, filteredIds, selectedVolumes, onExit, onSelectAll, onRemove }: {
  readonly colors: any;
  readonly selectionLength: number;
  readonly filteredIds: string[];
  readonly selectedVolumes: Volume[];
  readonly onExit: () => void;
  readonly onSelectAll: (ids: string[]) => void;
  readonly onRemove: (volumes: Volume[]) => void;
}) {
  return (
    <View style={s.barRow}>
      <IconButton icon="close" onPress={onExit} tint={colors.onSurface} label="Leave selection mode" />
      <Text style={[s.barTitle, { color: colors.onSurface }]}>{selectionTitle(selectionLength)}</Text>
      <IconButton
        icon="check"
        onPress={() => {
          Haptics.selectionAsync();
          onSelectAll(filteredIds);
        }}
        tint={colors.primary}
        label="Select all"
      />
      <IconButton
        icon="trash"
        onPress={() => { onRemove(selectedVolumes); }}
        tint={selectionLength ? colors.error : colors.tertiaryLabel}
        label="Remove selected"
      />
    </View>
  );
}

function SearchAppBar({ colors, query, seriesName, onClose, onQuery, onClear }: {
  readonly colors: any;
  readonly query: string;
  readonly seriesName: string | undefined;
  readonly onClose: () => void;
  readonly onQuery: (q: string) => void;
  readonly onClear: () => void;
}) {
  return (
    <View style={s.barRow}>
      <IconButton icon="chevronLeft" onPress={onClose} tint={colors.onSurface} label="Close search" />
      <TextInput
        value={query}
        onChangeText={onQuery}
        autoFocus
        placeholder={searchPlaceholder(seriesName)}
        placeholderTextColor={colors.tertiaryLabel}
        style={[s.searchInput, { color: colors.onSurface }]}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {query.length ? <IconButton icon="close" onPress={onClear} tint={colors.secondaryLabel} label="Clear search" /> : null}
    </View>
  );
}

function TitleAppBar({ colors, headerTitle, headerSub, layout, onSearch, onToggleLayout, onOverflow }: {
  readonly colors: any;
  readonly headerTitle: string;
  readonly headerSub: string;
  readonly layout: 'grid' | 'list';
  readonly onSearch: () => void;
  readonly onToggleLayout: () => void;
  readonly onOverflow: () => void;
}) {
  let layoutIcon: IconName = 'grid';
  if (layout === 'grid') {
    layoutIcon = 'list';
  }
  let layoutLabel = 'Switch to grid';
  if (layout === 'grid') {
    layoutLabel = 'Switch to list';
  }
  return (
    <View style={s.barRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[s.title, { color: colors.onSurface }]}>{headerTitle}</Text>
        <Text numberOfLines={1} style={[s.subtitle, { color: colors.secondaryLabel }]}>{headerSub}</Text>
      </View>
      <IconButton icon="search" onPress={onSearch} tint={colors.onSurface} label="Search library" />
      <IconButton icon={layoutIcon} onPress={onToggleLayout} tint={colors.onSurface} label={layoutLabel} />
      <IconButton icon="more" onPress={onOverflow} tint={colors.onSurface} label="Library options" />
    </View>
  );
}

function LibraryAppBarContent(args: {
  readonly selecting: boolean;
  readonly searching: boolean;
  readonly colors: any;
  readonly selection: string[];
  readonly filtered: Volume[];
  readonly selectedVolumes: Volume[];
  readonly query: string;
  readonly seriesName: string | undefined;
  readonly headerTitle: string;
  readonly headerSub: string;
  readonly layout: 'grid' | 'list';
  readonly onExitSelection: () => void;
  readonly onToggleSelectAll: (allSelected: boolean, filtered: Volume[]) => void;
  readonly onRemoveVolumes: (v: Volume[]) => void;
  readonly onCloseSearch: () => void;
  readonly onQuery: (q: string) => void;
  readonly onClearQuery: () => void;
  readonly onSearch: () => void;
  readonly onToggleLayout: () => void;
  readonly onOverflow: () => void;
}): React.ReactElement {
  if (args.selecting) {
    return (
      <SelectionAppBar
        colors={args.colors}
        selectionLength={args.selection.length}
        filteredIds={args.filtered.map((volume) => volume.id)}
        selectedVolumes={args.selectedVolumes}
        onExit={args.onExitSelection}
        onSelectAll={() => args.onToggleSelectAll(args.selection.length === args.filtered.length, args.filtered)}
        onRemove={args.onRemoveVolumes}
      />
    );
  }
  if (args.searching) {
    return (
      <SearchAppBar
        colors={args.colors}
        query={args.query}
        seriesName={args.seriesName}
        onClose={args.onCloseSearch}
        onQuery={args.onQuery}
        onClear={args.onClearQuery}
      />
    );
  }
  return (
    <TitleAppBar
      colors={args.colors}
      headerTitle={args.headerTitle}
      headerSub={args.headerSub}
      layout={args.layout}
      onSearch={args.onSearch}
      onToggleLayout={args.onToggleLayout}
      onOverflow={args.onOverflow}
    />
  );
}

function ShelvesSection({ library, series, colors, onSelectSeries, onMenuSeries }: {
  readonly library: Series[];
  readonly series: Series;
  readonly colors: any;
  readonly onSelectSeries: (item: Series) => void;
  readonly onMenuSeries: (item: Series) => void;
}) {
  if (library.length <= 1) {
    return null;
  }
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={[s.sectionTitle, { color: colors.onSurface }]}>Shelves</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.shelfRail}>
        {library.map((item) => (
          <ShelfChip key={seriesKey(item)} item={item} active={seriesKey(item) === seriesKey(series)} colors={colors} onSelect={onSelectSeries} onMenu={onMenuSeries} />
        ))}
      </ScrollView>
    </View>
  );
}

function ShelfChip({ item, active, colors, onSelect, onMenu }: {
  readonly item: Series;
  readonly active: boolean;
  readonly colors: any;
  readonly onSelect: (item: Series) => void;
  readonly onMenu: (item: Series) => void;
}) {
  const cover = item.volumes.find((volume) => volume.coverUri)?.coverUri;
  return (
    <Pressable
      key={seriesKey(item)}
      onPress={() => onSelect(item)}
      onLongPress={() => onMenu(item)}
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
}

function ContinueReadingSection({ volumes, colors, isDark, query, selecting, onOpen, onMenu }: {
  readonly volumes: Volume[];
  readonly colors: any;
  readonly isDark: boolean;
  readonly query: string;
  readonly selecting: boolean;
  readonly onOpen: (v: Volume) => void;
  readonly onMenu: (v: Volume) => void;
}) {
  if (volumes.length === 0 || query || selecting) {
    return null;
  }
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={[s.sectionTitle, { color: colors.onSurface }]}>Continue reading</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingRight: 16 }} snapToInterval={134} decelerationRate="fast">
        {volumes.map((volume) => (
          <ContinueReadingCard key={volume.id} volume={volume} colors={colors} isDark={isDark} onOpen={onOpen} onMenu={onMenu} />
        ))}
      </ScrollView>
    </View>
  );
}

function ContinueReadingCard({ volume, colors, isDark, onOpen, onMenu }: {
  readonly volume: Volume;
  readonly colors: any;
  readonly isDark: boolean;
  readonly onOpen: (v: Volume) => void;
  readonly onMenu: (v: Volume) => void;
}) {
  return (
    <Pressable
      key={volume.id}
      onPress={() => onOpen(volume)}
      onLongPress={() => onMenu(volume)}
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
  );
}

function FilterSection({ volumeCount, filter, colors, filteredLength, onFilter }: {
  readonly volumeCount: number;
  readonly filter: Filter;
  readonly colors: any;
  readonly filteredLength: number;
  readonly onFilter: (f: Filter) => void;
}) {
  if (volumeCount <= 2) {
    return null;
  }
  return (
    <View style={s.filterRow}>
      <View style={[s.segmented, { backgroundColor: colors.secondarySystemFill }]}>
        {(['all', 'reading', 'unread'] as Filter[]).map((option) => (
          <FilterChip key={option} option={option} active={filter === option} colors={colors} onFilter={onFilter} />
        ))}
      </View>
      <Text style={[s.countText, { color: colors.tertiaryLabel }]}>{filteredLength}</Text>
    </View>
  );
}

function FilterChip({ option, active, colors, onFilter }: {
  readonly option: Filter;
  readonly active: boolean;
  readonly colors: any;
  readonly onFilter: (f: Filter) => void;
}) {
  return (
    <Pressable
      key={option}
      onPress={() => onFilter(option)}
      style={[s.segItem, active && { backgroundColor: colors.secondaryGroupedBackground }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[s.segText, { color: active ? colors.onSurface : colors.secondaryLabel }]}>
        {filterOptionLabel(option)}
      </Text>
    </Pressable>
  );
}

function EmptyVolumesView({ query, filter, colors }: {
  readonly query: string;
  readonly filter: Filter;
  readonly colors: any;
}) {
  return (
    <View style={s.listEmpty}>
      <Icon name="search" size={26} color={colors.tertiaryLabel} strokeWidth={1.7} />
      <Text style={[s.listEmptyText, { color: colors.secondaryLabel }]}>
        {emptyListMessage(query, filter)}
      </Text>
    </View>
  );
}

function removeSeriesDetail(target: Series): string {
  if (target.volumes.length === 1) {
    return `${target.volumes.length} volume will leave your library. Nothing is deleted from this device.`;
  }
  return `${target.volumes.length} volumes will leave your library. Nothing is deleted from this device.`;
}

function buildOverflowActionsOrEmpty(
  series: Series | null,
  sort: Sort,
  removedCount: number,
  callbacks: {
    onAdd: () => void;
    onSelect: () => void;
    onRescan: () => void;
    onRestore: () => void;
    onSort: (s: Sort) => void;
    onRemove: (s: Series) => void;
  }
): SheetAction[] {
  if (!series) {
    return [];
  }
  return buildOverflowActions({ series, sort, removedCount, ...callbacks });
}

function toggleLayoutValue(current: 'grid' | 'list'): 'grid' | 'list' {
  if (current === 'grid') {
    return 'list';
  }
  return 'grid';
}

function shouldShowOnboarding(series: Series | null, loading: boolean): boolean {
  if (!series && !loading) {
    return true;
  }
  return false;
}

type RemoveSeriesDeps = {
  libraryRef: React.RefObject<Series[]>;
  activeSeriesUri: string | null;
  exitSelection: () => void;
  setLibrary: React.Dispatch<React.SetStateAction<Series[]>>;
  setActiveSeriesUri: (v: string | null) => void;
  setRemoved: (n: Set<string>) => void;
  setSnack: (s: SnackState) => void;
  showSnack: (text: string, undo?: () => void) => void;
};

async function performRemoveSeries(target: Series, deps: RemoveSeriesDeps): Promise<void> {
  const snapshot = deps.libraryRef.current;
  const previousActive = deps.activeSeriesUri;
  const rest = snapshot.filter((item) => seriesKey(item) !== seriesKey(target));
  const sourceRoot = target.sourceRootUri ?? target.rootUri;
  // Only forget the granted folder when no other shelf still needs it.
  const rootStillUsed = rest.some((item) => (item.sourceRootUri ?? item.rootUri) === sourceRoot);
  deps.exitSelection();
  deps.setLibrary(rest);
  if (rest.length) {
    deps.setActiveSeriesUri(seriesKey(rest[0]));
  } else {
    deps.setActiveSeriesUri(null);
  }
  deps.setRemoved(await markRemoved([target.rootUri]));
  if (!rootStillUsed) {
    await removeRoot(sourceRoot).catch(() => {});
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  deps.showSnack(`Removed “${target.name}”`, () => {
    void restoreRemoved([target.rootUri]).then(deps.setRemoved);
    if (!rootStillUsed) {
      void saveRoot(sourceRoot).catch(() => {});
    }
    deps.setLibrary(snapshot);
    deps.setActiveSeriesUri(previousActive);
    deps.setSnack(null);
  });
}

function confirmRemoveSeries(target: Series, deps: RemoveSeriesDeps): void {
  Alert.alert(`Remove “${target.name}”?`, removeSeriesDetail(target), [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Remove',
      style: 'destructive',
      onPress: () => void performRemoveSeries(target, deps),
    },
  ]);
}

function OnboardingView({ colors, topPad, onPick }: {
  readonly colors: any;
  readonly topPad: number;
  readonly onPick: () => void;
}) {
  return (
    <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>
      <AppBar colors={colors} isDark={false} topPad={topPad}>
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
          onPress={onPick}
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
    await rescanAllRoots({ goneRef, libraryRef, removedRef, scanningRef }, setLoading, setScanProgress, absorb);
  }, [absorb]);

  const restoreCachedLibrary = useCallback(async () => {
    setRemoved(await loadRemoved().catch(() => new Set<string>()));
    // Show the last known shelf first — covers and page counts included —
    // then let the live scan below reconcile. absorb() still applies the
    // removal set, so hidden series cannot return from the cache.
    const roots = await getRoots().catch(() => [] as string[]);
    if (roots.length && !goneRef.current) {
      const cached = await loadLibraryIndex(roots);
      if (cached.length && !goneRef.current) {
        absorb(await withSavedProgress(cached));
      }
    }
    await rescan();
  }, [absorb, rescan, setRemoved]);

  useEffect(() => {
    if (restored.current) {
      return;
    }
    restored.current = true;
    void restoreCachedLibrary();
  }, [restoreCachedLibrary]);

  useEffect(() => nav.addListener('focus', () => refreshLibraryOnFocus(libraryRef, setLibrary)), [nav]);

  const pickFolder = useCallback(async () => {
    await runPickFolderFlow({ removedRef, setLoading, setScanProgress, setRemoved, setLibrary, setActiveSeriesUri, absorb });
  }, [absorb, setRemoved]);

  const openVolume = useCallback((volume: Volume) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (series) {
      const next = markVolumeOpened(series, volume.id);
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
    setSelection((current) => toggleIdInSelection(current, id));
  }, []);

  // Stable volume-keyed handlers so memoised VolumeCards keep their props
  // identity across list re-renders. Inline closures here would defeat memo.
  const handlePressVolume = useCallback((volume: Volume) => {
    if (selecting) {
      toggleSelected(volume.id);
      return;
    }
    openVolume(volume);
  }, [selecting, toggleSelected, openVolume]);

  const handleLongPressVolume = useCallback((volume: Volume) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (selecting) {
      toggleSelected(volume.id);
      return;
    }
    setSelecting(true);
    setSelection([volume.id]);
  }, [selecting, toggleSelected]);

  const handleMenuVolume = useCallback((volume: Volume) => {
    Haptics.selectionAsync();
    setMenuVolume(volume);
  }, []);

  // Removing never touches the files on disk — it only hides them, and the
  // choice is persisted so the next scan does not bring them back.
  const removeVolumes = useCallback(async (volumes: Volume[]) => {
    if (!volumes.length) {
      return;
    }
    const ids = volumes.map((volume) => volume.id);
    const idSet = new Set(ids);
    const snapshot = libraryRef.current;
    const previousActive = activeSeriesUri;
    exitSelection();
    setLibrary((current) => removeVolumesFromLibrary(current, idSet));
    setRemoved(await markRemoved(ids));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    showSnack(removeSnackText(volumes), () => {
      void restoreRemoved(ids).then(setRemoved);
      setLibrary(snapshot);
      setActiveSeriesUri(previousActive);
      setSnack(null);
    });
  }, [activeSeriesUri, exitSelection, setRemoved, showSnack]);

  const removeSeries = useCallback((target: Series) => {
    confirmRemoveSeries(target, {
      libraryRef,
      activeSeriesUri,
      exitSelection,
      setLibrary,
      setActiveSeriesUri,
      setRemoved,
      setSnack,
      showSnack,
    });
  }, [activeSeriesUri, exitSelection, setRemoved, showSnack]);

  const restoreEverything = useCallback(async () => {
    setRemoved(await clearRemoved());
    await rescan();
    showSnack('Restored removed manga');
  }, [rescan, setRemoved, showSnack]);

  const filtered = useMemo(() => getFilteredVolumes(series, deferredQuery, filter, sort), [series, deferredQuery, filter, sort]);

  const continueReading = useMemo(() => getContinueReading(series), [series]);

  const libraryVolumeCount = useMemo(() => getLibraryVolumeCount(library), [library]);

  const selectedVolumes = useMemo(() => getSelectedVolumes(series, selectionSet), [series, selectionSet]);

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
  if (shouldShowOnboarding(series, loading)) {
    return <OnboardingView colors={colors} topPad={insets.top + 10} onPick={pickFolder} />;
  }

  const headerTitle = headerTitleFor(library.length, series?.name);
  const headerSub = headerSubFor({
    hasSeries: !!series,
    libraryLength: library.length,
    libraryVolumeCount,
    volumeCount: series?.volumes.length ?? 0,
    totalPages: series?.totalPages ?? 0,
  });

  const overflowActions: SheetAction[] = buildOverflowActionsOrEmpty(series, sort, removedCount, {
    onAdd: () => void pickFolder(),
    onSelect: () => setSelecting(true),
    onRescan: () => void rescan(),
    onRestore: () => void restoreEverything(),
    onSort: (next) => setSort(next),
    onRemove: (target) => removeSeries(target),
  });

  const handleToggleSelectAll = (allSelected: boolean, list: Volume[]) => {
    Haptics.selectionAsync();
    if (allSelected) {
      setSelection([]);
    } else {
      setSelection(list.map((volume) => volume.id));
    }
  };

  const handleCloseSearch = () => {
    setSearching(false);
    setQuery('');
  };

  const handleToggleLayout = () => {
    Haptics.selectionAsync();
    setLayout((current) => toggleLayoutValue(current));
  };

  const handleSelectSeries = (item: Series) => {
    Haptics.selectionAsync();
    setActiveSeriesUri(seriesKey(item));
    setQuery('');
    exitSelection();
  };

  const handleLongPressSeries = (item: Series) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenuSeries(item);
  };

  const handleSelectVolumeForMenu = (volume: Volume) => {
    setSelecting(true);
    setSelection([volume.id]);
  };

  return (
    <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>
      <AppBar colors={colors} isDark={isDark} topPad={insets.top + 8}>
        <LibraryAppBarContent
          selecting={selecting}
          searching={searching}
          colors={colors}
          selection={selection}
          filtered={filtered}
          selectedVolumes={selectedVolumes}
          query={query}
          seriesName={series?.name}
          headerTitle={headerTitle}
          headerSub={headerSub}
          layout={layout}
          onExitSelection={exitSelection}
          onToggleSelectAll={handleToggleSelectAll}
          onRemoveVolumes={(volumes) => void removeVolumes(volumes)}
          onCloseSearch={handleCloseSearch}
          onQuery={setQuery}
          onClearQuery={() => setQuery('')}
          onSearch={() => setSearching(true)}
          onToggleLayout={handleToggleLayout}
          onOverflow={() => setOverflowOpen(true)}
        />
      </AppBar>

      <LibraryScanStatus loading={loading} scanProgress={scanProgress} colors={colors} />

      <LibraryMainContent
        series={series}
        filtered={filtered}
        layout={layout}
        colors={colors}
        isDark={isDark}
        library={library}
        continueReading={continueReading}
        query={query}
        selecting={selecting}
        filter={filter}
        openVolume={openVolume}
        renderVolume={renderVolume}
        onSelectSeries={handleSelectSeries}
        onMenuSeries={handleLongPressSeries}
        onMenuVolume={setMenuVolume}
        onFilter={(next) => {
          Haptics.selectionAsync();
          setFilter(next);
        }}
      />

      <LibraryFab selecting={selecting} searching={searching} colors={colors} snackVisible={!!snack} onPick={pickFolder} />

      <LibrarySnack snack={snack} colors={colors} />

      <LibraryDialogs
        menuVolume={menuVolume}
        menuSeries={menuSeries}
        overflowOpen={overflowOpen}
        series={series}
        sort={sort}
        colors={colors}
        bottomInset={insets.bottom}
        overflowActions={overflowActions}
        onCloseMenuVolume={() => setMenuVolume(null)}
        onCloseMenuSeries={() => setMenuSeries(null)}
        onCloseOverflow={() => setOverflowOpen(false)}
        openVolume={openVolume}
        onSelectVolumeForMenu={handleSelectVolumeForMenu}
        onRemoveVolumes={(volumes) => void removeVolumes(volumes)}
        onShowShelf={(target) => {
          setActiveSeriesUri(seriesKey(target));
          setQuery('');
        }}
        onRemoveSeries={(target) => removeSeries(target)}
      />
    </View>
  );
}

function LibraryDialogs({ menuVolume, menuSeries, overflowOpen, series, sort, colors, bottomInset, overflowActions, onCloseMenuVolume, onCloseMenuSeries, onCloseOverflow, openVolume, onSelectVolumeForMenu, onRemoveVolumes, onShowShelf, onRemoveSeries }: {
  readonly menuVolume: Volume | null;
  readonly menuSeries: Series | null;
  readonly overflowOpen: boolean;
  readonly series: Series | null;
  readonly sort: Sort;
  readonly colors: any;
  readonly bottomInset: number;
  readonly overflowActions: SheetAction[];
  readonly onCloseMenuVolume: () => void;
  readonly onCloseMenuSeries: () => void;
  readonly onCloseOverflow: () => void;
  readonly openVolume: (v: Volume) => void;
  readonly onSelectVolumeForMenu: (v: Volume) => void;
  readonly onRemoveVolumes: (v: Volume[]) => void;
  readonly onShowShelf: (s: Series) => void;
  readonly onRemoveSeries: (s: Series) => void;
}): React.ReactElement {
  return (
    <>
      <VolumeDialog menuVolume={menuVolume} colors={colors} bottomInset={bottomInset} onClose={onCloseMenuVolume} openVolume={openVolume} onSelectVolume={onSelectVolumeForMenu} onRemoveVolumes={onRemoveVolumes} />
      <SeriesDialog menuSeries={menuSeries} colors={colors} bottomInset={bottomInset} onClose={onCloseMenuSeries} onShowShelf={onShowShelf} onRemoveSeries={onRemoveSeries} />
      <OverflowDialog overflowOpen={overflowOpen} series={series} sort={sort} colors={colors} bottomInset={bottomInset} onClose={onCloseOverflow} overflowActions={overflowActions} />
    </>
  );
}

function VolumeDialog({ menuVolume, colors, bottomInset, onClose, openVolume, onSelectVolume, onRemoveVolumes }: {
  readonly menuVolume: Volume | null;
  readonly colors: any;
  readonly bottomInset: number;
  readonly onClose: () => void;
  readonly openVolume: (v: Volume) => void;
  readonly onSelectVolume: (v: Volume) => void;
  readonly onRemoveVolumes: (v: Volume[]) => void;
}): React.ReactElement | null {
  if (!menuVolume) {
    return null;
  }
  return (
    <ActionSheet
      title={menuVolume.title}
      subtitle={menuVolume.pageCount ? `${menuVolume.pageCount} pages` : undefined}
      colors={colors}
      insetBottom={bottomInset}
      onClose={onClose}
      actions={menuVolumeActions(menuVolume, openVolume, onSelectVolume, (volumes) => { onRemoveVolumes(volumes); })}
    />
  );
}

function SeriesDialog({ menuSeries, colors, bottomInset, onClose, onShowShelf, onRemoveSeries }: {
  readonly menuSeries: Series | null;
  readonly colors: any;
  readonly bottomInset: number;
  readonly onClose: () => void;
  readonly onShowShelf: (s: Series) => void;
  readonly onRemoveSeries: (s: Series) => void;
}): React.ReactElement | null {
  if (!menuSeries) {
    return null;
  }
  return (
    <ActionSheet
      title={menuSeries.name}
      subtitle={`${menuSeries.volumes.length} volumes`}
      colors={colors}
      insetBottom={bottomInset}
      onClose={onClose}
      actions={[
        { key: 'show', label: 'Show this shelf', icon: 'library', onPress: () => onShowShelf(menuSeries) },
        { key: 'remove', label: 'Remove from library', icon: 'trash', destructive: true, dividerBefore: true, onPress: () => onRemoveSeries(menuSeries) },
      ]}
    />
  );
}

function OverflowDialog({ overflowOpen, series, sort, colors, bottomInset, onClose, overflowActions }: {
  readonly overflowOpen: boolean;
  readonly series: Series | null;
  readonly sort: Sort;
  readonly colors: any;
  readonly bottomInset: number;
  readonly onClose: () => void;
  readonly overflowActions: SheetAction[];
}): React.ReactElement | null {
  if (!overflowOpen || !series) {
    return null;
  }
  return (
    <ActionSheet
      title={series.name}
      subtitle={`${series.volumes.length} volumes · sorted by ${SORT_LABEL[sort]}`}
      colors={colors}
      insetBottom={bottomInset}
      onClose={onClose}
      actions={overflowActions}
    />
  );
}

function LibraryFab({ selecting, searching, colors, snackVisible, onPick }: {
  readonly selecting: boolean;
  readonly searching: boolean;
  readonly colors: any;
  readonly snackVisible: boolean;
  readonly onPick: () => void;
}) {
  if (selecting || searching) {
    return null;
  }
  return (
    <Pressable
      onPress={onPick}
      accessibilityRole="button"
      accessibilityLabel="Add folder"
      android_ripple={{ color: 'rgba(255,255,255,0.24)' }}
      style={({ pressed }) => [
        s.fab,
        { backgroundColor: colors.primary, bottom: snackVisible ? 84 : 20, transform: [{ scale: pressed ? 0.94 : 1 }] },
      ]}
    >
      <Icon name="plus" size={24} color="#FFFFFF" strokeWidth={2.4} />
    </Pressable>
  );
}

function LibrarySnack({ snack, colors }: {
  readonly snack: SnackState;
  readonly colors: any;
}) {
  if (!snack) {
    return null;
  }
  return (
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
  );
}

function LibraryScanStatus({ loading, scanProgress, colors }: {
  readonly loading: boolean;
  readonly scanProgress: string;
  readonly colors: any;
}): React.ReactElement | null {
  if (!loading) {
    return null;
  }
  if (!scanProgress) {
    return <ScanBar colors={colors} />;
  }
  return (
    <>
      <ScanBar colors={colors} />
      <View style={s.scanRow}>
        <ActivityIndicator size="small" color={colors.secondaryLabel} />
        <Text numberOfLines={1} style={[s.scanText, { color: colors.secondaryLabel }]}>{scanProgress}</Text>
      </View>
    </>
  );
}

function numColumnsForLayout(layout: 'grid' | 'list'): number {
  if (layout === 'grid') {
    return 2;
  }
  return 1;
}

function contentGapForLayout(layout: 'grid' | 'list'): number {
  if (layout === 'grid') {
    return 20;
  }
  return 8;
}

function columnStyleForLayout(layout: 'grid' | 'list'): { gap: number } | undefined {
  if (layout === 'grid') {
    return { gap: 16 };
  }
  return undefined;
}

function LibraryMainContent({ series, filtered, layout, colors, isDark, library, continueReading, query, selecting, filter, openVolume, renderVolume, onSelectSeries, onMenuSeries, onMenuVolume, onFilter }: {
  readonly series: Series | null;
  readonly filtered: Volume[];
  readonly layout: 'grid' | 'list';
  readonly colors: any;
  readonly isDark: boolean;
  readonly library: Series[];
  readonly continueReading: Volume[];
  readonly query: string;
  readonly selecting: boolean;
  readonly filter: Filter;
  readonly openVolume: (v: Volume) => void;
  readonly renderVolume: ({ item }: { item: Volume }) => React.ReactElement;
  readonly onSelectSeries: (item: Series) => void;
  readonly onMenuSeries: (item: Series) => void;
  readonly onMenuVolume: (v: Volume) => void;
  readonly onFilter: (f: Filter) => void;
}): React.ReactElement {
  if (!series) {
    return <SkeletonGrid colors={colors} />;
  }
  return (
    <FlatList
      data={filtered}
      key={String(layout)}
      keyExtractor={(volume) => volume.id}
      renderItem={renderVolume}
      numColumns={numColumnsForLayout(layout)}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      removeClippedSubviews={Platform.OS === 'android'}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={80}
      windowSize={7}
      initialNumToRender={10}
      contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: contentGapForLayout(layout) }}
      columnWrapperStyle={columnStyleForLayout(layout)}
      ListHeaderComponent={
        <View>
          <ShelvesSection library={library} series={series} colors={colors} onSelectSeries={onSelectSeries} onMenuSeries={onMenuSeries} />
          <ContinueReadingSection volumes={continueReading} colors={colors} isDark={isDark} query={query} selecting={selecting} onOpen={openVolume} onMenu={onMenuVolume} />
          <FilterSection volumeCount={series.volumes.length} filter={filter} colors={colors} filteredLength={filtered.length} onFilter={onFilter} />
        </View>
      }
      ListEmptyComponent={<EmptyVolumesView query={query} filter={filter} colors={colors} />}
    />
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
