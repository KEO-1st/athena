import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const design = fs.readFileSync(new URL("../public/design.css", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
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

test("the home workspace keeps the chat input on screen instead of centering it off-canvas", () => {
  assert.match(html, /<div class="chat" id="chat">[\s\S]*<form id="ask-form" class="ask">[\s\S]*<input id="ask"/, "the composer follows the conversation and contains a real input");
  assert.match(html, /id="cancel-ask"/, "a stuck answer can be stopped without reloading");
  assert.match(design, /section\.view\[data-view="home"\] > \.composer[\s\S]{0,260}position: static;[\s\S]{0,120}transform: none;/, "desktop sticky sizing must reset the legacy fixed centering");
  assert.match(styles, /section\.view\[data-view="home"\] \{ padding-bottom: 236px; \}/, "phone layout still reserves room for the fixed composer");
  assert.match(app, /\.abort\("cancel"\)/, "the stop control aborts the real request");
  assert.match(app, /Date\.now\(\) - lastStateAt > 20_000/, "a dropped stream cannot leave the workspace stale");
  assert.match(app, /store\.stream\.readyState === 2/, "a closed stream is reopened without a manual refresh");
});

test("the controller stops its stream while hidden and reconnects with backoff", () => {
  assert.match(app, /document\.addEventListener\(\"visibilitychange\"/);
  assert.match(app, /Math\.min\(30_000, 2000 \* 2 \*\* Math\.min\(streamRetry, 4\)\)/);
  assert.match(app, /if \(document\.visibilityState === \"hidden\"\) return/);
});
