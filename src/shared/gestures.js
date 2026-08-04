// Pointer-gesture recognition: pinch, drag, swipe.
//
// Written against Pointer Events so mouse, touch and pen all go through one
// path. The trainer's canvas already tracks pointers for the on-screen piano,
// so the tricky part isn't recognising a pinch — it's handing back control
// cleanly when a gesture starts, and never swallowing a plain tap.
//
// The contract: `onPointerDown` returns true if the pointer was claimed for a
// gesture. A caller that also plays notes should treat a claimed pointer as
// "not a keypress", and call `onGestureStart` to cancel any note it already
// started when a second finger turns a tap into a pinch.

const SWIPE_MIN_DISTANCE = 60;     // px
const SWIPE_MAX_OFF_AXIS = 45;     // px — a diagonal drag isn't a swipe
const SWIPE_MAX_DURATION = 600;    // ms
const DRAG_THRESHOLD = 8;          // px before a press becomes a drag

export function createGestureTarget(el, {
  onPinch,          // ({ scale, centerX, centerY }) — scale is relative to the last event
  onPan,            // ({ dx, dy, pointers })
  onSwipe,          // ({ direction: 'left'|'right'|'up'|'down' })
  onGestureStart,   // () — a multi-touch gesture began; cancel single-pointer work
  onGestureEnd,     // ()
  allowPan = () => true,   // (event) => boolean: is a one-finger drag a pan here?
} = {}) {
  const points = new Map();   // pointerId -> { x, y, startX, startY, startTime, panning }
  let pinchDistance = null;
  let gestureActive = false;

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function twoPoints() {
    const it = points.values();
    return [it.next().value, it.next().value];
  }

  // Returns true if this pointer is being used for a gesture rather than
  // whatever the element normally does with a press.
  function pointerDown(e) {
    points.set(e.pointerId, {
      x: e.clientX, y: e.clientY,
      startX: e.clientX, startY: e.clientY,
      startTime: performance.now(),
      panning: false,
    });

    if (points.size === 2) {
      const [a, b] = twoPoints();
      pinchDistance = distance(a, b);
      gestureActive = true;
      onGestureStart?.();
      return true;
    }
    return false;
  }

  function pointerMove(e) {
    const p = points.get(e.pointerId);
    if (!p) return false;
    const prevX = p.x, prevY = p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (points.size >= 2) {
      const [a, b] = twoPoints();
      const d = distance(a, b);
      if (pinchDistance && d > 0) {
        onPinch?.({
          scale: d / pinchDistance,
          centerX: (a.x + b.x) / 2,
          centerY: (a.y + b.y) / 2,
        });
      }
      pinchDistance = d;
      return true;
    }

    // One pointer: a drag past the threshold becomes a pan, if the caller
    // allows panning from where the press started.
    const moved = Math.hypot(p.x - p.startX, p.y - p.startY);
    if (!p.panning && moved > DRAG_THRESHOLD && allowPan(e)) {
      p.panning = true;
      gestureActive = true;
      onGestureStart?.();
    }
    if (p.panning) {
      onPan?.({ dx: p.x - prevX, dy: p.y - prevY, pointers: 1 });
      return true;
    }
    return false;
  }

  function pointerUp(e) {
    const p = points.get(e.pointerId);
    points.delete(e.pointerId);
    if (points.size < 2) pinchDistance = null;

    if (p && !p.panning && points.size === 0) {
      // Might have been a swipe: fast, far, and mostly on one axis.
      const dx = p.x - p.startX;
      const dy = p.y - p.startY;
      const dt = performance.now() - p.startTime;
      if (dt <= SWIPE_MAX_DURATION) {
        if (Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dy) <= SWIPE_MAX_OFF_AXIS) {
          onSwipe?.({ direction: dx > 0 ? 'right' : 'left' });
        } else if (Math.abs(dy) >= SWIPE_MIN_DISTANCE && Math.abs(dx) <= SWIPE_MAX_OFF_AXIS) {
          onSwipe?.({ direction: dy > 0 ? 'down' : 'up' });
        }
      }
    }

    if (points.size === 0 && gestureActive) {
      gestureActive = false;
      onGestureEnd?.();
    }
    return !!p?.panning;
  }

  el.addEventListener('pointerdown', pointerDown);
  el.addEventListener('pointermove', pointerMove);
  el.addEventListener('pointerup', pointerUp);
  el.addEventListener('pointercancel', pointerUp);

  return {
    // Callers that own the same pointers (the touch piano) ask these
    // questions before acting on a press.
    isGesturing: () => gestureActive,
    pointerCount: () => points.size,
    destroy() {
      el.removeEventListener('pointerdown', pointerDown);
      el.removeEventListener('pointermove', pointerMove);
      el.removeEventListener('pointerup', pointerUp);
      el.removeEventListener('pointercancel', pointerUp);
      points.clear();
    },
  };
}

// Swipe-only helper for surfaces that shouldn't pan or pinch — the mode nav,
// where a horizontal flick moves between tabs.
export function onSwipe(el, handler) {
  return createGestureTarget(el, { onSwipe: handler, allowPan: () => false });
}
