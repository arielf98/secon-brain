import { planSync, type SyncAction } from "../core/sync-plan.js";
import { isPluginRemotePath } from "../core/paths.js";
import type { FileSnapshot, ManifestEntry, RemoteFile } from "../core/sync-model.js";
import { AuthRequiredError, RateLimitError, TransientHttpError } from "../integrations/http.js";
import type { GoogleDrive } from "../integrations/google-drive.js";
import type { ManifestStore } from "./manifest-store.js";
import type { SyncReport } from "./sync-report.js";
import type { VaultAdapter } from "./vault-adapter.js";

export interface Clock {
  now(): number;
}

export class SyncEngine {
  private paused = false;

  constructor(
    private readonly vault: VaultAdapter,
    private readonly drive: GoogleDrive,
    private readonly manifest: ManifestStore,
    private readonly clock: Clock,
    private readonly deviceId: string,
    private readonly rootFolderId: string,
  ) {}

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  async sync(): Promise<SyncReport> {
    const report: SyncReport = {
      status: "synced",
      uploaded: [],
      downloaded: [],
      conflicts: [],
      errors: [],
    };
    if (this.paused) return { ...report, status: "offline", errors: ["Sync is paused"] };

    let base: Record<string, ManifestEntry>;
    let local: FileSnapshot[];
    let remote: RemoteFile[];
    try {
      base = await this.manifest.load();
      const [localFiles, remoteFiles] = await Promise.all([
        this.retry(() => this.vault.listFiles()),
        this.retry(() => this.drive.listTree(this.rootFolderId)),
      ]);
      local = localFiles;
      remote = remoteFiles.filter((file) => !isPluginRemotePath(file.path));
    } catch (error) {
      return this.failedReport(report, error);
    }

    const actions = planSync({
      local: byPath(local),
      remote: byPath(remote),
      base,
    }, this.deviceId, this.clock.now());

    try {
      for (const action of actions) await this.apply(action, report);
      const afterLocal = await this.retry(() => this.vault.listFiles());
      const afterRemote = (await this.retry(() => this.drive.listTree(this.rootFolderId)))
        .filter((file) => !isPluginRemotePath(file.path));
      await this.manifest.save(buildManifest(afterLocal, afterRemote, this.clock.now(), base, actions));
    } catch (error) {
      return this.failedReport(report, error);
    }

    report.status = report.conflicts.length ? "conflict" : "synced";
    return report;
  }

  private async apply(action: SyncAction, report: SyncReport): Promise<void> {
    if (action.type === "skip") return;

    if (action.type === "upload") {
      const data = new Uint8Array(await this.vault.read(action.path));
      const parentId = await this.drive.ensureFolder(parentPath(action.path), this.rootFolderId);
      if (action.remote) {
        await this.retry(() => this.drive.update(action.remote!.driveId, data, mimeType(action.path)));
      } else {
        await this.retry(() => this.drive.upload(action.path, data, parentId, mimeType(action.path)));
      }
      report.uploaded.push(action.path);
      return;
    }

    if (action.type === "download") {
      if (!action.remote) throw new Error(`Missing remote file for download: ${action.path}`);
      const data = await this.retry(() => this.drive.download(action.remote!.driveId));
      await this.vault.write(action.path, toArrayBuffer(data));
      report.downloaded.push(action.path);
      return;
    }

    if (action.type === "delete-local") {
      await this.vault.delete(action.path);
      return;
    }

    if (action.type === "delete-remote") {
      if (!action.remote) throw new Error(`Missing remote file for delete: ${action.path}`);
      await this.retry(() => this.drive.delete(action.remote!.driveId));
      return;
    }

    report.conflicts.push(action.path);
    if (action.remote && action.conflictPath) {
      const data = await this.retry(() => this.drive.download(action.remote!.driveId));
      await this.vault.write(action.conflictPath, toArrayBuffer(data));
    }
  }

  private async retry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof RateLimitError || error instanceof TransientHttpError) || attempt >= 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }

  private failedReport(report: SyncReport, error: unknown): SyncReport {
    report.status = error instanceof AuthRequiredError ? "auth-required" : "offline";
    report.errors.push(error instanceof Error ? error.message : String(error));
    return report;
  }
}

function byPath<T extends { path: string }>(files: T[]): Record<string, T> {
  return Object.fromEntries(files.map((file) => [file.path, file]));
}

function buildManifest(
  localFiles: FileSnapshot[],
  remoteFiles: RemoteFile[],
  now: number,
  previous: Record<string, ManifestEntry>,
  actions: SyncAction[],
): Record<string, ManifestEntry> {
  const local = byPath(localFiles);
  const remote = byPath(remoteFiles);
  const conflicts = new Map(actions.filter((action) => action.type === "conflict").map((action) => [action.path, action]));
  const entries: Record<string, ManifestEntry> = {};
  for (const path of [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort()) {
    const localFile = local[path];
    const remoteFile = remote[path];
    if (!localFile || !remoteFile) {
      const previousEntry = previous[path];
      const conflict = conflicts.get(path);
      if (!previousEntry || !conflict) continue;
      if (localFile && !remoteFile && conflict.reason === "remote-deleted-local-edited") {
        entries[path] = {
          ...previousEntry,
          baseLocalHash: localFile.hash,
          localHash: localFile.hash,
          remoteDeleted: true,
          lastSyncedAt: now,
        };
      } else if (!localFile && remoteFile && conflict.reason === "local-deleted-remote-edited") {
        entries[path] = {
          ...previousEntry,
          baseRemoteHash: remoteFile.hash,
          remoteHash: remoteFile.hash,
          localDeleted: true,
          lastSyncedAt: now,
        };
      }
      continue;
    }
    entries[path] = {
      path,
      driveId: remoteFile.driveId,
      baseLocalHash: localFile.hash,
      baseRemoteHash: remoteFile.hash,
      localHash: localFile.hash,
      remoteHash: remoteFile.hash,
      localDeleted: false,
      remoteDeleted: false,
      lastSyncedAt: now,
    };
  }
  return entries;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.slice().buffer as ArrayBuffer;
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

function mimeType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "md") return "text/markdown";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "pdf") return "application/pdf";
  if (extension === "json") return "application/json";
  return "application/octet-stream";
}
