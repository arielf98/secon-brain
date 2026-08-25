# Cross-Platform Google Drive Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sken Brain synchronize a Google Drive-backed vault from Obsidian desktop and mobile without Obsidian Sync.

**Architecture:** Keep the existing Drive client and sync engine. Replace Electron/Node loopback OAuth with a stateless Cloudflare Worker that exchanges and refreshes Google tokens, while the plugin receives callbacks through the native `obsidian://` protocol and stores tokens locally.

**Tech Stack:** TypeScript, Obsidian API, Cloudflare Workers Web APIs, Google OAuth 2.0, Google Drive REST API, Node built-in test runner, esbuild.

**Spec:** `docs/superpowers/specs/2026-08-25-cross-platform-drive-sync-design.md`

## Global Constraints

- No new runtime or development dependency.
- Never synchronize `.obsidian`, plugin artifacts, OAuth tokens, or AI API keys.
- Worker stores no Google token and proxies no vault file.
- Background sync never opens an authorization browser.
- Desktop and mobile use one cross-platform OAuth implementation.

---

### Task 1: Stateless OAuth Worker

**Files:**
- Create: `worker/src/index.ts`
- Create: `worker/wrangler.toml`
- Create: `tests/sync-worker.test.ts`

**Interfaces:**
- Produces: `handleRequest(request: Request, env: WorkerEnv, fetcher?: typeof fetch, now?: number): Promise<Response>`
- Routes: `GET /oauth/start`, `GET /oauth/callback`, `POST /oauth/exchange`, `POST /oauth/refresh`, `GET /health`

- [ ] **Step 1: Write failing route tests** for Google redirect construction, signed callback state, tamper rejection, code exchange, and refresh.
- [ ] **Step 2: Run `npm test`** and confirm failure because `worker/src/index.ts` is missing.
- [ ] **Step 3: Implement the minimum Worker** with HMAC state signing, Google token requests, callback HTML, CORS, and redacted errors.
- [ ] **Step 4: Run `npm test`** and confirm the Worker tests pass with the existing suite.

### Task 2: Cross-Platform Plugin Authorization

**Files:**
- Modify: `src/integrations/google-auth.ts`
- Modify: `tests/google-http.test.ts`
- Modify: `src/obsidian/settings-tab.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `WorkerGoogleAuth.beginAuthorization(): Promise<void>`
- Produces: `WorkerGoogleAuth.completeAuthorization(params: Record<string, string>): Promise<GoogleToken>`
- Produces: `WorkerGoogleAuth.getAccessToken(): Promise<string>`
- Consumes: Worker `/oauth/start`, `/oauth/exchange`, and `/oauth/refresh`

- [ ] **Step 1: Replace loopback expectations with failing auth bridge tests** covering saved state, callback validation, exchange, refresh, and credential clearing.
- [ ] **Step 2: Run `npm test`** and confirm failures identify the missing cross-platform auth behavior.
- [ ] **Step 3: Implement `WorkerGoogleAuth`** using Web Crypto, injected HTTP transport, local token/state stores, and an injected browser opener.
- [ ] **Step 4: Wire settings and `registerObsidianProtocolHandler("sken-brain-auth", ...)`** so authorization is explicit and a successful callback starts sync.
- [ ] **Step 5: Run `npm test`** and confirm the auth and existing sync suites pass.

### Task 3: Mobile Manifest, Build, and Setup

**Files:**
- Modify: `manifest.json`
- Modify: `esbuild.config.mjs`
- Delete: `src/electron.d.ts`
- Modify: `tsconfig.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/setup/google-drive.md`

**Interfaces:**
- Produces: a browser-only Obsidian bundle with `isDesktopOnly: false`
- Produces: documented Worker and Google Cloud setup commands

- [ ] **Step 1: Set `isDesktopOnly` to false** and remove Electron/Node externals and declarations.
- [ ] **Step 2: Include Worker sources in typecheck** and add a `typecheck` script without adding dependencies.
- [ ] **Step 3: Document Worker deployment, OAuth callback registration, per-device authorization, and mobile installation.**
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, and `npm run build`.**
- [ ] **Step 5: Inspect `main.js`** and confirm it contains no `require("electron")` or `require("node:http")`.
