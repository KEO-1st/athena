import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { freePort, request, startHub } from "./helpers.mjs";

const hub = await startHub();
const auth = { "x-athena-session": hub.token };

/* A tiny integration endpoint: a real HTTP answer, not a simulated status. */
const port = await freePort();
const upstream = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, auth: req.headers.authorization || null }));
});
await new Promise((resolve) => upstream.listen(port, "127.0.0.1", resolve));

after(async () => {
  await new Promise((resolve) => upstream.close(resolve));
  await hub.stop();
});

let createdId = "";

test("integrations are registered separately from software", async () => {
  assert.equal((await request(hub.port, "/api/integrations")).status, 401);

  const created = await request(hub.port, "/api/integrations", {
    method: "POST",
    headers: auth,
    body: {
      name: "Clip Studio",
      kind: "app",
      description: "Turns streams into clips",
      url: `http://127.0.0.1:${port}/api`,
      token: "secret-token",
      capabilities: "render, export",
    },
  });
  assert.equal(created.status, 200);
  assert.ok(created.json.integration.id);
  createdId = created.json.integration.id;
  assert.equal(created.json.integration.hasToken, true);
  assert.equal(created.json.integration.token, undefined, "the token never leaves the hub");
  assert.ok(!created.text.includes("secret-token"));
  assert.deepEqual(created.json.integration.capabilities, ["render", "export"]);

  const list = await request(hub.port, "/api/integrations", { headers: auth });
  assert.equal(list.status, 200);
  assert.ok(list.json.integrations.some((item) => item.id === createdId));
});

test("only http(s) addresses are accepted", async () => {
  const bad = await request(hub.port, "/api/integrations", {
    method: "POST",
    headers: auth,
    body: { name: "Bad", url: "file:///etc/passwd" },
  });
  assert.equal(bad.status, 400);
});

test("a probe reports the real answer and its latency", async () => {
  const probed = await request(hub.port, `/api/integrations/${createdId}/probe`, { method: "POST", headers: auth });
  assert.equal(probed.status, 200);
  assert.equal(probed.json.integration.lastProbe.ok, true);
  assert.equal(probed.json.integration.lastProbe.status, 200);
  assert.ok(probed.json.integration.lastProbe.ms >= 0);
  assert.equal(probed.json.integration.token, undefined);
});

test("an unreachable integration is reported as failed, not connected", async () => {
  const created = await request(hub.port, "/api/integrations", {
    method: "POST",
    headers: auth,
    body: { name: "Gone", url: "http://127.0.0.1:1/" },
  });
  const id = created.json.integration.id;
  const probed = await request(hub.port, `/api/integrations/${id}/probe`, { method: "POST", headers: auth });
  assert.equal(probed.json.integration.lastProbe.ok, false);
  assert.ok(probed.json.integration.lastProbe.error);

  const removed = await request(hub.port, `/api/integrations/${id}`, { method: "DELETE", headers: auth });
  assert.equal(removed.status, 200);
  assert.equal((await request(hub.port, `/api/integrations/${id}`, { method: "DELETE", headers: auth })).status, 404);
});
