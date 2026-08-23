import { Notice, Plugin } from "obsidian";
import { shell } from "electron";
import { DeepSeekClient } from "./ai/deepseek-client.js";
import { AiCommands } from "./ai/ai-commands.js";
import { LocalContextRetriever } from "./ai/context-retriever.js";
import { OpenAiClient } from "./ai/openai-client.js";
import { NoteIndex } from "./core/note-index.js";
import { LoopbackGoogleAuth, type GoogleTokenStore } from "./integrations/google-auth.js";
import { GoogleDriveClient } from "./integrations/google-drive.js";
import { ObsidianRequestTransport } from "./obsidian/request-transport.js";
import { ObsidianIndexWatcher } from "./obsidian/index-watcher.js";
import { AskVaultModal } from "./obsidian/ask-vault-modal.js";
import { PreviewModal } from "./obsidian/preview-modal.js";
import { RelatedNotesView } from "./obsidian/related-notes-view.js";
import { RELATED_NOTES_VIEW_TYPE, registerSecondBrainCommands } from "./obsidian/plugin-wiring.js";
import { SecondBrainSettingTab, normalizeSettings, type SecondBrainSettings } from "./obsidian/settings-tab.js";
import { SyncStatusBar } from "./obsidian/status-bar.js";
import { DataManifestStore } from "./sync/manifest-store.js";
import { SyncEngine } from "./sync/sync-engine.js";
import type { SyncReport } from "./sync/sync-report.js";
import { ObsidianVaultAdapter } from "./sync/vault-adapter.js";

export default class SecondBrainPlugin extends Plugin {
  private pluginSettings!: SecondBrainSettings;
  private index!: NoteIndex;
  private watcher?: ObsidianIndexWatcher;
  private statusBar?: SyncStatusBar;
  private syncTimer?: ReturnType<typeof setTimeout>;

  async onload(): Promise<void> {
    this.pluginSettings = normalizeSettings(await this.loadData());
    if (!this.pluginSettings.deviceId) {
      this.pluginSettings.deviceId = `device-${crypto.randomUUID?.() ?? Date.now().toString(36)}`;
      await this.saveSettings();
    }

    const transport = new ObsidianRequestTransport();
    const vault = new ObsidianVaultAdapter(this.app);
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
        void this.syncNow(transport, vault);
      }, 1000);
    };
    this.registerEvent(this.app.vault.on("create", scheduleSync));
    this.registerEvent(this.app.vault.on("modify", scheduleSync));
    this.registerEvent(this.app.vault.on("delete", scheduleSync));
    this.registerEvent(this.app.vault.on("rename", scheduleSync));
    this.registerInterval(window.setInterval(() => {
      if (!this.pluginSettings.paused) void this.syncNow(transport, vault);
    }, Math.max(1, this.pluginSettings.syncIntervalMinutes) * 60_000));
    this.refreshRelatedView();
    if (this.pluginSettings.googleToken) void this.syncNow(transport, vault);
  }

  private async syncNow(transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter): Promise<void> {
    if (this.pluginSettings.paused) return;
    if (!this.pluginSettings.googleClientId || !this.pluginSettings.driveFolderId) {
      this.showReport({ status: "offline", uploaded: [], downloaded: [], conflicts: [], errors: ["Configure Google client ID and Drive folder ID first"] });
      return;
    }
    try {
      const auth = this.googleAuth(transport);
      try {
        await auth.getAccessToken();
      } catch {
        await auth.authorize();
      }
      const drive = new GoogleDriveClient(transport, () => auth.getAccessToken());
      const engine = new SyncEngine(vault, drive, this.manifestStore(), { now: () => Date.now() }, this.pluginSettings.deviceId, this.pluginSettings.driveFolderId);
      this.showReport(await engine.sync());
    } catch (error) {
      this.showReport({ status: "auth-required", uploaded: [], downloaded: [], conflicts: [], errors: [error instanceof Error ? error.message : String(error)] });
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
    await this.openPreview(commands.summarizeNote(path), commands);
  }

  private async explainRelation(activePath: string, relatedPath: string | undefined, transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter): Promise<void> {
    if (!activePath) return;
    const target = relatedPath ?? this.index.related(activePath, 1)[0]?.path;
    const commands = this.aiCommands(transport, vault);
    if (!target || !commands) return;
    await this.openPreview(commands.explainRelation(activePath, target), commands);
  }

  private async extractStructure(transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter): Promise<void> {
    const path = this.activePath();
    const commands = this.aiCommands(transport, vault);
    if (!path || !commands) return;
    await this.openPreview(commands.extractStructure(path), commands);
  }

  private async createNote(transport: ObsidianRequestTransport, vault: ObsidianVaultAdapter): Promise<void> {
    const prompt = window.prompt("Create note from prompt");
    const commands = this.aiCommands(transport, vault);
    if (!prompt || !commands) return;
    await this.openPreview(commands.createNote(prompt), commands);
  }

  private async openPreview(previewPromise: ReturnType<AiCommands["summarizeNote"]>, commands: AiCommands): Promise<void> {
    try {
      new PreviewModal(this.app, await previewPromise, (preview) => commands.applyPreview(preview)).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
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
      await this.googleAuth(transport).authorize();
      new Notice("Google Drive authorized.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private async clearCredentials(): Promise<void> {
    this.pluginSettings.googleToken = undefined;
    await this.saveSettings();
    new Notice("Google credentials cleared on this device.");
  }

  private googleAuth(transport: ObsidianRequestTransport): LoopbackGoogleAuth {
    const store: GoogleTokenStore = {
      load: async () => this.pluginSettings.googleToken,
      save: async (token) => { this.pluginSettings.googleToken = token; await this.saveSettings(); },
      clear: async () => { this.pluginSettings.googleToken = undefined; await this.saveSettings(); },
    };
    return new LoopbackGoogleAuth({ clientId: this.pluginSettings.googleClientId }, transport, store, (url) => shell.openExternal(url));
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

  private showReport(report: SyncReport): void {
    this.statusBar?.setReport(report);
    if (report.status === "conflict") new Notice(`Sync conflict: ${report.conflicts.length} file(s)`);
    if (report.status === "auth-required") new Notice("Google Drive authorization is required.");
  }
}
