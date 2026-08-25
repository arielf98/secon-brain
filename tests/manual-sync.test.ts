import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("does not register automatic sync triggers", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /this\.app\.vault\.on\("(create|modify|delete|rename)"/);
  assert.doesNotMatch(source, /registerInterval\(window\.setInterval/);
  assert.doesNotMatch(source, /if \(this\.pluginSettings\.googleToken\) void this\.syncNow/);
  assert.doesNotMatch(source, /await this\.syncNow\(transport, vault\);/);
});
