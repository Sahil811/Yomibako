// SecureStore backed config for jpdb — mirrors D:\Downloads\jpd-breader_13.0\background\config.js
// Full parity minus Anki (no anki export). Supports all 25 keys of jpd-breader 13.0.
// Web-safe via services/storage (localStorage fallback).
import { getItemAsync, setItemAsync, deleteItemAsync } from '../storage';
import { POPUP_THEME_IDS, type PopupThemeId } from '../../theme/popupThemes';

export const CURRENT_SCHEMA_VERSION = 5;

export type Hotkey = { key: string; code: string; modifiers: string[] } | null;

export type YomibakoConfig = {
  schemaVersion: number;
  apiToken: string | null;
  showKanji: boolean;
  showExamplesAutomatically: boolean;
  miningDeckId: string | number | null;
  forqDeckId: string | number | null;
  blacklistDeckId: string | number | null;
  neverForgetDeckId: string | number | null;
  contextWidth: number; // 0-10
  forqOnMine: boolean;
  customWordCSS: string;
  customPopupCSS: string;
  showPopupOnHover: boolean;
  playSoundOnHover: boolean;
  touchscreenSupport: boolean;
  disableFadeAnimation: boolean;
  showPopupKey: Hotkey;
  addKey: Hotkey;
  dialogKey: Hotkey;
  blacklistKey: Hotkey;
  neverForgetKey: Hotkey;
  nothingKey: Hotkey;
  somethingKey: Hotkey;
  hardKey: Hotkey;
  goodKey: Hotkey;
  easyKey: Hotkey;
  geminiApiKey: string | null;
  /** App chrome theme. */
  theme: 'auto' | 'light' | 'dark';
  /** Word-popup palette, independent of the app chrome. See popupThemes.ts. */
  popupTheme: PopupThemeId;
  showReviewButtons: boolean;
  showAddButton: boolean;
  showBlacklistButton: boolean;
  minimalMineButtons: boolean;
  nextUnknownWordKey: Hotkey;
  prevUnknownWordKey: Hotkey;
  popupScale: number; // 50-200
  showRtk: boolean;
};

export const defaultConfig: YomibakoConfig = Object.freeze({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  apiToken: null,
  showKanji: true,
  showExamplesAutomatically: false,
  miningDeckId: null,
  forqDeckId: 'forq',
  blacklistDeckId: 'blacklist',
  neverForgetDeckId: 'never-forget',
  contextWidth: 1,
  forqOnMine: true,
  customWordCSS: '',
  customPopupCSS: '',
  showPopupOnHover: true,
  playSoundOnHover: false,
  touchscreenSupport: true,
  disableFadeAnimation: false,
  showPopupKey: { key: 'Shift', code: 'ShiftLeft', modifiers: [] },
  addKey: null,
  dialogKey: null,
  blacklistKey: null,
  neverForgetKey: null,
  nothingKey: null,
  somethingKey: null,
  hardKey: null,
  goodKey: null,
  easyKey: null,
  geminiApiKey: null,
  theme: 'auto',
  popupTheme: 'auto',
  showReviewButtons: false,
  showAddButton: false,
  showBlacklistButton: false,
  minimalMineButtons: false,
  nextUnknownWordKey: null,
  prevUnknownWordKey: null,
  popupScale: 100,
  showRtk: true,
} as YomibakoConfig);

// Legacy SecureStore keys for backward compat (pre-parity installs)
const LEGACY_KEYS = {
  token: 'jpdb_token',
  miningDeckId: 'jpdb_miningDeckId',
  blacklistDeckId: 'jpdb_blacklistDeckId',
  neverForgetDeckId: 'jpdb_neverForgetDeckId',
  forqDeckId: 'jpdb_forqDeckId',
} as const;

const CONFIG_JSON_KEY = 'yomibako_config_json';
let configCache: YomibakoConfig | null = null;

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

// An id written by a newer build (or a corrupted store) must not reach the
// palette lookup, or the popup renders with undefined colours.
function validPopupTheme(value: any): PopupThemeId {
  return POPUP_THEME_IDS.includes(value) ? value : 'auto';
}

export function migrateSchema(config: any): void {
  if (config.schemaVersion === 0 || config.schemaVersion == null) {
    for (const key of [
      'showPopupKey',
      'blacklistKey',
      'neverForgetKey',
      'nothingKey',
      'somethingKey',
      'hardKey',
      'goodKey',
      'easyKey',
    ] as const) {
      config[key] = (defaultConfig as any)[key];
    }
    config.schemaVersion = 1;
  }
  if ((config.schemaVersion ?? 0) < 2) {
    // v1 default was off; mobile is touch-first so existing installs
    // follow the new default (user can still toggle off in Settings).
    config.showPopupOnHover = true;
    config.touchscreenSupport = true;
    config.schemaVersion = 2;
  }
  if ((config.schemaVersion ?? 0) < 3) {
    // v3: popup shows only Never forget + Examples by default (matches the
    // extension card). Extra buttons become opt-in via Settings → Behavior.
    config.showReviewButtons = false;
    if (config.showAddButton == null) config.showAddButton = false;
    if (config.showBlacklistButton == null) config.showBlacklistButton = false;
    config.schemaVersion = 3;
  }
  if ((config.schemaVersion ?? 0) < 4) {
    // v4: RTK mnemonics on by default so the kanji panel shows
    // ✦ Mnemonic like the extension card (toggle in Settings → Behavior).
    config.showRtk = true;
    config.schemaVersion = 4;
  }
  if ((config.schemaVersion ?? 0) < 5) {
    // v5 briefly stored manga-reader layout settings here. Those controls belong
    // to the reader itself, so this migration is now just a version marker;
    // any leftover keys in stored JSON are ignored.
    config.schemaVersion = 5;
  }
}

async function loadLegacyIntoConfig(cfg: YomibakoConfig): Promise<void> {
  try {
    const [tok, mining, bl, nf, forq] = await Promise.all([
      getItemAsync(LEGACY_KEYS.token),
      getItemAsync(LEGACY_KEYS.miningDeckId),
      getItemAsync(LEGACY_KEYS.blacklistDeckId),
      getItemAsync(LEGACY_KEYS.neverForgetDeckId),
      getItemAsync(LEGACY_KEYS.forqDeckId),
    ]);
    if (tok && !cfg.apiToken) cfg.apiToken = tok;
    if (mining && cfg.miningDeckId == null) {
      const n = Number(mining);
      cfg.miningDeckId = Number.isNaN(n) ? mining : n;
    }
    if (bl && cfg.blacklistDeckId === 'blacklist') {
      const n = Number(bl);
      cfg.blacklistDeckId = Number.isNaN(n) ? bl : n;
    }
    if (nf && cfg.neverForgetDeckId === 'never-forget') {
      const n = Number(nf);
      cfg.neverForgetDeckId = Number.isNaN(n) ? nf : n;
    }
    if (forq && cfg.forqDeckId === 'forq') {
      const n = Number(forq);
      cfg.forqDeckId = Number.isNaN(n) ? forq : n;
    }
  } catch {}
}

export async function loadConfig(forceReload = false): Promise<YomibakoConfig> {
  if (configCache && !forceReload) return configCache;
  try {
    const raw = await getItemAsync(CONFIG_JSON_KEY);
    let cfg: YomibakoConfig;
    if (raw) {
      const parsed = JSON.parse(raw);
      cfg = { ...defaultConfig, ...parsed } as YomibakoConfig;
      migrateSchema(cfg);
    } else {
      cfg = { ...defaultConfig } as YomibakoConfig;
      await loadLegacyIntoConfig(cfg);
    }
    // clamp
    cfg.popupScale = clamp(Number(cfg.popupScale) || 100, 50, 200);
    cfg.contextWidth = clamp(Number(cfg.contextWidth) || 1, 0, 10);
    cfg.popupTheme = validPopupTheme(cfg.popupTheme);
    if (cfg.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      // fallback to default but preserve token/deck ids if present
      const fallback = { ...defaultConfig } as YomibakoConfig;
      fallback.apiToken = cfg.apiToken;
      fallback.miningDeckId = cfg.miningDeckId;
      fallback.forqDeckId = cfg.forqDeckId;
      fallback.blacklistDeckId = cfg.blacklistDeckId;
      fallback.neverForgetDeckId = cfg.neverForgetDeckId;
      cfg = fallback;
    }
    configCache = cfg;
    return cfg;
  } catch (e) {
    console.warn('[config] load failed', e);
    configCache = { ...defaultConfig } as YomibakoConfig;
    return configCache;
  }
}

export async function saveConfig(newConfig: YomibakoConfig): Promise<void> {
  try {
    // clamp before save
    newConfig.popupScale = clamp(Number(newConfig.popupScale) || 100, 50, 200);
    newConfig.contextWidth = clamp(Number(newConfig.contextWidth) || 1, 0, 10);
    newConfig.popupTheme = validPopupTheme(newConfig.popupTheme);
    // Publish before awaiting storage. A newer staged edit must not be rolled
    // back when this older write eventually completes.
    configCache = { ...newConfig };
    await setItemAsync(CONFIG_JSON_KEY, JSON.stringify(newConfig));
    // also mirror legacy keys for api token + decks so older code still works
    if (newConfig.apiToken) await setItemAsync(LEGACY_KEYS.token, String(newConfig.apiToken));
    else await deleteItemAsync(LEGACY_KEYS.token);
    for (const [k, legacyKey] of [
      ['miningDeckId', LEGACY_KEYS.miningDeckId],
      ['blacklistDeckId', LEGACY_KEYS.blacklistDeckId],
      ['neverForgetDeckId', LEGACY_KEYS.neverForgetDeckId],
      ['forqDeckId', LEGACY_KEYS.forqDeckId],
    ] as const) {
      const v = (newConfig as any)[k];
      if (v == null || v === '') await deleteItemAsync(legacyKey);
      else await setItemAsync(legacyKey, String(v));
    }
  } catch (e) {
    console.warn('[config] save failed', e);
  }
}

export function getConfig(): YomibakoConfig {
  return configCache ? { ...configCache } : ({ ...defaultConfig } as YomibakoConfig);
}

/** Make an edited settings snapshot visible to focused screens immediately. */
export function stageConfig(newConfig: YomibakoConfig): void {
  configCache = { ...newConfig };
}

// Backwards compat helpers used by api.ts / audio.ts
export async function getApiToken(): Promise<string | null> {
  const cfg = await loadConfig();
  return cfg.apiToken;
}

export async function getDeckId(
  key: 'miningDeckId' | 'blacklistDeckId' | 'neverForgetDeckId' | 'forqDeckId'
): Promise<string | number | null> {
  const cfg = await loadConfig();
  const v = cfg[key];
  if (v == null || v === '') return null;
  return v as string | number;
}

export async function setDeckId(key: keyof typeof LEGACY_KEYS, value: string): Promise<void> {
  const cfg = await loadConfig();
  const map: Record<string, keyof YomibakoConfig> = {
    token: 'apiToken',
    miningDeckId: 'miningDeckId',
    blacklistDeckId: 'blacklistDeckId',
    neverForgetDeckId: 'neverForgetDeckId',
    forqDeckId: 'forqDeckId',
  };
  const ck = map[key];
  if (ck) {
    const v = value?.trim();
    if (!v) (cfg as any)[ck] = (defaultConfig as any)[ck] === null ? null : (defaultConfig as any)[ck];
    else {
      const n = Number(v);
      (cfg as any)[ck] = Number.isNaN(n) ? v : n;
    }
    await saveConfig(cfg);
  }
}

// Utility for parsing hotkey string like "ShiftLeft" or "KeyA+Ctrl"
export function parseHotkeyInput(input: string): Hotkey {
  const s = input.trim();
  if (!s || s.toLowerCase() === 'none' || s === '-') return null;
  // expects "code:ShiftLeft modifiers:Ctrl,Shift" or just "ShiftLeft" or "KeyA"
  if (s.includes(':')) {
    try {
      return JSON.parse(s) as Hotkey;
    } catch {}
  }
  // simple code
  return { key: s.replace('Left','').replace('Right',''), code: s, modifiers: [] };
}

export function hotkeyToString(hk: Hotkey): string {
  if (!hk) return '';
  if (!hk.code) return hk.key ?? '';
  if (hk.modifiers?.length) return `${hk.modifiers.join('+')}+${hk.code}`;
  return hk.code;
}

export async function exportConfigJson(): Promise<string> {
  const cfg = await loadConfig();
  return JSON.stringify(cfg, null, 2);
}

export async function importConfigJson(json: string): Promise<void> {
  const parsed = JSON.parse(json);
  migrateSchema(parsed);
  const cfg = { ...defaultConfig, ...parsed } as YomibakoConfig;
  await saveConfig(cfg);
}
