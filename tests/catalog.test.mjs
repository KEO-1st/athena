import test from "node:test";
import assert from "node:assert/strict";
import { APPS, APP_SPECS, APP_CATALOG } from "../lib/app-catalog.mjs";
import { APPS as HUB_APPS } from "../lib/apps.mjs";

test("hub and node app lists come from the same catalogue", () => {
  assert.deepEqual(
    APPS.map((app) => app.id),
    APP_SPECS.map((spec) => spec.id)
  );
  assert.deepEqual(
    HUB_APPS.map((app) => app.id),
    APP_CATALOG.map((app) => app.id)
  );
  for (const spec of APP_SPECS) {
    assert.ok(spec.name, `${spec.id} has a name`);
    assert.ok(spec.id !== "comfyui" ? spec.bin : true, `${spec.id} has a binary`);
  }
});

test("install commands never reach the hub payload", () => {
  for (const app of APPS) {
    assert.equal(app.winget, undefined);
    assert.equal(app.bin, undefined);
  }
});
