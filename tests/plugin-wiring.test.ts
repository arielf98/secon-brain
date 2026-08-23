import test from "node:test";
import assert from "node:assert/strict";

import { registerSecondBrainCommands, RELATED_NOTES_VIEW_TYPE, statusLabel } from "../src/obsidian/plugin-wiring.js";

test("registers all user-facing commands and the Related Notes view", () => {
  const commands: string[] = [];
  let viewType = "";
  const plugin = {
    addCommand(command: { id: string }): void { commands.push(command.id); },
    registerView(type: string): void { viewType = type; },
  };

  registerSecondBrainCommands(plugin, {
    syncNow: () => undefined,
    askVault: () => undefined,
    summarizeNote: () => undefined,
    explainRelation: () => undefined,
    extractStructure: () => undefined,
    createNote: () => undefined,
  }, () => null);

  assert.deepEqual(commands, [
    "second-brain:sync-now",
    "second-brain:ask-vault",
    "second-brain:summarize-note",
    "second-brain:explain-relation",
    "second-brain:extract-structure",
    "second-brain:create-note",
  ]);
  assert.equal(viewType, RELATED_NOTES_VIEW_TYPE);
});

test("maps sync states to short UI labels", () => {
  assert.equal(statusLabel("synced"), "Synced");
  assert.equal(statusLabel("conflict"), "Conflict");
  assert.equal(statusLabel("offline"), "Offline");
  assert.equal(statusLabel("auth-required"), "Auth required");
});
