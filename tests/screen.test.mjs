import test from "node:test";
import assert from "node:assert/strict";
import { containBox, screenPoint, screenProfile } from "../public/screen-coords.mjs";

const rect = { left: 20, top: 100, width: 400, height: 300 };

test("object-fit contain accounts for horizontal letterboxing", () => {
  const box = containBox(rect, 1920, 1080);
  assert.equal(box.width, 400);
  assert.equal(box.height, 225);
  assert.equal(box.top, 137.5);
  assert.equal(box.left, 20);
});

test("an iPad-like tap near the top maps to the picture, not the element edge", () => {
  const box = containBox(rect, 1920, 1080);
  const point = screenPoint(
    { getBoundingClientRect: () => rect, naturalWidth: 1920, naturalHeight: 1080 },
    { clientX: 220, clientY: box.top + 22.5 }
  );
  assert.equal(point.x, 0.5);
  assert.equal(point.y, 0.1, "22.5/225 is 10%, not 72.5/300");
});

test("a portrait image is pillarboxed and still maps exactly", () => {
  const box = containBox(rect, 1080, 1920);
  assert.equal(box.height, 300);
  assert.equal(box.width, 168.75);
  assert.equal(box.left, 135.625);
  const point = screenPoint(
    { getBoundingClientRect: () => rect, naturalWidth: 1080, naturalHeight: 1920 },
    { clientX: box.left + box.width / 2, clientY: 250 }
  );
  assert.equal(point.x, 0.5);
  assert.equal(point.y, 0.5);
});

test("CSS pixels are used directly, so DPR and page zoom do not double-apply", () => {
  const point = screenPoint(
    { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }), naturalWidth: 200, naturalHeight: 100 },
    { clientX: 60, clientY: 45 }
  );
  assert.deepEqual(point, { x: 0.25, y: 0.25 });
});

test("adaptive streaming asks for 30 fps focused and 10-12 fps in preview", () => {
  assert.equal(screenProfile({ focused: true }).fps, 30);
  assert.equal(screenProfile({ focused: false, coarse: false }).fps, 12);
  assert.equal(screenProfile({ focused: false, coarse: true }).fps, 10);
  assert.equal(screenProfile({ focused: false, coarse: false, viewportWidth: 390 }).fps, 10);
  assert.equal(screenProfile({ hidden: true }).active, false);
});
