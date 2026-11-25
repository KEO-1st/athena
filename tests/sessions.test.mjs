import test, { after } from "node:test";
import assert from "node:assert/strict";
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

  const state = await request(hub.port, "/api/state", { headers: auth(res.json.token) });
  assert.equal(state.status, 200);
  assert.equal(state.json.sessions, 2, "the existing hub session is preserved and the tablet is separate");
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
