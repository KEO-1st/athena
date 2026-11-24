#!/usr/bin/env node
/** One end-to-end boot: health, static shell, service worker version, auth wall. */
import assert from "node:assert/strict";
import { request, startHub } from "./helpers.mjs";
import { VERSION } from "../lib/version.mjs";

const hub = await startHub();
try {
  const health = await request(hub.port, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.json.version, VERSION);

  const index = await request(hub.port, "/");
  assert.equal(index.status, 200);
  assert.match(index.text, /ATHENA/);

  const sw = await request(hub.port, "/sw.js");
  assert.equal(sw.status, 200);
  assert.ok(sw.text.includes(`athena-${VERSION}`));
  assert.ok(!sw.text.includes("__ATHENA_VERSION__"));

  assert.equal((await request(hub.port, "/api/state")).status, 401);
  assert.equal((await request(hub.port, "/api/state", { headers: { "x-athena-session": hub.token } })).status, 200);

  console.log(`smoke: ok · hub on 127.0.0.1:${hub.port} · v${VERSION}`);
} finally {
  await hub.stop();
}
