import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-ignore The deploy helper is a runtime-only ESM script.
import { deployArtifacts, PLUGIN_FILES } from "../scripts/obsidian-deploy.mjs";

test("deploys the Obsidian plugin artifacts to the target directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "sken-brain-deploy-"));
  const source = join(root, "build");
  const destination = join(root, ".obsidian", "plugins", "sken-brain");
  await mkdir(source);
  for (const file of PLUGIN_FILES) await writeFile(join(source, file), `built ${file}`);

  await deployArtifacts(destination, source);

  for (const file of PLUGIN_FILES) {
    assert.equal(await readFile(join(destination, file), "utf8"), `built ${file}`);
  }
});
