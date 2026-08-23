import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { GoogleToken } from "../integrations/google-auth.js";
import type { AiProvider } from "../ai/ai-types.js";

export interface SecondBrainSettings {
  googleClientId: string;
  driveFolderId: string;
  googleToken?: GoogleToken;
  provider: AiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  syncIntervalMinutes: number;
  conflictFolder: string;
  maxContextChars: number;
  maxOutputTokens: number;
  paused: boolean;
  deviceId: string;
}

export const DEFAULT_SETTINGS: SecondBrainSettings = {
  googleClientId: "",
  driveFolderId: "",
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  model: "gpt-4o-mini",
  syncIntervalMinutes: 5,
  conflictFolder: "_sync-conflicts",
  maxContextChars: 12000,
  maxOutputTokens: 800,
  paused: false,
  deviceId: "",
};

export function normalizeSettings(value: unknown): SecondBrainSettings {
  const candidate = value && typeof value === "object" && "settings" in value
    ? (value as { settings?: unknown }).settings
    : value;
  const settings = candidate && typeof candidate === "object" ? candidate as Partial<SecondBrainSettings> : {};
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    provider: settings.provider === "deepseek" ? "deepseek" : "openai",
    syncIntervalMinutes: positiveNumber(settings.syncIntervalMinutes, DEFAULT_SETTINGS.syncIntervalMinutes),
    maxContextChars: positiveNumber(settings.maxContextChars, DEFAULT_SETTINGS.maxContextChars),
    maxOutputTokens: positiveNumber(settings.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens),
  };
}

interface SettingsActions {
  reauthenticate: () => Promise<void>;
  clearCredentials: () => Promise<void>;
  syncNow: () => Promise<void>;
}

export class SecondBrainSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly getSettings: () => SecondBrainSettings,
    private readonly saveSettings: (settings: SecondBrainSettings) => Promise<void>,
    private readonly actions: SettingsActions,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Sken Brain" });
    const settings = this.getSettings();
    const update = async (patch: Partial<SecondBrainSettings>): Promise<void> => {
      Object.assign(settings, patch);
      await this.saveSettings(settings);
    };

    new Setting(containerEl)
      .setName("Google desktop client ID")
      .setDesc("Stored locally on this device.")
      .addText((text) => text.setValue(settings.googleClientId).onChange((value) => update({ googleClientId: value.trim() })));
    new Setting(containerEl)
      .setName("Drive folder ID")
      .setDesc("The Google Drive folder mirrored by this vault.")
      .addText((text) => text.setValue(settings.driveFolderId).onChange((value) => update({ driveFolderId: value.trim() })));
    new Setting(containerEl)
      .setName("Google authorization")
      .addButton((button) => button.setButtonText("Re-authenticate").onClick(() => this.actions.reauthenticate()))
      .addButton((button) => button.setButtonText("Clear credentials").onClick(() => this.actions.clearCredentials()));

    new Setting(containerEl)
      .setName("AI provider")
      .addDropdown((dropdown) => dropdown
        .addOption("openai", "OpenAI")
        .addOption("deepseek", "DeepSeek")
        .setValue(settings.provider)
        .onChange((value) => update({ provider: value as AiProvider })));
    new Setting(containerEl)
      .setName("API key")
      .setDesc("Stored locally and never synced.")
      .addText((text) => {
        text.setValue(settings.apiKey).onChange((value) => update({ apiKey: value }));
        text.inputEl.type = "password";
      });
    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("Optional OpenAI-compatible API base URL.")
      .addText((text) => text.setValue(settings.baseUrl).onChange((value) => update({ baseUrl: value.trim() })));
    new Setting(containerEl)
      .setName("Model")
      .addText((text) => text.setValue(settings.model).onChange((value) => update({ model: value.trim() })));

    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .addText((text) => text.setValue(String(settings.syncIntervalMinutes)).onChange((value) => update({ syncIntervalMinutes: positiveNumber(Number(value), settings.syncIntervalMinutes) })));
    new Setting(containerEl)
      .setName("Conflict folder")
      .addText((text) => text.setValue(settings.conflictFolder).onChange((value) => update({ conflictFolder: value.trim() || DEFAULT_SETTINGS.conflictFolder })));
    new Setting(containerEl)
      .setName("Maximum AI context characters")
      .addText((text) => text.setValue(String(settings.maxContextChars)).onChange((value) => update({ maxContextChars: positiveNumber(Number(value), settings.maxContextChars) })));
    new Setting(containerEl)
      .setName("Maximum AI output tokens")
      .addText((text) => text.setValue(String(settings.maxOutputTokens)).onChange((value) => update({ maxOutputTokens: positiveNumber(Number(value), settings.maxOutputTokens) })));
    new Setting(containerEl)
      .setName("Pause sync")
      .addToggle((toggle) => toggle.setValue(settings.paused).onChange((value) => update({ paused: value })));
    new Setting(containerEl)
      .setName("Sync now")
      .addButton((button) => button.setButtonText("Sync Now").onClick(() => this.actions.syncNow()));
  }
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}
