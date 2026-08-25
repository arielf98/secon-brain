import type { FileSnapshot, ManifestEntry, RemoteFile } from "./sync-model.js";
import { makeConflictPath } from "./conflicts.js";

export interface SyncSnapshot {
  local: Record<string, FileSnapshot>;
  remote: Record<string, RemoteFile>;
  base: Record<string, ManifestEntry>;
}

export type SyncAction = {
  type: "upload" | "download" | "delete-local" | "delete-remote" | "conflict" | "skip";
  path: string;
  remote?: RemoteFile;
  conflictPath?: string;
  reason: string;
};

export function planSync(snapshot: SyncSnapshot, deviceId: string, now: number): SyncAction[] {
  const paths = new Set([
    ...Object.keys(snapshot.local),
    ...Object.keys(snapshot.remote),
    ...Object.keys(snapshot.base),
  ]);

  return [...paths].sort().map((path) => {
    const local = snapshot.local[path];
    const remote = snapshot.remote[path];
    const base = snapshot.base[path];

    if (!base) {
      if (local && !remote) return { type: "upload", path, reason: "new-local-file" };
      if (!local && remote) return { type: "download", path, remote, reason: "new-remote-file" };
      if (!local && !remote) return { type: "skip", path, reason: "unchanged" };
      if (local?.hash === remote?.hash) return { type: "skip", path, reason: "same-new-file" };
      if (local && remote) return latestWins(path, local, remote);
      return {
        type: "conflict",
        path,
        remote,
        conflictPath: makeConflictPath(path, deviceId, now),
        reason: "new-file-conflict",
      };
    }

    const localChanged = local ? local.hash !== base.baseLocalHash : !base.localDeleted;
    const remoteChanged = remote ? remote.hash !== base.baseRemoteHash : !base.remoteDeleted;

    if (!local && !remote) return { type: "skip", path, reason: "deleted-on-both-sides" };

    if (local && remote) {
      if (local.hash === remote.hash) return { type: "skip", path, reason: "unchanged" };
      if (!localChanged && !remoteChanged) return { type: "skip", path, reason: "conflict-baseline" };
      if (localChanged && !remoteChanged) return { type: "upload", path, reason: "changed-locally" };
      if (!localChanged && remoteChanged) return { type: "download", path, remote, reason: "changed-remotely" };
      return latestWins(path, local, remote);
    }

    if (!local && remote) {
      if (!localChanged && !remoteChanged) return { type: "skip", path, reason: "conflict-baseline" };
      if (!remoteChanged) return { type: "delete-remote", path, remote, reason: "deleted-locally" };
      return {
        type: "conflict",
        path,
        remote,
        conflictPath: makeConflictPath(path, deviceId, now),
        reason: "local-deleted-remote-edited",
      };
    }

    if (local && !remote) {
      if (!localChanged && !remoteChanged) return { type: "skip", path, reason: "conflict-baseline" };
      if (!localChanged) return { type: "delete-local", path, reason: "deleted-remotely" };
      if (!remoteChanged) return { type: "upload", path, reason: "preserve-local-after-remote-delete" };
      return { type: "conflict", path, reason: "remote-deleted-local-edited" };
    }

    return { type: "skip", path, reason: "unchanged" };
  });
}

function latestWins(path: string, local: FileSnapshot, remote: RemoteFile): SyncAction {
  if (local.modifiedAt >= remote.modifiedAt) {
    return { type: "upload", path, remote, reason: "local-latest-wins" };
  }
  return { type: "download", path, remote, reason: "remote-latest-wins" };
}
