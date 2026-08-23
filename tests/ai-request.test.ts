import test from "node:test";
import assert from "node:assert/strict";

import { runAiRequest } from "../src/obsidian/ai-request.js";

test("emits loading before an AI request result", async () => {
  const states: string[] = [];

  await runAiRequest(
    async () => {
      states.push("request");
      return "answer";
    },
    (state) => states.push(state.status === "ready" ? `ready:${state.value}` : state.status),
  );

  assert.deepEqual(states, ["loading", "request", "ready:answer"]);
});

test("emits an error state when an AI request fails", async () => {
  const states: string[] = [];

  await runAiRequest(
    async () => {
      throw new Error("provider unavailable");
    },
    (state) => states.push(state.status === "error" ? `error:${state.message}` : state.status),
  );

  assert.deepEqual(states, ["loading", "error:provider unavailable"]);
});
