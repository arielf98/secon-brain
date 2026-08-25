import { pluginLocalPath } from "../core/paths.js";
import type { GoogleDrive } from "../integrations/google-drive.js";
import type { VaultAdapter } from "./vault-adapter.js";

export class PluginUpdater {
  constructor(
    private readonly vault: VaultAdapter,
    private readonly drive: GoogleDrive,
    private readonly rootFolderId: string,
  ) {}

  async sync(): Promise<string[]> {
    const remoteFiles = (await this.drive.listTree(this.rootFolderId))
      .filter((file) => pluginLocalPath(file.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    const updated: string[] = [];
    for (const remote of remoteFiles) {
      const data = await this.drive.download(remote.driveId);
      const local = await readOptional(this.vault, remote.path);
      if (local && sameBytes(local, data)) continue;
      await this.vault.write(remote.path, toArrayBuffer(data));
      updated.push(remote.path);
    }
    return updated;
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
