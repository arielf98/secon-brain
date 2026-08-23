import test from "node:test";
import assert from "node:assert/strict";

import type { ManifestEntry } from "../src/core/sync-model.js";
import { DataManifestStore } from "../src/sync/manifest-store.js";

test("saves and reloads a versioned manifest", async () => {
  let stored: unknown;
  const store = new DataManifestStore(
    async () => stored,
    async (value) => {
      stored = value;
    },
  );
  const entries: Record<string, ManifestEntry> = {
    "Notes/idea.md": {
      path: "Notes/idea.md",
      baseHash: "abc",
      lastSyncedAt: 1,
    },
  };

  await store.save(entries);

  assert.deepEqual(await store.load(), entries);
  assert.deepEqual(stored, { version: 1, entries });
});

test("missing and cleared manifests load as empty", async () => {
  let stored: unknown;
  const store = new DataManifestStore(
    async () => stored,
    async (value) => {
      stored = value;
    },
  );

  assert.deepEqual(await store.load(), {});
  await store.save({});
  await store.clear();
  assert.equal(stored, undefined);
  assert.deepEqual(await store.load(), {});
});
