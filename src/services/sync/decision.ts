import type { SyncCheckpoint } from "./types";

export function syncDecision(fingerprint: string, empty: boolean, base: SyncCheckpoint | undefined, remote: SyncCheckpoint | undefined) {
  if (!remote) return base ? "conflict" : empty ? "idle" : "upload";
  if (remote.fingerprint === fingerprint) return "equal";
  if (!base) return empty ? "download" : "conflict";
  if (remote.revision < base.revision) return "conflict";
  if (remote.revision === base.revision && remote.fingerprint === base.fingerprint) return "upload";
  return fingerprint === base.fingerprint ? "download" : "conflict";
}
