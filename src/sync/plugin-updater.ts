import { pluginLocalPath, SKEN_BRAIN_PLUGIN_FILES } from "../core/paths.js";
import { sha256 } from "../core/hash.js";
import type { GoogleDrive } from "../integrations/google-drive.js";
import type { VaultAdapter } from "./vault-adapter.js";

export interface PluginSyncOptions {
  mode: "download" | "publish";
}

export interface PluginSyncState {
  remoteHash: string;
  localHash: string;
}

export interface PluginSyncStateStore {
  load(): Promise<Record<string, PluginSyncState>>;
  save(state: Record<string, PluginSyncState>): Promise<void>;
}

export class PluginUpdater {
  constructor(
    private readonly vault: VaultAdapter,
    private readonly drive: GoogleDrive,
    private readonly rootFolderId: string,
    private readonly options: PluginSyncOptions = { mode: "download" },
    private readonly stateStore: PluginSyncStateStore = memoryStateStore(),
  ) {}

  async sync(): Promise<string[]> {
    const remoteFiles = (await this.drive.listTree(this.rootFolderId))
      .sort((a, b) => a.path.localeCompare(b.path));
    const previousState = await this.stateStore.load();
    const result = this.options.mode === "publish"
      ? await this.publish(remoteFiles, previousState)
      : await this.download(remoteFiles, previousState);
    await this.stateStore.save(result.state);
    return result.updated;
  }

  private async download(
    remoteFiles: Awaited<ReturnType<GoogleDrive["listTree"]>>,
    previousState: Record<string, PluginSyncState>,
  ): Promise<{ updated: string[]; state: Record<string, PluginSyncState> }> {
    const pluginFiles = remoteFiles.filter((file) => pluginLocalPath(file.path));
    const updated: string[] = [];
    const state: Record<string, PluginSyncState> = {};
    for (const remote of pluginFiles) {
      const local = await readOptional(this.vault, remote.path);
      const localHash = local ? await sha256(local) : undefined;
      const previous = previousState[remote.path];
      if (localHash && previous?.remoteHash === remote.hash && previous.localHash === localHash) {
        state[remote.path] = previous;
        continue;
      }

      const data = await this.drive.download(remote.driveId);
      const downloadedHash = await sha256(data);
      if (!local || !sameBytes(local, data)) {
        await this.vault.write(remote.path, toArrayBuffer(data));
        updated.push(remote.path);
      }
      state[remote.path] = { remoteHash: remote.hash, localHash: downloadedHash };
    }
    return { updated, state };
  }

  private async publish(
    remoteFiles: Awaited<ReturnType<GoogleDrive["listTree"]>>,
    previousState: Record<string, PluginSyncState>,
  ): Promise<{ updated: string[]; state: Record<string, PluginSyncState> }> {
    const remoteByPath = new Map(remoteFiles.map((file) => [file.path, file]));
    const updated: string[] = [];
    const state: Record<string, PluginSyncState> = {};
    let parentId: string | undefined;
    for (const file of SKEN_BRAIN_PLUGIN_FILES) {
      const path = `obsidian/plugins/sken-brain/${file}`;
      const local = await readOptional(this.vault, path);
      if (!local) continue;
      const localHash = await sha256(local);
      const remote = remoteByPath.get(path);
      const previous = previousState[path];
      if (remote && previous?.remoteHash === remote.hash && previous.localHash === localHash) {
        state[path] = previous;
        continue;
      }
      if (remote) {
        if (!previous) {
          const current = await this.drive.download(remote.driveId);
          if (sameBytes(local, current)) {
            state[path] = { remoteHash: remote.hash, localHash };
            continue;
          }
        }
        const result = await this.drive.update(remote.driveId, new Uint8Array(local), mimeType(path));
        state[path] = { remoteHash: result.hash, localHash };
      } else {
        parentId ??= await this.drive.ensureFolder("obsidian/plugins/sken-brain", this.rootFolderId);
        const result = await this.drive.upload(path, new Uint8Array(local), parentId, mimeType(path));
        state[path] = { remoteHash: result.hash, localHash };
      }
      updated.push(path);
    }
    return { updated: updated.sort((a, b) => a.localeCompare(b)), state };
  }
}

function memoryStateStore(): PluginSyncStateStore {
  let state: Record<string, PluginSyncState> = {};
  return {
    load: async () => ({ ...state }),
    save: async (next) => { state = { ...next }; },
  };
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
