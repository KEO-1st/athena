import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { request, startHub } from "./helpers.mjs";
import { VERSION } from "../lib/version.mjs";

const hub = await startHub();
after(async () => {
  await hub.stop();
});

const auth = (token = hub.token) => ({ "x-athena-session": token });

function openStream(port, pathname) {
  return new Promise((resolve, reject) => {
    let timer;
    const req = http.get({ host: "127.0.0.1", port, path: pathname }, (res) => {
      clearTimeout(timer);
      resolve({ status: res.statusCode, headers: res.headers, close: () => req.destroy() });
    });
    req.on("error", reject);
    timer = setTimeout(() => {
      req.destroy();
      reject(new Error("stream did not open"));
    }, 6000);
  });
}

test("health reports the one version source", async () => {
  const res = await request(hub.port, "/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.json.version, VERSION);
});

test("protected routes need a real credential", async () => {
  assert.equal((await request(hub.port, "/api/state")).status, 401);

  /* The access code is a bootstrap secret, not an API credential. */
  const asCode = await request(hub.port, "/api/state", { headers: { "x-athena-session": hub.code } });
  assert.equal(asCode.status, 401);

  /* Long-lived tokens are not accepted in query strings. */
  const inUrl = await request(hub.port, `/api/state?token=${encodeURIComponent(hub.token)}`);
  assert.equal(inUrl.status, 401);

  const ok = await request(hub.port, "/api/state", { headers: auth() });
  assert.equal(ok.status, 200);
});

test("state never contains the access code or the data directory", async () => {
  const res = await request(hub.port, "/api/state", { headers: auth() });
  assert.equal(res.status, 200);
  assert.equal(res.json.hub.code, undefined);
  assert.equal(res.json.hub.dataDir, undefined);
  assert.ok(!res.text.includes(hub.dir));
});

test("Host and Origin are validated, and CORS is not a wildcard", async () => {
  const badHost = await request(hub.port, "/api/health", { host: "evil.example" });
  assert.equal(badHost.status, 403);

  const badOrigin = await request(hub.port, "/api/state", {
    headers: { ...auth(), origin: "https://evil.example" },
  });
  assert.equal(badOrigin.status, 403);
  assert.equal(badOrigin.headers["access-control-allow-origin"], undefined);

  const origin = `http://127.0.0.1:${hub.port}`;
  const good = await request(hub.port, "/api/state", { headers: { ...auth(), origin } });
  assert.equal(good.status, 200);
  assert.equal(good.headers["access-control-allow-origin"], origin);
  assert.notEqual(good.headers["access-control-allow-origin"], "*");
});

test("bodies are bounded and must be JSON", async () => {
  const malformed = await request(hub.port, "/api/ask", { method: "POST", headers: auth(), body: "{" });
  assert.equal(malformed.status, 400);

  const big = await request(hub.port, "/api/ask", {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ text: "x".repeat(600 * 1024) }),
  });
  assert.equal(big.status, 413);
});

test("open mode and code changes require this PC and the current code", async () => {
  const denied = await request(hub.port, "/api/settings", {
    method: "POST",
    headers: auth(),
    body: { openMode: true },
  });
  assert.equal(denied.status, 403);

  const allowed = await request(hub.port, "/api/settings", {
    method: "POST",
    headers: auth(),
    body: { openMode: true, confirmCode: hub.code },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.state.hub.openMode, true);

  const reset = await request(hub.port, "/api/settings", {
    method: "POST",
    headers: auth(),
    body: { openMode: false, confirmCode: hub.code },
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.state.hub.openMode, false);

  const badBrain = await request(hub.port, "/api/settings", {
    method: "POST",
    headers: auth(),
    body: { brain: { provider: "openai", baseUrl: "file:///etc/passwd" } },
  });
  assert.equal(badBrain.status, 400);
});

test("the local lock endpoint needs the app's explicit intent header", async () => {
  const denied = await request(hub.port, "/api/lock");
  assert.equal(denied.status, 403);

  const allowed = await request(hub.port, "/api/lock", { headers: { "x-athena-local": "1" } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.local, true);
  assert.equal(allowed.json.code, hub.code);
});

test("stream tickets work for streaming routes only", async () => {
  const issued = await request(hub.port, "/api/stream-ticket", { method: "POST", headers: auth() });
  assert.equal(issued.status, 200);
  assert.match(issued.json.ticket, /^st_/);

  const stream = await openStream(hub.port, `/api/events?ticket=${encodeURIComponent(issued.json.ticket)}`);
  assert.equal(stream.status, 200);
  assert.match(String(stream.headers["content-type"]), /text\/event-stream/);
  stream.close();

  const wrongRoute = await request(hub.port, `/api/state?ticket=${encodeURIComponent(issued.json.ticket)}`);
  assert.equal(wrongRoute.status, 401);
});

test("the service worker is served with the current version and no placeholder", async () => {
  const res = await request(hub.port, "/sw.js");
  assert.equal(res.status, 200);
  assert.ok(res.text.includes(`athena-${VERSION}`));
  assert.ok(!res.text.includes("__ATHENA_VERSION__"));
  assert.ok(!res.text.includes("?v="));
});

test("/api/ask answers a version question from real state, with timing", async () => {
  const res = await request(hub.port, "/api/ask", {
    method: "POST",
    headers: auth(),
    body: { text: "what version are you", history: [] },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.meta.path, "identity:version");
  assert.ok(res.json.reply.includes(`v${VERSION}`));
  assert.deepEqual(res.json.images, []);
  assert.ok(res.json.meta.ms < 1000);
});

test("software is per machine and Integrations live in System", async () => {
  const page = await request(hub.port, "/");
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /data-tab="apps"/, "there is no global Software tab");
  assert.doesNotMatch(page.text, /data-view="apps"/, "there is no global Software view");
  assert.doesNotMatch(page.text, /<h2>Software<\/h2>/);
  assert.match(page.text, /id="integration-list"/);
  assert.match(page.text, /id="int-add"/);
  assert.match(page.text, /id="voice-pick"/, "the voice controls are in System");
  assert.match(page.text, /SPOKEN VOICE/);

  const js = await request(hub.port, "/app.js");
  assert.equal(js.status, 200);
  assert.match(js.text, /function loadNodeSoftware/);
  assert.match(js.text, /function renderNodeSoftware/);
  assert.match(js.text, /function renderIntegrations/);
  assert.match(js.text, /function addShots/);
  assert.doesNotMatch(js.text, /store\.mode|data-mode|loadApps/);
  const speech = await request(hub.port, "/speech.mjs");
  assert.equal(speech.status, 200);
  assert.match(speech.headers["content-type"], /text\/javascript/, "browsers refuse a module with the wrong MIME type");
  assert.match((await request(hub.port, "/app.js")).headers["content-type"], /text\/javascript/);
});
