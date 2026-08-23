import { Component, MarkdownRenderer, Modal, type App } from "obsidian";
import type { AiPreview } from "../ai/ai-types.js";
import { runAiRequest } from "./ai-request.js";

export class AskVaultModal extends Modal {
  private markdownComponent?: Component;

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
    this.markdownComponent?.unload();
    this.contentEl.empty();
  }

  private renderForm(): void {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Ask Vault" });
    const input = container.createEl("textarea", { placeholder: "Ask about your notes..." });
    input.rows = 4;
    const answer = container.createDiv({ cls: "sken-brain-ai-answer" });
    const askButton = container.createEl("button", { text: "Ask" });
    askButton.addEventListener("click", async () => {
      const query = input.value.trim();
      if (!query) return;
      await runAiRequest(() => this.ask(query), (state) => {
        answer.empty();
        answer.className = "sken-brain-ai-answer";
        askButton.disabled = state.status === "loading";
        askButton.setText(state.status === "loading" ? "Processing…" : "Ask");
        if (state.status === "loading") {
          const spinner = answer.createSpan({ cls: "sken-brain-ai-spinner" });
          spinner.setAttribute("aria-hidden", "true");
          answer.createSpan({ text: "AI sedang memproses…" });
        } else if (state.status === "error") {
          answer.addClass("sken-brain-ai-status-error");
          answer.setText(state.message);
        } else {
          this.renderAnswer(answer, state.value);
        }
      });
    });
  }

  private renderAnswer(container: HTMLElement, preview: AiPreview): void {
    this.markdownComponent?.unload();
    this.markdownComponent = new Component();
    this.markdownComponent.load();
    const result = container.createDiv({ cls: "sken-brain-ai-markdown" });
    void MarkdownRenderer.render(this.app, preview.text, result, "", this.markdownComponent).catch((error) => {
      container.setText(error instanceof Error ? error.message : String(error));
    });
    if (preview.sources.length) container.createEl("small", { text: `Sources: ${preview.sources.join(", ")}` });
  }
}
