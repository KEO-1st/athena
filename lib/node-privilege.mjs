/**
 * One list of node actions that require Hub-administrator authority.
 *
 * A controller session and an API key may look at machines and drive a screen;
 * they may not run arbitrary commands, install software, rewrite node settings
 * or power a machine off. The HTTP routes and the AI tools both consult this
 * module, so a new action cannot be privileged in one path and open in another.
 */
export const PRIVILEGED_NODE_OPS = Object.freeze([
  "run",
  "exec",
  "task-cancel",
  "app-install",
  "install-node",
  "pip",
  "pull-model",
  "config",
  "shutdown",
]);

const PRIVILEGED = new Set(PRIVILEGED_NODE_OPS);

export function isPrivilegedNodeOp(op) {
  return PRIVILEGED.has(String(op || ""));
}
