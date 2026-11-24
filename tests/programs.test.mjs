import test from "node:test";
import assert from "node:assert/strict";
import { asUrl, normalizeProgramName, programCandidates, resolveProgramTarget } from "../node/programs.mjs";

test("\"task manager\" resolves to the real Windows exe", () => {
  const target = resolveProgramTarget("task manager", {
    exists: (candidate) => /\.exe$/i.test(candidate),
    env: {},
  });
  assert.match(target, /Taskmgr\.exe$/i);
});

test("common spoken names map to their executables", () => {
  assert.deepEqual(programCandidates("Task Manager"), ["taskmanager", "taskmgr"]);
  assert.deepEqual(programCandidates("Google Chrome"), ["googlechrome", "chrome"]);
  assert.deepEqual(programCandidates("file explorer"), ["fileexplorer", "explorer"]);
  assert.equal(normalizeProgramName("Taskmgr.exe"), "taskmgr");
});

test("an existing PATH binary is accepted without an alias", () => {
  const target = resolveProgramTarget("notepad", {
    exists: (candidate) => candidate.endsWith("notepad.exe"),
    env: {},
  });
  assert.match(target, /notepad\.exe$/i);
});

test("a missing program resolves to null instead of a guess", () => {
  assert.equal(resolveProgramTarget("no such app", { exists: () => false, env: {} }), null);
});

test("websites are recognised without being confused with programs", () => {
  assert.equal(asUrl("youtube"), "https://www.youtube.com");
  assert.equal(asUrl("example.com/docs"), "https://example.com/docs");
  assert.equal(asUrl("https://github.com/owner/repo"), "https://github.com/owner/repo");
  assert.equal(asUrl("task manager"), null);
  assert.equal(asUrl("chrome"), null);
  assert.equal(asUrl("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"), null);
});
