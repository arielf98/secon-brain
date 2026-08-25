import { Notice, Platform, Plugin, type ObsidianProtocolData } from "obsidian";
import { DeepSeekClient } from "./ai/deepseek-client.js";
import { AiCommands } from "./ai/ai-commands.js";
import type { AiPreview } from "./ai/ai-types.js";
import { LocalContextRetriever } from "./ai/context-retriever.js";
import { OpenAiClient } from "./ai/openai-client.js";
import { NoteIndex } from "./core/note-index.js";
import {
  createAuthorizationBrowser,
  WorkerGoogleAuth,
  type GoogleOAuthStateStore,
  type GoogleTokenStore,
} from "./integrations/google-auth.js";
import { GoogleDriveClient } from "./integrations/google-drive.js";
import { ObsidianRequestTransport } from "./obsidian/request-transport.js";
import { ObsidianIndexWatcher } from "./obsidian/index-watcher.js";
import { AskVaultModal } from "./obsidian/ask-vault-modal.js";
import { runAiRequest } from "./obsidian/ai-request.js";
import { PreviewModal } from "./obsidian/preview-modal.js";
import { RelatedNotesView } from "./obsidian/related-notes-view.js";
import { RELATED_NOTES_VIEW_TYPE, registerSecondBrainCommands, syncNotice } from "./obsidian/plugin-wiring.js";
import { SecondBrainSettingTab, normalizeSettings, type SecondBrainSettings } from "./obsidian/settings-tab.js";
import { SyncStatusBar } from "./obsidian/status-bar.js";
import { DataManifestStore } from "./sync/manifest-store.js";
import { PluginUpdater, type PluginSyncState } from "./sync/plugin-updater.js";
import { SyncEngine } from "./sync/sync-engine.js";
import { SyncGate } from "./sync/sync-gate.js";
import type { SyncReport } from "./sync/sync-report.js";
import { ObsidianVaultAdapter } from "./sync/vault-adapter.js";

export default class SecondBrainPlugin extends Plugin {
  private pluginSettings!: SecondBrainSettings;
  private index!: NoteIndex;
  private watcher?: ObsidianIndexWatcher;
  private statusBar?: SyncStatusBar;
  private syncTimer?: ReturnType<typeof setTimeout>;
  private googleAuthClient!: WorkerGoogleAuth;
  private readonly syncGate = new SyncGate();

  async onload(): Promise<void> {
    this.pluginSettings = normalizeSettings(await this.loadData());
    if (!this.pluginSettings.deviceId) {
      this.pluginSettings.deviceId = `device-${crypto.randomUUID?.() ?? Date.now().toString(36)}`;
      await this.saveSettings();
    }

    const transport = new ObsidianRequestTransport();
    const vault = new ObsidianVaultAdapter(this.app);
    this.googleAuthClient = this.googleAuth(transport);
    this.registerObsidianProtocolHandler("sken-brain-auth", (params) => {
      void this.completeGoogleAuthorization(params, transport, vault);
    });
    this.index = new NoteIndex();
    this.watcher = new ObsidianIndexWatcher(this.app, this.index, (event) => this.registerEvent(event));
    await this.watcher.start();
    this.register(() => this.watcher?.stop());

    this.statusBar = new SyncStatusBar(this.addStatusBarItem());
    this.statusBar.setText("Sken Brain");
    this.addSettingTab(new SecondBrainSettingTab(
      this.app,
      this,
      () => this.pluginSettings,
      async (settings) => {
        this.pluginSettings = settings;
        await this.saveSettings();
        this.googleAuthClient = this.googleAuth(transport);
      },
      {
        reauthenticate: () => this.reauthenticate(transport),
        clearCredentials: () => this.clearCredentials(),
        syncNow: () => this.syncNow(transport, vault),
      },
    ));

    const explainRelation = (activePath: string, relatedPath?: string): Promise<void> => this.explainRelation(activePath, relatedPath, transport, vault);
    registerSecondBrainCommands(this, {
      syncNow: () => this.syncNow(transport, vault),
      askVault: () => this.askVault(transport, vault),
      summarizeNote: () => this.summarizeNote(transport, vault),
      explainRelation: () => this.explainRelation(this.activePath() ?? "", undefined, transport, vault),
      extractStructure: () => this.extractStructure(transport, vault),
      createNote: () => this.createNote(transport, vault),
    }, (leaf) => new RelatedNotesView(leaf, this.index, explainRelation));
    if (!this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE).length) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: false });
    }

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshRelatedView()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshRelatedView()));
    const scheduleSync = (): void => {
      if (this.pluginSettings.paused || !this.pluginSettings.googleToken) return;
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        this.syncTimer = undefined;
        void this.syncNow(transport, vault, false);
      }, 1000);
    };
    this.registerEvent(this.app.vault.on("create", scheduleSync));
    this.registerEvent(this.app.vault.on("modify", scheduleSync));
    this.registerEvent(this.app.vault.on("delete", scheduleSync));
    this.registerEvent(this.app.vault.on("rename", scheduleSync));
    this.registerInterval(window.setInterval(() => {
      if (!this.pluginSettings.paused) void this.syncNow(transport, vault, false);
    }, Math.max(1, this.pluginSettings.syncIntervalMinutes) * 60_000));
    this.refreshRelatedView();
    if (this.pluginSettings.googleToken) void this.syncNow(transport, vault, false);
  }

  private async syncNow(transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter, notify = true): Promise<void> {
    const started = await this.syncGate.run(() => this.performSync(transport, vault, notify));
    if (!started && notify) new Notice("Sken Brain sync is already running.");
  }

  private async performSync(transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter, notify: boolean): Promise<void> {
    if (this.pluginSettings.paused) return;
    if (!this.pluginSettings.syncServiceUrl || !this.pluginSettings.driveFolderId) {
      this.showReport({ status: "offline", uploaded: [], downloaded: [], conflicts: [], errors: ["Configure the sync service URL and Drive folder ID first"] }, notify);
      return;
    }
    if (!this.pluginSettings.googleToken) {
      this.showReport({ status: "auth-required", uploaded: [], downloaded: [], conflicts: [], errors: ["Authorize Google Drive in Sken Brain settings"] }, notify);
      return;
    }
    try {
      const drive = new GoogleDriveClient(transport, () => this.googleAuthClient.getAccessToken());
      const engine = new SyncEngine(vault, drive, this.manifestStore(), { now: () => Date.now() }, this.pluginSettings.deviceId, this.pluginSettings.driveFolderId);
      const report = await engine.sync();
      if (report.status === "synced" || report.status === "conflict") {
        try {
          const mode = Platform.isDesktopApp ? "publish" : "download";
          const updated = await new PluginUpdater(
            vault,
            drive,
            this.pluginSettings.driveFolderId,
            { mode },
            this.pluginSyncStateStore(),
          ).sync();
          if (updated.length) {
            new Notice(mode === "publish"
              ? "Sken Brain plugin bundle published to Google Drive."
              : "Sken Brain plugin updated. Reload Obsidian to apply it.");
          }
        } catch (error) {
          new Notice(`Sken Brain plugin update failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      this.showReport(report, notify);
    } catch (error) {
      this.showReport({ status: "auth-required", uploaded: [], downloaded: [], conflicts: [], errors: [error instanceof Error ? error.message : String(error)] }, notify);
    }
  }

  private async askVault(transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter): Promise<void> {
    if (!this.aiCommands(transport, vault)) return;
    new AskVaultModal(this.app, (query) => this.aiCommands(transport, vault)!.askVault(query)).open();
  }

  private async summarizeNote(transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter): Promise<void> {
    const path = this.activePath();
    const commands = this.aiCommands(transport, vault);
    if (!path || !commands) return;
    await this.openPreview("Summarize note", () => commands.summarizeNote(path), commands);
  }

  private async explainRelation(activePath: string, relatedPath: string | undefined, transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter): Promise<void> {
    if (!activePath) return;
    const target = relatedPath ?? this.index.related(activePath, 1)[0]?.path;
    const commands = this.aiCommands(transport, vault);
    if (!target || !commands) return;
    await this.openPreview("Explain relation", () => commands.explainRelation(activePath, target), commands);
  }

  private async extractStructure(transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter): Promise<void> {
    const path = this.activePath();
    const commands = this.aiCommands(transport, vault);
    if (!path || !commands) return;
    await this.openPreview("Extract structure", () => commands.extractStructure(path), commands);
  }

  private async createNote(transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter): Promise<void> {
    const prompt = window.prompt("Create note from prompt");
    const commands = this.aiCommands(transport, vault);
    if (!prompt || !commands) return;
    await this.openPreview("Create note from prompt", () => commands.createNote(prompt), commands);
  }

  private async openPreview(title: string, request: () => Promise<AiPreview>, commands: AiCommands): Promise<void> {
    const modal = new PreviewModal(this.app, title, (preview) => commands.applyPreview(preview));
    modal.open();
    await runAiRequest(request, (state) => modal.setState(state));
  }

  private aiCommands(transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter): AiCommands | undefined {
    if (!this.pluginSettings.apiKey || !this.pluginSettings.model) {
      new Notice("Configure an AI provider, API key, and model in Sken Brain settings.");
      return undefined;
    }
    const settings = {
      provider: this.pluginSettings.provider,
      apiKey: this.pluginSettings.apiKey,
      baseUrl: this.pluginSettings.baseUrl || undefined,
      model: this.pluginSettings.model,
      maxContextChars: this.pluginSettings.maxContextChars,
      maxOutputTokens: this.pluginSettings.maxOutputTokens,
    };
    const client = settings.provider === "deepseek"
      ? new DeepSeekClient(settings, transport)
      : new OpenAiClient(settings, transport);
    return new AiCommands(client, new LocalContextRetriever(this.index), vault, settings);
  }

  private async reauthenticate(transport: ObsidianRequestTransport): Promise<void> {
    try {
      this.googleAuthClient = this.googleAuth(transport);
      await this.googleAuthClient.beginAuthorization();
      new Notice("Continue Google authorization in your browser.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private async completeGoogleAuthorization(
    params: ObsidianProtocolData,
    transport: ObsidianRequestTransport,
    vault: ObsidianVaultAdapter,
  ): Promise<void> {
    try {
      await this.googleAuthClient.completeAuthorization(params);
      new Notice("Google Drive authorized.");
      await this.syncNow(transport, vault);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private async clearCredentials(): Promise<void> {
    await this.googleAuthClient.clear();
    new Notice("Google credentials cleared on this device.");
  }

  private googleAuth(transport: ObsidianRequestTransport): WorkerGoogleAuth {
    const store: GoogleTokenStore = {
      load: async () => this.pluginSettings.googleToken,
      save: async (token) => { this.pluginSettings.googleToken = token; await this.saveSettings(); },
      clear: async () => { this.pluginSettings.googleToken = undefined; await this.saveSettings(); },
    };
    const stateStore: GoogleOAuthStateStore = {
      load: async () => this.pluginSettings.googleOAuthState,
      save: async (state) => { this.pluginSettings.googleOAuthState = state; await this.saveSettings(); },
      clear: async () => { this.pluginSettings.googleOAuthState = undefined; await this.saveSettings(); },
    };
    return new WorkerGoogleAuth(
      { serviceUrl: this.pluginSettings.syncServiceUrl },
      transport,
      store,
      stateStore,
      createAuthorizationBrowser(
        () => window.open("about:blank", "_blank"),
        desktopExternalBrowser(),
      ),
    );
  }

  private manifestStore(): DataManifestStore {
    return new DataManifestStore(
      async () => {
        const data = await this.loadData();
        return data && typeof data === "object" ? (data as { manifest?: unknown }).manifest : undefined;
      },
      async (manifest) => {
        const data = await this.loadData();
        const next = data && typeof data === "object" ? { ...(data as Record<string, unknown>) } : {};
        if (manifest === undefined) delete next.manifest;
        else next.manifest = manifest;
        await this.saveData(next);
      },
    );
  }

  private pluginSyncStateStore(): {
    load(): Promise<Record<string, PluginSyncState>>;
    save(state: Record<string, PluginSyncState>): Promise<void>;
  } {
    return {
      load: async () => {
        const data = await this.loadData();
        if (!data || typeof data !== "object") return {};
        const value = (data as { pluginSync?: unknown }).pluginSync;
        return value && typeof value === "object" ? value as Record<string, PluginSyncState> : {};
      },
      save: async (state) => {
        const data = await this.loadData();
        const next = data && typeof data === "object" ? { ...(data as Record<string, unknown>) } : {};
        next.pluginSync = state;
        await this.saveData(next);
      },
    };
  }

  private async saveSettings(): Promise<void> {
    const data = await this.loadData();
    const next = data && typeof data === "object" ? { ...(data as Record<string, unknown>) } : {};
    next.settings = this.pluginSettings;
    await this.saveData(next);
  }

  private activePath(): string | undefined {
    const file = this.app.workspace.getActiveFile();
    return file?.extension.toLowerCase() === "md" ? file.path : undefined;
  }

  private relatedView(): RelatedNotesView | undefined {
    return this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE)[0]?.view as RelatedNotesView | undefined;
  }

  private refreshRelatedView(): void {
    this.relatedView()?.refresh(this.activePath() ?? "");
  }

  private showReport(report: SyncReport, notify = true): void {
    this.statusBar?.setReport(report);
    if (notify) new Notice(syncNotice(report));
  }
}

function desktopExternalBrowser(): ((url: string) => void) | undefined {
  if (!Platform.isDesktopApp) return undefined;
  try {
    const { shell } = require("electron") as { shell: { openExternal(url: string): Promise<void> } };
    return (url) => { void shell.openExternal(url); };
  } catch {
    return undefined;
  }
}
