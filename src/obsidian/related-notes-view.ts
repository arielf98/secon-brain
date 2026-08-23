import { ItemView, type WorkspaceLeaf } from "obsidian";
import { NoteIndex } from "../core/note-index.js";
import { RELATED_NOTES_VIEW_TYPE } from "./plugin-wiring.js";

export class RelatedNotesView extends ItemView {
  private activePath = "";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly index: NoteIndex,
    private readonly onExplain: (activePath: string, relatedPath: string) => void | Promise<void>,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return RELATED_NOTES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Related Notes";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(path: string): void {
    this.activePath = path;
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("sken-brain-related-notes");
    container.createEl("h3", { text: "Related Notes" });
    if (!this.activePath) {
      container.createEl("p", { text: "Open a Markdown note to see contextual suggestions." });
      return;
    }
    const related = this.index.related(this.activePath, 5);
    if (!related.length) {
      container.createEl("p", { text: "No related notes yet." });
      return;
    }
    for (const item of related) {
      const card = container.createDiv({ cls: "sken-brain-related-card" });
      card.createEl("a", { text: item.path, href: `#${item.path}` });
      card.createEl("p", { text: item.reasons.join(" · ") });
      card.createEl("button", { text: "Explain relation", cls: "sken-brain-compact-button" })
        .addEventListener("click", () => void this.onExplain(this.activePath, item.path));
    }
  }
}
