/**
 * Hub side of the ATHENA Node protocol contract.
 *
 * RANGE, NOT EXACT MATCH. A Hub accepts every Node protocol in
 * [NODE_PROTOCOL_MIN, NODE_PROTOCOL_MAX]. Raising NODE_PROTOCOL_MAX is how a
 * future Hub learns a new Node without breaking older ones; lowering
 * NODE_PROTOCOL_MIN is a deliberate decision to drop old Nodes and must be
 * called out in the release notes.
 *
 * Nodes that predate negotiation (no `protocol` in /api/hello) are treated as
 * `legacy`: still usable, visibly marked, and limited to the fields the Hub
 * has always understood.
 */
export const HUB_PROTOCOL = 1;
export const NODE_PROTOCOL_MIN = 1;
export const NODE_PROTOCOL_MAX = 1;

/** A Node must be able to answer status for the Hub to do anything useful. */
export const REQUIRED_NODE_FEATURES = ["status"];

function versionOf(input = {}) {
  return String(input.nodeVersion || input.version || "unknown");
}

/** A Node's declared Hub-protocol window, or null for a legacy Node. */
function hubRangeOf(input = {}) {
  const range = input.hubProtocol;
  if (!range || typeof range !== "object") return null;
  const min = Number(range.min);
  const max = Number(range.max);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) return null;
  return { min, max };
}

/** Headers every Hub request must carry, including raw screen/audio proxies. */
export function hubProtocolHeaders() {
  return { "x-athena-hub-protocol": String(HUB_PROTOCOL) };
}

/**
 * Assess one /api/hello or /api/status payload.
 * Returns { status, compatible, protocol, nodeVersion, features, reason }.
 */
export function assessNode(input = {}) {
  const nodeVersion = versionOf(input);
  const features = Array.isArray(input.features)
    ? input.features.filter((item) => typeof item === "string").slice(0, 40)
    : [];
  const raw = input.protocol;
  /* null means "this Node never negotiated". Number(null) is 0, which would
     be misread as an ancient protocol instead of a legacy Node. */
  const protocol = raw === null || raw === undefined || raw === "" ? null : Number.isInteger(Number(raw)) ? Number(raw) : null;
  const hubProtocol = hubRangeOf(input);

  if (protocol === null) {
    return {
      status: "legacy",
      compatible: true,
      protocol: null,
      nodeVersion,
      features,
      hubProtocol,
      reason:
        "This Node predates protocol negotiation. It still works, but update the Node when convenient to get compatibility checks.",
    };
  }

  /* A Node can speak the Node protocol but refuse this Hub's protocol. That
     is a two-sided contract: checking only the Node number would half-drive a
     Node whose /api/hello or /api/action it does not understand. */
  if (hubProtocol && (HUB_PROTOCOL < hubProtocol.min || HUB_PROTOCOL > hubProtocol.max)) {
    return {
      status: "hub-incompatible",
      compatible: false,
      protocol,
      nodeVersion,
      features,
      hubProtocol,
      reason: `This Hub speaks Hub protocol ${HUB_PROTOCOL}, but the Node accepts ${hubProtocol.min}–${hubProtocol.max}. Update ${HUB_PROTOCOL < hubProtocol.min ? "this Hub" : "ATHENA Node on that PC"}.`,
    };
  }

  if (protocol < NODE_PROTOCOL_MIN) {
    return {
      status: "too-old",
      compatible: false,
      protocol,
      nodeVersion,
      features,
      hubProtocol,
      reason: `Node protocol ${protocol} is older than this Hub supports (${NODE_PROTOCOL_MIN}–${NODE_PROTOCOL_MAX}). Update ATHENA Node on that PC.`,
    };
  }

  if (protocol > NODE_PROTOCOL_MAX) {
    return {
      status: "too-new",
      compatible: false,
      protocol,
      nodeVersion,
      features,
      hubProtocol,
      reason: `Node protocol ${protocol} is newer than this Hub understands (${NODE_PROTOCOL_MIN}–${NODE_PROTOCOL_MAX}). Update this Hub, or install the older Node package on that PC.`,
    };
  }

  const missing = REQUIRED_NODE_FEATURES.filter((feature) => !features.includes(feature));
  if (missing.length) {
    return {
      status: "incomplete",
      compatible: false,
      protocol,
      nodeVersion,
      features,
      hubProtocol,
      reason: `The Node does not advertise required feature(s): ${missing.join(", ")}.`,
    };
  }

  return {
    status: "ok",
    compatible: true,
    protocol,
    nodeVersion,
    features,
    hubProtocol,
    reason: `Node ${nodeVersion} speaks protocol ${protocol}.`,
  };
}

/** Compatibility of a stored node record (uses the last negotiation). */
export function storedCompatibility(node = {}) {
  return assessNode({
    protocol: node.protocol ?? null,
    nodeVersion: node.nodeVersion,
    features: node.features,
    hubProtocol: node.hubProtocol || null,
  });
}
