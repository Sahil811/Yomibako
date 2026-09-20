// Yomibako mark — the app icon, drawn as vectors so it stays crisp in-app.
// Geometry is kept in sync with scripts/generate-icons.mjs (1024 design space).
import React from 'react';
import Svg, { Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

const LEFT_PAGE = 'M172 268C292 240 420 274 496 332L496 700C420 642 292 610 172 636C163 520 163 384 172 268Z';
const RIGHT_PAGE = 'M852 268C732 240 604 274 528 332L528 700C604 642 732 610 852 636C861 520 861 384 852 268Z';
const LEFT_STACK = 'M172 298C292 270 420 304 496 362L496 730C420 672 292 640 172 666C163 550 163 414 172 298Z';
const RIGHT_STACK = 'M852 298C732 270 604 304 528 362L528 730C604 672 732 640 852 666C861 550 861 414 852 298Z';
const RIBBON = 'M488 600L536 600L536 772L512 734L488 772Z';

export function Logo({ size = 96, badge = true }: { size?: number; badge?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      {badge ? (
        <>
          <Defs>
            <LinearGradient id="yomibakoBg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#2E3270" />
              <Stop offset="0.55" stopColor="#15162E" />
              <Stop offset="1" stopColor="#0B0B12" />
            </LinearGradient>
            <RadialGradient id="yomibakoGlow" cx="369" cy="246" r="942" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#6484FF" stopOpacity="0.38" />
              <Stop offset="0.6" stopColor="#6484FF" stopOpacity="0.07" />
              <Stop offset="1" stopColor="#6484FF" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="1024" height="1024" rx="229" fill="url(#yomibakoBg)" />
          <Rect x="0" y="0" width="1024" height="1024" rx="229" fill="url(#yomibakoGlow)" />
        </>
      ) : null}
      <G transform="translate(512 512) scale(0.92) translate(-512 -500)">
        <Path d={LEFT_STACK} fill="#8E9AC9" />
        <Path d={RIGHT_STACK} fill="#8E9AC9" />
        <Path d={RIBBON} fill="#FF4438" />
        <Path d={LEFT_PAGE} fill="#FFFFFF" />
        <Path d={RIGHT_PAGE} fill="#DCE4FA" />
      </G>
    </Svg>
  );
}
