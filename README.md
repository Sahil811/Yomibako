# Yomibako よみばこ — Read manga where it lives

Clean, on-device manga reader for learners. Direct folder access — no import or duplication. Built on `jpd-breader_13.0` + `mokuro`.

## Why Yomibako (not Mokuro Reader)
`Mokuro Reader` is generic + many clones. `Yomibako` = `Yomi + Hako` (reading box), brandable, `com.yomibako.reader`.

## Direct Folder Access
Grant folder permission once to a series folder like `Detective Conan` (100 volumes, 37k pages). Yomibako reads **where data is**, streams images via an efficient bridge for the WebView. Permission persists after reboot — no 5 GB duplication.

Structure supported:
```
Detective Conan/
  Meitantei Konan 001.mobile.html  // preferred (responsive)
  Meitantei Konan 001.html
  Meitantei Konan 001.mokuro       // zip share via Share sheet (iOS)
  Meitantei Konan 001/page0001.jpeg
  _ocr/Meitantei Konan 096/page0003.json {img_width, blocks:[{box, lines}]}
```

## Stack
Expo 57 + RN 0.86 + TS, `react-native-webview` (reuses `assets/jpd-breader/content/parse.js` `applyTokens` + `integrations/mokuro.js`), `expo-sqlite` index, `expo-secure-store` jpdb token, `expo-image`, `Reanimated 3`, `React Navigation 7`, `Zustand + TanStack Query`.

## Run
```
npm install
npx expo prebuild        // generate android/ios
npx expo run:android     // or run:ios
```
Set JPDB token in Settings — same token as `jpd-breader` `background/backend.js`.

## Reader
Loads `.mobile.html` with `baseUrl` via local bridge. Injects `jpd-breader` bundle, intercepts `requestParse` → `services/jpdb/api.ts` `jpdbApi.parse` (8192 batch) → `content/parse.js` `applyTokens` overlays. Tap word → bottom sheet with meanings, pitch, audio, and mining actions.

## Next
- P1: Native Canvas reader (parse `_ocr/*.json` blocks directly, without HTML)
- P2: Offline dict + Anki Connect + cloud sync
