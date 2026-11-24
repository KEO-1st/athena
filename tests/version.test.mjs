import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.mjs";
import { readVersion, VERSION } from "../lib/version.mjs";

test("version.json is the one semver source", () => {
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8"));
  assert.match(file.version, /^\d+\.\d+\.\d+$/);
  assert.equal(VERSION, file.version);
  assert.equal(readVersion(), file.version);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.version, file.version, "package.json version must match version.json");
});

test("source files no longer hard-code a version", () => {
  const server = fs.readFileSync(path.join(ROOT, "server.mjs"), "utf8");
  const node = fs.readFileSync(path.join(ROOT, "node", "athena-node.mjs"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "public", "sw.js"), "utf8");

  assert.doesNotMatch(server, /const VERSION = "\d+\.\d+\.\d+"/);
  assert.doesNotMatch(node, /const VERSION = "\d+\.\d+\.\d+"/);
  assert.match(sw, /__ATHENA_VERSION__/, "the hub substitutes the version into the service worker");
  assert.doesNotMatch(sw, /\?v=\d+/, "asset URLs are versioned by the cache name, not a query string");
});

test("the Node version has its own source of truth", () => {
  const nodeFile = JSON.parse(fs.readFileSync(path.join(ROOT, "node", "version.json"), "utf8"));
  assert.match(nodeFile.version, /^\d+\.\d+\.\d+$/);
  assert.equal(nodeFile.name, "athena-node");
  assert.ok(Number.isInteger(nodeFile.protocol));
});
