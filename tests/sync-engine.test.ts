import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "../src/core/hash.js";
import type { FileSnapshot, ManifestEntry, RemoteFile } from "../src/core/sync-model.js";
import type { GoogleDrive, DriveUploadResult } from "../src/integrations/google-drive.js";
import type { SyncReport } from "../src/sync/sync-report.js";
import { SyncEngine } from "../src/sync/sync-engine.js";
import type { ManifestStore } from "../src/sync/manifest-store.js";
import type { VaultAdapter } from "../src/sync/vault-adapter.js";

const bytes = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;
const text = (value: ArrayBuffer): string => new TextDecoder().decode(value);

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
  failListing = false;
  nextId = 1;

  constructor(initial: Record<string, { hash: string; content: string }>) {
    for (const [path, file] of Object.entries(initial)) {
      const driveId = `drive-${this.nextId++}`;
      this.files.set(path, {
        remote: { path, hash: file.hash, size: file.content.length, modifiedAt: 1, driveId, mimeType: "text/markdown" },
        data: bytes(file.content),
      });
    }
  }

  async listTree(): Promise<RemoteFile[]> {
    if (this.failListing) throw new Error("network unavailable");
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
    this.files.set(path, { remote: { path, hash, size: data.byteLength, modifiedAt: 2, driveId, mimeType }, data: content });
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

class MemoryManifest implements ManifestStore {
  constructor(private entries: Record<string, ManifestEntry>) {}

  async load(): Promise<Record<string, ManifestEntry>> {
    return structuredClone(this.entries);
  }

  async save(entries: Record<string, ManifestEntry>): Promise<void> {
    this.entries = structuredClone(entries);
  }

  async clear(): Promise<void> {
    this.entries = {};
  }

  snapshot(): Record<string, ManifestEntry> {
    return structuredClone(this.entries);
  }
}

const baseEntry = (localHash: string, remoteHash: string, driveId = "drive-1"): ManifestEntry => ({
  path: "Notes/idea.md",
  driveId,
  baseLocalHash: localHash,
  baseRemoteHash: remoteHash,
  localHash: localHash,
  remoteHash: remoteHash,
  lastSyncedAt: 1,
});

const engineFor = (vault: FakeVault, drive: FakeDrive, manifest: MemoryManifest): SyncEngine => new SyncEngine(
  vault,
  drive,
  manifest,
  { now: () => 2 },
  "laptop",
  "root",
);

test("uploads a local-only change and saves a new manifest", async () => {
  const oldLocalHash = await sha256(bytes("old"));
  const vault = new FakeVault({ "Notes/idea.md": "new local" });
  const drive = new FakeDrive({ "Notes/idea.md": { hash: "remote-old", content: "old" } });
  const manifest = new MemoryManifest({ "Notes/idea.md": baseEntry(oldLocalHash, "remote-old") });

  const report = await engineFor(vault, drive, manifest).sync();

  assert.equal(report.status, "synced");
  assert.deepEqual(report.uploaded, ["Notes/idea.md"]);
  assert.equal([...drive.files.values()][0]?.data && text([...drive.files.values()][0]!.data), "new local");
  assert.notEqual(manifest.snapshot()["Notes/idea.md"]?.baseLocalHash, oldLocalHash);
});

test("downloads a remote-only change into the local vault", async () => {
  const oldLocalHash = await sha256(bytes("old"));
  const vault = new FakeVault({ "Notes/idea.md": "old" });
  const drive = new FakeDrive({ "Notes/idea.md": { hash: "remote-new", content: "new remote" } });
  const manifest = new MemoryManifest({ "Notes/idea.md": baseEntry(oldLocalHash, "remote-old") });

  const report = await engineFor(vault, drive, manifest).sync();

  assert.equal(report.status, "synced");
  assert.deepEqual(report.downloaded, ["Notes/idea.md"]);
  assert.equal(text(await vault.read("Notes/idea.md")), "new remote");
});

test("keeps plugin files out of the normal vault sync", async () => {
  const vault = new FakeVault({});
  const drive = new FakeDrive({
    "obsidian/plugins/sken-brain/main.js": { hash: "plugin-main", content: "plugin" },
    "obsidian/plugins/sken-brain/data.json": { hash: "plugin-data", content: "settings" },
  });
  const manifest = new MemoryManifest({});

  const report = await engineFor(vault, drive, manifest).sync();

  assert.deepEqual(report.downloaded, []);
  assert.equal(vault.files.has("obsidian/plugins/sken-brain/main.js"), false);
  assert.equal(vault.files.has("obsidian/plugins/sken-brain/data.json"), false);
});

test("deletes a remote file after a local deletion", async () => {
  const oldLocalHash = await sha256(bytes("old"));
  const vault = new FakeVault({});
  const drive = new FakeDrive({ "Notes/idea.md": { hash: "remote-old", content: "old" } });
  const manifest = new MemoryManifest({ "Notes/idea.md": baseEntry(oldLocalHash, "remote-old") });

  const report = await engineFor(vault, drive, manifest).sync();

  assert.equal(report.status, "synced");
  assert.equal(drive.files.has("Notes/idea.md"), false);
  assert.deepEqual(manifest.snapshot(), {});
});

test("deletes a local file after a remote deletion", async () => {
  const oldLocalHash = await sha256(bytes("old"));
  const vault = new FakeVault({ "Notes/idea.md": "old" });
  const drive = new FakeDrive({});
  const manifest = new MemoryManifest({ "Notes/idea.md": baseEntry(oldLocalHash, "remote-old") });

  const report = await engineFor(vault, drive, manifest).sync();

  assert.equal(report.status, "synced");
  assert.equal(vault.files.has("Notes/idea.md"), false);
  assert.deepEqual(manifest.snapshot(), {});
});

test("writes a remote conflict copy without replacing the local original", async () => {
  const oldLocalHash = await sha256(bytes("old"));
  const vault = new FakeVault({ "Notes/idea.md": "new local" });
  const drive = new FakeDrive({ "Notes/idea.md": { hash: "remote-new", content: "new remote" } });
  const manifest = new MemoryManifest({ "Notes/idea.md": baseEntry(oldLocalHash, "remote-old") });

  const report = await engineFor(vault, drive, manifest).sync();

  assert.equal(report.status, "conflict");
  assert.deepEqual(report.conflicts, ["Notes/idea.md"]);
  assert.equal(text(await vault.read("Notes/idea.md")), "new local");
  const conflictPath = [...vault.files.keys()].find((path) => path.startsWith("_sync-conflicts/"));
  assert.ok(conflictPath);
  assert.equal(text(await vault.read(conflictPath!)), "new remote");
});

test("returns offline and preserves the previous manifest when inventory fails", async () => {
  const oldLocalHash = await sha256(bytes("old"));
  const vault = new FakeVault({ "Notes/idea.md": "new local" });
  const drive = new FakeDrive({ "Notes/idea.md": { hash: "remote-old", content: "old" } });
  drive.failListing = true;
  const manifest = new MemoryManifest({ "Notes/idea.md": baseEntry(oldLocalHash, "remote-old") });
  const before = manifest.snapshot();

  const report: SyncReport = await engineFor(vault, drive, manifest).sync();

  assert.equal(report.status, "offline");
  assert.deepEqual(manifest.snapshot(), before);
});
