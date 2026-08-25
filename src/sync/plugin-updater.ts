import { pluginLocalPath, SKEN_BRAIN_PLUGIN_FILES } from "../core/paths.js";
import type { GoogleDrive } from "../integrations/google-drive.js";
import type { VaultAdapter } from "./vault-adapter.js";

export interface PluginSyncOptions {
  mode: "download" | "publish";
}

export class PluginUpdater {
  constructor(
    private readonly vault: VaultAdapter,
    private readonly drive: GoogleDrive,
    private readonly rootFolderId: string,
    private readonly options: PluginSyncOptions = { mode: "download" },
  ) {}

  async sync(): Promise<string[]> {
    const remoteFiles = (await this.drive.listTree(this.rootFolderId))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (this.options.mode === "publish") return this.publish(remoteFiles);
    return this.download(remoteFiles);
  }

  private async download(remoteFiles: Awaited<ReturnType<GoogleDrive["listTree"]>>): Promise<string[]> {
    const pluginFiles = remoteFiles.filter((file) => pluginLocalPath(file.path));
    const updated: string[] = [];
    for (const remote of pluginFiles) {
      const data = await this.drive.download(remote.driveId);
      const local = await readOptional(this.vault, remote.path);
      if (local && sameBytes(local, data)) continue;
      await this.vault.write(remote.path, toArrayBuffer(data));
      updated.push(remote.path);
    }
    return updated;
  }

  private async publish(remoteFiles: Awaited<ReturnType<GoogleDrive["listTree"]>>): Promise<string[]> {
    const remoteByPath = new Map(remoteFiles.map((file) => [file.path, file]));
    const updated: string[] = [];
    let parentId: string | undefined;
    for (const file of SKEN_BRAIN_PLUGIN_FILES) {
      const path = `obsidian/plugins/sken-brain/${file}`;
      const local = await readOptional(this.vault, path);
      if (!local) continue;
      const remote = remoteByPath.get(path);
      if (remote) {
        const current = await this.drive.download(remote.driveId);
        if (sameBytes(local, current)) continue;
        await this.drive.update(remote.driveId, new Uint8Array(local), mimeType(path));
      } else {
        parentId ??= await this.drive.ensureFolder("obsidian/plugins/sken-brain", this.rootFolderId);
        await this.drive.upload(path, new Uint8Array(local), parentId, mimeType(path));
      }
      updated.push(path);
    }
    return updated.sort((a, b) => a.localeCompare(b));
  }
}

async function readOptional(vault: VaultAdapter, path: string): Promise<ArrayBuffer | undefined> {
  try {
    return await vault.read(path);
  } catch {
    return undefined;
  }
}

function sameBytes(local: ArrayBuffer, remote: Uint8Array): boolean {
  const localBytes = new Uint8Array(local);
  if (localBytes.byteLength !== remote.byteLength) return false;
  return localBytes.every((value, index) => value === remote[index]);
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.slice().buffer as ArrayBuffer;
}

function mimeType(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".css")) return "text/css";
  return "application/octet-stream";
}
