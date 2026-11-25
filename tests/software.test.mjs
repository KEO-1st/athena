import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.mjs";

const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
const node = fs.readFileSync(path.join(ROOT, "node", "athena-node.mjs"), "utf8");

test("software results are shown, not replaced by a generic success toast", () => {
  assert.match(app, /result\.note/);
  assert.match(app, /appsState\.message\.set/);
  assert.match(app, /SOFT_CACHE_MS/);
  assert.match(app, /loadNodeSoftware\(summary\.parentElement\.dataset\.soft, \{ force: true \}\)/);
});

test("ComfyUI's action is labelled as detection, not installation", () => {
  assert.match(app, /app\.install === "detect" \|\| app\.id === "comfyui" \? "FIND FOLDER"/);
  assert.match(node, /This is detection, not a download/);
  assert.match(node, /manual: true/);
});

test("install refreshes PATH and reports whether the tool was detected", () => {
  assert.match(node, /refreshProcessPath/);
  assert.match(node, /installed and detected at/);
  assert.match(node, /not on PATH yet/);
});

test("software actions carry the selected node id in the request path", () => {
  assert.match(app, /\/api\/nodes\/\$\{encodeURIComponent\(nodeId\)\}\/action/);
});
