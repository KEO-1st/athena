import dgram from "node:dgram";
import os from "node:os";
import { hubProtocolHeaders } from "./node-protocol.mjs";

/**
 * ATHENA discovery. The hub shouts ATHENA_DISCOVER on UDP 48880; every node
 * answers ATHENA_NODE with its identity, GPU and readiness. Legacy
 * UNORDINARY_LINKER agents are ignored on purpose: they speak a different
 * protocol and would not understand hub commands.
 */

export const DISCOVERY_PORT = 48_880;
export const DISCOVERY_WORD = "ATHENA_DISCOVER";
export const REPLY_WORD = "ATHENA_NODE";
export const NODE_PORT = 47_910;

export function broadcastTargets() {
  const targets = new Set(["255.255.255.255", "127.0.0.1"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const ip = entry.address.split(".").map(Number);
      const mask = (entry.netmask || "255.255.255.0").split(".").map(Number);
      if (ip.length !== 4) continue;
      targets.add(
        ip
          .map((part, index) => (part & (mask[index] ?? 255)) | (~(mask[index] ?? 255) & 255))
          .join(".")
      );
      targets.add(entry.address);
    }
  }
  return [...targets];
}

export function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) found.push({ name, address: item.address });
    }
  }
  return found.sort((a, b) => {
    const rank = (ip) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : 3);
    return rank(a.address) - rank(b.address);
  });
}

export function discover(timeoutMs = 2200) {
  return new Promise((resolve) => {
    const found = new Map();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch {
        /* closed already */
      }
      resolve([...found.values()]);
    };

    socket.on("message", (message, rinfo) => {
      try {
        const json = JSON.parse(message.toString("utf8"));
        if (json.reply !== REPLY_WORD) return;
        const host = String(rinfo.address).replace(/^::ffff:/, "");
        const id = String(json.id || host);
        found.set(id, {
          id,
          name: String(json.name || host),
          host,
          port: Number(json.port) || NODE_PORT,
          version: json.version ? String(json.version) : undefined,
          nodeVersion: json.nodeVersion ? String(json.nodeVersion) : undefined,
          protocol: Number.isInteger(Number(json.protocol)) ? Number(json.protocol) : null,
          features: Array.isArray(json.features) ? json.features : [],
          state: String(json.state || "ready"),
          gpu: json.gpu ? String(json.gpu) : undefined,
          vramGb: json.vramGb ? Number(json.vramGb) : undefined,
          load: json.load ?? null,
        });
      } catch {
        /* stray packet */
      }
    });

    socket.on("error", finish);

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* direct addresses still work */
      }
      const payload = Buffer.from(DISCOVERY_WORD);
      const shout = () => {
        for (const target of broadcastTargets()) socket.send(payload, DISCOVERY_PORT, target, () => undefined);
      };
      shout();
      setTimeout(shout, 500);
      setTimeout(finish, timeoutMs);
    });
  });
}

/* Every Hub→Node request, including image and audio streams, goes through
   this header set. A proxy that calls fetch() directly is how the screen and
   audio paths previously escaped the protocol guard. */
export function nodeFetch(node, pathname, init = {}, timeoutMs = 30_000) {
  return fetch(`http://${node.host}:${node.port}${pathname}`, {
    ...init,
    headers: {
      ...hubProtocolHeaders(),
      "x-athena-token": node.token || "",
      ...((init.headers || {})),
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
}

export async function nodeRequest(node, pathname, init = {}, timeoutMs = 30_000) {
  const res = await nodeFetch(
    node,
    pathname,
    { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } },
    timeoutMs
  );
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}
