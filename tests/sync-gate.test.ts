import test from "node:test";
import assert from "node:assert/strict";

import { SyncGate } from "../src/sync/sync-gate.js";

test("skips overlapping sync runs and can run again after completion", async () => {
  const gate = new SyncGate();
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });

  const first = gate.run(async () => {
    calls += 1;
    await blocked;
  });
  const second = await gate.run(async () => { calls += 1; });

  assert.equal(second, false);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);
  assert.equal(await gate.run(async () => { calls += 1; }), true);
  assert.equal(calls, 2);
});
