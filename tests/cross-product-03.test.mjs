import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, freePort, removeDir, request, sleep, startHub, stopChild, tempDir } from "./helpers.mjs";
import { assessNode } from "../lib/node-protocol.mjs";

/*
 * Automated cross-product check: the real Hub 3.3 code pairs with the real
 * ATHENA Node 0.3 process. It does not replace a second physical PC, firewall
 * prompt or SmartScreen check, and does not claim those happened.
 */
test("Hub 3.3 pairs with Node 0.3 and reads its measured hardware as a controller", async (t) => {
  const dir = tempDir("athena-node-03");
  const port = await freePort();
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      name: "ATHENA Node 0.3 Test",
      port,
      code: "ABC123",
      pairOpen: false,
      allowShell: false,
      allowInput: false,
      allowShutdown: false,
      openWindow: false,
      autoStartComfy: false,
    })
  );

  const node = spawn(process.execPath, [path.join("athena-node", "athena-node.mjs")], {
    cwd: ROOT,
    env: { ...process.env, ATHENA_NODE_DIR: dir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  node.stdout.on("data", (chunk) => (output += chunk.toString()));
  node.stderr.on("data", (chunk) => (output += chunk.toString()));

  const hub = await startHub();
  t.after(async () => {
    await stopChild(node);
    removeDir(dir);
    await hub.stop();
  });

  let hello = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (node.exitCode !== null) break;
    try {
      const reply = await request(port, "/api/hello");
      if (reply.status === 200) {
        hello = reply.json;
        break;
      }
    } catch {
      /* not listening yet */
    }
    await sleep(120);
  }
  assert.ok(hello, `Node 0.3 did not answer /api/hello\n${output}`);
  assert.equal(hello.nodeVersion, "0.3.0");
  const compatibility = assessNode(hello);
  assert.equal(compatibility.compatible, true, compatibility.reason);
  assert.equal(compatibility.protocol, 1);
  assert.ok(compatibility.features.includes("status"));

  const paired = await request(hub.port, "/api/nodes/pair", {
    method: "POST",
    headers: { "x-athena-session": hub.token },
    body: { host: "127.0.0.1", port, code: "ABC123" },
  });
  assert.equal(paired.status, 200, paired.text);

  const controller = await hub.controllerToken();
  assert.ok(controller);
  const state = await request(hub.port, "/api/state", { headers: { "x-athena-session": controller } });
  assert.equal(state.status, 200);
  const nodeState = state.json.nodes.find((item) => item.nodeVersion === "0.3.0");
  assert.ok(nodeState, "the paired Node 0.3 must appear in Hub state");
  assert.equal(nodeState.online, true);
  assert.equal(nodeState.localToHub, true, "the Hub PC's own Node is labelled, not duplicated");
  assert.equal(nodeState.status.capabilities.shell, false, "Hub cannot enable local shell");
  assert.equal(nodeState.status.capabilities.input, false);
  assert.equal(nodeState.status.capabilities.shutdown, false);
  assert.ok(nodeState.status.hardware, "the Node returned a hardware inventory");
  assert.equal(typeof nodeState.status.hardware.memory.totalGb, "number");

  const answer = await request(hub.port, "/api/ask", {
    method: "POST",
    headers: { "x-athena-session": controller },
    body: { text: "Show me the specifications of this PC", history: [] },
  });
  assert.equal(answer.status, 200, answer.text);
  assert.equal(answer.json.meta.path, "hardware");
  assert.match(answer.json.reply, /RAM/);
  assert.match(answer.json.reply, /installed/);
  assert.match(answer.json.reply, /usable/);
  assert.match(answer.json.reply, /available/);
  assert.equal(answer.json.actions[0].name, "node_status");
  assert.equal(answer.json.actions[0].ok, true);
  assert.doesNotMatch(answer.json.actions[0].name, /run_command|shutdown|exec/);
});
