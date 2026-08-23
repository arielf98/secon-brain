import { isSyncablePath } from "../core/paths.js";
import { sha256 } from "../core/hash.js";
import type { VaultAdapter } from "../sync/vault-adapter.js";
import type { AiChange, AiClient, AiPreview, AiRequest, AiSettings, ProposedStructure } from "./ai-types.js";
import type { ContextRetriever, RetrievedNote } from "./context-retriever.js";

export class AiCommands {
  constructor(
    private readonly client: AiClient,
    private readonly context: ContextRetriever,
    private readonly vault: VaultAdapter,
    private readonly settings: AiSettings,
  ) {}

  async askVault(query: string): Promise<AiPreview> {
    const sources = this.context.retrieve(query, 10);
    const response = await this.client.complete(this.request(
      "Answer using only the supplied local vault excerpts. Cite source paths in the answer.",
      `Question: ${query}\n\n${formatContext(sources, this.settings.maxContextChars)}`,
    ));
    return this.preview("ask-vault", "Ask Vault", response.text, sources.map((source) => source.path));
  }

  async explainRelation(activePath: string, relatedPath: string): Promise<AiPreview> {
    const sources = [this.context.get(activePath), this.context.get(relatedPath)].filter((source): source is RetrievedNote => !!source);
    if (sources.length < 2) throw new Error("Both notes must be indexed before explaining their relation");
    const response = await this.client.complete(this.request(
      "Explain the contextual relationship between these two local notes. Suggest a backlink only as a proposal.",
      formatContext(sources, this.settings.maxContextChars),
    ));
    return this.preview("explain-relation", "Explain relation", response.text, sources.map((source) => source.path));
  }

  async summarizeNote(path: string): Promise<AiPreview> {
    const source = this.requireNote(path);
    const response = await this.client.complete(this.request("Summarize this local note clearly and briefly.", formatContext([source], this.settings.maxContextChars)));
    return this.preview("summarize-note", `Summarize ${source.title}`, response.text, [path]);
  }

  async extractStructure(path: string): Promise<AiPreview> {
    const source = this.requireNote(path);
    const response = await this.client.complete(this.request(
      "Return JSON only with arrays named tags, tasks, and links. Do not invent content outside this note.",
      formatContext([source], this.settings.maxContextChars),
    ));
    const proposed = parseStructure(response.text);
    const changes: AiChange[] = [];
    if (proposed) {
      const current = await this.vault.read(path);
      const currentText = new TextDecoder().decode(new Uint8Array(current));
      changes.push({
        path,
        content: appendStructure(currentText, proposed),
        expectedHash: await sha256(current),
        mode: "replace",
      });
    }
    return {
      ...this.preview("extract-structure", `Extract structure from ${source.title}`, response.text, [path]),
      proposed,
      changes,
    };
  }

  async createNote(prompt: string): Promise<AiPreview> {
    const response = await this.client.complete(this.request(
      "Return JSON only with string fields title and content for a new Markdown note.",
      prompt,
    ));
    const draft = parseDraft(response.text);
    const changes: AiChange[] = draft
      ? [{ path: `Notes/${safeFileName(draft.title)}.md`, content: draft.content, mode: "create" }]
      : [];
    return {
      ...this.preview("create-note", "Create note from prompt", response.text, []),
      changes,
    };
  }

  async applyPreview(preview: AiPreview): Promise<void> {
    for (const change of preview.changes) {
      if (!isSyncablePath(change.path)) throw new Error(`Unsafe AI output path: ${change.path}`);
      const files = await this.vault.listFiles();
      const existing = files.find((file) => file.path === change.path);
      if (change.mode === "create" && existing) throw new Error(`AI note already exists: ${change.path}`);
      if (change.expectedHash && existing?.hash !== change.expectedHash) throw new Error(`${change.path} changed since preview`);
      if (change.expectedHash && !existing) throw new Error(`${change.path} changed since preview`);
      await this.vault.write(change.path, new TextEncoder().encode(change.content).buffer);
    }
  }

  private requireNote(path: string): RetrievedNote {
    const note = this.context.get(path);
    if (!note) throw new Error(`Note is not indexed: ${path}`);
    return note;
  }

  private request(system: string, prompt: string): AiRequest {
    return { system, prompt, maxOutputTokens: this.settings.maxOutputTokens };
  }

  private preview(type: AiPreview["type"], title: string, text: string, sources: string[]): AiPreview {
    return { type, title, text, sources, changes: [] };
  }
}

function formatContext(sources: RetrievedNote[], maxChars: number): string {
  const chunks: string[] = [];
  let remaining = Math.max(0, maxChars);
  for (const source of sources) {
    if (remaining <= 0) break;
    const header = `[${source.path}]\n`;
    const chunk = `${header}${source.excerpt}`.slice(0, remaining);
    chunks.push(chunk);
    remaining -= chunk.length;
  }
  return chunks.join("\n\n");
}

function parseStructure(text: string): ProposedStructure | undefined {
  const value = parseJson(text);
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ProposedStructure>;
  if (!Array.isArray(candidate.tags) || !Array.isArray(candidate.tasks) || !Array.isArray(candidate.links)) return undefined;
  if (![...candidate.tags, ...candidate.tasks, ...candidate.links].some((item) => typeof item !== "string")) {
    return { tags: candidate.tags, tasks: candidate.tasks, links: candidate.links };
  }
  return undefined;
}

function parseDraft(text: string): { title: string; content: string } | undefined {
  const value = parseJson(text);
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { title?: unknown; content?: unknown };
  return typeof candidate.title === "string" && candidate.title.trim() && typeof candidate.content === "string"
    ? { title: candidate.title.trim(), content: candidate.content }
    : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "untitled";
}

function appendStructure(content: string, structure: ProposedStructure): string {
  const section = [
    "## AI Suggestions",
    ...(structure.tags.length ? ["", "Tags", ...structure.tags.map((tag) => `- ${tag}`)] : []),
    ...(structure.tasks.length ? ["", "Tasks", ...structure.tasks.map((task) => `- [ ] ${task}`)] : []),
    ...(structure.links.length ? ["", "Links", ...structure.links.map((link) => `- [[${link}]]`)] : []),
  ].join("\n");
  return `${content.replace(/\s*$/, "")}\n\n${section}\n`;
}
