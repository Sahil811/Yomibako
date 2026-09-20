// Where the word-lookup popup renders.
//
// Deliberately dependency-free (no react-native imports) so the geometry can be
// unit-tested headlessly with node -- see the fixture table in
// src/features/reader/__tests__/popupPlacement.test.ts.
//
// The rule, in one sentence: never cover the speech bubble the reader is in the
// middle of, never sit under their finger, and otherwise hug the word as closely
// as the screen allows.

export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type Insets = { top: number; right: number; bottom: number; left: number };
export type Frame = { x: number; y: number; width: number; height: number };

/** Which edge of the popup faces the word. Drives pinning and the entry origin. */
export type Side = 'below' | 'above' | 'right' | 'left' | 'edge' | 'center';

export type PlacementInput = {
  /** Union rect of the word, viewport-local CSS px. */
  wordRect?: Rect | null;
  /** Per-fragment rects. A word wrapping across columns has more than one. */
  wordRects?: Rect[] | null;
  /** The owning speech bubble / block, viewport-local CSS px. */
  boxRect?: Rect | null;
  /** Where the pointer actually was, viewport-local CSS px. */
  point?: Point | null;
  pointerType?: 'touch' | 'mouse';
  /** Vertical writing mode (manga columns). */
  vertical?: boolean;
  /** WebView window.innerWidth, used to scale CSS px into dp. */
  vw?: number;
  /** Native window size in dp. */
  viewport: Size;
  /** Safe-area insets in dp. */
  safe: Insets;
  /** Native frame of the WebView in dp. Omit for a full-bleed reader. */
  anchorFrame?: Frame | null;
  /** Measured popup size in dp. Pass an estimate on the first pass. */
  desired: Size;
  /** Smallest popup worth showing. Below this a slot is rejected. */
  min?: Size;
  /** Hard height cap (a share of the viewport). */
  cap?: number;
  /**
   * Side chosen last time. Wins every tie, so growing the card (expanding
   * details) keeps its pinned edge instead of teleporting to another slot.
   * Ignored when that slot can no longer show the card whole and another can.
   */
  prefer?: Side;
};

export type Placement = {
  width: number;
  maxHeight: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  side: Side;
  /** Entry-animation origin as a 0..1 fraction of the popup box. */
  originX: number;
  originY: number;
};

const OUTER_MARGIN = 12;
const GAP = 8;
/** Half-width of the area a fingertip hides around the contact point. */
const FINGER_HALF_W = 32;
/** How far the fingertip hides above / below the contact point. */
const FINGER_UP = 26;
const FINGER_DOWN = 56;

// A 390dp phone has 366dp of usable width, so a 300dp floor would reject every
// side placement and force the popup above/below even in a tall manga column.
const DEFAULT_MIN: Size = { width: 260, height: 180 };
/** Share of the wanted height the current side must still offer to keep it. */
const STICKY_KEEP = 0.7;

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.max(lo, Math.min(hi, v)));

type Edges = { left: number; top: number; right: number; bottom: number };

const edges = (r: Rect): Edges => ({ left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h });
const inflate = (e: Edges, by: number): Edges => ({
  left: e.left - by,
  top: e.top - by,
  right: e.right + by,
  bottom: e.bottom + by,
});
const union = (a: Edges, b: Edges): Edges => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
});

/**
 * Upstream jpd-breader's getClosestClientRect. A word that wraps across two
 * manga columns has a union getBoundingClientRect spanning both, which anchors
 * the popup to empty space between them. Pick the fragment nearest the pointer.
 */
export function pickClosestRect(rects: Rect[] | null | undefined, point?: Point | null): Rect | null {
  if (!rects?.length) return null;
  if (!point || rects.length === 1) return rects[0];
  let best = rects[0];
  let bestDistance = Infinity;
  for (const r of rects) {
    const dx = Math.max(r.x - point.x, 0, point.x - (r.x + r.w));
    const dy = Math.max(r.y - point.y, 0, point.y - (r.y + r.h));
    const d = Math.hypot(dx, dy);
    if (d < bestDistance) {
      bestDistance = d;
      best = r;
    }
  }
  return best;
}

type Candidate = {
  side: Side;
  slot: Edges;
  slotW: number;
  slotH: number;
  width: number;
  height: number;
  fits: boolean;
  preferred: boolean;
  distance: number;
};

function computeUsable(viewport: Size, safe: Insets, frame: Frame): Edges {
  return {
    left: Math.max(safe.left, frame.x) + OUTER_MARGIN,
    top: Math.max(safe.top, frame.y) + OUTER_MARGIN,
    right: Math.min(viewport.width - safe.right, frame.x + frame.width) - OUTER_MARGIN,
    bottom: Math.min(viewport.height - safe.bottom, frame.y + frame.height) - OUTER_MARGIN,
  };
}

function scaleForFrame(frame: Frame, vw: number): number {
  return vw > 0 ? frame.width / vw : 1;
}

function buildAvoid(
  bubble: Edges,
  pointerType: 'touch' | 'mouse',
  point: Point | null,
): Edges {
  let avoid = inflate(bubble, GAP);
  if (pointerType === 'touch' && point) {
    avoid = union(avoid, {
      left: point.x - FINGER_HALF_W,
      top: point.y - FINGER_UP,
      right: point.x + FINGER_HALF_W,
      bottom: point.y + FINGER_DOWN,
    });
  }
  return avoid;
}

function buildSlots(usable: Edges, avoid: Edges): { side: Side; slot: Edges }[] {
  return [
    { side: 'below', slot: { left: usable.left, top: Math.max(usable.top, avoid.bottom), right: usable.right, bottom: usable.bottom } },
    { side: 'above', slot: { left: usable.left, top: usable.top, right: usable.right, bottom: Math.min(usable.bottom, avoid.top) } },
    { side: 'right', slot: { left: Math.max(usable.left, avoid.right), top: usable.top, right: usable.right, bottom: usable.bottom } },
    { side: 'left', slot: { left: usable.left, top: usable.top, right: Math.min(usable.right, avoid.left), bottom: usable.bottom } },
  ];
}

function distanceForSide(side: Side, slot: Edges, word: Edges): number {
  if (side === 'below') {
    return slot.top - word.bottom;
  }
  if (side === 'above') {
    return word.top - slot.bottom;
  }
  if (side === 'right') {
    return slot.left - word.right;
  }
  return word.left - slot.right;
}

function isPreferredSide(vertical: boolean, side: Side): boolean {
  if (vertical) {
    return side === 'right' || side === 'left';
  }
  return side === 'below' || side === 'above';
}

function buildCandidates(
  slots: { side: Side; slot: Edges }[],
  word: Edges,
  desired: Size,
  min: Size,
  cap: number,
  vertical: boolean,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const { side, slot } of slots) {
    const slotW = slot.right - slot.left;
    const slotH = Math.min(slot.bottom - slot.top, cap);
    if (slotW < min.width || slotH < min.height) {
      continue;
    }
    const width = Math.min(desired.width, slotW);
    const height = Math.min(desired.height, slotH);
    const distance = distanceForSide(side, slot, word);
    candidates.push({
      side,
      slot,
      slotW,
      slotH,
      width,
      height,
      fits: slotW >= desired.width && slotH >= desired.height,
      // Vertical manga text reads down a column, so a popup beside it keeps the
      // most of the page readable. Horizontal text prefers above/below.
      preferred: isPreferredSide(vertical, side),
      distance: Math.max(0, distance),
    });
  }
  return candidates;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.fits !== b.fits) {
    return a.fits ? -1 : 1;
  }
  if (!a.fits) {
    // Neither shows the card whole, so show as much of it as possible.
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    if (Math.abs(areaA - areaB) > 1) {
      return areaB - areaA;
    }
  }
  if (a.preferred !== b.preferred) {
    return a.preferred ? -1 : 1;
  }
  return a.distance - b.distance;
}

function chooseBestCandidate(candidates: Candidate[], prefer: Side | undefined, desired: Size): Candidate | undefined {
  // Staying put beats showing a little more card. Expanding details should feel
  // like the card grew, not like it jumped to the other side of the page, and
  // the content scrolls anyway. Only abandon the current side once it has lost
  // most of the room.
  const sticky = candidates.find((c) => c.side === prefer);
  const keepSticky = !!sticky && (sticky.fits || sticky.height >= desired.height * STICKY_KEEP);
  if (keepSticky) {
    return sticky;
  }
  const sorted = [...candidates].sort(compareCandidates);
  return sorted[0];
}

function centeredPlacement(
  desired: Size,
  min: Size,
  usable: Edges,
  usableW: number,
  cap: number,
): Placement {
  const width = clamp(desired.width, Math.min(min.width, usableW), usableW);
  const top = usable.top + 24;
  return {
    width,
    maxHeight: Math.min(cap, usable.bottom - top),
    left: usable.left + (usableW - width) / 2,
    top,
    side: 'center',
    originX: 0.5,
    originY: 0,
  };
}

function layoutBelowAbove(
  best: Candidate,
  word: Edges,
  wordCenterX: number,
  viewport: Size,
): Placement {
  const { side, slot, width } = best;
  const box: Placement = { width, maxHeight: best.slotH, side, originX: 0.5, originY: 0.5 };
  // Align along the word, biased toward whichever side has more room.
  const leftSpace = word.left - slot.left;
  const rightSpace = slot.right - word.right;
  let anchorLeft = word.right - width;
  if (rightSpace >= leftSpace) {
    anchorLeft = word.left;
  }
  const left = clamp(anchorLeft, slot.left, slot.right - width);
  box.left = left;
  box.originX = clamp((wordCenterX - left) / width, 0, 1);
  if (side === 'below') {
    box.top = slot.top;
    box.originY = 0;
  } else {
    box.bottom = viewport.height - slot.bottom;
    box.originY = 1;
  }
  return box;
}

function layoutSide(
  best: Candidate,
  word: Edges,
  wordCenterY: number,
  viewport: Size,
): Placement {
  const { side, slot, width } = best;
  const height = Math.min(best.height, best.slotH);
  const box: Placement = { width, maxHeight: best.slotH, side, originX: 0.5, originY: 0.5 };
  const topSpace = word.top - slot.top;
  const bottomSpace = slot.bottom - word.bottom;
  let anchorTop = word.bottom - height;
  if (bottomSpace >= topSpace) {
    anchorTop = word.top;
  }
  const top = clamp(anchorTop, slot.top, slot.bottom - height);
  box.top = top;
  box.originY = clamp((wordCenterY - top) / height, 0, 1);
  // Unlike below/above, `top` floats, so the slot height is not the room left
  // underneath it. The card can still grow after placement (a late AI answer,
  // say) and would otherwise run off the bottom of the slot.
  box.maxHeight = Math.min(box.maxHeight, slot.bottom - top);
  if (side === 'right') {
    box.left = slot.left;
    box.originX = 0;
  } else {
    box.right = viewport.width - slot.right;
    box.originX = 1;
  }
  return box;
}

function layoutBest(best: Candidate, word: Edges, viewport: Size): Placement {
  const wordCenterX = (word.left + word.right) / 2;
  const wordCenterY = (word.top + word.bottom) / 2;
  if (best.side === 'below' || best.side === 'above') {
    return layoutBelowAbove(best, word, wordCenterX, viewport);
  }
  return layoutSide(best, word, wordCenterY, viewport);
}

export function placePopup(input: PlacementInput): Placement {
  const {
    viewport,
    safe,
    desired,
    vertical = false,
    pointerType = 'touch',
    anchorFrame,
  } = input;
  const min = input.min ?? DEFAULT_MIN;
  const frame: Frame = anchorFrame ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };

  const usable = computeUsable(viewport, safe, frame);
  const usableW = Math.max(0, usable.right - usable.left);
  const usableH = Math.max(0, usable.bottom - usable.top);
  const cap = Math.min(input.cap ?? Infinity, usableH);

  // CSS px -> dp. The reader is full-bleed so k is ~1; the browser's WebView
  // sits below its chrome and may be pinch-zoomed, so both offset and scale
  // matter there.
  const vw = Number(input.vw) || 0;
  const k = scaleForFrame(frame, vw);
  const toDp = (r: Rect): Rect => ({
    x: frame.x + r.x * k,
    y: frame.y + r.y * k,
    w: r.w * k,
    h: r.h * k,
  });

  const rawWord = pickClosestRect(input.wordRects, input.point) ?? input.wordRect ?? null;

  // No coordinates at all: centre it near the top, as before.
  if (!rawWord) {
    return centeredPlacement(desired, min, usable, usableW, cap);
  }

  const word = edges(toDp(rawWord));
  const bubble = input.boxRect ? edges(toDp(input.boxRect)) : word;
  const point = input.point ? { x: frame.x + input.point.x * k, y: frame.y + input.point.y * k } : null;

  // What the popup must not overlap: the bubble being read, plus the patch of
  // screen the reader's own fingertip is already hiding.
  const avoid = buildAvoid(bubble, pointerType, point);
  const slots = buildSlots(usable, avoid);
  const candidates = buildCandidates(slots, word, desired, min, cap, vertical);
  const best = chooseBestCandidate(candidates, input.prefer, desired);
  if (!best) {
    return edgeFallback(input, usable, word, cap, min);
  }
  return layoutBest(best, word, viewport);
}

/**
 * Nothing fits beside the bubble. Retreat to the band furthest from the word:
 * the word itself stays visible even though the rest of its bubble does not.
 */
function edgeFallback(
  input: PlacementInput,
  usable: Edges,
  word: Edges,
  cap: number,
  min: Size
): Placement {
  const { viewport, desired } = input;
  const usableW = Math.max(0, usable.right - usable.left);
  const usableH = Math.max(0, usable.bottom - usable.top);
  const width = clamp(desired.width, Math.min(min.width, usableW), usableW);
  const left = clamp((word.left + word.right) / 2 - width / 2, usable.left, usable.right - width);
  const originX = clamp(((word.left + word.right) / 2 - left) / width, 0, 1);

  const topRemain = Math.max(0, word.top - GAP - usable.top);
  const bottomRemain = Math.max(0, usable.bottom - (word.bottom + GAP));
  const below = bottomRemain >= topRemain;
  let height = Math.min(cap, below ? bottomRemain : topRemain);

  // Degenerate: the word all but fills the screen, so clearing it leaves no
  // room at all. Take the far half and accept the overlap.
  if (height < 120) {
    height = Math.min(cap, usableH / 2);
    const wordBelowMiddle = (word.top + word.bottom) / 2 > (usable.top + usable.bottom) / 2;
    return wordBelowMiddle
      ? { width, maxHeight: height, left, top: usable.top, side: 'edge', originX, originY: 1 }
      : { width, maxHeight: height, left, bottom: viewport.height - usable.bottom, side: 'edge', originX, originY: 0 };
  }

  return below
    ? { width, maxHeight: height, left, bottom: viewport.height - usable.bottom, side: 'edge', originX, originY: 1 }
    : { width, maxHeight: height, left, top: usable.top, side: 'edge', originX, originY: 0 };
}
