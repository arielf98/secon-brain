import { Plugin } from "obsidian";

export default class SecondBrainPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addCommand({
      id: "sync-now",
      name: "Sync Now",
      callback: () => undefined,
    });
  }
}
