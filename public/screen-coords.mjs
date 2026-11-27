/**
 * Screen geometry and streaming policy shared by the controller.
 *
 * These functions deliberately know nothing about the DOM. The click mapping
 * is the part that caused iPad taps to land below the target: the <img> uses
 * object-fit: contain, so the rendered frame is often smaller than its element
 * and centred with letterboxing. Treating the element rectangle as the image
 * made every coordinate drift toward the letterboxed edge.
 */

/** The actual rendered image inside an object-fit: contain box. */
export function containBox(rect, naturalWidth, naturalHeight) {
  const box = {
    left: Number(rect?.left) || 0,
    top: Number(rect?.top) || 0,
    width: Math.max(1, Number(rect?.width) || 1),
    height: Math.max(1, Number(rect?.height) || 1),
  };
  const nw = Number(naturalWidth) || 0;
  const nh = Number(naturalHeight) || 0;
  if (!nw || !nh) return { ...box, scale: 1 };
  const scale = Math.min(box.width / nw, box.height / nh);
  const width = nw * scale;
  const height = nh * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
    scale,
  };
}

/**
 * Convert a pointer position to [0,1] coordinates INSIDE the picture.
 * CSS pixels already include devicePixelRatio and page zoom, so no DPR
 * multiplication belongs here. Safe-area insets are included in getBoundingClientRect.
 */
export function screenPoint(img, event) {
  const rect = img.getBoundingClientRect();
  const content = containBox(rect, img.naturalWidth || img.width, img.naturalHeight || img.height);
  const clamp = (value) => Math.min(1, Math.max(0, value));
  return {
    x: clamp((event.clientX - content.left) / content.width),
    y: clamp((event.clientY - content.top) / content.height),
  };
}

/**
 * Adaptive capture policy. Targets are budgets, not promises: the node only
 * captures as fast as the fastest viewer asked and stops when nobody is
 * watching. `intervalMs` leaves room for the next frame to arrive.
 */
export function screenProfile({ focused = false, hidden = false, coarse = false, viewportWidth = 1200 } = {}) {
  if (hidden) return { fps: 0, intervalMs: 0, width: 0, active: false };
  /* Focused capture measured ~10.7 fps at 1280px versus ~9.8 fps at 1600px on
     the reference Windows node. 1280 is also less bandwidth for the same
     readable desktop; the budget stays 30 because a faster capture backend
     should not be capped by the controller. */
  if (focused) return { fps: 30, intervalMs: 34, width: 1280, active: true };
  const mobile = coarse || Number(viewportWidth) < 760;
  return mobile
    ? { fps: 10, intervalMs: 100, width: 960, active: true }
    : { fps: 12, intervalMs: 84, width: 1280, active: true };
}
