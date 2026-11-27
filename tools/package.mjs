#!/usr/bin/env node
/**
 * Windows packaging for ATHENA. No npm dependencies.
 *
 *   npm run package:node     standalone ATHENA Node 0.1 folder + zip
 *   npm run package:hub      Hub folder + real ATHENA Hub.exe + zip
 *   npm run package          both
 *
 * The Node package is assembled from the exact files in node/ plus the two
 * shared modules the agent already uses. It is not a second implementation.
 * The Hub launcher is compiled with the C# compiler that ships with Windows
 * and starts the Node runtime bundled beside it, so a user never has to run a
 * .cmd file by hand.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VERSION } from "../lib/version.mjs";
import { readNodeVersion } from "../node/version.mjs";
import { MAX_HUB_PROTOCOL, MIN_HUB_PROTOCOL, NODE_PROTOCOL } from "../node/protocol.mjs";
import { NODE_PROTOCOL_MAX, NODE_PROTOCOL_MIN } from "../lib/node-protocol.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const CSC = [
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
].find((file) => fs.existsSync(file));

const WEBVIEW2_VERSION = "1.0.4370.26";

/* The launchers are native WinForms windows with an embedded WebView2. The SDK
   is fetched once into a cache; it is not an npm dependency and never ends up
   as source in the product. Runtime WebView2 itself ships with Windows 10/11. */
function ensureWebView2() {
  const candidates = [
    path.join(ROOT, "tools", "webview2"),
    path.join(ROOT, "tools", ".cache", "webview2", "extracted"),
    path.join(os.tmpdir(), "athena-webview2", WEBVIEW2_VERSION),
  ];
  const valid = (dir) =>
    fs.existsSync(path.join(dir, "lib", "net462", "Microsoft.Web.WebView2.Core.dll")) &&
    fs.existsSync(path.join(dir, "lib", "net462", "Microsoft.Web.WebView2.WinForms.dll")) &&
    fs.existsSync(path.join(dir, "build", "native", "x64", "WebView2Loader.dll"));
  const found = candidates.find(valid);
  if (found) return found;

  const dir = path.join(os.tmpdir(), "athena-webview2", WEBVIEW2_VERSION);
  fs.mkdirSync(dir, { recursive: true });
  const zipFile = path.join(dir, "sdk.zip");
  if (!fs.existsSync(zipFile)) {
    const url = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WEBVIEW2_VERSION}/microsoft.web.webview2.${WEBVIEW2_VERSION}.nupkg`;
    const script = [
      "$ErrorActionPreference='Stop'",
      `Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile '${zipFile.replace(/'/g, "''")}'`,
    ].join("\n");
    const fetched = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 120_000 });
    if (fetched.status !== 0 || !fs.existsSync(zipFile)) {
      throw new Error(`Could not download the WebView2 SDK: ${fetched.stderr || fetched.stdout || "no file"}`);
    }
  }
  if (!valid(dir)) {
    const unpack = `Expand-Archive -LiteralPath '${zipFile.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`;
    const expanded = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", unpack], { encoding: "utf8", timeout: 120_000 });
    if (expanded.status !== 0 || !valid(dir)) {
      throw new Error(`Could not extract the WebView2 SDK: ${expanded.stderr || expanded.stdout || "missing files"}`);
    }
  }
  return dir;
}

function installWebView2(folder) {
  const sdk = ensureWebView2();
  const files = [
    path.join(sdk, "lib", "net462", "Microsoft.Web.WebView2.Core.dll"),
    path.join(sdk, "lib", "net462", "Microsoft.Web.WebView2.WinForms.dll"),
    path.join(sdk, "build", "native", "x64", "WebView2Loader.dll"),
  ];
  for (const file of files) copy(file, path.join(folder, path.basename(file)));
  return {
    core: files[0],
    winforms: files[1],
  };
}

const NODE_FILES = [
  "athena-node.mjs",
  "run-node.cmd",
  "setup-runtime.cmd",
  "programs.mjs",
  "protocol.mjs",
  "version.mjs",
  "version.json",
  "panel.html",
  "host-screen.ps1",
  "host-input.ps1",
];
const NODE_SHARED = ["lib/app-catalog.mjs", "lib/audio-sources.mjs", "lib/security.mjs"];
const HUB_FILES = ["server.mjs", "version.json", "package.json", "Start Athena.cmd"];

function fresh(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.replace(/\n/g, "\r\n"), "utf8");
}

/* A build record makes an artifact auditable without making it non-reproducible:
   it contains content hashes and versions, never a timestamp. */
function writeBuildInfo(folder, fields) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(folder, full).replace(/\\/g, "/");
      if (rel === "BUILD-INFO.json") continue;
      files[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(folder);
  fs.writeFileSync(path.join(folder, "BUILD-INFO.json"), JSON.stringify({ ...fields, files }, null, 2) + "\n", "utf8");
}

function zip(folder, destination) {
  fs.rmSync(destination, { force: true });
  const source = `${folder.replace(/'/g, "''")}\\*`;
  const target = destination.replace(/'/g, "''");
  /* Compress-Archive can fail with a non-terminating error (commonly a
     transient antivirus lock on runtime\\node.exe) while PowerShell still
     exits 0. Verify the artifact instead of trusting the exit code. */
  const script = [
    "$ErrorActionPreference='Stop'",
    "for($i=0;$i -lt 3;$i++) {",
    "  try {",
    "    Compress-Archive -Path '" + source + "' -DestinationPath '" + target + "' -Force",
    "    break",
    "  } catch {",
    "    if($i -eq 2) { Write-Error $_; exit 1 }",
    "    Start-Sleep -Milliseconds 700",
    "  }",
    "}",
    "if(!(Test-Path -LiteralPath '" + target + "')) { Write-Error 'archive was not created'; exit 2 }",
    "$item=Get-Item -LiteralPath '" + target + "'",
    "if($item.Length -le 0) { Write-Error 'archive is empty'; exit 3 }",
  ].join("\n");
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 300_000,
  });
  if (result.status !== 0 || !fs.existsSync(destination) || fs.statSync(destination).size === 0) {
    throw new Error(`Could not create ${path.basename(destination)}: ${result.stderr || result.stdout || "missing/empty archive"}`);
  }
  return destination;
}

/* ──────────────────────────────────────────────────────────────── node */

export function buildNodePackage({ outDir = DIST, zip: shouldZip = true } = {}) {
  const version = readNodeVersion();
  const folder = path.join(outDir, `ATHENA-Node-${version}`);
  fresh(folder);

  for (const name of NODE_FILES) copy(path.join(ROOT, "node", name), path.join(folder, "node", name));
  for (const name of NODE_SHARED) copy(path.join(ROOT, name), path.join(folder, name));

  fs.writeFileSync(
    path.join(folder, "package.json"),
    JSON.stringify(
      {
        name: "athena-node",
        version,
        private: true,
        type: "module",
        description: "ATHENA Node — the agent that lets an ATHENA Hub drive this PC.",
        engines: { node: ">=20" },
        athena: { protocol: NODE_PROTOCOL, component: "node" },
      },
      null,
      2
    )
  );

  write(
    path.join(folder, "Start Node.cmd"),
    `@echo off
title ATHENA NODE ${version}
cd /d "%~dp0"

rem Identity + pairing live in LOCALAPPDATA, outside these program files.
rem Replacing this folder with a newer Node package keeps them.
if "%ATHENA_NODE_DIR%"=="" set "ATHENA_NODE_DIR=%LOCALAPPDATA%\\ATHENA Node"
if not exist "%ATHENA_NODE_DIR%" mkdir "%ATHENA_NODE_DIR%"

cd /d "%~dp0"
call "%~dp0node\\run-node.cmd"
if errorlevel 1 pause
`
  );  write(
    path.join(folder, "Install Node.cmd"),
    `@echo off
title ATHENA NODE SETUP
cd /d "%~dp0"

call "%~dp0node\\setup-runtime.cmd"
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo   ================================================
echo    ATHENA NODE ${version}
echo   ================================================
echo    The next window is THIS PC's node. Keep it open.
echo    It shows a six-character pairing code.
echo    On the hub: NODES - SCAN - LINK, then enter the code.
echo.
echo    If Windows asks about the firewall, allow PRIVATE
echo    networks so the hub can reach this PC.
echo.
pause
call "%~dp0Start Node.cmd"
`
  );

  write(
    path.join(folder, "README.txt"),
    `ATHENA NODE ${version}
=================

This is the portable standalone ATHENA Node. It is NOT a Windows installer:
keep this folder wherever you like. It is versioned separately from the Hub.
Hub ${VERSION} speaks Node protocol ${NODE_PROTOCOL}; this Node understands Hub protocols ${MIN_HUB_PROTOCOL}-${MAX_HUB_PROTOCOL}.
It needs Node.js 20+ (Install Node.cmd gets it) or an existing Node 20+ install.

INSTALL ON A WINDOWS PC
  1. Copy this whole folder to that PC.
  2. Run "Install Node.cmd" (installs Node.js 20+ if needed, then starts it).
     The launcher also finds a just-installed Node whose PATH has not refreshed.
  3. Allow the Windows firewall prompt for PRIVATE networks.
  4. On the Hub: NODES -> SCAN -> LINK, and type the pairing code shown here.
  5. Start it again later with "Start Node.cmd".

WHERE YOUR IDENTITY LIVES
  %LOCALAPPDATA%\\ATHENA Node\\config.json   name, port, pairing code, permissions
  %LOCALAPPDATA%\\ATHENA Node\\state.json    this node's id and hub token
  These files are never overwritten by a Node upgrade. Delete them only if you
  deliberately want to unpair and start over.

UPDATES ARE YOUR DECISION
  There is no automatic updater. To move to a newer Node, close this window,
  extract the newer package, and replace the program files (node\\ and lib\\).
  Keep the LOCALAPPDATA folder. The old version keeps working until you do.

WHY A NODE AND A HUB ARE SEPARATE
  The Hub is the brain and the window. A Node is a pair of hands on one PC.
  A Hub update must not silently change what an already-installed Node does,
  which is why the protocol is negotiated at pairing and on every status read.
`
  );

  writeBuildInfo(folder, { component: "node", version, protocol: NODE_PROTOCOL, hubProtocol: { min: MIN_HUB_PROTOCOL, max: MAX_HUB_PROTOCOL } });
  const result = { folder, version, protocol: NODE_PROTOCOL, zip: null };
  if (shouldZip) result.zip = zip(folder, path.join(outDir, `ATHENA-Node-${version}-win64.zip`));
  return result;
}

/* ───────────────────────────────────────────────────────────────── hub */

export function buildHubPackage({ outDir = DIST, zip: shouldZip = true, runtime = true } = {}) {
  const folder = path.join(outDir, `ATHENA-Hub-${VERSION}`);
  fresh(folder);

  for (const name of HUB_FILES) copy(path.join(ROOT, name), path.join(folder, name));
  fs.cpSync(path.join(ROOT, "lib"), path.join(folder, "lib"), { recursive: true });
  fs.cpSync(path.join(ROOT, "public"), path.join(folder, "public"), { recursive: true });
  fs.cpSync(path.join(ROOT, "assets"), path.join(folder, "assets"), { recursive: true });

  let exe = null;
  if (CSC) {
    const sdk = installWebView2(folder);
    const source = path.join(ROOT, "tools", "hub-launcher.cs");
    exe = path.join(folder, "ATHENA Hub.exe");
    const compiled = spawnSync(CSC, [
      "/nologo",
      "/optimize+",
      "/target:winexe",
      `/out:${exe}`,
      "/r:System.dll",
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      `/r:${sdk.core}`,
      `/r:${sdk.winforms}`,
      `/win32icon:${path.join(ROOT, "assets", "athena.ico")}`,
      source,
    ], { encoding: "utf8" });
    if (compiled.status !== 0) throw new Error(`Could not compile ATHENA Hub.exe: ${compiled.stderr || compiled.stdout}`);
  }

  if (runtime) {
    const runtimeDir = path.join(folder, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    copy(process.execPath, path.join(runtimeDir, "node.exe"));
  }

  write(
    path.join(folder, "Start Athena.cmd"),
    `@echo off
title ATHENA HUB ${VERSION}
cd /d "%~dp0"
if exist "%~dp0runtime\\node.exe" (
  "%~dp0runtime\\node.exe" server.mjs
) else (
  node server.mjs
)
if errorlevel 1 pause
`
  );

  write(
    path.join(folder, "README.txt"),
    `ATHENA HUB ${VERSION}
===============

ATHENA Hub ${VERSION} · Node protocol ${NODE_PROTOCOL} (accepts ${NODE_PROTOCOL_MIN}-${NODE_PROTOCOL_MAX})

PORTABLE, NOT AN INSTALLER
  There is no installer, service, registry entry or uninstaller. Copy or move
  this whole folder. Data lives in data\ and moves with it.

START
  Double-click "ATHENA Hub.exe". That is the Hub's own desktop window, hosted
  in WebView2. Closing or minimising it hides the Hub to the notification area;
  phones and Nodes stay connected. Use the tray icon to show it again or Quit.
  If your antivirus dislikes a new unsigned .exe, "Start Athena.cmd" runs the
  same server with the bundled runtime in a console window.

WHAT IS IN THIS FOLDER
  ATHENA Hub.exe     launcher (no install, no registry changes)
  runtime\\node.exe   the Node runtime the hub uses
  server.mjs, lib\\, public\\, version.json
  data\\              created on first run: access code, keys, paired nodes, jobs

Move the whole folder if you like. Its data moves with it. Do not put it in
Program Files: the hub writes its access code and keys into data\\.

NODES
  Nodes are installed separately and have their own version numbers. Updating
  this Hub does not update, restart, or re-pair a Node. If a Node is outside
  the protocol range above, the hub says so instead of half-driving it.
`
  );

  writeBuildInfo(folder, { component: "hub", version: VERSION, nodeProtocol: NODE_PROTOCOL, acceptsNodeProtocol: { min: NODE_PROTOCOL_MIN, max: NODE_PROTOCOL_MAX } });
  const result = { folder, version: VERSION, exe, runtime, zip: null };
  if (shouldZip) result.zip = zip(folder, path.join(outDir, `ATHENA-Hub-${VERSION}-win64.zip`));
  return result;
}

/* ───────────────────────────────────────────────────────────────── cli */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "all";
  const outDir = args.includes("--out") ? path.resolve(args[args.indexOf("--out") + 1]) : DIST;
  const shouldZip = !args.includes("--no-zip");
  const runtime = !args.includes("--no-runtime");
  fs.mkdirSync(outDir, { recursive: true });

  if (only === "node" || only === "all") {
    const built = buildNodePackage({ outDir, zip: shouldZip });
    console.log(`node: ${built.folder}${built.zip ? ` + ${path.basename(built.zip)}` : ""}`);
  }
  if (only === "hub" || only === "all") {
    const built = buildHubPackage({ outDir, zip: shouldZip, runtime });
    console.log(`hub:  ${built.folder}${built.exe ? " (ATHENA Hub.exe)" : " (no C# compiler; Start Athena.cmd only)"}${built.zip ? ` + ${path.basename(built.zip)}` : ""}`);
  }
  if (os.platform() !== "win32") console.log("note: this packaging target is Windows; files were still assembled.");
}
