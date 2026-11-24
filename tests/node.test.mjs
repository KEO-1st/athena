import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, freePort, removeDir, request, sleep, stopChild, tempDir } from "./helpers.mjs";

const dir = tempDir("athena-node");
const port = await freePort();

fs.writeFileSync(
  path.join(dir, "config.json"),
  JSON.stringify({
    name: "Test node",
    port,
    pairOpen: false,
    allowShell: true,
    allowShutdown: true,
    allowInput: true,
    openWindow: false,
    autoStartComfy: false,
  })
);
fs.writeFileSync(
  path.join(dir, "state.json"),
  JSON.stringify({ id: "node_test", token: "hubtok", hub: "athena", index: 1, linkedAt: new Date().toISOString() })
);

const child = spawn(process.execPath, [path.join("node", "athena-node.mjs")], {
  cwd: ROOT,
  env: { ...process.env, ATHENA_NODE_DIR: dir },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

after(async () => {
  await stopChild(child);
  removeDir(dir);
});

let bootstrapToken = "";

test("node boots with an isolated identity directory", async () => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await request(port, "/api/local/bootstrap", { headers: { "x-athena-panel": "1" } });
      if (res.status === 200) {
        bootstrapToken = res.json.token;
        return;
      }
    } catch {
      /* still starting */
    }
    await sleep(150);
  }
  throw new Error(`node did not start\n${output}`);
});

test("loopback alone is not enough for the local API", async () => {
  const noHeader = await request(port, "/api/local/status");
  assert.equal(noHeader.status, 403);
  assert.equal((await request(port, "/api/local/bootstrap")).status, 403);

  const withToken = await request(port, "/api/local/status", { headers: { "x-athena-local": bootstrapToken } });
  assert.equal(withToken.status, 200);
});

test("the node only answers to its own host", async () => {
  const res = await request(port, "/api/hello", { host: "evil.example" });
  assert.equal(res.status, 403);
});

test("the pairing code is never written to the boot log", () => {
  const config = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
  const log = fs.existsSync(path.join(dir, "node.log")) ? fs.readFileSync(path.join(dir, "node.log"), "utf8") : "";
  assert.ok(config.code, "node has a code");
  assert.ok(!log.includes(config.code), "node.log must not contain the pairing code");
});

test("status requires a credential and redacts secrets from the log tail", { timeout: 40_000 }, async () => {
  assert.equal((await request(port, "/api/status")).status, 403);

  const config = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
  fs.appendFileSync(path.join(dir, "node.log"), `[test] leaked code ${config.code} token hubtok\n`);

  const res = await request(port, "/api/status", { headers: { "x-athena-token": "hubtok" } });
  assert.equal(res.status, 200);
  assert.ok(res.json.id, "status answers");
  assert.ok(!res.json.log.includes(config.code), "the pairing code is redacted");
  assert.ok(!res.json.log.includes("hubtok"), "the hub token is redacted");
  assert.match(res.json.log, /\[redacted\]/);
});

test("the hub cannot widen a node's permissions on its own", { timeout: 30_000 }, async () => {
  const viaHub = await request(port, "/api/action", {
    method: "POST",
    headers: { "x-athena-token": "hubtok" },
    body: { op: "config", args: { allowShell: false } },
  });
  assert.equal(viaHub.status, 403);

  const viaPanel = await request(port, "/api/action", {
    method: "POST",
    headers: { "x-athena-local": bootstrapToken },
    body: { op: "config", args: { allowShell: false } },
  });
  assert.equal(viaPanel.status, 200);
  assert.equal(viaPanel.json.config.allowShell, false);
});

test("a malformed or oversized body is rejected", async () => {
  const malformed = await request(port, "/api/link", { method: "POST", body: "{" });
  assert.equal(malformed.status, 400);

  const big = await request(port, "/api/link", { method: "POST", body: JSON.stringify({ hub: "x".repeat(600 * 1024) }) });
  assert.equal(big.status, 413);
});
