import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Registry } from "../lib/nodes.mjs";
import { Jobs } from "../lib/jobs.mjs";
import { sleep, startFakeNode, tempDir, removeDir } from "./helpers.mjs";

async function until(check, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await sleep(80);
  }
  return false;
}

test("a restart fails running jobs and resumes the queued ones", async (t) => {
  const fake = await startFakeNode();
  const dir = tempDir("athena-jobs");
  const nodesFile = path.join(dir, "nodes.json");
  fs.writeFileSync(
    nodesFile,
    JSON.stringify({ nodes: [{ id: "node_fake", name: "Fake node", host: "127.0.0.1", port: fake.port, token: fake.token, index: 1 }] })
  );
  const jobsFile = path.join(dir, "jobs.json");
  fs.writeFileSync(
    jobsFile,
    JSON.stringify({
      jobs: [
        { id: "job_running", node: "node_fake", op: "run", args: { command: "echo old" }, label: "old", state: "running", createdAt: new Date().toISOString(), startedAt: new Date().toISOString() },
        { id: "job_queued", node: "node_fake", op: "run", args: { command: "echo new" }, label: "new", state: "queued", createdAt: new Date().toISOString() },
      ],
    })
  );
  t.after(async () => {
    await fake.close();
    removeDir(dir);
  });

  const registry = new Registry(nodesFile);
  const jobs = new Jobs(jobsFile, registry);
  const result = jobs.recover();
  assert.equal(result.failed, 1);
  assert.equal(jobs.get("job_running").state, "failed");
  assert.match(jobs.get("job_running").output, /Hub restarted/);

  assert.ok(await until(() => jobs.get("job_queued").state === "done", 10_000), "queued job runs without a new request");
});

test("cancelling a running job stops it on the node and is not overwritten", async (t) => {
  const fake = await startFakeNode();
  const dir = tempDir("athena-jobs-cancel");
  const nodesFile = path.join(dir, "nodes.json");
  fs.writeFileSync(
    nodesFile,
    JSON.stringify({ nodes: [{ id: "node_fake", name: "Fake node", host: "127.0.0.1", port: fake.port, token: fake.token, index: 1 }] })
  );
  t.after(async () => {
    await fake.close();
    removeDir(dir);
  });

  const registry = new Registry(nodesFile);
  const jobs = new Jobs(path.join(dir, "jobs.json"), registry);
  const job = jobs.create({ node: "node_fake", op: "run", args: { command: "echo long" }, label: "long" });

  assert.ok(await until(() => job.state === "running" && registry.activeTasks.size > 0));
  const cancelled = await jobs.cancel(job.id);
  assert.equal(cancelled, true);
  assert.equal(job.state, "cancelled");
  assert.equal(fake.cancels.length, 1, "the node was told to stop the task");

  await sleep(1200);
  assert.equal(job.state, "cancelled", "the completion must not turn a cancelled job back into done");
});

test("a job records who created it, not just a guessed source", async (t) => {
  const dir = tempDir("athena-jobs-origin");
  t.after(() => removeDir(dir));
  const jobs = new Jobs(path.join(dir, "jobs.json"), {});
  const keyed = jobs.create({ node: "node_fake", op: "run", args: { command: "echo hi" }, source: "api", createdBy: "API key “ci”" });
  assert.equal(keyed.source, "api");
  assert.equal(keyed.createdBy, "API key “ci”");

  const old = jobs.create({ node: "node_fake", op: "run", args: {} });
  assert.equal(old.source, "api", "an old client still produces a usable source");
  assert.equal(old.createdBy, null, "provenance is not invented");
});

test("a finished job cannot be cancelled", async (t) => {
  const fake = await startFakeNode();
  const dir = tempDir("athena-jobs-done");
  t.after(async () => {
    await fake.close();
    removeDir(dir);
  });
  const nodesFile = path.join(dir, "nodes.json");
  fs.writeFileSync(
    nodesFile,
    JSON.stringify({ nodes: [{ id: "node_fake", name: "Fake node", host: "127.0.0.1", port: fake.port, token: fake.token, index: 1 }] })
  );
  const jobs = new Jobs(path.join(dir, "jobs.json"), new Registry(nodesFile));
  const job = jobs.create({ node: "node_fake", op: "run", args: { command: "echo quick" } });
  assert.ok(await until(() => job.state === "done", 10_000));
  assert.equal(await jobs.cancel(job.id), false);
});
