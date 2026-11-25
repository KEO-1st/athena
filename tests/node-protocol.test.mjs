import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ROOT, freePort, removeDir, startFakeNode, tempDir } from "./helpers.mjs";
import { nodeFetch } from "../lib/discover.mjs";
import { Registry } from "../lib/nodes.mjs";
import {
  HUB_PROTOCOL,
  NODE_PROTOCOL_MAX,
  NODE_PROTOCOL_MIN,
  assessNode,
  storedCompatibility,
} from "../lib/node-protocol.mjs";
import { NODE_VERSION } from "../node/version.mjs";
import { MAX_HUB_PROTOCOL, MIN_HUB_PROTOCOL, NODE_FEATURES, NODE_PROTOCOL, helloInfo } from "../node/protocol.mjs";

test("the Node has its own version, independent of the Hub", () => {
  const nodeFile = JSON.parse(fs.readFileSync(path.join(ROOT, "node", "version.json"), "utf8"));
  const hubFile = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8"));
  assert.equal(NODE_VERSION, nodeFile.version);
  assert.equal(nodeFile.version, "0.1.1");
  assert.notEqual(NODE_VERSION, hubFile.version, "the Node must not report the Hub version");

  const source = fs.readFileSync(path.join(ROOT, "node", "athena-node.mjs"), "utf8");
  assert.match(source, /from "\.\/version\.mjs"/);
  assert.doesNotMatch(source, /lib\/version\.mjs/, "the Node must not borrow the Hub's version module");
});

test("the Node advertises a protocol, Hub range and stable features", () => {
  const hello = helloInfo();
  assert.equal(hello.protocol, NODE_PROTOCOL);
  assert.equal(hello.nodeVersion, NODE_VERSION);
  assert.deepEqual(hello.hubProtocol, { min: MIN_HUB_PROTOCOL, max: MAX_HUB_PROTOCOL });
  assert.ok(hello.features.includes("status"));
  assert.ok(hello.features.includes("apps"));
  assert.ok(Array.isArray(NODE_FEATURES));
});

test("a Node inside the Hub's range is compatible", () => {
  const result = assessNode({
    protocol: NODE_PROTOCOL,
    nodeVersion: "0.1.0",
    features: ["status"],
    hubProtocol: { min: HUB_PROTOCOL, max: HUB_PROTOCOL },
  });
  assert.equal(result.compatible, true);
  assert.equal(result.status, "ok");
  assert.equal(result.protocol, NODE_PROTOCOL);
  assert.deepEqual(result.hubProtocol, { min: HUB_PROTOCOL, max: HUB_PROTOCOL });
});

test("a Node that cannot speak this Hub's protocol is refused", () => {
  const result = assessNode({
    protocol: NODE_PROTOCOL,
    nodeVersion: "9.0.0",
    features: ["status"],
    hubProtocol: { min: HUB_PROTOCOL + 1, max: HUB_PROTOCOL + 2 },
  });
  assert.equal(result.compatible, false);
  assert.equal(result.status, "hub-incompatible");
  assert.match(result.reason, /Hub protocol/);
  assert.match(result.reason, /Update this Hub/);
});

test("every nodeFetch request carries the Hub protocol header", async (t) => {
  const port = await freePort();
  let seen = "";
  const server = http.createServer((req, res) => {
    seen = String(req.headers["x-athena-hub-protocol"] || "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const res = await nodeFetch({ host: "127.0.0.1", port, token: "tok" }, "/api/audio?source=desktop");
  assert.equal(res.status, 200);
  assert.equal(seen, String(HUB_PROTOCOL));
});

test("old and new protocol numbers are refused with a useful reason", () => {
  const old = assessNode({ protocol: NODE_PROTOCOL_MIN - 1, nodeVersion: "0.0.1", features: [] });
  assert.equal(old.compatible, false);
  assert.equal(old.status, "too-old");
  assert.match(old.reason, /protocol/);

  const future = assessNode({ protocol: NODE_PROTOCOL_MAX + 1, nodeVersion: "9.0.0", features: [] });
  assert.equal(future.compatible, false);
  assert.equal(future.status, "too-new");
  assert.match(future.reason, /Update this Hub/);
});

test("a Node that predates negotiation stays usable but marked legacy", () => {
  const result = assessNode({ version: "0.0.9" });
  assert.equal(result.compatible, true);
  assert.equal(result.status, "legacy");
  assert.equal(result.protocol, null);
  assert.match(result.reason, /predates protocol negotiation/);
});

test("pairing negotiates before linking and stores the Node's own version", async (t) => {
  const fake = await startFakeNode({ protocol: 1, nodeVersion: "0.1.0" });
  const dir = tempDir("athena-pair");
  t.after(async () => {
    await fake.close();
    removeDir(dir);
  });
  const registry = new Registry(path.join(dir, "nodes.json"));
  const node = await registry.pair({ host: "127.0.0.1", port: fake.port, code: "", name: "hub" });
  assert.equal(node.nodeVersion, "0.1.0");
  assert.equal(node.protocol, 1);
  assert.equal(node.compatibility.status, "ok");
  assert.equal(registry.nodes[0].nodeVersion, "0.1.0", "the record survives a reload");
});

test("a future Node protocol is refused instead of half-paired", async (t) => {
  const fake = await startFakeNode({ protocol: NODE_PROTOCOL_MAX + 1, nodeVersion: "9.0.0" });
  const dir = tempDir("athena-pair-bad");
  t.after(async () => {
    await fake.close();
    removeDir(dir);
  });
  const registry = new Registry(path.join(dir, "nodes.json"));
  await assert.rejects(
    () => registry.pair({ host: "127.0.0.1", port: fake.port, code: "", name: "hub" }),
    /newer than this Hub/
  );
  assert.equal(registry.nodes.length, 0, "nothing is stored for an incompatible Node");
});

test("stored compatibility uses the last negotiated values", () => {
  assert.equal(storedCompatibility({ protocol: HUB_PROTOCOL, nodeVersion: "0.1.0", features: ["status"] }).status, "ok");
  assert.equal(storedCompatibility({ protocol: HUB_PROTOCOL, nodeVersion: "0.1.0", features: [] }).status, "incomplete");
  assert.equal(storedCompatibility({}).status, "legacy");
});
