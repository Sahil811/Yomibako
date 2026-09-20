// Apple-clean icon set — thin-stroke, rounded, SF-Symbol-like.
// Hand-built SVG (Feather-style, MIT) on react-native-svg — zero native deps, works on web.
// 24×24 viewBox, round caps/joins, 1.7–2px stroke ≈ SF Symbols.
import React from 'react';
import Svg, { Path, Circle, Rect, Polyline, Line, Polygon } from 'react-native-svg';

export type IconName =
  | 'library'
  | 'book'
  | 'bookOpen'
  | 'browse'
  | 'browser'
  | 'settings'
  | 'search'
  | 'close'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronDown'
  | 'grid'
  | 'list'
  | 'folder'
  | 'file'
  | 'play'
  | 'pause'
  | 'plus'
  | 'check'
  | 'checkCircle'
  | 'circle'
  | 'trash'
  | 'more'
  | 'ai'
  | 'sort'
  | 'reload'
  | 'info'
  | 'lang'
  | 'lock'
  | 'audio'
  | 'repeat'
  | 'expand'
  | 'collapse';

function Strokes({ color, strokeWidth, children }: { color: string; strokeWidth: number; children: React.ReactNode }) {
  return <>{children}</>;
}

function Glyph({ name, color, strokeWidth }: { name: IconName; color: string; strokeWidth: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'library':
    case 'bookOpen':
      return (
        <>
          <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" {...p} />
          <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" {...p} />
        </>
      );
    case 'book':
      return (
        <>
          <Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" {...p} />
          <Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" {...p} />
        </>
      );
    case 'browse':
    case 'folder':
      return <Path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" {...p} />;
    case 'browser':
      return (
        <>
          <Circle cx="12" cy="12" r="10" {...p} />
          <Line x1="2" y1="12" x2="22" y2="12" {...p} />
          <Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" {...p} />
        </>
      );
    case 'settings':
      return (
        <>
          <Line x1="4" y1="21" x2="4" y2="14" {...p} />
          <Line x1="4" y1="10" x2="4" y2="3" {...p} />
          <Line x1="12" y1="21" x2="12" y2="12" {...p} />
          <Line x1="12" y1="8" x2="12" y2="3" {...p} />
          <Line x1="20" y1="21" x2="20" y2="16" {...p} />
          <Line x1="20" y1="12" x2="20" y2="3" {...p} />
          <Line x1="1" y1="14" x2="7" y2="14" {...p} />
          <Line x1="9" y1="8" x2="15" y2="8" {...p} />
          <Line x1="17" y1="16" x2="23" y2="16" {...p} />
        </>
      );
    case 'search':
      return (
        <>
          <Circle cx="11" cy="11" r="8" {...p} />
          <Line x1="21" y1="21" x2="16.65" y2="16.65" {...p} />
        </>
      );
    case 'close':
      return (
        <>
          <Line x1="18" y1="6" x2="6" y2="18" {...p} />
          <Line x1="6" y1="6" x2="18" y2="18" {...p} />
        </>
      );
    case 'chevronRight':
      return <Polyline points="9 18 15 12 9 6" {...p} />;
    case 'chevronLeft':
      return <Polyline points="15 18 9 12 15 6" {...p} />;
    case 'chevronDown':
      return <Polyline points="6 9 12 15 18 9" {...p} />;
    case 'grid':
      return (
        <>
          <Rect x="3" y="3" width="7" height="7" rx="1" {...p} />
          <Rect x="14" y="3" width="7" height="7" rx="1" {...p} />
          <Rect x="14" y="14" width="7" height="7" rx="1" {...p} />
          <Rect x="3" y="14" width="7" height="7" rx="1" {...p} />
        </>
      );
    case 'list':
      return (
        <>
          <Line x1="8" y1="6" x2="21" y2="6" {...p} />
          <Line x1="8" y1="12" x2="21" y2="12" {...p} />
          <Line x1="8" y1="18" x2="21" y2="18" {...p} />
          <Line x1="3" y1="6" x2="3.01" y2="6" {...p} />
          <Line x1="3" y1="12" x2="3.01" y2="12" {...p} />
          <Line x1="3" y1="18" x2="3.01" y2="18" {...p} />
        </>
      );
    case 'file':
      return (
        <>
          <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" {...p} />
          <Polyline points="14 2 14 8 20 8" {...p} />
          <Line x1="16" y1="13" x2="8" y2="13" {...p} />
          <Line x1="16" y1="17" x2="8" y2="17" {...p} />
        </>
      );
    case 'play':
      return <Polygon points="6 3 20 12 6 21 6 3" fill={color} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />;
    case 'pause':
      return (
        <>
          <Rect x="6" y="4" width="4" height="16" rx="1" fill={color} stroke="none" />
          <Rect x="14" y="4" width="4" height="16" rx="1" fill={color} stroke="none" />
        </>
      );
    case 'plus':
      return (
        <>
          <Line x1="12" y1="5" x2="12" y2="19" {...p} />
          <Line x1="5" y1="12" x2="19" y2="12" {...p} />
        </>
      );
    case 'check':
      return <Polyline points="20 6 9 17 4 12" {...p} />;
    case 'checkCircle':
      return (
        <>
          <Circle cx="12" cy="12" r="10" fill={color} stroke="none" />
          <Polyline points="7.6 12.3 10.7 15.4 16.4 9.2" stroke="#FFFFFF" strokeWidth={2.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case 'circle':
      return <Circle cx="12" cy="12" r="9.5" {...p} />;
    case 'trash':
      return (
        <>
          <Line x1="3.5" y1="6" x2="20.5" y2="6" {...p} />
          <Path d="M18.5 6l-.9 13.1A2 2 0 0 1 15.6 21H8.4a2 2 0 0 1-2-1.9L5.5 6" {...p} />
          <Path d="M9.5 6V4.4A1.4 1.4 0 0 1 10.9 3h2.2a1.4 1.4 0 0 1 1.4 1.4V6" {...p} />
          <Line x1="10.3" y1="10.5" x2="10.3" y2="17" {...p} />
          <Line x1="13.7" y1="10.5" x2="13.7" y2="17" {...p} />
        </>
      );
    case 'more':
      return (
        <>
          <Circle cx="12" cy="5" r="1.7" fill={color} stroke="none" />
          <Circle cx="12" cy="12" r="1.7" fill={color} stroke="none" />
          <Circle cx="12" cy="19" r="1.7" fill={color} stroke="none" />
        </>
      );
    case 'ai':
      return <Path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" {...p} />;
    case 'sort':
      return (
        <>
          <Polyline points="7 16 7 4 3 8" {...p} />
          <Polyline points="7 4 11 8" {...p} />
          <Polyline points="17 8 17 20 21 16" {...p} />
          <Polyline points="17 20 13 16" {...p} />
        </>
      );
    case 'reload':
      return (
        <>
          <Polyline points="23 4 23 10 17 10" {...p} />
          <Polyline points="1 20 1 14 7 14" {...p} />
          <Path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" {...p} />
        </>
      );
    case 'info':
      return (
        <>
          <Circle cx="12" cy="12" r="10" {...p} />
          <Line x1="12" y1="16" x2="12" y2="12" {...p} />
          <Line x1="12" y1="8" x2="12.01" y2="8" {...p} />
        </>
      );
    case 'lang':
      return (
        <>
          <Path d="M4 5h9" {...p} />
          <Path d="M8.5 3v2c0 3-2 5.5-4.5 7" {...p} />
          <Path d="M6 9c1 2.5 3.5 4.5 6 5" {...p} />
          <Path d="M12.5 21l4.5-10 4.5 10" {...p} />
          <Line x1="14.2" y1="17" x2="19.3" y2="17" {...p} />
        </>
      );
    case 'lock':
      return (
        <>
          <Rect x="3" y="11" width="18" height="11" rx="2" {...p} />
          <Path d="M7 11V7a5 5 0 0 1 10 0v4" {...p} />
        </>
      );
    case 'audio':
      return (
        <>
          <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" {...p} />
          <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" {...p} />
        </>
      );
    case 'repeat':
      return (
        <>
          <Polyline points="17 1 21 5 17 9" {...p} />
          <Path d="M3 11V9a4 4 0 0 1 4-4h14" {...p} />
          <Polyline points="7 23 3 19 7 15" {...p} />
          <Path d="M21 13v2a4 4 0 0 1-4 4H3" {...p} />
        </>
      );
    case 'expand':
      return (
        <>
          <Polyline points="8 3 3 3 3 8" {...p} />
          <Line x1="3" y1="3" x2="9" y2="9" {...p} />
          <Polyline points="16 3 21 3 21 8" {...p} />
          <Line x1="21" y1="3" x2="15" y2="9" {...p} />
          <Polyline points="3 16 3 21 8 21" {...p} />
          <Line x1="3" y1="21" x2="9" y2="15" {...p} />
          <Polyline points="21 16 21 21 16 21" {...p} />
          <Line x1="21" y1="21" x2="15" y2="15" {...p} />
        </>
      );
    case 'collapse':
      return (
        <>
          <Polyline points="3 8 8 8 8 3" {...p} />
          <Line x1="8" y1="8" x2="3" y2="3" {...p} />
          <Polyline points="21 8 16 8 16 3" {...p} />
          <Line x1="16" y1="8" x2="21" y2="3" {...p} />
          <Polyline points="3 16 8 16 8 21" {...p} />
          <Line x1="8" y1="16" x2="3" y2="21" {...p} />
          <Polyline points="21 16 16 16 16 21" {...p} />
          <Line x1="16" y1="16" x2="21" y2="21" {...p} />
        </>
      );
    default:
      return <Circle cx="12" cy="12" r="9" {...p} />;
  }
}

export const Icon = React.memo(function Icon({
  name,
  size = 22,
  color = '#007AFF',
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Glyph name={name} color={color} strokeWidth={strokeWidth} />
    </Svg>
  );
});
