import type { SyncReport } from "../sync/sync-report.js";
import type { WorkspaceLeaf } from "obsidian";

export const RELATED_NOTES_VIEW_TYPE = "second-brain-related-notes";

export interface CommandActions {
  syncNow: () => void | Promise<void>;
  askVault: () => void | Promise<void>;
  summarizeNote: () => void | Promise<void>;
  explainRelation: () => void | Promise<void>;
  extractStructure: () => void | Promise<void>;
  createNote: () => void | Promise<void>;
}

interface PluginCommandHost {
  addCommand(command: { id: string; name: string; callback: () => void | Promise<void> }): unknown;
  registerView(type: string, creator: (leaf: WorkspaceLeaf) => unknown): unknown;
}

export function registerSecondBrainCommands(
  plugin: PluginCommandHost,
  actions: CommandActions,
  createRelatedView: (leaf: WorkspaceLeaf) => unknown,
): void {
  const commands: Array<[string, string, () => void | Promise<void>]> = [
    ["second-brain:sync-now", "Sync Now", actions.syncNow],
    ["second-brain:ask-vault", "Ask Vault", actions.askVault],
    ["second-brain:summarize-note", "Summarize Note", actions.summarizeNote],
    ["second-brain:explain-relation", "Explain relation", actions.explainRelation],
    ["second-brain:extract-structure", "Extract structure", actions.extractStructure],
    ["second-brain:create-note", "Create note from prompt", actions.createNote],
  ];
  for (const [id, name, callback] of commands) plugin.addCommand({ id, name, callback });
  plugin.registerView(RELATED_NOTES_VIEW_TYPE, createRelatedView);
}

export function statusLabel(status: SyncReport["status"]): string {
  if (status === "auth-required") return "Auth required";
  return status[0].toUpperCase() + status.slice(1);
}
