import test from "node:test";
import assert from "node:assert/strict";

import {
  registerSecondBrainCommands,
  RELATED_NOTES_VIEW_TYPE,
  statusLabel,
  statusSummary,
} from "../src/obsidian/plugin-wiring.js";

test("registers all user-facing commands and the Related Notes view", () => {
  const commands: string[] = [];
  let viewType = "";
  let ribbon: { icon: string; title: string; callback: () => void } | undefined;
  let syncCalls = 0;
  const plugin = {
    addCommand(command: { id: string }): void { commands.push(command.id); },
    addRibbonIcon(icon: string, title: string, callback: () => void): void { ribbon = { icon, title, callback }; },
    registerView(type: string): void { viewType = type; },
  };

  registerSecondBrainCommands(plugin, {
    syncNow: () => { syncCalls += 1; },
    askVault: () => undefined,
    summarizeNote: () => undefined,
    explainRelation: () => undefined,
    extractStructure: () => undefined,
    createNote: () => undefined,
  }, () => null);

  assert.deepEqual(commands, [
    "sken-brain:sync-now",
    "sken-brain:ask-vault",
    "sken-brain:summarize-note",
    "sken-brain:explain-relation",
    "sken-brain:extract-structure",
    "sken-brain:create-note",
  ]);
  assert.equal(viewType, RELATED_NOTES_VIEW_TYPE);
  assert.equal(ribbon?.icon, "refresh-cw");
  assert.equal(ribbon?.title, "Sync Sken Brain");
  ribbon?.callback();
  assert.equal(syncCalls, 1);
});

test("maps sync states to short UI labels", () => {
  assert.equal(statusLabel("synced"), "Synced");
  assert.equal(statusLabel("conflict"), "Conflict");
  assert.equal(statusLabel("offline"), "Offline");
  assert.equal(statusLabel("auth-required"), "Auth required");
});

test("shows sync counts and errors in the status summary", () => {
  assert.equal(statusSummary({
    status: "synced",
    uploaded: ["note.md", "image.png"],
    downloaded: ["remote.md"],
    conflicts: [],
    errors: [],
  }), "Synced · 2 uploaded · 1 downloaded");
  assert.equal(statusSummary({
    status: "offline",
    uploaded: [],
    downloaded: [],
    conflicts: [],
    errors: ["Drive folder was not found"],
  }), "Offline · Drive folder was not found");
});
