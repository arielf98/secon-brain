import test from "node:test";
import assert from "node:assert/strict";

import { NoteIndex, type IndexedNote } from "../src/core/note-index.js";
import { DeepSeekClient } from "../src/ai/deepseek-client.js";
import type { AiClient, AiRequest, AiResponse, AiSettings } from "../src/ai/ai-types.js";
import { OpenAiClient } from "../src/ai/openai-client.js";
import { AiCommands } from "../src/ai/ai-commands.js";
import { LocalContextRetriever } from "../src/ai/context-retriever.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "../src/integrations/http.js";
import type { FileSnapshot } from "../src/core/sync-model.js";
import type { VaultAdapter } from "../src/sync/vault-adapter.js";
import { sha256 } from "../src/core/hash.js";

class FakeTransport implements HttpTransport {
  requests: HttpRequest[] = [];
  constructor(private readonly response: unknown) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(JSON.stringify(this.response)).buffer,
    };
  }
}

class FakeAi implements AiClient {
  writes = 0;
  constructor(private readonly text: string) {}

  async complete(_request: AiRequest): Promise<AiResponse> {
    return { text: this.text };
  }
}

class MemoryVault implements VaultAdapter {
  readonly files = new Map<string, ArrayBuffer>();
  writes = 0;

  constructor(initial: Record<string, string>) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, new TextEncoder().encode(content).buffer);
  }

  async listFiles(): Promise<FileSnapshot[]> {
    return Promise.all([...this.files].map(async ([path, data]) => ({
      path,
      hash: await sha256(data),
      size: data.byteLength,
      modifiedAt: 1,
    })));
  }

  async read(path: string): Promise<ArrayBuffer> {
    const data = this.files.get(path);
    if (!data) throw new Error(`missing file: ${path}`);
    return data;
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    this.writes += 1;
    this.files.set(path, data.slice(0));
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async ensureFolder(): Promise<void> {}
}

const note = (path: string, values: Partial<IndexedNote> = {}): IndexedNote => ({
  path,
  title: "Note",
  headings: [],
  tags: [],
  links: [],
  text: "",
  modifiedAt: 1,
  ...values,
});

const settings = (overrides: Partial<AiSettings> = {}): AiSettings => ({
  provider: "openai",
  apiKey: "secret-key",
  model: "test-model",
  maxContextChars: 120,
  maxOutputTokens: 100,
  ...overrides,
});

test("OpenAI sends bounded local context to the Responses endpoint", async () => {
  const transport = new FakeTransport({ output_text: "answer" });
  const client = new OpenAiClient(settings(), transport);
  const index = new NoteIndex();
  index.upsert(note("Notes/relevant.md", { title: "Relevant", text: "relevant ".repeat(100) }));
  const commands = new AiCommands(client, new LocalContextRetriever(index), new MemoryVault({ "Notes/relevant.md": "relevant" }), settings());
  const preview = await commands.askVault("relevant");
  const request = transport.requests[0]!;
  const payload = JSON.parse(String(request.body)) as { input: Array<{ content: Array<{ text: string }> }> };
  const userPrompt = payload.input[1]!.content[0]!.text;
  const boundedContext = userPrompt.split("\n\n").slice(1).join("\n\n");

  assert.equal(preview.text, "answer");
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.headers?.Authorization, "Bearer secret-key");
  assert.equal(payload.input.length, 2);
  assert.ok(userPrompt.includes("[Notes/relevant.md]"));
  assert.ok(boundedContext.length <= 120);
});

test("DeepSeek uses its configured OpenAI-compatible base URL and key", async () => {
  const transport = new FakeTransport({ choices: [{ message: { content: "answer" } }] });
  const client = new DeepSeekClient(settings({ provider: "deepseek", apiKey: "deep-key", baseUrl: "https://deep.example/v1" }), transport);
  const response = await client.complete({ prompt: "A question", maxOutputTokens: 20 });

  assert.equal(response.text, "answer");
  assert.equal(transport.requests[0]?.url, "https://deep.example/v1/chat/completions");
  assert.equal(transport.requests[0]?.headers?.Authorization, "Bearer deep-key");
});

test("invalid structured output remains a text-only preview", async () => {
  const index = new NoteIndex();
  index.upsert(note("Notes/idea.md", { text: "A note" }));
  const commands = new AiCommands(new FakeAi("not json"), new LocalContextRetriever(index), new MemoryVault({ "Notes/idea.md": "A note" }), settings());

  const preview = await commands.extractStructure("Notes/idea.md");

  assert.equal(preview.text, "not json");
  assert.equal(preview.proposed, undefined);
  assert.deepEqual(preview.changes, []);
});

test("create note never writes before applyPreview and rejects stale source edits", async () => {
  const index = new NoteIndex();
  index.upsert(note("Notes/idea.md", { text: "A note" }));
  const vault = new MemoryVault({ "Notes/idea.md": "A note" });
  const commands = new AiCommands(
    new FakeAi(JSON.stringify({ title: "New idea", content: "Generated content" })),
    new LocalContextRetriever(index),
    vault,
    settings(),
  );

  const preview = await commands.createNote("Create a note");
  assert.equal(vault.writes, 0);
  await commands.applyPreview(preview);
  assert.equal(vault.writes, 1);

  const stale = {
    ...preview,
    changes: preview.changes.map((change) => ({ ...change, mode: "replace" as const, expectedHash: "stale" })),
  };
  await assert.rejects(() => commands.applyPreview(stale), /changed since preview/);
});
