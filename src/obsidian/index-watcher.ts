import type { App, EventRef, TAbstractFile, TFile } from "obsidian";
import { isSyncablePath } from "../core/paths.js";
import { NoteIndex, type IndexedNote } from "../core/note-index.js";

export class ObsidianIndexWatcher {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly app: App,
    private readonly index: NoteIndex,
    private readonly registerEvent: (event: EventRef) => void,
    private readonly debounceMs = 200,
  ) {}

  async start(): Promise<void> {
    await Promise.all(this.app.vault.getMarkdownFiles().filter((file) => isSyncablePath(file.path)).map((file) => this.indexFile(file)));
    this.registerEvent(this.app.vault.on("create", (file) => this.schedule(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.schedule(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.clearTimer(file.path);
      this.index.remove(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.clearTimer(oldPath);
      this.index.remove(oldPath);
      this.schedule(file);
    }));
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(file: TAbstractFile): void {
    if (!isMarkdownFile(file)) {
      this.index.remove(file.path);
      return;
    }
    this.clearTimer(file.path);
    this.timers.set(file.path, setTimeout(() => {
      this.timers.delete(file.path);
      void this.indexFile(file);
    }, this.debounceMs));
  }

  private clearTimer(path: string): void {
    const timer = this.timers.get(path);
    if (timer) clearTimeout(timer);
    this.timers.delete(path);
  }

  private async indexFile(file: TFile): Promise<void> {
    if (!isSyncablePath(file.path) || file.extension.toLowerCase() !== "md") return;
    const text = await this.app.vault.read(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const note: IndexedNote = {
      path: file.path,
      title: file.basename,
      headings: (cache?.headings ?? []).map((heading) => heading.heading),
      tags: (cache?.tags ?? []).map((tag) => tag.tag),
      links: (cache?.links ?? []).map((link) => link.link),
      text,
      modifiedAt: file.stat.mtime,
    };
    this.index.upsert(note);
  }
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return "extension" in file
    && typeof file.extension === "string"
    && file.extension.toLowerCase() === "md"
    && isSyncablePath(file.path);
}
