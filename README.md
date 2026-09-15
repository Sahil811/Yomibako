# Yomibako よみばこ — read manga where it lives

On-device manga reader for Japanese learners. Point it at a folder of
[mokuro](https://github.com/kha-white/mokuro) volumes and read — no import,
no 5 GB duplication. Tap any word for a JPDB-powered popup card with
meanings, pitch accent, kanji breakdown, audio, and one-tap mining.

Parsing/tokenization ports [jpd-breader](https://github.com/jpdbrowser) 13.0
(`content/parse.js` `applyTokens`, `integrations/mokuro.js`), adapted to a
React Native WebView bridge.

## Features

- **Folder streaming** — SAF folder permission once; volumes are cache-copied
  on open so `<img>` loads natively. Permission persists across reboots.
- **Chunked parse pipeline** — visible pages are split into bounded chunks
  (≤4000 chars) with a 3-in-flight queue, so 100 KB+ token replies can't
  freeze the WebView. Failures stay retryable.
- **Popup word card** — floating card styled on the jpd-breader popup:
  state badges, frequency + pitch diagram, ghost action row
  (Never forget / Examples; Add, Review, Blacklist opt-in via Settings),
  collapsible sentence editor, ImmersionKit examples, Gemini AI explanations.
- **Offline kanji breakdown** — bundled meanings, component decomposition,
  and RTK mnemonics (same data files the extension ships). No network needed.
- **Audio** — JPDB recordings work with no login (verified: logged-out
  vocabulary pages already carry the audio hash).
- **JPDB login session** — hidden session WebView shares cookies with the
  Browser tab, enabling login-gated features: SRS reviews, FORQ.
- **Browser tab** — generic jpd-breader parsing for TTSU, texthooker,
  Readwok, Wikipedia/Syosetu, Bunpro, NHK, with prev/next unknown-word jump.
- **On-device diagnostics** — Settings → Diagnostics reports the reader
  pipeline state (pages, parse requests ok/failed, spans applied, taps,
  audio/session errors). No logcat needed.

## Requirements

- A series folder of mokuro output:
  ```
  Detective Conan/
    Meitantei Konan 001.mobile.html   # preferred (responsive)
    Meitantei Konan 001/
      page0001.jpeg
      ...
  ```
  Also accepted: plain `.html`, `.mokuro` zips (iOS share path),
  `_ocr/` volume JSON (detected, reader uses HTML for now).
- A **JPDB API token** (jpdb.io → Settings → API token) for parsing/mining.
- Optional: **JPDB login** (Settings → JPDB Login) for SRS reviews + FORQ.
  Audio works without it.

## Run

```
npm install
npx expo run:android     # or run:ios (prebuilds android/ios first)
```

Then: Settings → paste the JPDB API token → Save → open a volume from
Library and tap a word. Tap Settings → JPDB Login and sign in for reviews.

## Settings worth knowing

- **Behavior** — word-popup buttons beyond Never forget / Examples are
  opt-in: Add button, Review buttons, Blacklist button. RTK mnemonics on
  by default; kanji breakdown, auto-fetch examples, compact mining, popup
  scale (50–200%), custom Word/Popup CSS, touchscreen mode.
- **Decks** — mining / FORQ / blacklist / never-forget deck IDs.
  `"forq"`, `"blacklist"`, `"never-forget"` are JPDB magic IDs and work
  as-is; numeric IDs target your own decks.
- Config migrates forward automatically (schema v4); Reset to Defaults
  clears token + decks.

## Diagnostics

Open any volume, wait ~10 s on a text-heavy page, tap 2–3 words, then
Settings → Refresh reader diagnostics:

```
volume: …              time: …
token: set | MISSING
pages: N (sel: …, textBoxes: M)
parse requests: R, ok: O, failed: F
last error: …
taps: bg B, words W, spans applied S
audio: …               session: bridge …, login …, jobs a/b
```

- `parseReq 0` + `boxes 0` → observer/selector problem
- `failed > 0` + `last error` → JPDB API/token problem
- `ok > 0` + `spans 0` → token reply never applied
- `spans > 0` + `words 0` → span/click mismatch
- `audio:` / `session:` → audio hash / login-bridge health

## How it works

- `src/features/reader/yomibakoBundle.ts` — injected JS: mokuro page
  observer, chunked parse scheduler, `applyTokens` + furigana, tap bridge.
- `src/features/reader/MokuroWebView.tsx` — RN side: JPDB parse calls,
  chunked token replies (`__yomibakoOnTokensChunk`), image resolution,
  pipeline counters persisted for Diagnostics.
- `src/services/jpdb/api.ts` — full jpd-breader API port (parse, decks,
  flags, reviews, FORQ) minus Anki export.
- `src/services/jpdb/session.ts` + `components/system/JpdbSessionWebView`
  — cookie-authenticated scraping for login-gated endpoints.
- `src/services/jpdb/kanjiData.ts` + `assets/kanji/*.json` — offline
  kanji meanings, components, RTK (extension data files).
- `src/features/browser/` — generic-site parsing bundle + integrations.

## Roadmap

- Native canvas reader rendering `_ocr/*.json` blocks directly (no HTML)
- Offline dictionary fallback for lookups
- Anki Connect export, cloud sync

## Credits

- Parsing, popup design, kanji data: jpd-breader 13.0
- OCR HTML: mokuro · Dictionary/SRS/audio: [jpdb.io](https://jpdb.io)
- Examples: ImmersionKit · Kanji API fallback: kanjiapi.dev
