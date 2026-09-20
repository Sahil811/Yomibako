// Fixture table for the popup placement geometry. Runs headlessly:
//   npm run test:placement
//
// Every case asserts the invariants that matter to a reader: the popup does not
// cover the speech bubble, it stays inside the usable region, and it lands on
// the side we expect.

import test from 'node:test';
import assert from 'node:assert/strict';
import { placePopup, pickClosestRect, type PlacementInput, type Placement, type Rect } from '../popupPlacement';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const PHONE = { width: 390, height: 844 };
const PHONE_INSETS = { top: 59, right: 0, bottom: 34, left: 0 };
const TABLET_LANDSCAPE = { width: 1180, height: 820 };

const CARD = { width: 380, height: 320 };

function base(over: Partial<PlacementInput>): PlacementInput {
  return {
    viewport: PHONE,
    safe: NO_INSETS,
    desired: CARD,
    vw: PHONE.width,
    pointerType: 'touch',
    ...over,
  };
}

/** Resolve a Placement into absolute edges using its measured height. */
function box(p: Placement, viewport: { width: number; height: number }, height = p.maxHeight) {
  const h = Math.min(height, p.maxHeight);
  const left = p.left ?? viewport.width - (p.right ?? 0) - p.width;
  const top = p.top ?? viewport.height - (p.bottom ?? 0) - h;
  return { left, top, right: left + p.width, bottom: top + h };
}

function overlaps(a: { left: number; top: number; right: number; bottom: number }, r: Rect) {
  return a.left < r.x + r.w && a.right > r.x && a.top < r.y + r.h && a.bottom > r.y;
}

test('pickClosestRect returns the fragment nearest the pointer', () => {
  const rects: Rect[] = [
    { x: 300, y: 100, w: 24, h: 180 },
    { x: 260, y: 100, w: 24, h: 90 },
  ];
  assert.equal(pickClosestRect(rects, { x: 268, y: 140 }), rects[1]);
  assert.equal(pickClosestRect(rects, { x: 310, y: 250 }), rects[0]);
  assert.equal(pickClosestRect(rects, null), rects[0]);
  assert.equal(pickClosestRect([], { x: 0, y: 0 }), null);
});

// A full-height manga column hugging the right edge: nothing fits above or
// below it, so the popup must take the strip to its left rather than a corner.
const TALL_COLUMN: Rect = { x: 300, y: 40, w: 80, h: 760 };
const COLUMN_WORD: Rect = { x: 320, y: 150, w: 24, h: 60 };
const COLUMN_POINT = { x: 332, y: 180 };

test('a full-height column at the right edge places the popup to its left', () => {
  const p = placePopup(
    base({ vertical: true, boxRect: TALL_COLUMN, wordRect: COLUMN_WORD, point: COLUMN_POINT })
  );
  assert.equal(p.side, 'left');
  const b = box(p, PHONE, CARD.height);
  assert.ok(!overlaps(b, TALL_COLUMN), 'must not cover the bubble');
  assert.ok(b.left >= 12 && b.right <= PHONE.width - 12, 'stays in the usable region');
});

test('a short column leaves room below, and the wider slot wins over the side', () => {
  const boxRect: Rect = { x: 268, y: 90, w: 96, h: 300 };
  const wordRect: Rect = { x: 300, y: 150, w: 24, h: 60 };
  const p = placePopup(base({ vertical: true, boxRect, wordRect, point: { x: 312, y: 180 } }));
  assert.equal(p.side, 'below');
  const b = box(p, PHONE, CARD.height);
  assert.ok(!overlaps(b, boxRect), 'must not cover the bubble');
  assert.ok(p.width > 366 - 96, 'the below slot is wider than the leftover strip');
});

test('vertical bubble centred goes above or below, never to a far corner', () => {
  const boxRect: Rect = { x: 120, y: 240, w: 150, h: 320 };
  const wordRect: Rect = { x: 200, y: 300, w: 24, h: 64 };
  const p = placePopup(base({ vertical: true, boxRect, wordRect, point: { x: 212, y: 330 } }));
  assert.ok(p.side === 'above' || p.side === 'below', `expected above/below, got ${p.side}`);
  const b = box(p, PHONE, CARD.height);
  assert.ok(!overlaps(b, boxRect), 'must not cover the bubble');
});

test('a short card sits right next to the word, not shoved to an edge', () => {
  // The regression that motivated this module: placement used the *max* height
  // (360/560) as if it were the card height, pushing short cards far away.
  const p = placePopup(
    base({
      vertical: true,
      boxRect: TALL_COLUMN,
      wordRect: COLUMN_WORD,
      point: COLUMN_POINT,
      desired: { width: 330, height: 180 },
    })
  );
  const b = box(p, PHONE, 180);
  assert.ok(Math.abs(b.top - COLUMN_WORD.y) <= 16, `top ${b.top} should hug the word at y=${COLUMN_WORD.y}`);
});

test('touch placement clears the fingertip below the contact point', () => {
  const boxRect: Rect = { x: 40, y: 100, w: 300, h: 60 };
  const wordRect: Rect = { x: 150, y: 110, w: 60, h: 40 };
  const point = { x: 180, y: 130 };
  const p = placePopup(base({ boxRect, wordRect, point, pointerType: 'touch' }));
  assert.equal(p.side, 'below');
  const b = box(p, PHONE, CARD.height);
  assert.ok(b.top >= point.y + 56, `top ${b.top} must clear the finger zone at ${point.y + 56}`);
});

test('mouse hover hugs the word far more tightly than touch', () => {
  const boxRect: Rect = { x: 40, y: 100, w: 300, h: 60 };
  const wordRect: Rect = { x: 150, y: 110, w: 60, h: 40 };
  const point = { x: 180, y: 130 };
  const touch = box(placePopup(base({ boxRect, wordRect, point, pointerType: 'touch' })), PHONE, CARD.height);
  const mouse = box(placePopup(base({ boxRect, wordRect, point, pointerType: 'mouse' })), PHONE, CARD.height);
  assert.ok(mouse.top < touch.top, 'mouse popup should sit closer to the word');
  assert.equal(mouse.top, 100 + 60 + 8, 'mouse gap is the bubble bottom plus 8');
});

test('tablet landscape fits the full-width card beside a column', () => {
  const boxRect: Rect = { x: 500, y: 80, w: 140, h: 600 };
  const wordRect: Rect = { x: 560, y: 200, w: 28, h: 80 };
  const p = placePopup(
    base({
      viewport: TABLET_LANDSCAPE,
      vw: TABLET_LANDSCAPE.width,
      vertical: true,
      boxRect,
      wordRect,
      point: { x: 574, y: 240 },
    })
  );
  assert.ok(p.side === 'right' || p.side === 'left', `expected a side placement, got ${p.side}`);
  assert.equal(p.width, 380, 'no shrinking needed on a tablet');
  const b = box(p, TABLET_LANDSCAPE, CARD.height);
  assert.ok(!overlaps(b, boxRect));
});

test('safe areas are excluded from the usable region', () => {
  const boxRect: Rect = { x: 40, y: 300, w: 300, h: 80 };
  const wordRect: Rect = { x: 150, y: 320, w: 60, h: 40 };
  const p = placePopup(
    base({ safe: PHONE_INSETS, boxRect, wordRect, point: { x: 180, y: 340 } })
  );
  const b = box(p, PHONE, CARD.height);
  assert.ok(b.top >= 59 + 12, `top ${b.top} must clear the status bar`);
  assert.ok(b.bottom <= PHONE.height - 34 - 12, `bottom ${b.bottom} must clear the home indicator`);
});

test('a bubble filling the viewport falls back to an edge but still clears the word', () => {
  const boxRect: Rect = { x: 4, y: 4, w: 382, h: 836 };
  const wordRect: Rect = { x: 180, y: 600, w: 30, h: 70 };
  const p = placePopup(base({ vertical: true, boxRect, wordRect, point: { x: 195, y: 630 } }));
  assert.equal(p.side, 'edge');
  const b = box(p, PHONE);
  assert.ok(!overlaps(b, wordRect), 'the word itself must stay visible');
});

test('browser anchorFrame offsets and scales the rect into screen space', () => {
  const frame = { x: 0, y: 120, width: 390, height: 600 };
  const wordRect: Rect = { x: 100, y: 50, w: 60, h: 20 };
  const p = placePopup(
    base({
      anchorFrame: frame,
      vw: 780, // page reports twice the native width, so k = 0.5
      wordRect,
      boxRect: { x: 20, y: 40, w: 700, h: 60 },
      point: { x: 130, y: 60 },
    })
  );
  const b = box(p, PHONE, CARD.height);
  assert.ok(b.top >= frame.y, 'never above the WebView frame');
  assert.ok(b.bottom <= frame.y + frame.height, 'never below the WebView frame');
});

test('missing coordinates fall back to a centred card', () => {
  const p = placePopup(base({ wordRect: null, wordRects: null }));
  assert.equal(p.side, 'center');
  // 380 does not fit inside the 366dp usable width, so it shrinks and pins to it.
  assert.equal(p.width, 366);
  assert.equal(p.left, 12);
});

test('a word wrapped across two columns anchors to the fragment under the finger', () => {
  // Exactly the payload the reader bundle's anchorFor emits for a word split
  // over two manga columns. Its union rect spans both, so placing against
  // `rect` alone would anchor to the gap between them.
  const payload = {
    rect: { x: 300, y: 150, w: 44, h: 60 },
    rects: [
      { x: 300, y: 150, w: 20, h: 60 },
      { x: 324, y: 150, w: 20, h: 24 },
    ],
    boxRect: { x: 268, y: 90, w: 96, h: 300 },
    point: { x: 330, y: 158 },
    vertical: true,
  };
  const withFragments = placePopup(
    base({
      wordRect: payload.rect,
      wordRects: payload.rects,
      boxRect: payload.boxRect,
      point: payload.point,
      vertical: true,
      desired: { width: 330, height: 200 },
    })
  );
  const unionOnly = placePopup(
    base({
      wordRect: payload.rect,
      boxRect: payload.boxRect,
      point: payload.point,
      vertical: true,
      desired: { width: 330, height: 200 },
    })
  );
  // The pointer is on the short second fragment, which ends at y=174.
  assert.equal(pickClosestRect(payload.rects, payload.point), payload.rects[1]);
  assert.notDeepEqual(withFragments, unionOnly, 'fragments must change the answer');
});

test('a side-placed card cannot grow past the bottom of its slot', () => {
  // `top` floats for side placements, so maxHeight must be the room left below
  // it -- not the whole slot height. Otherwise content arriving after placement
  // (a late AI answer) pushes the card off screen.
  const p = placePopup(
    base({
      vertical: true,
      boxRect: TALL_COLUMN,
      wordRect: COLUMN_WORD,
      point: COLUMN_POINT,
      desired: { width: 330, height: 180 },
    })
  );
  assert.equal(p.side, 'left');
  const grown = box(p, PHONE, p.maxHeight);
  assert.ok(grown.bottom <= PHONE.height - 12, `grown bottom ${grown.bottom} escapes the usable region`);
});

test('the centred fallback also respects the bottom of the usable region', () => {
  const p = placePopup(base({ wordRect: null, wordRects: null }));
  const grown = box(p, PHONE, p.maxHeight);
  assert.ok(grown.bottom <= PHONE.height - 12, `grown bottom ${grown.bottom} escapes the usable region`);
});

test('the taller default card (kanji now always shown) still finds a real slot', () => {
  // Showing kanji by default raised the collapsed estimate from 300 to 380dp.
  // If that no longer fits beside a typical bubble, every lookup degrades to
  // the screen-edge fallback, which is worse than what we replaced.
  const tall = { width: 351, height: 380 };
  const cases: { name: string; input: Partial<PlacementInput> }[] = [
    {
      name: 'right-edge column',
      input: { vertical: true, boxRect: TALL_COLUMN, wordRect: COLUMN_WORD, point: COLUMN_POINT },
    },
    {
      name: 'centred bubble',
      input: {
        vertical: true,
        boxRect: { x: 120, y: 240, w: 150, h: 320 },
        wordRect: { x: 200, y: 300, w: 24, h: 64 },
        point: { x: 212, y: 330 },
      },
    },
    {
      name: 'top-of-page bubble',
      input: {
        vertical: true,
        boxRect: { x: 60, y: 60, w: 140, h: 260 },
        wordRect: { x: 120, y: 100, w: 24, h: 60 },
        point: { x: 132, y: 130 },
      },
    },
  ];
  for (const { name, input } of cases) {
    const p = placePopup(base({ ...input, desired: tall }));
    assert.notEqual(p.side, 'edge', `${name} fell back to the screen edge`);
    assert.ok(p.maxHeight >= 200, `${name} only offered ${p.maxHeight}dp`);
  }
});

test('the entry origin points back at the word', () => {
  const boxRect: Rect = { x: 40, y: 100, w: 300, h: 60 };
  const wordRect: Rect = { x: 150, y: 110, w: 60, h: 40 };
  const p = placePopup(base({ boxRect, wordRect, point: { x: 180, y: 130 } }));
  assert.equal(p.originY, 0, 'placed below, so it grows down from its top edge');
  assert.ok(p.originX > 0 && p.originX < 1);
});

test('expanding keeps the current side when it still fits', () => {
  // A centred bubble with room above and below. Collapsed picks one side;
  // growing the card must not make it hop to the other.
  const boxRect: Rect = { x: 40, y: 330, w: 300, h: 80 };
  const wordRect: Rect = { x: 150, y: 350, w: 60, h: 40 };
  const point = { x: 180, y: 370 };
  const collapsed = placePopup(base({ boxRect, wordRect, point, desired: { width: 380, height: 260 } }));
  const expanded = placePopup(
    base({ boxRect, wordRect, point, desired: { width: 380, height: 400 }, prefer: collapsed.side })
  );
  assert.equal(expanded.side, collapsed.side);
  assert.equal(expanded.left, collapsed.left, 'no horizontal shift on expand');
});

test('expanding abandons the preferred side when it can no longer fit', () => {
  const boxRect: Rect = { x: 40, y: 80, w: 300, h: 60 };
  const wordRect: Rect = { x: 150, y: 90, w: 60, h: 40 };
  const point = { x: 180, y: 110 };
  // 'above' leaves only ~60dp, so a grown card has to move below.
  const p = placePopup(
    base({ boxRect, wordRect, point, desired: { width: 380, height: 500 }, prefer: 'above' })
  );
  assert.equal(p.side, 'below');
});
