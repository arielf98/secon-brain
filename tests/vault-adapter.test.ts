import test from "node:test";
import assert from "node:assert/strict";

import type { App, DataAdapter } from "obsidian";
import { ObsidianVaultAdapter } from "../src/sync/vault-adapter.js";

const bytes = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;
const text = (value: ArrayBuffer): string => new TextDecoder().decode(value);

test("maps plugin bundle paths to Obsidian's hidden plugin directory", async () => {
  const files = new Map<string, ArrayBuffer>();
  const folders = new Set<string>();
  const dataAdapter = {
    async exists(path: string): Promise<boolean> { return files.has(path) || folders.has(path); },
    async mkdir(path: string): Promise<void> { folders.add(path); },
    async readBinary(path: string): Promise<ArrayBuffer> {
      const data = files.get(path);
      if (!data) throw new Error(`missing file: ${path}`);
      return data;
    },
    async writeBinary(path: string, data: ArrayBuffer): Promise<void> { files.set(path, data.slice(0)); },
    async remove(path: string): Promise<void> { files.delete(path); },
  } as unknown as DataAdapter;
  const app = { vault: { adapter: dataAdapter } } as unknown as App;
  const vault = new ObsidianVaultAdapter(app);

  await vault.write("obsidian/plugins/sken-brain/main.js", bytes("latest"));

  assert.equal(text(await vault.read("obsidian/plugins/sken-brain/main.js")), "latest");
  assert.equal(files.has(".obsidian/plugins/sken-brain/main.js"), true);

  await vault.delete("obsidian/plugins/sken-brain/main.js");
  assert.equal(files.has(".obsidian/plugins/sken-brain/main.js"), false);
});
