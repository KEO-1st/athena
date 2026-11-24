/**
 * What a node can be made to do.
 *
 * ATHENA is not a ComfyUI front-end: ComfyUI is one app out of many that can be
 * installed on a machine and driven from here. The single source of truth is
 * lib/app-catalog.mjs, shared with the node so the two copies cannot drift.
 */
export { APPS, APP_SPECS, APP_CATALOG, appById } from "./app-catalog.mjs";
