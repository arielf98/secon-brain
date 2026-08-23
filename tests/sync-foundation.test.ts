import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "../src/core/hash.js";
import { isSyncablePath, normalizeVaultPath } from "../src/core/paths.js";

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
