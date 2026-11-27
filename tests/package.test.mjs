import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDir, removeDir } from "./helpers.mjs";
import { buildHubPackage, buildNodePackage } from "../tools/package.mjs";
import { readNodeVersion } from "../node/version.mjs";
import { VERSION } from "../lib/version.mjs";

test("the Node package is standalone and keeps identity outside program files", () => {
  const dir = tempDir("athena-package-node");
  try {
    const built = buildNodePackage({ outDir: dir, zip: true });
    assert.equal(built.version, readNodeVersion());
    assert.ok(built.zip && fs.existsSync(built.zip) && fs.statSync(built.zip).size > 0, "the zip is real, not a reported-but-missing file");
    for (const file of [
      "node/athena-node.mjs",
      "node/run-node.cmd",
      "node/setup-runtime.cmd",
      "node/protocol.mjs",
      "node/version.mjs",
      "node/version.json",
      "node/panel.html",
      "lib/security.mjs",
      "lib/app-catalog.mjs",
      "lib/audio-sources.mjs",
      "Start Node.cmd",
      "Install Node.cmd",
      "README.txt",
      "package.json",
    ]) {
      assert.ok(fs.existsSync(path.join(built.folder, file)), `missing ${file}`);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(built.folder, "package.json"), "utf8"));
    assert.equal(pkg.name, "athena-node");
    assert.equal(pkg.version, readNodeVersion());
    assert.equal(pkg.athena.component, "node");

    const start = fs.readFileSync(path.join(built.folder, "Start Node.cmd"), "utf8");
    assert.match(start, /ATHENA_NODE_DIR/);
    assert.match(start, /LOCALAPPDATA/);
    assert.match(start, /run-node\.cmd/);
    const runtime = fs.readFileSync(path.join(built.folder, "node", "run-node.cmd"), "utf8");
    assert.match(runtime, /ProgramFiles/);
    assert.match(runtime, />= 20/);
    const setup = fs.readFileSync(path.join(built.folder, "node", "setup-runtime.cmd"), "utf8");
    assert.match(setup, /winget upgrade/);
    assert.match(setup, /winget install/);
    assert.match(fs.readFileSync(path.join(built.folder, "Install Node.cmd"), "utf8"), /setup-runtime\.cmd/);
    const info = JSON.parse(fs.readFileSync(path.join(built.folder, "BUILD-INFO.json"), "utf8"));
    assert.equal(info.component, "node");
    assert.ok(info.files["node/athena-node.mjs"]);
    const readme = fs.readFileSync(path.join(built.folder, "README.txt"), "utf8");
    assert.match(readme, /no automatic updater/i);
    assert.match(readme, /Hub protocols/);
  } finally {
    removeDir(dir);
  }
});

test("the Hub package contains a real launcher, the server and the app shell", () => {
  const dir = tempDir("athena-package-hub");
  try {
    const built = buildHubPackage({ outDir: dir, zip: false, runtime: false });
    assert.equal(built.version, VERSION);
    for (const file of ["server.mjs", "version.json", "lib/brain.mjs", "lib/audio-sources.mjs", "public/index.html", "public/app.js", "public/screen-coords.mjs", "Start Athena.cmd", "README.txt", "BUILD-INFO.json"]) {
      assert.ok(fs.existsSync(path.join(built.folder, file)), `missing ${file}`);
    }
    if (process.platform === "win32") {
      assert.ok(built.exe && fs.existsSync(built.exe), "ATHENA Hub.exe was compiled");
      for (const file of ["Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", "assets/athena.ico"]) {
        assert.ok(fs.existsSync(path.join(built.folder, file)), `the desktop package is missing ${file}`);
      }
    }
    const launcher = fs.readFileSync(new URL("../tools/hub-launcher.cs", import.meta.url), "utf8");
    assert.match(launcher, /using Microsoft\.Web\.WebView2\.WinForms/);
    assert.match(launcher, /new WebView2\(\)/);
    assert.match(launcher, /NotifyIcon/);
    assert.match(launcher, /FormClosing[\s\S]{0,500}HideWindow\(\)/);
    assert.doesNotMatch(launcher, /--app=/, "the packaged Hub must not present a browser app window as its desktop app");
    assert.match(fs.readFileSync(path.join(built.folder, "README.txt"), "utf8"), /protocol/);
  } finally {
    removeDir(dir);
  }
});
