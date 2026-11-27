import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { isDirectLocalRequest, isLoopback } from "../lib/security.mjs";
import { request, startHub, tempDir } from "./helpers.mjs";

const dir = tempDir("athena-security");
fs.writeFileSync(
  path.join(dir, "nodes.json"),
  JSON.stringify({
    nodes: [{ id: "node_security", name: "Security node", host: "127.0.0.1", port: 47910, token: "test-token", index: 1 }],
  })
);
const hub = await startHub({ dataDir: dir });
after(async () => {
  await hub.stop();
});

const auth = (token = hub.token) => ({ "x-athena-session": token });
const directHeaders = (extra = {}) => ({ host: `127.0.0.1:${hub.port}`, ...extra });

async function controllerSession(deviceId = "security-controller") {
  const res = await request(hub.port, "/api/session", {
    method: "POST",
    body: { code: hub.code, deviceId, deviceName: "Security Controller", platform: "Test · Controller" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.admin, false);
  return { token: res.json.token, headers: auth(res.json.token) };
}

function firstSseState(port, pathname, { host } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      fn(value);
    };
    const req = http.get({ host: "127.0.0.1", port, path: pathname, headers: host ? { host } : {} }, (res) => {
      let text = "";
      res.on("data", (chunk) => {
        text += chunk.toString();
        const match = text.match(/event: state\ndata: ([^\n]+)\n\n/);
        if (!match) return;
        try {
          finish(resolve, { status: res.statusCode, headers: res.headers, json: JSON.parse(match[1]), text });
        } catch (error) {
          finish(reject, error);
        }
      });
    });
    req.on("error", (error) => finish(reject, error));
    const timer = setTimeout(() => finish(reject, new Error("state event did not arrive")), 6000);
  });
}

test("direct-local detection is not satisfied by loopback alone", () => {
  const fake = (remoteAddress, headers) => ({ socket: { remoteAddress }, headers });
  const base = { host: "127.0.0.1:4790" };

  assert.equal(isLoopback(fake("127.0.0.1", base)), true);
  assert.equal(isDirectLocalRequest(fake("127.0.0.1", base)), true);
  assert.equal(isDirectLocalRequest(fake("127.0.0.1", { host: "localhost:4790" })), true);
  assert.equal(isDirectLocalRequest(fake("::1", { host: "[::1]:4790" })), true);
  assert.equal(isDirectLocalRequest(fake("::ffff:127.0.0.1", base)), true);

  assert.equal(isDirectLocalRequest(fake("192.168.1.20", base)), false, "a LAN socket is never local");
  assert.equal(isDirectLocalRequest(fake("127.0.0.1", { host: "athena-pc:4790" })), false, "a LAN Host through a proxy is not local");
  assert.equal(isDirectLocalRequest(fake("127.0.0.1", { ...base, "x-forwarded-for": "192.168.1.20" })), false);
  assert.equal(isDirectLocalRequest(fake("127.0.0.1", { ...base, "x-forwarded-for": "" })), false, "an empty proxy header still marks a proxy request");
  assert.equal(isDirectLocalRequest(fake("127.0.0.1", { ...base, forwarded: "for=192.168.1.20" })), false);
  assert.equal(isDirectLocalRequest(fake("127.0.0.1", { ...base, origin: "http://192.168.1.20:4790" })), false);
  assert.equal(isDirectLocalRequest(fake("127.0.0.1", { ...base, origin: "https://evil.example" })), false);
  assert.equal(isDirectLocalRequest(fake("127.0.0.1", { ...base, origin: "http://localhost:4790" })), true);
});

test("administrator role comes from a direct loopback request, not the JSON body", async () => {
  const normal = await request(hub.port, "/api/session", {
    method: "POST",
    body: { local: true, deviceId: "direct-admin", deviceName: "Direct Admin" },
  });
  assert.equal(normal.status, 200);
  assert.equal(normal.json.admin, true);

  const localhost = await request(hub.port, "/api/session", {
    method: "POST",
    host: `localhost:${hub.port}`,
    body: { local: true, deviceId: "localhost-admin", deviceName: "Localhost Admin" },
  });
  assert.equal(localhost.status, 200);
  assert.equal(localhost.json.admin, true);

  const proxyHeader = await request(hub.port, "/api/session", {
    method: "POST",
    headers: { "x-forwarded-for": "192.168.1.20" },
    body: { local: true, deviceId: "proxy-admin", deviceName: "Proxy Admin" },
  });
  assert.equal(proxyHeader.status, 401, "a proxied request cannot mint a session from local:true");
  assert.equal(proxyHeader.json.token, undefined);

  const lanHost = await request(hub.port, "/api/session", {
    method: "POST",
    host: `${os.hostname()}:${hub.port}`,
    body: { local: true, deviceId: "lan-host-admin", deviceName: "LAN Host Admin" },
  });
  assert.equal(lanHost.status, 401, "the Hub hostname is not the administrator bootstrap origin");

  const lanOrigin = await request(hub.port, "/api/session", {
    method: "POST",
    headers: { origin: `http://${os.hostname()}:${hub.port}` },
    body: { local: true, deviceId: "lan-origin-admin", deviceName: "LAN Origin Admin" },
  });
  assert.equal(lanOrigin.status, 401, "a LAN page cannot promote itself with a loopback socket");

  const codeOnly = await request(hub.port, "/api/session", {
    method: "POST",
    body: { code: hub.code, deviceId: "code-only", deviceName: "Code Only" },
  });
  assert.equal(codeOnly.status, 200);
  assert.equal(codeOnly.json.admin, false, "knowing the access code does not grant Hub administration");

  const stringLocal = await request(hub.port, "/api/session", {
    method: "POST",
    body: { local: "true", code: hub.code, deviceId: "string-local", deviceName: "String Local" },
  });
  assert.equal(stringLocal.status, 200);
  assert.equal(stringLocal.json.admin, false, "local must be a boolean, not a truthy string");
});

test("the local code endpoint also requires a direct loopback request", async () => {
  const proxied = await request(hub.port, "/api/lock", {
    headers: { "x-athena-local": "1", "x-forwarded-for": "192.168.1.20" },
  });
  assert.equal(proxied.status, 200);
  assert.equal(proxied.json.local, false);
  assert.equal(proxied.json.code, null);

  const hostOnly = await request(hub.port, "/api/lock", {
    host: `${os.hostname()}:${hub.port}`,
    headers: { "x-athena-local": "1" },
  });
  assert.equal(hostOnly.status, 200);
  assert.equal(hostOnly.json.local, false);
  assert.equal(hostOnly.json.code, null);

  const direct = await request(hub.port, "/api/lock", { headers: { "x-athena-local": "1", ...directHeaders() } });
  assert.equal(direct.status, 200);
  assert.equal(direct.json.local, true);
});

test("every administrative endpoint refuses a normal controller session", async () => {
  const controller = await controllerSession("endpoint-matrix-controller");
  const cases = [
    ["POST", "/api/settings", { hubName: "hijacked" }],
    ["GET", "/api/sessions", undefined],
    ["PATCH", "/api/sessions/device_any", { name: "renamed" }],
    ["PUT", "/api/sessions/device_any", { name: "renamed" }],
    ["DELETE", "/api/sessions/device_any", undefined],
    ["DELETE", "/api/sessions", undefined],
    ["POST", "/api/scan", {}],
    ["POST", "/api/nodes/pair", { host: "127.0.0.1", port: 47910, code: "XXXXXX" }],
    ["DELETE", "/api/nodes/node_security", undefined],
    ["POST", "/api/keys", { label: "controller-created" }],
    ["DELETE", "/api/keys/key_any", undefined],
    ["GET", "/api/brain/install", undefined],
    ["POST", "/api/brain/install", {}],
    ["POST", "/api/brain/upgrade", {}],
    ["GET", "/api/providers", undefined],
    ["POST", "/api/providers/test", { provider: "openai" }],
    ["POST", "/api/integrations", { name: "controller", url: "http://127.0.0.1:1" }],
    ["POST", "/api/integrations/int_any", { name: "controller" }],
    ["POST", "/api/integrations/int_any/probe", {}],
    ["DELETE", "/api/integrations/int_any", undefined],
    ["POST", "/api/hub/shutdown", {}],
    ["POST", "/api/hub/restart", {}],
  ];

  for (const [method, pathname, body] of cases) {
    const res = await request(hub.port, pathname, { method, headers: controller.headers, body });
    assert.equal(res.status, 403, `${method} ${pathname} must refuse a controller (got ${res.status})`);
  }

  const state = await request(hub.port, "/api/state", { headers: controller.headers });
  assert.equal(state.status, 200);
  assert.equal(state.json.admin, false);
  assert.equal(state.json.sessions, null);
  assert.deepEqual(state.json.devices, []);
  assert.deepEqual(state.json.keys, []);
  assert.equal(state.json.providers, undefined, "providers and their masks are administrator-only");
  assert.ok(!state.text.includes("Test Hub"), "administrator identity is not in controller state");
});

test("administrator sessions and tickets lose authority when replayed through a LAN host", async () => {
  const lanHost = `${os.hostname()}:${hub.port}`;

  const state = await request(hub.port, "/api/state", { host: lanHost, headers: auth() });
  assert.equal(state.status, 200);
  assert.equal(state.json.admin, false, "an admin token replayed via the LAN hostname is not admin");
  assert.deepEqual(state.json.devices, []);

  const settings = await request(hub.port, "/api/settings", {
    method: "POST",
    host: lanHost,
    headers: auth(),
    body: { hubName: "lan-replay" },
  });
  assert.equal(settings.status, 403);

  const issued = await request(hub.port, "/api/stream-ticket", { method: "POST", headers: auth() });
  const event = await firstSseState(hub.port, `/api/events?ticket=${encodeURIComponent(issued.json.ticket)}`, { host: lanHost });
  assert.equal(event.json.admin, false, "a copied administrator stream ticket does not keep the admin audience");
  assert.deepEqual(event.json.devices, []);
});

test("an API key can operate nodes but cannot administer the Hub", async () => {
  const created = await request(hub.port, "/api/keys", {
    method: "POST",
    headers: auth(),
    body: { label: "security-audit" },
  });
  assert.equal(created.status, 200);
  const keyHeaders = { "x-athena-key": created.json.key };

  const state = await request(hub.port, "/api/state", { headers: keyHeaders });
  assert.equal(state.status, 200);
  assert.equal(state.json.admin, false);
  assert.deepEqual(state.json.devices, []);

  const settings = await request(hub.port, "/api/settings", {
    method: "POST",
    headers: keyHeaders,
    body: { hubName: "key-hijack" },
  });
  assert.equal(settings.status, 403);

  await request(hub.port, `/api/keys/${encodeURIComponent(created.json.entry.id)}`, { method: "DELETE", headers: auth() });
});

test("controller SSE and state contain no administrator audience fields", async () => {
  const controller = await controllerSession("sse-controller");
  const issued = await request(hub.port, "/api/stream-ticket", { method: "POST", headers: controller.headers });
  assert.equal(issued.status, 200);

  const event = await firstSseState(hub.port, `/api/events?ticket=${encodeURIComponent(issued.json.ticket)}`);
  assert.equal(event.status, 200);
  assert.equal(event.json.admin, false);
  assert.equal(event.json.sessions, null);
  assert.deepEqual(event.json.devices, []);
  assert.deepEqual(event.json.keys, []);
  assert.ok(!event.text.includes("Test Hub"), "the administrator device is not in the controller stream");
});

test("administrator SSE remains administrator-shaped", async () => {
  const issued = await request(hub.port, "/api/stream-ticket", { method: "POST", headers: auth() });
  const event = await firstSseState(hub.port, `/api/events?ticket=${encodeURIComponent(issued.json.ticket)}`);
  assert.equal(event.json.admin, true);
  assert.ok(Array.isArray(event.json.devices));
  assert.ok(event.json.devices.some((device) => device.name === "Test Hub"));
  assert.ok(Array.isArray(event.json.keys));
  assert.equal(typeof event.json.sessions, "number");
});
