import type { SyncReport } from "../sync/sync-report.js";
import type { WorkspaceLeaf } from "obsidian";

export const RELATED_NOTES_VIEW_TYPE = "sken-brain-related-notes";

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
  addRibbonIcon(icon: string, title: string, callback: () => void): unknown;
  registerView(type: string, creator: (leaf: WorkspaceLeaf) => unknown): unknown;
}

export function registerSecondBrainCommands(
  plugin: PluginCommandHost,
  actions: CommandActions,
  createRelatedView: (leaf: WorkspaceLeaf) => unknown,
): void {
  const commands: Array<[string, string, () => void | Promise<void>]> = [
    ["sken-brain:sync-now", "Sync Now", actions.syncNow],
    ["sken-brain:ask-vault", "Ask Vault", actions.askVault],
    ["sken-brain:summarize-note", "Summarize Note", actions.summarizeNote],
    ["sken-brain:explain-relation", "Explain relation", actions.explainRelation],
    ["sken-brain:extract-structure", "Extract structure", actions.extractStructure],
    ["sken-brain:create-note", "Create note from prompt", actions.createNote],
  ];
  for (const [id, name, callback] of commands) plugin.addCommand({ id, name, callback });
  plugin.addRibbonIcon("refresh-cw", "Sync Sken Brain", () => { void actions.syncNow(); });
  plugin.registerView(RELATED_NOTES_VIEW_TYPE, createRelatedView);
}

export function statusLabel(status: SyncReport["status"]): string {
  if (status === "auth-required") return "Auth required";
  return status[0].toUpperCase() + status.slice(1);
}

export function statusSummary(report: SyncReport): string {
  const label = statusLabel(report.status);
  if (report.errors.length) return `${label} · ${report.errors[0]}`;
  const deleted = report.deleted?.length ?? 0;
  return `${label} · ${report.uploaded.length} uploaded · ${report.downloaded.length} downloaded${deleted ? ` · ${deleted} deleted` : ""}${report.conflicts.length ? ` · ${report.conflicts.length} conflicts` : ""}`;
}

export function syncNotice(report: SyncReport): string {
  if (report.status === "auth-required") return "Google Drive authorization is required.";
  if (report.status === "offline") return `Sync offline · ${report.errors[0] ?? "Check your connection or configuration."}`;
  if (report.status === "conflict") return `Sync conflict · ${report.conflicts.length} file(s)`;
  const deleted = report.deleted?.length ?? 0;
  const changes = report.uploaded.length + report.downloaded.length + deleted;
  if (!changes) return "Sync complete · No changes";
  return `Sync complete · ${report.uploaded.length} uploaded · ${report.downloaded.length} downloaded${deleted ? ` · ${deleted} deleted` : ""}`;
}
