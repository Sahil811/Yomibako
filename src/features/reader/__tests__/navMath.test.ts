import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE_FRAC,
  edgeTapDelta,
  flickSkipCount,
  shouldSwipeTurn,
  snapSpreadIndex,
  spreadSize,
  swipeDelta,
  swipeThreshold,
} from '../navMath';

test('edge zones match bundle EDGE_FRAC=0.18, centre returns 0', () => {
  assert.equal(EDGE_FRAC, 0.18);
  assert.equal(edgeTapDelta(0.5, false), 0);
  assert.equal(edgeTapDelta(0.5, true), 0);
});

test('edge-tap RTL inversion mirrors bundle navStep mapping', () => {
  // LTR: right=+1 left=-1. RTL: right=-1 left=+1.
  assert.equal(edgeTapDelta(0.95, false), 1);
  assert.equal(edgeTapDelta(0.05, false), -1);
  assert.equal(edgeTapDelta(0.95, true), -1);
  assert.equal(edgeTapDelta(0.05, true), 1);
});

test('swipe delta mirrors tap zones: LTR left-swipe next, RTL mirrored', () => {
  assert.equal(swipeDelta(-120, false), 1);
  assert.equal(swipeDelta(120, false), -1);
  assert.equal(swipeDelta(-120, true), -1);
  assert.equal(swipeDelta(120, true), 1);
});

test('swipe turn needs dominance + threshold or fast flick', () => {
  const wide = 400;
  assert.equal(shouldSwipeTurn({ dx: 20, dy: 5, dtMs: 200, viewportWidth: wide, total: 10 }), false);
  assert.equal(shouldSwipeTurn({ dx: 100, dy: 90, dtMs: 200, viewportWidth: wide, total: 10 }), false);
  assert.equal(shouldSwipeTurn({ dx: 120, dy: 10, dtMs: 400, viewportWidth: wide, total: 10 }), true);
  // Fast flick under threshold still turns.
  assert.equal(shouldSwipeTurn({ dx: 60, dy: 5, dtMs: 100, viewportWidth: wide, total: 10 }), true);
  assert.equal(shouldSwipeTurn({ dx: 120, dy: 10, dtMs: 300, viewportWidth: wide, total: 1 }), false);
});

test('swipeThreshold scales with viewport, floor 64', () => {
  assert.equal(swipeThreshold(400), 64);
  assert.equal(swipeThreshold(1000), 120);
});

test('spreadSize + snap keep two-page turns in phase', () => {
  assert.equal(spreadSize(false, true), 1);
  assert.equal(spreadSize(true, false), 1);
  assert.equal(spreadSize(true, true), 2);
  assert.equal(snapSpreadIndex(5, true, true), 4);
  assert.equal(snapSpreadIndex(4, true, true), 4);
  assert.equal(snapSpreadIndex(5, false, true), 5);
});

test('flickSkipCount escalates only on fast long flicks', () => {
  assert.equal(flickSkipCount(80, 300), 1);
  assert.equal(flickSkipCount(160, 150), 2);
  assert.equal(flickSkipCount(260, 150), 3);
  assert.equal(flickSkipCount(300, 800), 1);
});
