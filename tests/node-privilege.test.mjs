import test from "node:test";
import assert from "node:assert/strict";
import { request, startFakeNode, startHub } from "./helpers.mjs";

const adminHeaders = (hub) => ({ "x-athena-session": hub.token });
const controllerHeaders = (token) => ({ "x-athena-session": token });

test("privileged node execution and jobs require the Hub administrator", async (t) => {
  const hub = await startHub();
  const fake = await startFakeNode();
  t.after(async () => {
    await fake.close();
    await hub.stop();
  });

  const paired = await request(hub.port, "/api/nodes/pair", {
    method: "POST",
    headers: adminHeaders(hub),
    body: { host: "127.0.0.1", port: fake.port, code: "FAKE00" },
  });
  assert.equal(paired.status, 200, paired.text);

  const controller = await hub.controllerToken();
  assert.ok(controller);

  const keyReply = await request(hub.port, "/api/keys", {
    method: "POST",
    headers: adminHeaders(hub),
    body: { label: "security-test" },
  });
  assert.equal(keyReply.status, 200);
  const apiKey = keyReply.json.key;
  assert.match(apiKey, /^ath_/);

  /* Unauthorized: controllers and API keys can see nodes, but cannot execute. */
  const execController = await request(hub.port, "/v1/nodes/node_fake/exec", {
    method: "POST",
    headers: controllerHeaders(controller),
    body: { command: "whoami" },
  });
  assert.equal(execController.status, 403);

  const execKey = await request(hub.port, "/v1/nodes/node_fake/exec", {
    method: "POST",
    headers: { "x-athena-key": apiKey },
    body: { command: "whoami" },
  });
  assert.equal(execKey.status, 403);

  const actionController = await request(hub.port, "/api/nodes/node_fake/action", {
    method: "POST",
    headers: controllerHeaders(controller),
    body: { op: "exec", args: { command: "whoami" } },
  });
  assert.equal(actionController.status, 403);

  const tasksController = await request(hub.port, "/api/nodes/node_fake/tasks", {
    headers: controllerHeaders(controller),
  });
  assert.equal(tasksController.status, 403);

  const jobsController = await request(hub.port, "/api/jobs", {
    method: "POST",
    headers: controllerHeaders(controller),
    body: { node: "node_fake", command: "whoami" },
  });
  assert.equal(jobsController.status, 403);

  const jobsKey = await request(hub.port, "/api/jobs", {
    method: "POST",
    headers: { "x-athena-key": apiKey },
    body: { node: "node_fake", command: "whoami" },
  });
  assert.equal(jobsKey.status, 403);

  /* The same route works for the actual administrator. */
  const execAdmin = await request(hub.port, "/v1/nodes/node_fake/exec", {
    method: "POST",
    headers: adminHeaders(hub),
    body: { command: "echo privileged", waitSec: 15 },
  });
  assert.equal(execAdmin.status, 200, execAdmin.text);
  assert.equal(execAdmin.json.job.state, "done");
  assert.match(execAdmin.json.job.output, /fake output/);

  const job = await request(hub.port, "/api/jobs", {
    method: "POST",
    headers: adminHeaders(hub),
    body: { node: "node_fake", command: "echo second" },
  });
  assert.equal(job.status, 202);
  assert.equal(job.json.job.args.command, "echo second");

  /* Non-admin job listings redact commands and output, including cancels. */
  const listController = await request(hub.port, "/api/jobs", {
    headers: controllerHeaders(controller),
  });
  assert.equal(listController.status, 200);
  const controllerJob = listController.json.jobs.find((item) => item.id === job.json.job.id);
  assert.ok(controllerJob);
  assert.equal(controllerJob.redacted, true);
  assert.equal(controllerJob.args, undefined);
  assert.equal(controllerJob.output, undefined);
  assert.equal(controllerJob.label, "run on node_fake");

  const listAdmin = await request(hub.port, "/api/jobs", {
    headers: adminHeaders(hub),
  });
  assert.equal(listAdmin.status, 200);
  const adminJob = listAdmin.json.jobs.find((item) => item.id === job.json.job.id);
  assert.equal(adminJob.args.command, "echo second");

  const cancelController = await request(hub.port, `/api/jobs/${job.json.job.id}/cancel`, {
    method: "POST",
    headers: controllerHeaders(controller),
  });
  assert.equal(cancelController.status, 403);

  /* Cross-node / missing-node requests cannot be redirected by a body field. */
  const missingExec = await request(hub.port, "/v1/nodes/node_missing/exec", {
    method: "POST",
    headers: adminHeaders(hub),
    body: { command: "whoami", node: "node_fake" },
  });
  assert.equal(missingExec.status, 404);

  const missingJob = await request(hub.port, "/api/jobs", {
    method: "POST",
    headers: adminHeaders(hub),
    body: { node: "node_missing", command: "whoami" },
  });
  assert.equal(missingJob.status, 400);

  /* A controller may still observe a paired node without execution rights. */
  const readNode = await request(hub.port, "/api/nodes/node_fake", {
    headers: controllerHeaders(controller),
  });
  assert.equal(readNode.status, 200);
  assert.equal(readNode.json.node.id, "node_fake");
});
