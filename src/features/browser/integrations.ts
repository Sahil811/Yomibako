// Site integration registry — mirrors manifest.json content_scripts minus Anki
// Used by BrowserScreen / BROWSER_JS for documentation and quick-tile URL validation
// Anki domains intentionally omitted (ankiuser.net / ankiweb.net)

export type SiteIntegration = {
  id: string;
  label: string;
  hosts: string[];
  selector: string;
  description: string;
  parser: 'visible' | 'mutation' | 'youtube-asr';
};

export const SITE_INTEGRATIONS: SiteIntegration[] = [
  {
    id: 'mokuro',
    label: 'Mokuro (local)',
    hosts: ['mokuro.moe', 'mokuro.app', 'file://*mokuro*.html'],
    selector: '#pagesContainer > div .textBox',
    description: 'Mokuro HTML — handled by MokuroWebView with yokoBundle (yomibakoBundle.ts). Not used in BrowserScreen.',
    parser: 'visible',
  },
  {
    id: 'ttu',
    label: 'TTU Reader',
    hosts: ['reader.ttsu.app', 'ttu-ebook.web.app'],
    selector: '.book-content p, .book-content div.calibre1',
    description: 'ported from integrations/ttu.js — filters [data-ttu-spoiler-img]',
    parser: 'mutation',
  },
  {
    id: 'texthooker',
    label: 'Texthooker / ExSTATic',
    hosts: ['anacreondjt.gitlab.io/texthooker.html', 'learnjapanese.moe/texthooker.html', 'kamwithk.github.io/exSTATic', 'renji-xd.github.io/texthooker-ui'],
    selector: '.textline, .line_box, .sentence-entry, .my-2.cursor-pointer',
    description: 'ported from integrations/anacreon.js',
    parser: 'mutation',
  },
  {
    id: 'readwok',
    label: 'Readwok',
    hosts: ['app.readwok.com'],
    selector: 'div[class*="styles_text_"]',
    description: 'ported from integrations/readwok.js',
    parser: 'mutation',
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia + Syosetu',
    hosts: ['ja.wikipedia.org', 'ja.m.wikipedia.org', 'ncode.syosetu.com'],
    selector: '#firstHeading, #mw-content-text .mw-parser-output > *, .mwe-popups-extract > *',
    description: 'ported from integrations/wikipedia.js — excludes nav/chrome nodes',
    parser: 'mutation',
  },
  {
    id: 'youtube',
    label: 'YouTube (JA captions)',
    hosts: ['*.youtube.com'],
    selector: '.asbplayer-subtitles, .ytp-caption-segment, .captions-text',
    description: 'ported from integrations/youtube.js — ASR transcript fallback via youtubeApi.fetchWatchPage. Subtitles observed via perpetual MutationObserver when url contains youtube.com/watch',
    parser: 'youtube-asr',
  },
  {
    id: 'bunpro',
    label: 'Bunpro',
    hosts: ['bunpro.jp'],
    selector: 'div.bp-quiz-question.relative div.text-center',
    description: 'ported from integrations/bunpro.js',
    parser: 'mutation',
  },
  {
    id: 'nhk-jpdb',
    label: 'NHK / JPDB / generic parse_selection',
    hosts: ['www.nhk.or.jp', 'www3.nhk.or.jp', 'jpdb.io'],
    selector: 'p, h1, h2, h3, li, article p, main p',
    description: 'ported from integrations/parse_selection.js generic — debounced full-body parse, handles subtitle selectors (.asbplayer-subtitles) for miruro/hianime/netflix/anime/youglish',
    parser: 'mutation',
  },
];

// Helper: matches current url against any integration host (glob-like)
export function detectIntegration(url: string): SiteIntegration | undefined {
  const lower = url.toLowerCase();
  // mokuro is not browser
  for (const s of SITE_INTEGRATIONS) {
    if (s.id === 'mokuro') continue;
    // Anki explicitly excluded — even if host matches ankiuser, return undefined
    if (lower.includes('ankiuser.net') || lower.includes('ankiweb.net')) return undefined;
    for (const h of s.hosts) {
      const host = h.replace('*.', '').replace('*://', '').split('/')[0];
      if (lower.includes(host.toLowerCase())) return s;
    }
  }
  return undefined;
}

export const ANKI_BLOCKLIST = ['ankiuser.net', 'ankiweb.net'] as const;

export function isAnkiUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return ANKI_BLOCKLIST.some((d) => lower.includes(d));
}
