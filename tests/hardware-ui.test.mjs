import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));

test("the Hub presents the coordinated product name and version source", () => {
  assert.match(html, /<title>ATHENA Hub<\/title>/);
  assert.doesNotMatch(html, /CORE OS 4\.7/);
  assert.equal(manifest.name, "ATHENA Hub");
  assert.equal(manifest.short_name, "ATHENA Hub");
});

test("the Node detail view separates installed, usable and available hardware", () => {
  assert.match(app, /HARDWARE &amp; CAPABILITIES/);
  assert.match(app, /installed \$\{hwText\(memory\.installedGb\, \" GB\"\)\}/);
  assert.match(app, /usable \$\{hwText\(memory\.totalGb\, \" GB\"\)\}/);
  assert.match(app, /available \$\{hwText\(memory\.freeGb\, \" GB\"\)\}/);
  assert.match(app, /Node did not return a hardware inventory/);
});

test("the Hub PC is labelled without being treated as a privileged Node", () => {
  assert.match(app, /node\.localToHub \? '<span class=\"badge ok\">THIS PC<\/span>'/);
  assert.match(fs.readFileSync(new URL("../lib/nodes.mjs", import.meta.url), "utf8"), /localToHub: Boolean\(hostname && hostname === os\.hostname\(\)\.toLowerCase\(\)\)/);
});

test("the controller stops its stream while hidden and reconnects with backoff", () => {
  assert.match(app, /document\.addEventListener\(\"visibilitychange\"/);
  assert.match(app, /Math\.min\(30_000, 2000 \* 2 \*\* Math\.min\(streamRetry, 4\)\)/);
  assert.match(app, /if \(document\.visibilityState === \"hidden\"\) return/);
});
