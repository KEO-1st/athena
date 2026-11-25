import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function tempDir(label = "athena") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  return dir;
}

export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may still hold a log file briefly */
  }
}

export async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  for (let i = 0; i < 20; i += 1) {
    if (child.exitCode !== null) return;
    await sleep(100);
  }
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  }
}

/**
 * Minimal HTTP client that can set Host/Origin deliberately (fetch forbids Host).
 * Resolves { status, headers, text, json }.
 */
export function request(port, pathname, { method = "GET", headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers: {
          ...(host ? { host } : {}),
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        timeout: 20_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Boots the real hub on an ephemeral port with an isolated data directory. */
export async function startHub({ dataDir } = {}) {
  const dir = dataDir || tempDir("athena-hub");
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, ATHENA_DATA_DIR: dir, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const deadline = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await request(port, "/api/health");
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* not listening yet */
    }
    await sleep(120);
  }
  if (!ready) {
    await stopChild(child);
    throw new Error(`hub did not start\n${output}`);
  }

  const codeFile = path.join(dir, "access-code.txt");
  const code = fs.existsSync(codeFile) ? fs.readFileSync(codeFile, "utf8").trim() : "";
  let token = "";
  if (code) {
    /* The test client is on loopback, but an administrator session is only
       minted when the Hub app explicitly asks for its local session. A plain
       code login stays a controller. */
    const res = await request(port, "/api/session", { method: "POST", body: { code, local: true, deviceId: "hub-test-admin", deviceName: "Test Hub" } });
    token = res.json?.token || "";
  }

  return {
    port,
    dir,
    code,
    token,
    admin: Boolean(token),
    controllerToken: async () => {
      const res = await request(port, "/api/session", { method: "POST", body: { code, deviceId: `test-controller-${Date.now()}`, deviceName: "Test Controller", platform: "Test · Controller" } });
      return res.json?.token || "";
    },
    child,
    output: () => output,
    stop: async () => {
      await stopChild(child);
      removeDir(dir);
    },
  };
}

/**
 * A pretend node: enough of the real protocol to prove job locking, recovery,
 * cancellation and redaction without Windows, a GPU or a 47910 listener.
 */
export async function startFakeNode({ token = "fake-token", onCancel, protocol = 1, nodeVersion = "0.1.0", features = ["status"] } = {}) {
  const tasks = new Map();
  const cancels = [];
  let seq = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let payload = {};
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      payload = {};
    }
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/api/hello") {
      return send(200, {
        id: "node_fake",
        name: "Fake node",
        version: nodeVersion,
        nodeVersion,
        protocol,
        features,
        port,
        codeRequired: false,
      });
    }
    if (url.pathname === "/api/link" && req.method === "POST") {
      return send(200, { ok: true, id: "node_fake", name: "Fake node", token, index: 1, gpu: "Fake GPU" });
    }
    if (url.pathname === "/api/status") {
      if (req.headers["x-athena-token"] !== token) return send(403, { error: "Bad token." });
      return send(200, { id: "node_fake", name: "Fake node", version: "test", gpu: { name: "Fake GPU", vramGb: 8 }, tasks: [] });
    }
    if (url.pathname === "/api/screen") {
      if (req.headers["x-athena-token"] !== token) return send(403, { error: "Bad token." });
      res.writeHead(200, {
        "content-type": "image/jpeg",
        "x-athena-capture-fps": "24.5",
        "x-athena-capture-ms": "41",
        "x-athena-frame-age-ms": "3",
      });
      return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    if (url.pathname !== "/api/action" || req.method !== "POST") return send(404, { error: "Not found." });
    if (req.headers["x-athena-token"] !== token) return send(403, { error: "Bad token." });

    const { op, args = {} } = payload;
    if (op === "run") {
      seq += 1;
      const id = `task_${seq}`;
      tasks.set(id, { id, state: "running", polls: 0, output: "" });
      return send(200, { ok: true, taskId: id, task: { id, state: "running" } });
    }
    if (op === "task") {
      const task = tasks.get(args.taskId);
      if (!task) return send(404, { error: "No such task." });
      if (task.state === "running") {
        task.polls += 1;
        if (task.polls > 1) {
          task.state = "done";
          task.output = "fake output";
        }
      }
      return send(200, { ok: true, task: { ...task } });
    }
    if (op === "task-cancel") {
      const task = tasks.get(args.taskId);
      cancels.push(args.taskId);
      if (task) task.state = "failed";
      onCancel?.(args.taskId);
      return send(200, { ok: true });
    }
    if (op === "tasks") return send(200, { ok: true, tasks: [...tasks.values()] });
    return send(400, { error: `Unknown action "${op}".` });
  });

  const port = await freePort();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port,
    token,
    cancels,
    tasks,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
