import { sha256 } from "../core/hash.js";
import { isSyncablePath } from "../core/paths.js";
import type { FileSnapshot } from "../core/sync-model.js";
import type { App, TFile } from "obsidian";

export interface VaultAdapter {
  listFiles(): Promise<FileSnapshot[]>;
  read(path: string): Promise<ArrayBuffer>;
  write(path: string, data: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
}

export class ObsidianVaultAdapter implements VaultAdapter {
  constructor(private readonly app: App) {}

  async listFiles(): Promise<FileSnapshot[]> {
    const files = this.app.vault.getFiles().filter((file) => isSyncablePath(file.path));
    return Promise.all(files.map(async (file) => {
      const bytes = await this.app.vault.readBinary(file);
      return {
        path: file.path,
        hash: await sha256(bytes),
        size: file.stat.size,
        modifiedAt: file.stat.mtime,
      };
    }));
  }

  async read(path: string): Promise<ArrayBuffer> {
    const file = this.getFile(path);
    return this.app.vault.readBinary(file);
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && isVaultFile(existing)) {
      await this.app.vault.modifyBinary(existing, data);
      return;
    }
    if (existing) throw new Error(`Cannot write over folder: ${path}`);
    await this.ensureFolder(parentPath(path));
    await this.app.vault.createBinary(path, data);
  }

  async delete(path: string): Promise<void> {
    await this.app.vault.delete(this.getFile(path), true);
  }

  async ensureFolder(path: string): Promise<void> {
    if (!path) return;
    const segments = path.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private getFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !isVaultFile(file)) throw new Error(`File not found: ${path}`);
    return file;
  }
}

function isVaultFile(value: unknown): value is TFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TFile>;
  return typeof candidate.path === "string" && typeof candidate.extension === "string" && !!candidate.stat;
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}
