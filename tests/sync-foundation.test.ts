import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "../src/core/hash.js";
import { isSyncablePath, normalizeVaultPath } from "../src/core/paths.js";
import type { FileSnapshot, ManifestEntry, RemoteFile } from "../src/core/sync-model.js";
import { makeConflictPath } from "../src/core/conflicts.js";
import { planSync } from "../src/core/sync-plan.js";

test("excludes Obsidian internals but keeps user attachments", () => {
  assert.equal(isSyncablePath(".obsidian/workspace.json"), false);
  assert.equal(isSyncablePath(".trash/deleted.md"), false);
  assert.equal(isSyncablePath("Notes/idea.md"), true);
  assert.equal(isSyncablePath("Assets/photo.png"), true);
  assert.equal(isSyncablePath("Notes/idea.md~"), false);
});

test("normalizes vault paths", () => {
  assert.equal(normalizeVaultPath("./Notes\\idea.md"), "Notes/idea.md");
  assert.throws(() => normalizeVaultPath("./"), /empty path/);
});

test("hash is stable and hexadecimal", async () => {
  assert.equal(
    await sha256(new TextEncoder().encode("hello")),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

const localFile = (path: string, hash: string): FileSnapshot => ({
  path,
  hash,
  size: hash.length,
  modifiedAt: 1,
});

const remoteFile = (path: string, hash: string): RemoteFile => ({
  ...localFile(path, hash),
  driveId: `drive-${path}`,
  mimeType: "text/markdown",
});

const baseFile = (path: string, hash: string): ManifestEntry => ({
  path,
  baseLocalHash: hash,
  baseRemoteHash: hash,
  lastSyncedAt: 1,
});

test("plans a local-only edit as an upload", () => {
  const actions = planSync({
    local: { "Notes/idea.md": localFile("Notes/idea.md", "local") },
    remote: { "Notes/idea.md": remoteFile("Notes/idea.md", "base") },
    base: { "Notes/idea.md": baseFile("Notes/idea.md", "base") },
  }, "desktop", 1);

  assert.deepEqual(actions, [{
    type: "upload",
    path: "Notes/idea.md",
    reason: "changed-locally",
  }]);
});

test("plans a remote-only edit as a download", () => {
  const actions = planSync({
    local: { "Notes/idea.md": localFile("Notes/idea.md", "base") },
    remote: { "Notes/idea.md": remoteFile("Notes/idea.md", "remote") },
    base: { "Notes/idea.md": baseFile("Notes/idea.md", "base") },
  }, "desktop", 1);

  assert.deepEqual(actions, [{
    type: "download",
    path: "Notes/idea.md",
    remote: remoteFile("Notes/idea.md", "remote"),
    reason: "changed-remotely",
  }]);
});

test("plans edits on both sides as a conflict", () => {
  const actions = planSync({
    local: { "Notes/idea.md": localFile("Notes/idea.md", "local") },
    remote: { "Notes/idea.md": remoteFile("Notes/idea.md", "remote") },
    base: { "Notes/idea.md": baseFile("Notes/idea.md", "base") },
  }, "laptop", 1700000000000);

  assert.deepEqual(actions, [{
    type: "conflict",
    path: "Notes/idea.md",
    remote: remoteFile("Notes/idea.md", "remote"),
    conflictPath: "_sync-conflicts/Notes/idea (conflict-laptop-20231114-221320).md",
    reason: "changed-on-both-sides",
  }]);
});

test("preserves new files from either side", () => {
  const actions = planSync({
    local: { "Notes/local.md": localFile("Notes/local.md", "local") },
    remote: { "Notes/remote.md": remoteFile("Notes/remote.md", "remote") },
    base: {},
  }, "desktop", 1);

  assert.deepEqual(actions, [
    { type: "upload", path: "Notes/local.md", reason: "new-local-file" },
    { type: "download", path: "Notes/remote.md", remote: remoteFile("Notes/remote.md", "remote"), reason: "new-remote-file" },
  ]);
});

test("surfaces a remote deletion against a local edit as a conflict", () => {
  const actions = planSync({
    local: { "Notes/idea.md": localFile("Notes/idea.md", "local") },
    remote: {},
    base: { "Notes/idea.md": baseFile("Notes/idea.md", "base") },
  }, "desktop", 1);

  assert.deepEqual(actions, [{
    type: "conflict",
    path: "Notes/idea.md",
    reason: "remote-deleted-local-edited",
  }]);
});

test("uses a conflict copy for a local deletion against a remote edit", () => {
  const remote = remoteFile("Notes/idea.md", "remote");
  const actions = planSync({
    local: {},
    remote: { "Notes/idea.md": remote },
    base: { "Notes/idea.md": baseFile("Notes/idea.md", "base") },
  }, "desktop", 1700000000000);

  assert.deepEqual(actions, [{
    type: "conflict",
    path: "Notes/idea.md",
    remote,
    conflictPath: "_sync-conflicts/Notes/idea (conflict-desktop-20231114-221320).md",
    reason: "local-deleted-remote-edited",
  }]);
});

test("skips unchanged files and keeps conflict names deterministic", () => {
  const actions = planSync({
    local: { "Notes/idea.md": localFile("Notes/idea.md", "same") },
    remote: { "Notes/idea.md": remoteFile("Notes/idea.md", "same") },
    base: { "Notes/idea.md": baseFile("Notes/idea.md", "same") },
  }, "desktop", 1);

  assert.deepEqual(actions, [{
    type: "skip",
    path: "Notes/idea.md",
    reason: "unchanged",
  }]);
  assert.equal(makeConflictPath("Notes/idea.md", "desktop", 1700000000000), "_sync-conflicts/Notes/idea (conflict-desktop-20231114-221320).md");
});
