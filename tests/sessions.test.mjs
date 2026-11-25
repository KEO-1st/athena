import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { request, startHub } from "./helpers.mjs";

const hub = await startHub();
after(async () => {
  await hub.stop();
});
const auth = (token = hub.token) => ({ "x-athena-session": token });

test("a controller signs in with its own visible device identity", async () => {
  const res = await request(hub.port, "/api/session", {
    method: "POST",
    body: { code: hub.code, deviceId: "ipad-test-1", deviceName: "Test iPad", platform: "iPad · Safari" },
  });
  assert.equal(res.status, 200);
  assert.ok(res.json.token);
  assert.equal(res.json.device.name, "Test iPad");
  assert.equal(res.json.device.platform, "iPad · Safari");

  const list = await request(hub.port, "/api/sessions", { headers: auth() });
  assert.equal(list.status, 200);
  const device = list.json.devices.find((item) => item.name === "Test iPad");
  assert.ok(device, "the device is listed");
  assert.ok(!JSON.stringify(list.json).includes(res.json.token), "session tokens never appear in the list");

  const state = await request(hub.port, "/api/state", { headers: auth() });
  assert.equal(state.status, 200);
  assert.equal(state.json.sessions, 2, "the existing hub session is preserved and the tablet is separate");

  const controllerState = await request(hub.port, "/api/state", { headers: auth(res.json.token) });
  assert.equal(controllerState.status, 200);
  assert.equal(controllerState.json.admin, false);
  assert.equal(controllerState.json.sessions, null);
  assert.deepEqual(controllerState.json.devices, [], "a controller cannot enumerate other controllers");
});

test("signing in again on the same browser replaces only that browser's session", async () => {
  const first = await request(hub.port, "/api/session", {
    method: "POST",
    body: { code: hub.code, deviceId: "phone-test-1", deviceName: "Test Phone", platform: "iPhone · Safari" },
  });
  const second = await request(hub.port, "/api/session", {
    method: "POST",
    body: { code: hub.code, deviceId: "phone-test-1", deviceName: "Test Phone", platform: "iPhone · Safari" },
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await request(hub.port, "/api/state", { headers: auth(first.json.token) })).status, 401);
  assert.equal((await request(hub.port, "/api/state", { headers: auth(second.json.token) })).status, 200);
});

test("a remote controller cannot use the Hub administration API", async () => {
  const login = await request(hub.port, "/api/session", {
    method: "POST",
    body: { code: hub.code, deviceId: "remote-admin-check", deviceName: "Remote iPad", platform: "iPad · Safari" },
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.admin, false);
  const controller = { "x-athena-session": login.json.token };

  assert.equal((await request(hub.port, "/api/sessions", { headers: controller })).status, 403);
  assert.equal((await request(hub.port, "/api/settings", { method: "POST", headers: controller, body: { hubName: "hijacked" } })).status, 403);
  assert.equal((await request(hub.port, "/api/keys", { method: "POST", headers: controller, body: { label: "remote" } })).status, 403);
  assert.equal((await request(hub.port, "/api/hub/restart", { method: "POST", headers: controller })).status, 403);
  assert.equal((await request(hub.port, "/api/integrations", { method: "POST", headers: controller, body: { name: "x", url: "http://127.0.0.1:1" } })).status, 403);

  const state = await request(hub.port, "/api/state", { headers: controller });
  assert.equal(state.status, 200);
  assert.equal(state.json.admin, false);
  assert.deepEqual(state.json.devices, []);
  assert.deepEqual(state.json.keys, []);
  assert.equal(state.json.sessions, null);
  assert.ok(!state.text.includes("Test Hub"), "administrator device names are not broadcast to controllers");
});

test("the Hub can rename a controller and the name survives that browser signing in again", async () => {
  const login = await request(hub.port, "/api/session", {
    method: "POST",
    body: { code: hub.code, deviceId: "rename-test", deviceName: "iPad", platform: "iPad · Safari" },
  });
  const list = await request(hub.port, "/api/sessions", { headers: auth() });
  const device = list.json.devices.find((item) => item.id === login.json.device.id);
  assert.ok(device);

  const renamed = await request(hub.port, `/api/sessions/${encodeURIComponent(device.id)}`, {
    method: "PATCH",
    headers: auth(),
    body: { name: "Kitchen iPad" },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.device.name, "Kitchen iPad");

  const again = await request(hub.port, "/api/session", {
    method: "POST",
    body: { code: hub.code, deviceId: "rename-test", deviceName: "iPad", platform: "iPad · Safari" },
  });
  assert.equal(again.json.device.name, "Kitchen iPad", "the administrator's name is not overwritten by the device label");
});

test("the Hub can stop remembering new controller sessions", async () => {
  const changed = await request(hub.port, "/api/settings", {
    method: "POST",
    headers: auth(),
    body: { rememberControllers: false, sessionDays: 7 },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.json.state.rememberControllers, false);
  assert.equal(changed.json.state.sessionDays, 7);

  const login = await request(hub.port, "/api/session", {
    method: "POST",
    body: { code: hub.code, deviceId: "ephemeral-phone", deviceName: "Ephemeral Phone", platform: "iPhone · Safari" },
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.remember, false);

  const saved = fs.readFileSync(path.join(hub.dir, "sessions.json"), "utf8");
  assert.ok(!saved.includes(login.json.token), "an unremembered session is not written to disk");
  const listed = await request(hub.port, "/api/sessions", { headers: auth() });
  assert.equal(listed.json.sessionDays, 7);
  assert.ok(listed.json.devices.some((device) => device.id === login.json.device.id));

  await request(hub.port, "/api/settings", { method: "POST", headers: auth(), body: { rememberControllers: true, sessionDays: 30 } });
});

test("one device can be revoked without signing out the others", async () => {
  const phone = await request(hub.port, "/api/session", {
    method: "POST",
    body: { code: hub.code, deviceId: "revoke-test", deviceName: "Revocable Phone", platform: "Android · Chrome" },
  });
  const list = await request(hub.port, "/api/sessions", { headers: auth() });
  const device = list.json.devices.find((item) => item.name === "Revocable Phone");
  assert.ok(device);

  const revoked = await request(hub.port, `/api/sessions/${encodeURIComponent(device.id)}`, {
    method: "DELETE",
    headers: auth(),
  });
  assert.equal(revoked.status, 200);
  assert.equal((await request(hub.port, "/api/state", { headers: auth(phone.json.token) })).status, 401);
  assert.equal((await request(hub.port, "/api/state", { headers: auth() })).status, 200, "the hub session survives");
});
