# Second Brain Obsidian Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private Obsidian plugin that syncs a local vault with Google Drive, finds related notes locally, and provides preview-first AI actions through OpenAI or DeepSeek.

**Architecture:** Keep pure sync planning, hashing, path filtering, note scoring, and AI result validation independent of Obsidian so they can be tested with Node's built-in test runner. Add thin Obsidian adapters for vault events, settings, views, and commands; use direct HTTP adapters for Google Drive, OpenAI, and DeepSeek.

**Tech Stack:** TypeScript, Obsidian API, esbuild, Node.js built-in `node:test`, Web Crypto SHA-256, Obsidian `requestUrl`, Google Drive REST API, OpenAI-compatible HTTP APIs.

**Spec:** [docs/superpowers/specs/2026-08-23-second-brain-obsidian-design.md](../specs/2026-08-23-second-brain-obsidian-design.md)

## Global Constraints

- The local vault is the working source of truth; Google Drive is a shared mirror.
- Sync Markdown, images, PDFs, and other user files; exclude `.obsidian`, workspace/cache files, plugin settings, OAuth tokens, and API keys.
- Use three-way comparison: local state, remote state, and last common snapshot.
- Store local content hashes and remote Drive fingerprints separately; never compare unlike hash formats directly.
- Never discard a conflict version automatically; write remote conflicts to `_sync-conflicts/`.
- Related Notes uses local scoring and never calls AI automatically.
- AI receives bounded retrieved context, not the full vault by default.
- AI mutations require preview and explicit **Apply**.
- Support OpenAI and DeepSeek with separate provider keys and model IDs.
- The native Obsidian editor remains the writing surface.
- Prefer simple code, no unnecessary abstraction, no new dependency when the platform or standard library is enough.
- Create local commits at the end of each completed task; never push.

---

### Task 1: Create the minimal plugin and test foundation

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `src/main.ts`
- Create: `tests/smoke.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces `SecondBrainPlugin extends Plugin` in `src/main.ts` with `onload()` registering one command named `second-brain:sync-now` and `onunload()` clearing resources.
- Produces `npm run build`, `npm test`, and `npm run dev` scripts.

- [ ] **Step 1: Write the failing smoke test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

test("test runner is wired", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Run it to verify the test command is not wired yet**

Run: `npm test`

Expected: the command fails because `package.json` and the test build script do not exist.

- [ ] **Step 3: Add the smallest build configuration**

Use `obsidian`, `esbuild`, and `typescript` as development dependencies. Configure `esbuild.config.mjs` to bundle `src/main.ts` to `main.js` with `external: ["obsidian", "electron"]`, platform `browser`, and production sourcemaps disabled. Configure the test script to bundle `tests/*.test.ts` to `.test-dist/` and run `node --test .test-dist/*.test.js`.

Create `manifest.json` with the plugin id `second-brain`, name `Second Brain`, version `0.1.0`, minimum Obsidian version `1.5.0`, and desktop-first support.

Create `src/main.ts` with:

```ts
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
```

- [ ] **Step 4: Run the smoke test and production build**

Run: `npm install`  
Run: `npm test`  
Run: `npm run build`

Expected: the smoke test passes and `main.js` is produced.

- [ ] **Step 5: Ignore generated and brainstorm-only files**

Add `node_modules/`, `.test-dist/`, `.superpowers/`, and local logs to `.gitignore`. Keep `manifest.json`, `main.js`, and `styles.css` available as plugin installation artifacts.

- [ ] **Step 6: Commit**

```bash
git add manifest.json package.json tsconfig.json esbuild.config.mjs src/main.ts tests/smoke.test.ts .gitignore
git commit -m "feat: scaffold second brain obsidian plugin"
```

### Task 2: Add pure vault paths, snapshots, and hashing

**Files:**
- Create: `src/core/sync-model.ts`
- Create: `src/core/paths.ts`
- Create: `src/core/hash.ts`
- Create: `tests/sync-foundation.test.ts`

**Interfaces:**
- `FileSnapshot { path: string; hash: string; size: number; modifiedAt: number; deleted?: boolean }`
- `RemoteFile extends FileSnapshot { driveId: string; mimeType: string }`
- `ManifestEntry { path: string; driveId?: string; baseLocalHash?: string; baseRemoteHash?: string; localHash?: string; remoteHash?: string; lastSyncedAt: number }`
- `isSyncablePath(path: string): boolean`
- `sha256(bytes: ArrayBuffer | Uint8Array): Promise<string>`

- [ ] **Step 1: Write failing tests for path rules and hash stability**

```ts
test("excludes Obsidian internals but keeps user attachments", () => {
  assert.equal(isSyncablePath(".obsidian/workspace.json"), false);
  assert.equal(isSyncablePath("Notes/idea.md"), true);
  assert.equal(isSyncablePath("Assets/photo.png"), true);
});

test("hash is stable and hexadecimal", async () => {
  assert.equal(await sha256(new TextEncoder().encode("hello")), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});
```

- [ ] **Step 2: Run the test suite to verify it fails**

Run: `npm test`

Expected: FAIL because the path and hash modules do not exist.

- [ ] **Step 3: Implement path filtering and SHA-256**

Normalize `/` separators, remove a leading `./`, reject empty paths, reject `.obsidian/`, `.trash/`, temporary lock files, and workspace/cache patterns. Use `globalThis.crypto.subtle.digest("SHA-256", bytes)` and return lowercase hexadecimal without a crypto dependency.

- [ ] **Step 4: Run the test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/sync-model.ts src/core/paths.ts src/core/hash.ts tests/sync-foundation.test.ts
git commit -m "feat: add vault sync primitives"
```

### Task 3: Implement three-way sync planning and conflict naming

**Files:**
- Create: `src/core/sync-plan.ts`
- Create: `src/core/conflicts.ts`
- Modify: `tests/sync-foundation.test.ts`

**Interfaces:**
- `SyncSnapshot { local: Record<string, FileSnapshot>; remote: Record<string, RemoteFile>; base: Record<string, ManifestEntry> }`
- `SyncAction = { type: "upload" | "download" | "conflict" | "skip"; path: string; remote?: RemoteFile; conflictPath?: string; reason: string }`
- `planSync(snapshot: SyncSnapshot, deviceId: string, now: number): SyncAction[]`
- `makeConflictPath(path: string, deviceId: string, now: number): string`

- [ ] **Step 1: Write the failing three-way matrix tests**

Cover these exact cases: local-only edit produces `upload`; remote-only edit produces `download`; both edits produce `conflict`; new file on either side copies across; remote deletion versus local edit produces `conflict`; unchanged files produce `skip`; binary files use the same conflict action.

```ts
const actions = planSync({ local, remote, base }, "laptop", 1700000000000);
assert.deepEqual(actions[0], {
  type: "conflict",
  path: "Notes/idea.md",
  conflictPath: "_sync-conflicts/Notes/idea (conflict-laptop-20231114-221320).md",
  reason: "changed-on-both-sides",
});
```

- [ ] **Step 2: Run the test suite to verify it fails**

Run: `npm test`

Expected: FAIL because `planSync` and `makeConflictPath` do not exist.

- [ ] **Step 3: Implement the pure planner**

Compare each local path against `baseLocalHash` and each remote path against `baseRemoteHash`; never compare a local SHA-256 directly with a Drive fingerprint. Keep the local path as the primary file for conflicts and copy the remote content to the generated conflict path. Use UTC timestamps and preserve the original extension. Return actions in stable lexicographic path order so previews and tests are deterministic.

- [ ] **Step 4: Run the test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/sync-plan.ts src/core/conflicts.ts tests/sync-foundation.test.ts
git commit -m "feat: plan three-way sync conflicts"
```

### Task 4: Add vault and manifest adapters

**Files:**
- Create: `src/sync/vault-adapter.ts`
- Create: `src/sync/manifest-store.ts`
- Create: `tests/manifest-store.test.ts`

**Interfaces:**
- `VaultAdapter { listFiles(): Promise<FileSnapshot[]>; read(path: string): Promise<ArrayBuffer>; write(path: string, data: ArrayBuffer): Promise<void>; delete(path: string): Promise<void>; ensureFolder(path: string): Promise<void> }`
- `ManifestStore { load(): Promise<Record<string, ManifestEntry>>; save(entries: Record<string, ManifestEntry>): Promise<void>; clear(): Promise<void> }`
- `ObsidianVaultAdapter(app: App)` implements `VaultAdapter` with `app.vault` and only returns paths passing `isSyncablePath`.
- `DataManifestStore(loadData, saveData)` stores manifest data in plugin data, never in the synced vault.

- [ ] **Step 1: Write failing persistence tests**

Use an in-memory `loadData`/`saveData` fake. Assert that a saved manifest reloads unchanged, a missing manifest returns an empty object, and `clear()` removes it.

- [ ] **Step 2: Run the test suite to verify it fails**

Run: `npm test`

Expected: FAIL because the adapter modules do not exist.

- [ ] **Step 3: Implement the adapters**

Use `app.vault.getFiles()` for inventory, `readBinary`/`createBinary`/`modifyBinary` for bytes, and `createFolder` only when a parent directory does not exist. Store the manifest under a versioned plugin-data key `{ version: 1, entries }`.

- [ ] **Step 4: Run the test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/vault-adapter.ts src/sync/manifest-store.ts tests/manifest-store.test.ts
git commit -m "feat: add local vault and manifest adapters"
```

### Task 5: Implement Google OAuth and Drive file operations

**Files:**
- Create: `src/integrations/google-auth.ts`
- Create: `src/integrations/google-drive.ts`
- Create: `src/integrations/http.ts`
- Create: `tests/google-http.test.ts`
- Create: `docs/setup/google-drive.md`

**Interfaces:**
- `HttpTransport { request(options: HttpRequest): Promise<HttpResponse> }`
- `GoogleAuth { authorize(): Promise<GoogleToken>; refresh(token: GoogleToken): Promise<GoogleToken>; clear(): Promise<void> }`
- `GoogleDrive { listTree(rootId: string): Promise<RemoteFile[]>; upload(path: string, bytes: ArrayBuffer, parentId: string): Promise<RemoteFile>; download(fileId: string): Promise<ArrayBuffer>; update(fileId: string, bytes: ArrayBuffer): Promise<RemoteFile>; ensureFolder(path: string, rootId: string): Promise<string> }`

- [ ] **Step 1: Write failing HTTP and URL tests**

Test that the OAuth authorization URL contains the configured client id, PKCE challenge, loopback redirect, Drive scope, and state; test that the Drive query builder requests non-trashed files under the selected folder; test that a 401 response is surfaced as `AuthRequiredError`.

- [ ] **Step 2: Run the test suite to verify it fails**

Run: `npm test`

Expected: FAIL because the HTTP and Google modules do not exist.

- [ ] **Step 3: Implement the HTTP transport**

Use Obsidian `requestUrl` for requests inside the plugin. Keep the transport injectable so tests never call the network. Redact `Authorization` values from thrown errors and logs.

- [ ] **Step 4: Implement desktop OAuth with PKCE**

Generate `state`, verifier, and challenge with Web Crypto. Open the authorization URL in the system browser, listen on a loopback callback during the authorization window, exchange the code for tokens, and persist tokens through the device-local manifest/settings store. Reject a callback with the wrong state. Keep the flow desktop-only in v1; the responsive mobile UI does not promise mobile OAuth/sync.

- [ ] **Step 5: Implement Drive tree and file methods**

Represent Drive folders as path segments. Use stable `driveId` values in `RemoteFile`, preserve MIME type and modified time, upload raw bytes, and never call a delete endpoint from the sync engine. Return a typed error for 401, 403, 429, and 5xx responses so retry policy can distinguish auth, permission, rate limit, and transient failures.

- [ ] **Step 6: Document user setup**

Write `docs/setup/google-drive.md` with the exact steps to create a Google Cloud project, enable Drive API, create a desktop OAuth client, configure the client id in plugin settings, choose a folder, and authorize each device. State that Google credentials and the OpenAI/DeepSeek key are entered per device and never synced.

- [ ] **Step 7: Run the test suite**

Run: `npm test`

Expected: PASS with no live network calls.

- [ ] **Step 8: Commit**

```bash
git add src/integrations/google-auth.ts src/integrations/google-drive.ts src/integrations/http.ts tests/google-http.test.ts docs/setup/google-drive.md
git commit -m "feat: add google drive client"
```

### Task 6: Connect the sync engine to local and remote adapters

**Files:**
- Create: `src/sync/sync-engine.ts`
- Create: `src/sync/sync-report.ts`
- Create: `tests/sync-engine.test.ts`

**Interfaces:**
- `SyncEngine { sync(): Promise<SyncReport>; pause(): void; resume(): void }`
- `SyncReport { status: "synced" | "conflict" | "offline" | "auth-required"; uploaded: string[]; downloaded: string[]; conflicts: string[]; errors: string[] }`
- Constructor dependencies: `VaultAdapter`, `GoogleDrive`, `ManifestStore`, `Clock`, `deviceId`, and `rootFolderId`.

- [ ] **Step 1: Write failing fake-adapter tests**

Use fake vault, fake Drive, and fake manifest. Assert that a local-only change uploads and updates the manifest; a remote-only change writes local bytes; a conflict writes `_sync-conflicts/` and leaves the original local file unchanged; a thrown network error returns `offline` without changing the base snapshot.

- [ ] **Step 2: Run the test suite to verify it fails**

Run: `npm test`

Expected: FAIL because `SyncEngine` does not exist.

- [ ] **Step 3: Implement inventory, planning, apply, and snapshot update**

Inventory local files and the Drive tree, call `planSync`, apply upload/download/conflict actions, and save a new manifest only after all successful actions. A conflict action writes the remote bytes to the generated path and adds that path to the next inventory; it does not delete either original.

- [ ] **Step 4: Add retry and status mapping**

Retry transient failures twice with short backoff, map 401/403 to `auth-required`, 429/5xx to `offline` after retries, and preserve the previous manifest on failure. Emit status callbacks for the UI.

- [ ] **Step 5: Run the test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sync/sync-engine.ts src/sync/sync-report.ts tests/sync-engine.test.ts
git commit -m "feat: sync local vault with drive"
```

### Task 7: Build the local note index and Related Notes scoring

**Files:**
- Create: `src/core/note-index.ts`
- Create: `src/core/related-notes.ts`
- Create: `src/obsidian/index-watcher.ts`
- Create: `tests/related-notes.test.ts`

**Interfaces:**
- `IndexedNote { path: string; title: string; headings: string[]; tags: string[]; links: string[]; text: string; modifiedAt: number }`
- `NoteIndex { upsert(note: IndexedNote): void; remove(path: string): void; search(query: string, limit: number): IndexedNote[]; related(path: string, limit: number): RelatedNote[] }`
- `RelatedNote { path: string; score: number; reasons: string[] }`

- [ ] **Step 1: Write failing scoring tests**

Assert that shared tags outrank an unrelated note, shared links add a reason, title/body matches are case-insensitive, the active note is excluded, and the result is capped at five entries with stable ordering.

- [ ] **Step 2: Run the test suite to verify it fails**

Run: `npm test`

Expected: FAIL because `NoteIndex` and the scoring functions do not exist.

- [ ] **Step 3: Implement deterministic local scoring**

Tokenize title, headings, tags, and body; score title/headings higher than body, add fixed bonuses for shared tags and links, add a small folder/recency tie-breaker, and return human-readable reasons. Do not add embeddings or network calls.

- [ ] **Step 4: Wire Obsidian events**

Build an initial index from Markdown files, then update on `create`, `modify`, `delete`, and `rename` events. Debounce repeated modifications per path and remove deleted notes.

- [ ] **Step 5: Run the test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/note-index.ts src/core/related-notes.ts src/obsidian/index-watcher.ts tests/related-notes.test.ts
git commit -m "feat: add local related notes index"
```

### Task 8: Add OpenAI and DeepSeek AI adapters and preview-safe commands

**Files:**
- Create: `src/ai/ai-types.ts`
- Create: `src/ai/openai-client.ts`
- Create: `src/ai/deepseek-client.ts`
- Create: `src/ai/context-retriever.ts`
- Create: `src/ai/ai-commands.ts`
- Create: `tests/ai.test.ts`

**Interfaces:**
- `AiProvider = "openai" | "deepseek"`
- `AiSettings { provider: AiProvider; apiKey: string; baseUrl?: string; model: string; maxContextChars: number; maxOutputTokens: number }`
- `AiClient.complete(request: AiRequest): Promise<AiResponse>`
- `ContextRetriever.retrieve(query: string, limit: number): RetrievedNote[]`
- `AiCommands.askVault(query): Promise<AiPreview>`
- `AiCommands.explainRelation(activePath, relatedPath): Promise<AiPreview>`
- `AiCommands.summarizeNote(path): Promise<AiPreview>`
- `AiCommands.extractStructure(path): Promise<AiPreview>`
- `AiCommands.createNote(prompt): Promise<AiPreview>`

- [ ] **Step 1: Write failing provider and command tests**

Use a fake `HttpTransport`. Assert that OpenAI sends only bounded context to its configured endpoint, DeepSeek uses its own base URL and key, provider responses normalize to one `AiResponse`, invalid structured output produces a text-only preview, and no command writes to a vault before `applyPreview()` is called.

- [ ] **Step 2: Run the test suite to verify it fails**

Run: `npm test`

Expected: FAIL because the provider and command modules do not exist.

- [ ] **Step 3: Implement the common provider interface**

Keep transport, endpoint, key, model, and output parsing behind the adapter. Use the OpenAI Responses endpoint for OpenAI and the OpenAI-compatible chat endpoint for DeepSeek. Never include API keys in error text, logs, or preview content.

- [ ] **Step 4: Implement bounded context retrieval**

Use `NoteIndex.search` to select relevant notes, cap total context by `maxContextChars`, include each source path, and exclude `.obsidian` and binary content. `Explain relation` sends only the active note and selected related-note excerpt.

- [ ] **Step 5: Implement preview/apply**

Return a preview object containing title, explanation, proposed tags/tasks/links, and optional new-note content. `applyPreview()` performs only the explicitly approved file operations and rejects a preview whose source file hash changed since generation.

- [ ] **Step 6: Run the test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ai tests/ai.test.ts
git commit -m "feat: add provider agnostic ai commands"
```

### Task 9: Wire Obsidian settings, commands, panels, and responsive styles

**Files:**
- Modify: `src/main.ts`
- Create: `src/obsidian/settings-tab.ts`
- Create: `src/obsidian/related-notes-view.ts`
- Create: `src/obsidian/ask-vault-modal.ts`
- Create: `src/obsidian/preview-modal.ts`
- Create: `src/obsidian/status-bar.ts`
- Create: `styles.css`
- Create: `tests/plugin-wiring.test.ts`

**Interfaces:**
- Commands: `second-brain:sync-now`, `second-brain:ask-vault`, `second-brain:summarize-note`, `second-brain:explain-relation`, `second-brain:extract-structure`, `second-brain:create-note`.
- View type: `second-brain-related-notes`.
- Settings fields: Google client id, Drive folder id, provider, API key, model, sync interval, conflict folder, context limits, paused state.

- [ ] **Step 1: Write failing wiring tests**

Test pure command registration helpers with a fake Plugin instance: all six commands are registered, the Related Notes view type is registered, and the status callback maps sync reports to Synced/Conflict/Offline/Auth required.

- [ ] **Step 2: Run the test suite to verify it fails**

Run: `npm test`

Expected: FAIL because the wiring helpers and UI modules do not exist.

- [ ] **Step 3: Implement settings and first-run setup**

Load defaults, show provider-specific defaults, keep credentials in plugin data, add Re-authenticate/Clear credentials/Pause sync/Sync Now controls, and show the initial sync preview before enabling automatic sync.

- [ ] **Step 4: Implement Related Notes view**

Render the top five local suggestions for the active Markdown file, show reason text, and add an **Explain relation** action for each item. Refresh on active-leaf change and index updates without replacing the native editor.

- [ ] **Step 5: Implement Ask Vault and preview modals**

Ask Vault displays the question, answer, and source note links. Preview modal shows proposed Markdown/tag/task/link changes with **Apply** and **Cancel**. Apply checks the source hash before modifying the vault.

- [ ] **Step 6: Implement status and responsive CSS**

Show sync state in the status bar and Related Notes panel. Use a desktop three-panel layout and stack/collapse panels below 780px. Keep the native editor primary at mobile width; do not add a second editor surface.

- [ ] **Step 7: Run the test suite and build**

Run: `npm test`  
Run: `npm run build`

Expected: PASS and a loadable `main.js`/`styles.css` pair.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/obsidian styles.css tests/plugin-wiring.test.ts main.js
git commit -m "feat: add second brain obsidian ui"
```

### Task 10: Add setup documentation and complete verification

**Files:**
- Create: `README.md`
- Modify: `docs/setup/google-drive.md`
- Modify: `AGENTS.md` only if implementation-specific repository rules are discovered

**Interfaces:**
- Produces a reproducible local setup path: install dependencies, build plugin, copy `manifest.json`, `main.js`, and `styles.css` into an Obsidian vault plugin directory, configure Google Drive and AI provider, and run a two-device smoke test.

- [ ] **Step 1: Write the README acceptance checklist**

Document the commands:

```bash
npm install
npm test
npm run build
```

Document that push is manual and that the plugin requires separate Google/provider configuration on each device.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test`

Expected: all unit and fake-adapter integration tests pass.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: `main.js` and `styles.css` are generated without TypeScript or bundler errors.

- [ ] **Step 4: Perform the manual two-device smoke test**

Create two temporary vaults and one Drive test folder. Configure the plugin on both devices, create a Markdown note and attachment on device A, verify device B receives them, edit the same note offline on both devices, reconnect, verify `_sync-conflicts/` contains the preserved remote version, open Related Notes, run Explain relation, and cancel an AI preview before applying it.

- [ ] **Step 5: Review repository state**

Run: `git status --short --branch`  
Confirm only intended source, docs, and release artifacts are present; `.superpowers/` and test outputs remain ignored.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/setup/google-drive.md
git commit -m "docs: add second brain setup and verification"
```

## Plan self-review

- Spec coverage: sync, conflicts, attachments, local indexing, Related Notes, Explain relation, OpenAI/DeepSeek, preview/apply, responsive UI, setup, error states, and verification each have implementation tasks.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation step is used.
- Type consistency: `FileSnapshot`, `RemoteFile`, `ManifestEntry`, `VaultAdapter`, `ManifestStore`, `SyncEngine`, `NoteIndex`, `AiSettings`, `AiClient`, and command names are defined before later tasks consume them.
- Safety consistency: no task adds automatic conflict deletion or unreviewed AI writes; provider keys and Google tokens remain device-local.
