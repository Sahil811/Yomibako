// Shared WebView bridge helpers for the reader (MokuroWebView) and the
// in-app browser (BrowserScreen).
//
// Both inject the same custom-CSS rules, read the same customization keys,
// and reply with parsed tokens through the same chunked protocol. Kept in one
// place so the two screens cannot drift apart again.

import { getItemAsync } from '../../services/storage';

export type BridgeCustomization = {
  customWordCSS: string;
  customPopupCSS: string;
  disableFade: boolean;
};

export type ParsedBridgeConfig = BridgeCustomization & {
  showPopupOnHover: boolean;
  playSoundOnHover: boolean;
};

const DEFAULTS: ParsedBridgeConfig = {
  customWordCSS: '',
  customPopupCSS: '',
  disableFade: false,
  showPopupOnHover: true,
  playSoundOnHover: false,
};

/** Parse the raw config blob; missing or corrupt input yields defaults. */
export function parseBridgeCustomization(cfgRaw: string | null | undefined): ParsedBridgeConfig {
  if (!cfgRaw) return { ...DEFAULTS };
  try {
    const cfg = JSON.parse(cfgRaw);
    return {
      customWordCSS: cfg.customWordCSS || '',
      customPopupCSS: cfg.customPopupCSS || '',
      disableFade: !!cfg.disableFadeAnimation,
      showPopupOnHover: cfg.showPopupOnHover !== false,
      playSoundOnHover: !!cfg.playSoundOnHover,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Read the customization keys from storage and parse them. */
export async function readBridgeCustomization(): Promise<ParsedBridgeConfig> {
  return parseBridgeCustomization(await getItemAsync('yomibako_config_json'));
}

export function buildCustomWordInject(customWordCSS: string): string {
  if (!customWordCSS) {
    return '';
  }
  return `let cw=document.getElementById('yomibako-custom-word'); if(!cw){ cw=document.createElement('style'); cw.id='yomibako-custom-word'; cw.textContent=${JSON.stringify(customWordCSS)}; document.head.appendChild(cw); }`;
}

export function buildCustomPopupInject(customPopupCSS: string): string {
  if (!customPopupCSS) {
    return '';
  }
  return `let cp=document.getElementById('yomibako-custom-popup'); if(!cp){ cp=document.createElement('style'); cp.id='yomibako-custom-popup'; cp.textContent=${JSON.stringify(customPopupCSS)}; document.head.appendChild(cp); }`;
}

export function buildFadeInject(disableFade: boolean): string {
  if (!disableFade) {
    return '';
  }
  return `document.documentElement.style.setProperty('--jpdb-fade-duration','0s');`;
}

const SINGLE_PAYLOAD_LIMIT = 30000;
const TOKEN_CHUNK = 20000;

/**
 * Token reply scripts. Giant payloads (100KB+ of JSON) die silently on
 * Android, so large ones are split into ~20KB slices; the bundles reassemble
 * via __yomibakoOnTokensChunk.
 */
export function buildTokenScripts(id: string, tokens: unknown): string[] {
  const payload = JSON.stringify(tokens);
  if (payload.length <= SINGLE_PAYLOAD_LIMIT) {
    return [`window.__yomibakoOnTokens(${JSON.stringify(id)}, ${payload}); true;`];
  }
  const scripts: string[] = [];
  const total = Math.ceil(payload.length / TOKEN_CHUNK);
  for (let i = 0; i < total; i++) {
    const part = payload.slice(i * TOKEN_CHUNK, (i + 1) * TOKEN_CHUNK);
    scripts.push(
      `window.__yomibakoOnTokensChunk(${JSON.stringify(id)}, ${i}, ${total}, ${JSON.stringify(part)}); true;`
    );
  }
  return scripts;
}
