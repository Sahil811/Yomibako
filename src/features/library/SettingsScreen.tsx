import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView, useColorScheme, Switch, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { darkColors, lightColors } from '../../theme/colors';
import { Icon, type IconName } from '../../components/ui/Icon';
import { loadConfig, saveConfig, defaultConfig, type YomibakoConfig, type Hotkey, hotkeyToString, parseHotkeyInput } from '../../services/jpdb/config';
import { getItemAsync } from '../../services/storage';
import { getSessionStatus, pokeSession, sessionDebug, subscribeSessionStatus } from '../../services/jpdb/session';
import { lastAudioError } from '../../services/jpdb/audio';

// ——————————————— iOS Grouped Row Components ———————————————
function SectionHeader({ title, footnote, colors }: any) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 7, gap: 3 }}>
      <Text style={[s.sectionHeader, { color: colors.secondaryLabel }]}>{title}</Text>
      {footnote ? <Text style={[s.sectionFooter, { color: colors.secondaryLabel }]}>{footnote}</Text> : null}
    </View>
  );
}
function Group({ children, colors }: any) {
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[s.group, { backgroundColor: colors.secondaryGroupedBackground }]}>
      {kids.map((child: any, idx) => (
        <View key={idx} style={{}}>
          {child}
          {idx !== kids.length - 1 ? <View style={[s.rowSeparator, { backgroundColor: colors.separator, marginLeft: 57 }]} /> : null}
        </View>
      ))}
    </View>
  );
}
function Tile({ icon, color }: { icon: IconName; color: string }) {
  return (
    <View style={[s.rowIcon, { backgroundColor: color }]}>
      <Icon name={icon} size={15} color="#fff" strokeWidth={2.1} />
    </View>
  );
}
function Row({ icon, color, label, detail, onPress, children, colors }: any) {
  const content = (
    <View style={s.row}>
      {icon ? <Tile icon={icon} color={color || colors.primary} /> : null}
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[s.rowLabel, { color: colors.onSurface }]}>{label}</Text>
        {detail ? <Text style={[s.rowDetail, { color: colors.secondaryLabel }]}>{detail}</Text> : null}
      </View>
      {children}
      {onPress ? <Icon name="chevronRight" size={16} color={colors.tertiaryLabel} strokeWidth={2.2} /> : null}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [{ backgroundColor: pressed ? colors.systemFill : 'transparent' }]}>
        {content}
      </Pressable>
    );
  }
  return content;
}
function FieldRow({ label, value, onChangeText, placeholder, secure, keyboardType, colors, multiline, help }: any) {
  const [show, setShow] = useState(!secure);
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 11, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[s.fieldLabel, { color: colors.onSurface }]}>{label}</Text>
        {secure ? (
          <Pressable onPress={() => setShow((v) => !v)} hitSlop={10}>
            <Text style={[s.linkSmall, { color: colors.primary }]}>{show ? 'Hide' : 'Show'}</Text>
          </Pressable>
        ) : null}
      </View>
      <View
        style={[
          s.inputBox,
          {
            backgroundColor: colors.tertiarySystemFill,
            minHeight: multiline ? 88 : 38,
            alignItems: multiline ? 'flex-start' : 'center',
            paddingTop: multiline ? 10 : 0,
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.tertiaryLabel}
          style={[s.input, { color: colors.onSurface, textAlignVertical: multiline ? 'top' : 'center' } as any]}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={secure && !show}
          keyboardType={keyboardType}
          multiline={!!multiline}
          numberOfLines={multiline ? 4 : 1}
        />
      </View>
      {help ? <Text style={[s.help, { color: colors.secondaryLabel }]}>{help}</Text> : null}
    </View>
  );
}
function SwitchRow({ icon, color, label, value, onValueChange, colors, help, detail }: any) {
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 11, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {icon ? <Tile icon={icon} color={color} /> : null}
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={[s.rowLabel, { color: colors.onSurface }]}>{label}</Text>
          {detail ? <Text style={[s.rowDetail, { color: colors.secondaryLabel }]}>{detail}</Text> : null}
        </View>
        <Switch value={!!value} onValueChange={onValueChange} trackColor={{ false: colors.separatorOpaque, true: colors.primary }} thumbColor="#fff" ios_backgroundColor={colors.separatorOpaque} />
      </View>
      {help ? <Text style={[s.help, { color: colors.secondaryLabel, marginLeft: icon ? 40 : 0 }]}>{help}</Text> : null}
    </View>
  );
}
function HotkeyField({ label, value, onChange, colors }: { label: string; value: Hotkey; onChange: (v: Hotkey) => void; colors: any }) {
  const [text, setText] = useState(hotkeyToString(value));
  useEffect(() => setText(hotkeyToString(value)), [value]);
  const commit = () => {
    const parsed = parseHotkeyInput(text);
    onChange(parsed);
  };
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 11, gap: 8 }}>
      <Text style={[s.fieldLabel, { color: colors.onSurface }]}>{label}</Text>
      <View style={[s.inputBox, { backgroundColor: colors.tertiarySystemFill }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder="ShiftLeft · KeyJ · —"
          placeholderTextColor={colors.tertiaryLabel}
          style={[s.input, { color: colors.onSurface }]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          onPress={() => {
            setText('');
            onChange(null);
          }}
          style={({ pressed }) => [{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: pressed ? colors.systemFill : 'transparent' }]}
        >
          <Text style={[s.linkSmall, { color: colors.secondaryLabel }]}>Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = isDark ? darkColors : lightColors;
  const insets = useSafeAreaInsets();
  const [cfg, setCfg] = useState<YomibakoConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [jpdbLogin, setJpdbLogin] = useState('Checking…');
  const navigation = useNavigation<any>();

  useEffect(() => {
    loadConfig().then((c) => setCfg({ ...c }));
  }, []);

  // JPDB cookie-login status (audio / review / FORQ need it). Re-checks
  // every time Settings gains focus — e.g. returning from the login page.
  useFocusEffect(
    useCallback(() => {
      const update = () => {
        const s = getSessionStatus();
        setJpdbLogin(s === 'in' ? 'Logged in ✓ — audio & reviews work' : s === 'out' ? 'Logged out — tap to sign in' : 'Checking…');
      };
      update();
      pokeSession();
      const t = setTimeout(update, 2500);
      const unsub = subscribeSessionStatus(update);
      return () => { clearTimeout(t); unsub(); };
    }, [])
  );

  const openJpdbLogin = () => {
    Haptics.selectionAsync();
    navigation.navigate('Browser', { url: 'https://jpdb.io/login' });
  };

  const refreshDiag = async () => {
    try {
      const raw = await getItemAsync('yomibako_reader_diag');
      if (!raw) {
        setDiag('No reader session yet — open a volume and tap a word first.');
        return;
      }
      const d = JSON.parse(raw);
      setDiag(
        [
          `volume: ${d.title ?? '—'}`,
          `time: ${d.time ?? '—'}`,
          `token: ${d.tokenPresent ? 'set' : 'MISSING'}`,
          `pages: ${d.pages ?? 0} (sel: ${d.sel || '—'}, textBoxes: ${d.boxes ?? 0})`,
          `parse requests: ${d.parseReq ?? 0}, ok: ${d.parseOk ?? 0}, failed: ${d.parseErr ?? 0}`,
          d.lastErr ? `last error: ${d.lastErr}` : 'last error: —',
          `taps: bg ${d.taps ?? 0}, words ${d.lookups ?? 0}, spans applied ${d.applied ?? 0}${d.applyErr ? `, applyErr ${d.applyErr}` : ''}`,
          `audio: ${lastAudioError() || '—'}`,
          `session: ${sessionDebug()}`,
        ].join('\n')
      );
    } catch (e: any) {
      setDiag(`diag read failed: ${String(e?.message ?? e)}`);
    }
  };

  const update = (patch: Partial<YomibakoConfig>) => {
    if (!cfg) return;
    setCfg({ ...cfg, ...patch } as YomibakoConfig);
  };

  const save = async () => {
    if (!cfg) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const toSave = {
      ...cfg,
      contextWidth: Math.min(10, Math.max(0, Number(cfg.contextWidth) || 1)),
      popupScale: Math.min(200, Math.max(50, Number(cfg.popupScale) || 100)),
    } as YomibakoConfig;
    for (const k of ['miningDeckId', 'forqDeckId', 'blacklistDeckId', 'neverForgetDeckId'] as const) {
      const v = (toSave as any)[k];
      if (v === '' || v === undefined) (toSave as any)[k] = (defaultConfig as any)[k];
      else if (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '' && k !== 'forqDeckId' && k !== 'blacklistDeckId' && k !== 'neverForgetDeckId') {
        const n = Number(v);
        if (!Number.isNaN(n)) (toSave as any)[k] = n;
      }
    }
    if (toSave.geminiApiKey === '') toSave.geminiApiKey = null;
    if (toSave.apiToken === '') toSave.apiToken = null;
    await saveConfig(toSave);
    setCfg(toSave);
    setSaved(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setSaved(false), 1400);
  };

  const exportJson = async () => {
    if (!cfg) return;
    const json = JSON.stringify(cfg, null, 2);
    Alert.alert('Exported JSON', json.slice(0, 3800) + (json.length > 3800 ? '…' : ''));
  };
  const importJson = async () => {
    const doImport = async (text: string | undefined) => {
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        const merged = { ...defaultConfig, ...parsed, schemaVersion: 1 } as YomibakoConfig;
        setCfg(merged);
        await saveConfig(merged);
        Alert.alert('Imported', 'Review and tap Save.');
      } catch (e: any) {
        Alert.alert('Import failed', String(e.message));
      }
    };
    // @ts-ignore
    if ((Alert as any).prompt) {
      // @ts-ignore
      (Alert as any).prompt('Import JSON', 'Paste config JSON:', async (text: string) => doImport(text), 'plain-text', JSON.stringify(cfg, null, 2).slice(0, 3800));
    } else {
      Alert.alert('Import', 'On Android, edit fields manually — or paste via iOS.');
    }
  };
  const resetDefaults = async () => {
    Alert.alert('Reset Settings?', 'Restore defaults? Token and deck IDs will be cleared.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          const d = { ...defaultConfig } as YomibakoConfig;
          setCfg(d);
          await saveConfig(d);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
      },
    ]);
  };

  if (!cfg) {
    return (
      <View style={[s.root, { backgroundColor: colors.groupedBackground, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: colors.secondaryLabel }}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: colors.groupedBackground }]}>
      {/* iOS large title header with blur */}
      <BlurView intensity={isDark ? 32 : 36} tint={isDark ? 'dark' : 'light'} style={[s.headerBlur, { paddingTop: insets.top + 12, borderBottomColor: colors.separator, backgroundColor: colors.blurTint }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Text style={[s.largeTitle, { color: colors.onSurface }]}>Settings</Text>
            <Text style={[s.headerSub, { color: colors.secondaryLabel }]}>JPDB · Decks · Appearance</Text>
          </View>
          <Pressable onPress={save} style={({ pressed }) => [s.savePill, { backgroundColor: saved ? colors.success : colors.primary, opacity: pressed ? 0.84 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]} hitSlop={6}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {saved ? <Icon name="check" size={14} color="#fff" strokeWidth={2.6} /> : null}
              <Text style={[s.saveText, { color: '#fff' }]}>{saved ? 'Saved' : 'Save'}</Text>
            </View>
          </Pressable>
        </View>
      </BlurView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false} bounces keyboardShouldPersistTaps="handled">
        {/* JPDB */}
        <SectionHeader title="JPDB" footnote="Same token as jpd-breader" colors={colors} />
        <Group colors={colors}>
          <FieldRow label="API Token" value={cfg.apiToken ?? ''} onChangeText={(v: string) => update({ apiToken: v })} placeholder="Paste JPDB token…" secure colors={colors} help="jpdb.io → Settings → API token" />
          <FieldRow label="Gemini API Key" value={cfg.geminiApiKey ?? ''} onChangeText={(v: string) => update({ geminiApiKey: v })} placeholder="Optional" secure colors={colors} help="For AI explanations. Leave empty to disable." />
          <Row icon="browser" color="#34C759" label="JPDB Login" detail={jpdbLogin} colors={colors} onPress={openJpdbLogin} />
        </Group>

        {/* Decks */}
        <SectionHeader title="Decks" footnote="Deck IDs from the deck URL, or keep the defaults." colors={colors} />
        <Group colors={colors}>
          <FieldRow label="Mining Deck" value={String(cfg.miningDeckId ?? '')} onChangeText={(v: string) => update({ miningDeckId: v })} placeholder="e.g. 1234" colors={colors} />
          <FieldRow label="FORQ Deck" value={String(cfg.forqDeckId ?? '')} onChangeText={(v: string) => update({ forqDeckId: v })} placeholder="forq" colors={colors} help='Default "forq" uses scrape' />
          <FieldRow label="Blacklist Deck" value={String(cfg.blacklistDeckId ?? '')} onChangeText={(v: string) => update({ blacklistDeckId: v })} placeholder="blacklist" colors={colors} />
          <FieldRow label="Never-Forget Deck" value={String(cfg.neverForgetDeckId ?? '')} onChangeText={(v: string) => update({ neverForgetDeckId: v })} placeholder="never-forget" colors={colors} />
          <SwitchRow icon="plus" color="#007AFF" label="Add to FORQ on mine" value={cfg.forqOnMine} onValueChange={(v: boolean) => update({ forqOnMine: v })} colors={colors} detail="Also queue in FORQ when mining" />
          <FieldRow label="Context width" value={String(cfg.contextWidth)} onChangeText={(v: string) => update({ contextWidth: Number(v) as any })} placeholder="1" keyboardType="numeric" colors={colors} help="0–10 sentences" />
        </Group>

        {/* Behavior */}
        <SectionHeader title="Behavior" colors={colors} />
        <Group colors={colors}>
          <SwitchRow icon="lang" color="#34C759" label="Kanji breakdown" value={cfg.showKanji} onValueChange={(v: boolean) => update({ showKanji: v })} colors={colors} detail="Show components" />
          <SwitchRow icon="ai" color="#AF52DE" label="RTK mnemonics" value={cfg.showRtk} onValueChange={(v: boolean) => update({ showRtk: v })} colors={colors} />
          <SwitchRow icon="book" color="#FF9F0A" label="Auto-fetch examples" value={cfg.showExamplesAutomatically} onValueChange={(v: boolean) => update({ showExamplesAutomatically: v })} colors={colors} detail="ImmersionKit" />
          <SwitchRow icon="check" color="#007AFF" label="Review buttons" value={cfg.showReviewButtons} onValueChange={(v: boolean) => update({ showReviewButtons: v })} colors={colors} detail="Traffic-light pills in popup" />
          <SwitchRow icon="plus" color="#007AFF" label="Add button" value={(cfg as any).showAddButton} onValueChange={(v: boolean) => update({ showAddButton: v })} colors={colors} detail="Show Add in word popup" />
          <SwitchRow icon="close" color="#FF3B30" label="Blacklist button" value={(cfg as any).showBlacklistButton} onValueChange={(v: boolean) => update({ showBlacklistButton: v })} colors={colors} detail="Show × in word popup" />
          <SwitchRow icon="list" color="#8E8E93" label="Compact mining" value={cfg.minimalMineButtons} onValueChange={(v: boolean) => update({ minimalMineButtons: v })} colors={colors} detail="Minimal Add dialog" />
        </Group>

        {/* Appearance */}
        <SectionHeader title="Appearance" colors={colors} />
        <Group colors={colors}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
            <Text style={[s.fieldLabel, { color: colors.onSurface }]}>Theme</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['auto', 'light', 'dark'] as const).map((opt) => (
                <Pressable key={opt} onPress={() => update({ theme: opt })} style={[s.segBtn, { backgroundColor: cfg.theme === opt ? colors.primary : colors.tertiarySystemFill }]}>
                  <Text style={[s.segText, { color: cfg.theme === opt ? '#fff' : colors.onSurface }]}>{opt === 'auto' ? 'Automatic' : opt === 'light' ? 'Light' : 'Dark'}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <SwitchRow icon="settings" color="#5856D6" label="Reduce motion" value={cfg.disableFadeAnimation} onValueChange={(v: boolean) => update({ disableFadeAnimation: v })} colors={colors} />
          <SwitchRow icon="play" color="#30D158" label="Touchscreen support" value={cfg.touchscreenSupport} onValueChange={(v: boolean) => update({ touchscreenSupport: v })} colors={colors} />
          <FieldRow label="Popup scale" value={String(cfg.popupScale)} onChangeText={(v: string) => update({ popupScale: Number(v) as any })} placeholder="100" keyboardType="numeric" colors={colors} help="50–200%" />
          <FieldRow label="Custom Word CSS" value={cfg.customWordCSS} onChangeText={(v: string) => update({ customWordCSS: v })} placeholder=".jpdb-word { … }" colors={colors} multiline />
          <FieldRow label="Custom Popup CSS" value={cfg.customPopupCSS} onChangeText={(v: string) => update({ customPopupCSS: v })} placeholder="#jpdb-popup { … }" colors={colors} multiline />
        </Group>

        {/* Popup & Audio */}
        <SectionHeader title="Popup & Audio" colors={colors} />
        <Group colors={colors}>
          <SwitchRow icon="bookOpen" color="#007AFF" label="Show popup on hover" value={cfg.showPopupOnHover} onValueChange={(v: boolean) => update({ showPopupOnHover: v })} colors={colors} detail="Off = hold key to show" />
          <SwitchRow icon="audio" color="#FF2D55" label="Sound on hover" value={cfg.playSoundOnHover} onValueChange={(v: boolean) => update({ playSoundOnHover: v })} colors={colors} detail="250 ms delay" />
          <HotkeyField label="Show Popup Key" value={cfg.showPopupKey} onChange={(v) => update({ showPopupKey: v })} colors={colors} />
        </Group>

        {/* Hotkeys */}
        <SectionHeader title="Hotkeys" footnote="For hardware keyboards. Leave empty to disable." colors={colors} />
        <Group colors={colors}>
          <HotkeyField label="Add / Mine" value={cfg.addKey} onChange={(v) => update({ addKey: v })} colors={colors} />
          <HotkeyField label="Sentence editor" value={cfg.dialogKey} onChange={(v) => update({ dialogKey: v })} colors={colors} />
          <HotkeyField label="Blacklist" value={cfg.blacklistKey} onChange={(v) => update({ blacklistKey: v })} colors={colors} />
          <HotkeyField label="Never Forget" value={cfg.neverForgetKey} onChange={(v) => update({ neverForgetKey: v })} colors={colors} />
          <HotkeyField label="Review: Nothing" value={cfg.nothingKey} onChange={(v) => update({ nothingKey: v })} colors={colors} />
          <HotkeyField label="Review: Something" value={cfg.somethingKey} onChange={(v) => update({ somethingKey: v })} colors={colors} />
          <HotkeyField label="Review: Hard" value={cfg.hardKey} onChange={(v) => update({ hardKey: v })} colors={colors} />
          <HotkeyField label="Review: Good" value={cfg.goodKey} onChange={(v) => update({ goodKey: v })} colors={colors} />
          <HotkeyField label="Review: Easy" value={cfg.easyKey} onChange={(v) => update({ easyKey: v })} colors={colors} />
          <HotkeyField label="Next unknown" value={cfg.nextUnknownWordKey} onChange={(v) => update({ nextUnknownWordKey: v })} colors={colors} />
          <HotkeyField label="Prev unknown" value={cfg.prevUnknownWordKey} onChange={(v) => update({ prevUnknownWordKey: v })} colors={colors} />
        </Group>

        {/* Actions */}
        <SectionHeader title="Data" colors={colors} />
        <Group colors={colors}>
          <Row icon="file" color="#007AFF" label="Export settings" detail="Copy JSON" colors={colors} onPress={exportJson} />
          <Row icon="browse" color="#34C759" label="Import settings" detail="Paste JSON" colors={colors} onPress={importJson} />
          <Row icon="reload" color="#FF3B30" label="Reset to Defaults" detail="Clears token & decks" colors={colors} onPress={resetDefaults} />
        </Group>
        <Text style={[s.footerNote, { color: colors.secondaryLabel }]}>Changes need Save to apply.</Text>

        {/* Diagnostics */}
        <SectionHeader title="Diagnostics" footnote="Reader pipeline state from the last opened volume." colors={colors} />
        <Group colors={colors}>
          <Row icon="list" color="#5856D6" label="Refresh reader diagnostics" detail="Open volume + tap first" colors={colors} onPress={refreshDiag} />
          <View style={{ paddingHorizontal: 16, paddingVertical: 11 }}>
            <Text style={[s.help, { color: colors.secondaryLabel, fontFamily: 'monospace' }]}>{diag ?? 'Not loaded — tap Refresh.'}</Text>
          </View>
        </Group>

        {/* About */}
        <View style={[s.aboutCard, { backgroundColor: colors.secondaryGroupedBackground }]}>
          <Text style={[s.aboutTitle, { color: colors.onSurface }]}>Yomibako よみばこ</Text>
          <Text style={[s.aboutSub, { color: colors.secondaryLabel }]}>Reads where your files live — no import, no duplicate.</Text>
          <Text style={[s.aboutMeta, { color: colors.tertiaryLabel }]}>1.0.0 · mokuro + jpdb</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  headerBlur: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  largeTitle: { fontFamily: 'System', fontSize: 34, lineHeight: 41, fontWeight: '700' as const, letterSpacing: 0.4 },
  headerSub: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const, marginTop: 2, letterSpacing: -0.08 },
  savePill: { paddingHorizontal: 16, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', minWidth: 76 },
  saveText: { fontFamily: 'System', fontSize: 15, fontWeight: '600' as const, letterSpacing: -0.2 },
  sectionHeader: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: 0.2, textTransform: 'uppercase' as const },
  sectionFooter: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  group: { marginHorizontal: 16, borderRadius: 12, overflow: 'hidden', borderCurve: 'continuous' as any },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 50, paddingVertical: 8 },
  rowIcon: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' as any },
  rowLabel: { fontFamily: 'System', fontSize: 17, lineHeight: 22, fontWeight: '400' as const, letterSpacing: -0.4 },
  rowDetail: { fontFamily: 'System', fontSize: 13, lineHeight: 16, fontWeight: '400' as const },
  rowSeparator: { height: StyleSheet.hairlineWidth },
  fieldLabel: { fontFamily: 'System', fontSize: 14, lineHeight: 18, fontWeight: '600' as const, letterSpacing: -0.2 },
  inputBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 12, gap: 8, borderCurve: 'continuous' as any },
  input: { flex: 1, fontFamily: 'System', fontSize: 16, lineHeight: 21, fontWeight: '400' as const, paddingVertical: 7 },
  linkSmall: { fontFamily: 'System', fontSize: 13, fontWeight: '600' as const },
  help: { fontFamily: 'System', fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  segBtn: { flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' as any },
  segText: { fontFamily: 'System', fontSize: 13, fontWeight: '600' as const, textTransform: 'capitalize' as const },
  footerNote: { fontFamily: 'System', fontSize: 12, lineHeight: 16, fontWeight: '400' as const, textAlign: 'center' as const, marginTop: 8, paddingHorizontal: 20 },
  aboutCard: { margin: 16, marginTop: 24, borderRadius: 14, padding: 18, gap: 6, alignItems: 'center' as const, borderCurve: 'continuous' as any },
  aboutTitle: { fontFamily: 'System', fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.4 },
  aboutSub: { fontFamily: 'System', fontSize: 13, lineHeight: 18, fontWeight: '400' as const, textAlign: 'center' as const, maxWidth: 300 },
  aboutMeta: { fontFamily: 'System', fontSize: 11, lineHeight: 13, fontWeight: '400' as const, textAlign: 'center' as const, marginTop: 4 },
});
