// Navigation math extracted from yomibakoBundle.ts template string so it is
// unit-testable. The bundle is excluded from c8 (see package.json), so any
// logic that stays inside the string cannot be covered — extract first.
// Mirrors: EDGE_FRAC=0.18 tap zones, navStep RTL mapping, trySwipeTurn flick,
// spreadSize + fallback two-page snap (navGo idx%2).

export const EDGE_FRAC = 0.18;
export const SWIPE_MIN_ADX = 40;
export const SWIPE_DOMINANCE = 1.3;
export const FLICK_MAX_DT_MS = 350;
export const FLICK_MIN_VELOCITY = 0.4;

export function swipeThreshold(viewportWidth: number): number {
  return Math.max(64, viewportWidth * 0.12);
}

/** Edge-tap page delta. Returns 0 when the tap is in the centre (chrome toggle). */
export function edgeTapDelta(frac: number, rtl: boolean): -1 | 0 | 1 {
  if (frac < EDGE_FRAC || frac > 1 - EDGE_FRAC) {
    const right = frac > 0.5;
    if (rtl) {
      return right ? -1 : 1;
    }
    return right ? 1 : -1;
  }
  return 0;
}

/** Swipe-delta mapping: LTR swipe-left = next, RTL mirrored. Matches bundle. */
export function swipeDelta(dx: number, rtl: boolean): -1 | 1 {
  const base: -1 | 1 = dx < 0 ? 1 : -1;
  return rtl ? ((base * -1) as -1 | 1) : base;
}

export type SwipeInput = {
  dx: number;
  dy: number;
  dtMs: number;
  viewportWidth: number;
  total: number;
};

/** Whether a completed touch drag should turn the page. Pure predicate. */
export function shouldSwipeTurn(input: SwipeInput): boolean {
  const adx = Math.abs(input.dx);
  const ady = Math.abs(input.dy);
  if (input.total <= 1) return false;
  if (adx < SWIPE_MIN_ADX) return false;
  if (adx < ady * SWIPE_DOMINANCE) return false;
  const thresh = swipeThreshold(input.viewportWidth);
  const fastFlick =
    input.dtMs < FLICK_MAX_DT_MS && adx > SWIPE_MIN_ADX && adx > ady * 2 && adx / Math.max(1, input.dtMs) > FLICK_MIN_VELOCITY;
  if (adx < thresh && !fastFlick) return false;
  return true;
}

/** How many pages one turn advances. */
export function spreadSize(twoPage: boolean, active: boolean): number {
  return twoPage && active ? 2 : 1;
}

/** Keep fallback spreads on their starting index so turns stay in phase. */
export function snapSpreadIndex(idx: number, twoPage: boolean, active: boolean): number {
  const n = Math.round(idx);
  if (active && twoPage && n % 2 === 1 && n > 0) return n - 1;
  return Math.max(0, n);
}

/** Flick-to-skip: fast long flicks may advance more than one spread. */
export function flickSkipCount(adx: number, dtMs: number): number {
  const velocity = adx / Math.max(1, dtMs);
  if (dtMs < FLICK_MAX_DT_MS && velocity > 1.2 && adx > 220) return 3;
  if (dtMs < FLICK_MAX_DT_MS && velocity > 0.8 && adx > 140) return 2;
  return 1;
}
