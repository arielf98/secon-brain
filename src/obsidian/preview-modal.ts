import { Modal, type App } from "obsidian";
import type { AiPreview } from "../ai/ai-types.js";

export class PreviewModal extends Modal {
  constructor(
    app: App,
    private readonly preview: AiPreview,
    private readonly apply: (preview: AiPreview) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: this.preview.title });
    container.createEl("pre", { text: this.preview.text });
    if (this.preview.sources.length) container.createEl("p", { text: `Sources: ${this.preview.sources.join(", ")}` });
    if (this.preview.proposed) container.createEl("pre", { text: JSON.stringify(this.preview.proposed, null, 2) });
    const error = container.createDiv();
    const actions = container.createDiv({ cls: "second-brain-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const apply = actions.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.addEventListener("click", async () => {
      apply.disabled = true;
      try {
        await this.apply(this.preview);
        this.close();
      } catch (reason) {
        apply.disabled = false;
        error.setText(reason instanceof Error ? reason.message : String(reason));
      }
    });
  }
}
