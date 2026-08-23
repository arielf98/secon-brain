import { Component, MarkdownRenderer, Modal, type App } from "obsidian";
import type { AiPreview, ProposedStructure } from "../ai/ai-types.js";
import type { AiRequestState } from "./ai-request.js";

export class PreviewModal extends Modal {
  private readonly loadingTitle: string;
  private preview?: AiPreview;
  private bodyEl?: HTMLElement;
  private statusEl?: HTMLElement;
  private applyButton?: HTMLButtonElement;
  private markdownComponent?: Component;
  private headingEl?: HTMLElement;

  constructor(
    app: App,
    loadingTitle: string,
    private readonly apply: (preview: AiPreview) => Promise<void>,
  ) {
    super(app);
    this.loadingTitle = loadingTitle;
  }

  onOpen(): void {
    this.renderLayout();
    this.setState({ status: "loading" });
  }

  onClose(): void {
    this.markdownComponent?.unload();
    this.contentEl.empty();
  }

  setState(state: AiRequestState<AiPreview>): void {
    if (!this.bodyEl || !this.applyButton) return;
    this.markdownComponent?.unload();
    this.markdownComponent = undefined;
    this.bodyEl.empty();
    this.statusEl = this.bodyEl.createDiv({ cls: "sken-brain-ai-status" });
    this.statusEl.setAttribute("role", "status");
    this.statusEl.setAttribute("aria-live", "polite");
    this.statusEl.className = "sken-brain-ai-status";
    this.applyButton.style.display = "none";
    this.applyButton.disabled = true;

    if (state.status === "loading") {
      this.renderLoading();
      return;
    }
    if (state.status === "error") {
      this.renderError(state.message);
      return;
    }

    this.preview = state.value;
    this.headingEl?.setText(state.value.title);
    this.renderPreview(state.value);
    this.applyButton.style.display = "";
    this.applyButton.disabled = false;
  }

  private renderLayout(): void {
    this.contentEl.empty();
    this.contentEl.addClass("sken-brain-ai-modal");
    this.headingEl = this.contentEl.createEl("h2", { text: this.loadingTitle });
    this.bodyEl = this.contentEl.createDiv({ cls: "sken-brain-ai-modal-body" });
    this.statusEl = this.bodyEl.createDiv({ cls: "sken-brain-ai-status" });
    this.statusEl.setAttribute("role", "status");
    this.statusEl.setAttribute("aria-live", "polite");

    const actions = this.contentEl.createDiv({ cls: "sken-brain-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    this.applyButton = actions.createEl("button", { text: "Apply", cls: "mod-cta" });
    this.applyButton.style.display = "none";
    this.applyButton.disabled = true;
    this.applyButton.addEventListener("click", async () => {
      if (!this.preview || !this.applyButton) return;
      this.applyButton.disabled = true;
      try {
        await this.apply(this.preview);
        this.close();
      } catch (reason) {
        this.applyButton.disabled = false;
        this.showError(reason instanceof Error ? reason.message : String(reason));
      }
    });
  }

  private renderLoading(): void {
    const spinner = this.statusEl!.createSpan({ cls: "sken-brain-ai-spinner" });
    spinner.setAttribute("aria-hidden", "true");
    this.statusEl!.createSpan({ text: "AI sedang memproses…" });
  }

  private renderError(message: string): void {
    this.statusEl!.addClass("sken-brain-ai-status-error");
    this.statusEl!.createSpan({ text: message });
  }

  private showError(message: string): void {
    this.statusEl!.empty();
    this.statusEl!.className = "sken-brain-ai-status sken-brain-ai-status-error";
    this.statusEl!.createSpan({ text: message });
  }

  private renderPreview(preview: AiPreview): void {
    const result = this.bodyEl!.createDiv({ cls: "sken-brain-ai-result" });
    if (preview.type === "extract-structure" && preview.proposed) {
      this.renderProposedStructure(result, preview.proposed);
    } else if (preview.type === "create-note" && preview.changes[0]) {
      result.createEl("h3", { text: "New note" });
      result.createEl("p", { text: preview.changes[0].path, cls: "sken-brain-ai-note-path" });
      const noteContent = result.createDiv({ cls: "sken-brain-ai-markdown" });
      this.renderMarkdown(preview.changes[0].content, noteContent);
    } else {
      this.renderMarkdown(preview.text, result);
    }
    if (preview.sources.length) {
      result.createEl("p", { text: `Sources: ${preview.sources.join(", ")}`, cls: "sken-brain-ai-sources" });
    }
  }

  private renderProposedStructure(container: HTMLElement, proposed: ProposedStructure): void {
    const groups: Array<[string, string[]]> = [
      ["Tags", proposed.tags],
      ["Tasks", proposed.tasks],
      ["Links", proposed.links],
    ];
    const hasSuggestions = groups.some(([, items]) => items.length > 0);
    if (!hasSuggestions) {
      container.createEl("p", { text: "No structured suggestions returned." });
      return;
    }
    for (const [label, items] of groups) {
      if (!items.length) continue;
      container.createEl("h3", { text: label });
      const list = container.createEl("ul");
      for (const item of items) list.createEl("li", { text: item });
    }
  }

  private renderMarkdown(markdown: string, container: HTMLElement): void {
    this.markdownComponent?.unload();
    this.markdownComponent = new Component();
    this.markdownComponent.load();
    void MarkdownRenderer.render(this.app, markdown, container, "", this.markdownComponent).catch((error) => {
      this.showError(error instanceof Error ? error.message : String(error));
    });
  }
}
