import { Modal, type App } from "obsidian";
import type { AiPreview } from "../ai/ai-types.js";

export class AskVaultModal extends Modal {
  constructor(
    app: App,
    private readonly ask: (query: string) => Promise<AiPreview>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderForm();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderForm(): void {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Ask Vault" });
    const input = container.createEl("textarea", { placeholder: "Ask about your notes..." });
    input.rows = 4;
    const answer = container.createDiv({ cls: "second-brain-ai-answer" });
    container.createEl("button", { text: "Ask" }).addEventListener("click", async () => {
      const query = input.value.trim();
      if (!query) return;
      answer.setText("Thinking…");
      try {
        const preview = await this.ask(query);
        answer.empty();
        answer.createEl("p", { text: preview.text });
        if (preview.sources.length) answer.createEl("small", { text: `Sources: ${preview.sources.join(", ")}` });
      } catch (error) {
        answer.setText(error instanceof Error ? error.message : String(error));
      }
    });
  }
}
