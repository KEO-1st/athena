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
    const built = buildNodePackage({ outDir: dir, zip: false });
    assert.equal(built.version, readNodeVersion());
    for (const file of [
      "node/athena-node.mjs",
      "node/protocol.mjs",
      "node/version.mjs",
      "node/version.json",
      "node/panel.html",
      "lib/security.mjs",
      "lib/app-catalog.mjs",
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
    for (const file of ["server.mjs", "version.json", "lib/brain.mjs", "public/index.html", "public/app.js", "Start Athena.cmd", "README.txt"]) {
      assert.ok(fs.existsSync(path.join(built.folder, file)), `missing ${file}`);
    }
    if (process.platform === "win32") assert.ok(built.exe && fs.existsSync(built.exe), "ATHENA Hub.exe was compiled");
    assert.match(fs.readFileSync(path.join(built.folder, "README.txt"), "utf8"), /protocol/);
  } finally {
    removeDir(dir);
  }
});
