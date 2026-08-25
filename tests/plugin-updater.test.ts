import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "../src/core/hash.js";
import type { FileSnapshot, RemoteFile } from "../src/core/sync-model.js";
import type { DriveUploadResult, GoogleDrive } from "../src/integrations/google-drive.js";
import { PluginUpdater } from "../src/sync/plugin-updater.js";
import type { VaultAdapter } from "../src/sync/vault-adapter.js";

const bytes = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;
const text = (value: ArrayBuffer | Uint8Array): string => new TextDecoder().decode(value instanceof Uint8Array ? value : new Uint8Array(value));

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, ArrayBuffer>();

  constructor(initial: Record<string, string>) {
    for (const [path, value] of Object.entries(initial)) this.files.set(path, bytes(value));
  }

  async listFiles(): Promise<FileSnapshot[]> {
    return Promise.all([...this.files].map(async ([path, data]) => ({
      path,
      hash: await sha256(data),
      size: data.byteLength,
      modifiedAt: 1,
    })));
  }

  async read(path: string): Promise<ArrayBuffer> {
    const data = this.files.get(path);
    if (!data) throw new Error(`missing local file: ${path}`);
    return data;
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, data.slice(0));
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async ensureFolder(): Promise<void> {}
}

class FakeDrive implements GoogleDrive {
  readonly files = new Map<string, { remote: RemoteFile; data: ArrayBuffer }>();
  private nextId = 100;

  constructor(initial: Record<string, string>) {
    let id = 1;
    for (const [path, value] of Object.entries(initial)) {
      const data = bytes(value);
      this.files.set(path, {
        remote: { path, hash: `remote-${id}`, size: data.byteLength, modifiedAt: 1, driveId: `drive-${id}`, mimeType: "application/octet-stream" },
        data,
      });
      id += 1;
    }
  }

  async listTree(): Promise<RemoteFile[]> {
    return [...this.files.values()].map(({ remote }) => ({ ...remote }));
  }

  async download(driveId: string): Promise<Uint8Array> {
    const file = [...this.files.values()].find(({ remote }) => remote.driveId === driveId);
    if (!file) throw new Error(`missing remote file: ${driveId}`);
    return new Uint8Array(file.data);
  }

  async delete(driveId: string): Promise<void> {
    const entry = [...this.files.entries()].find(([, value]) => value.remote.driveId === driveId);
    if (!entry) throw new Error(`missing remote file: ${driveId}`);
    this.files.delete(entry[0]);
  }

  async upload(path: string, data: Uint8Array, _parentId: string, mimeType: string): Promise<DriveUploadResult> {
    const driveId = `drive-${this.nextId++}`;
    const content = data.slice().buffer;
    const hash = await sha256(content);
    this.files.set(path, {
      remote: { path, hash, size: data.byteLength, modifiedAt: 2, driveId, mimeType },
      data: content,
    });
    return { driveId, hash };
  }

  async update(driveId: string, data: Uint8Array, mimeType: string): Promise<DriveUploadResult> {
    const entry = [...this.files.entries()].find(([, value]) => value.remote.driveId === driveId);
    if (!entry) throw new Error(`missing remote file: ${driveId}`);
    const [path, file] = entry;
    const content = data.slice().buffer;
    const hash = await sha256(content);
    file.data = content;
    file.remote = { ...file.remote, hash, size: data.byteLength, modifiedAt: 2, mimeType };
    this.files.set(path, file);
    return { driveId, hash };
  }

  async ensureFolder(): Promise<string> {
    return "root";
  }
}

test("downloads the latest Sken Brain bundle without syncing plugin settings", async () => {
  const vault = new FakeVault({
    "obsidian/plugins/sken-brain/manifest.json": "old manifest",
    "obsidian/plugins/sken-brain/main.js": "old main",
    "obsidian/plugins/sken-brain/data.json": "keep local settings",
  });
  const drive = new FakeDrive({
    "obsidian/plugins/sken-brain/manifest.json": "new manifest",
    "obsidian/plugins/sken-brain/main.js": "new main",
    "obsidian/plugins/sken-brain/styles.css": "new styles",
    "obsidian/plugins/sken-brain/data.json": "remote settings must be ignored",
    "obsidian/plugins/other/main.js": "other plugin must be ignored",
  });

  const updated = await new PluginUpdater(vault, drive, "root").sync();

  assert.deepEqual(updated, [
    "obsidian/plugins/sken-brain/main.js",
    "obsidian/plugins/sken-brain/manifest.json",
    "obsidian/plugins/sken-brain/styles.css",
  ]);
  assert.equal(text(await vault.read("obsidian/plugins/sken-brain/main.js")), "new main");
  assert.equal(text(await vault.read("obsidian/plugins/sken-brain/data.json")), "keep local settings");
  assert.equal(vault.files.has("obsidian/plugins/other/main.js"), false);
});

test("does not rewrite an unchanged Sken Brain bundle", async () => {
  const vault = new FakeVault({ "obsidian/plugins/sken-brain/main.js": "same" });
  const drive = new FakeDrive({ "obsidian/plugins/sken-brain/main.js": "same" });

  const updated = await new PluginUpdater(vault, drive, "root").sync();

  assert.deepEqual(updated, []);
});

test("publishes the local Sken Brain bundle from desktop to Drive", async () => {
  const vault = new FakeVault({
    "obsidian/plugins/sken-brain/manifest.json": "local manifest",
    "obsidian/plugins/sken-brain/main.js": "local main",
    "obsidian/plugins/sken-brain/styles.css": "local styles",
    "obsidian/plugins/sken-brain/data.json": "keep local settings",
  });
  const drive = new FakeDrive({
    "obsidian/plugins/sken-brain/main.js": "old remote main",
  });

  const updated = await new PluginUpdater(vault, drive, "root", { mode: "publish" }).sync();

  assert.deepEqual(updated, [
    "obsidian/plugins/sken-brain/main.js",
    "obsidian/plugins/sken-brain/manifest.json",
    "obsidian/plugins/sken-brain/styles.css",
  ]);
  assert.equal(text(await drive.download(drive.files.get("obsidian/plugins/sken-brain/main.js")!.remote.driveId)), "local main");
  assert.equal(text(await drive.download(drive.files.get("obsidian/plugins/sken-brain/manifest.json")!.remote.driveId)), "local manifest");
  assert.equal(drive.files.has("obsidian/plugins/sken-brain/data.json"), false);
});
