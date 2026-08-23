"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SecondBrainPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");
var import_electron = require("electron");

// src/integrations/http.ts
var HttpError = class extends Error {
  constructor(message, status, response) {
    super(message);
    this.status = status;
    this.response = response;
    this.name = "HttpError";
  }
};
var AuthRequiredError = class extends HttpError {
  constructor(response) {
    super("Google authorization is required", response.status, response);
    this.name = "AuthRequiredError";
  }
};
var RateLimitError = class extends HttpError {
  constructor(response) {
    super("Google request was rate limited", response.status, response);
    this.name = "RateLimitError";
  }
};
var TransientHttpError = class extends HttpError {
  constructor(response) {
    super("A temporary HTTP error occurred", response.status, response);
    this.name = "TransientHttpError";
  }
};
function requireSuccess(response) {
  if (response.status === 401 || response.status === 403) {
    throw new AuthRequiredError(response);
  }
  if (response.status === 429) {
    throw new RateLimitError(response);
  }
  if (response.status >= 500) {
    throw new TransientHttpError(response);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HttpError(`HTTP request failed with status ${response.status}`, response.status, response);
  }
  return response;
}
function responseText(response) {
  return new TextDecoder().decode(new Uint8Array(response.body));
}
function responseJson(response) {
  return JSON.parse(responseText(response));
}

// src/ai/openai-client.ts
var DEFAULT_BASE_URL = "https://api.openai.com/v1";
var OpenAiClient = class {
  constructor(settings, transport) {
    this.settings = settings;
    this.transport = transport;
  }
  async complete(request) {
    var _a, _b, _c, _d;
    const response = await this.transport.request({
      method: "POST",
      url: `${baseUrl(this.settings.baseUrl, DEFAULT_BASE_URL)}/responses`,
      headers: {
        Authorization: `Bearer ${this.settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.settings.model,
        input: [
          ...request.system ? [{ role: "system", content: [{ type: "input_text", text: request.system }] }] : [],
          { role: "user", content: [{ type: "input_text", text: request.prompt }] }
        ],
        max_output_tokens: (_a = request.maxOutputTokens) != null ? _a : this.settings.maxOutputTokens
      })
    });
    const payload = responseJson(requireSuccess(response));
    const text = (_d = (_c = payload.output_text) != null ? _c : (_b = payload.output) == null ? void 0 : _b.flatMap((item) => {
      var _a2;
      return (_a2 = item.content) != null ? _a2 : [];
    }).map((item) => {
      var _a2;
      return (_a2 = item.text) != null ? _a2 : "";
    }).join("")) != null ? _d : "";
    return { text };
  }
};
function baseUrl(value, fallback) {
  return (value || fallback).replace(/\/$/, "");
}

// src/ai/deepseek-client.ts
var DEFAULT_BASE_URL2 = "https://api.deepseek.com";
var DeepSeekClient = class {
  constructor(settings, transport) {
    this.settings = settings;
    this.transport = transport;
  }
  async complete(request) {
    var _a, _b, _c, _d, _e;
    const messages = [
      ...request.system ? [{ role: "system", content: request.system }] : [],
      { role: "user", content: request.prompt }
    ];
    const response = await this.transport.request({
      method: "POST",
      url: `${baseUrl(this.settings.baseUrl, DEFAULT_BASE_URL2)}/chat/completions`,
      headers: {
        Authorization: `Bearer ${this.settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages,
        max_tokens: (_a = request.maxOutputTokens) != null ? _a : this.settings.maxOutputTokens
      })
    });
    const payload = responseJson(requireSuccess(response));
    return { text: (_e = (_d = (_c = (_b = payload.choices) == null ? void 0 : _b[0]) == null ? void 0 : _c.message) == null ? void 0 : _d.content) != null ? _e : "" };
  }
};

// src/core/paths.ts
var TEMP_FILE_PATTERNS = [/~$/, /\.swp$/i, /\.tmp$/i, /\.lock$/i];
function normalizeVaultPath(path) {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const clean = normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".").join("/");
  if (!clean) {
    throw new Error("empty path");
  }
  return clean;
}
function isSyncablePath(path) {
  try {
    const normalized = normalizeVaultPath(path);
    const lower = normalized.toLowerCase();
    if (lower === ".obsidian" || lower.startsWith(".obsidian/")) return false;
    if (lower === ".trash" || lower.startsWith(".trash/")) return false;
    return !TEMP_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
  } catch {
    return false;
  }
}

// src/core/hash.ts
async function sha256(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// src/ai/ai-commands.ts
var AiCommands = class {
  constructor(client, context, vault, settings) {
    this.client = client;
    this.context = context;
    this.vault = vault;
    this.settings = settings;
  }
  async askVault(query) {
    const sources = this.context.retrieve(query, 10);
    const response = await this.client.complete(this.request(
      "Answer using only the supplied local vault excerpts. Cite source paths in the answer.",
      `Question: ${query}

${formatContext(sources, this.settings.maxContextChars)}`
    ));
    return this.preview("ask-vault", "Ask Vault", response.text, sources.map((source) => source.path));
  }
  async explainRelation(activePath, relatedPath) {
    const sources = [this.context.get(activePath), this.context.get(relatedPath)].filter((source) => !!source);
    if (sources.length < 2) throw new Error("Both notes must be indexed before explaining their relation");
    const response = await this.client.complete(this.request(
      "Explain the contextual relationship between these two local notes. Suggest a backlink only as a proposal.",
      formatContext(sources, this.settings.maxContextChars)
    ));
    return this.preview("explain-relation", "Explain relation", response.text, sources.map((source) => source.path));
  }
  async summarizeNote(path) {
    const source = this.requireNote(path);
    const response = await this.client.complete(this.request("Summarize this local note clearly and briefly.", formatContext([source], this.settings.maxContextChars)));
    return this.preview("summarize-note", `Summarize ${source.title}`, response.text, [path]);
  }
  async extractStructure(path) {
    const source = this.requireNote(path);
    const response = await this.client.complete(this.request(
      "Return JSON only with arrays named tags, tasks, and links. Do not invent content outside this note.",
      formatContext([source], this.settings.maxContextChars)
    ));
    const proposed = parseStructure(response.text);
    const changes = [];
    if (proposed) {
      const current = await this.vault.read(path);
      const currentText = new TextDecoder().decode(new Uint8Array(current));
      changes.push({
        path,
        content: appendStructure(currentText, proposed),
        expectedHash: await sha256(current),
        mode: "replace"
      });
    }
    return {
      ...this.preview("extract-structure", `Extract structure from ${source.title}`, response.text, [path]),
      proposed,
      changes
    };
  }
  async createNote(prompt) {
    const response = await this.client.complete(this.request(
      "Return JSON only with string fields title and content for a new Markdown note.",
      prompt
    ));
    const draft = parseDraft(response.text);
    const changes = draft ? [{ path: `Notes/${safeFileName(draft.title)}.md`, content: draft.content, mode: "create" }] : [];
    return {
      ...this.preview("create-note", "Create note from prompt", response.text, []),
      changes
    };
  }
  async applyPreview(preview) {
    for (const change of preview.changes) {
      if (!isSyncablePath(change.path)) throw new Error(`Unsafe AI output path: ${change.path}`);
      const files = await this.vault.listFiles();
      const existing = files.find((file) => file.path === change.path);
      if (change.mode === "create" && existing) throw new Error(`AI note already exists: ${change.path}`);
      if (change.expectedHash && (existing == null ? void 0 : existing.hash) !== change.expectedHash) throw new Error(`${change.path} changed since preview`);
      if (change.expectedHash && !existing) throw new Error(`${change.path} changed since preview`);
      await this.vault.write(change.path, new TextEncoder().encode(change.content).buffer);
    }
  }
  requireNote(path) {
    const note = this.context.get(path);
    if (!note) throw new Error(`Note is not indexed: ${path}`);
    return note;
  }
  request(system, prompt) {
    return { system, prompt, maxOutputTokens: this.settings.maxOutputTokens };
  }
  preview(type, title, text, sources) {
    return { type, title, text, sources, changes: [] };
  }
};
function formatContext(sources, maxChars) {
  const chunks = [];
  let remaining = Math.max(0, maxChars);
  for (const source of sources) {
    if (remaining <= 0) break;
    const header = `[${source.path}]
`;
    const chunk = `${header}${source.excerpt}`.slice(0, remaining);
    chunks.push(chunk);
    remaining -= chunk.length;
  }
  return chunks.join("\n\n");
}
function parseStructure(text) {
  const value = parseJson(text);
  if (!value || typeof value !== "object") return void 0;
  const candidate = value;
  if (!Array.isArray(candidate.tags) || !Array.isArray(candidate.tasks) || !Array.isArray(candidate.links)) return void 0;
  if (![...candidate.tags, ...candidate.tasks, ...candidate.links].some((item) => typeof item !== "string")) {
    return { tags: candidate.tags, tasks: candidate.tasks, links: candidate.links };
  }
  return void 0;
}
function parseDraft(text) {
  const value = parseJson(text);
  if (!value || typeof value !== "object") return void 0;
  const candidate = value;
  return typeof candidate.title === "string" && candidate.title.trim() && typeof candidate.content === "string" ? { title: candidate.title.trim(), content: candidate.content } : void 0;
}
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function safeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "untitled";
}
function appendStructure(content, structure) {
  const section = [
    "## AI Suggestions",
    ...structure.tags.length ? ["", "Tags", ...structure.tags.map((tag) => `- ${tag}`)] : [],
    ...structure.tasks.length ? ["", "Tasks", ...structure.tasks.map((task) => `- [ ] ${task}`)] : [],
    ...structure.links.length ? ["", "Links", ...structure.links.map((link) => `- [[${link}]]`)] : []
  ].join("\n");
  return `${content.replace(/\s*$/, "")}

${section}
`;
}

// src/ai/context-retriever.ts
var LocalContextRetriever = class {
  constructor(index, excerptChars = 2e3) {
    this.index = index;
    this.excerptChars = excerptChars;
  }
  retrieve(query, limit) {
    return this.index.search(query, limit).map((note) => this.fromNote(note));
  }
  get(path) {
    const note = this.index.get(path);
    return note ? this.fromNote(note) : void 0;
  }
  fromNote(note) {
    return {
      path: note.path,
      title: note.title,
      excerpt: note.text.slice(0, this.excerptChars)
    };
  }
};

// src/core/related-notes.ts
function scoreRelated(active, candidate) {
  const titleOverlap = overlap(tokens(active.title), tokens(candidate.title));
  const headingOverlap = overlap(tokens(active.headings.join(" ")), tokens(candidate.headings.join(" ")));
  const bodyOverlap = overlap(tokens(active.text), tokens(candidate.text));
  const sharedTags = overlap(new Set(active.tags.map(normalize)), new Set(candidate.tags.map(normalize)));
  const linked = active.links.some(linkMatches(candidate.path)) || candidate.links.some(linkMatches(active.path));
  let score = titleOverlap.size * 5 + headingOverlap.size * 3 + bodyOverlap.size;
  if (sharedTags.size) score += sharedTags.size * 6;
  if (linked) score += 8;
  if (folderOf(active.path) === folderOf(candidate.path)) score += 1;
  score += Math.max(0, 0.1 - Math.abs(active.modifiedAt - candidate.modifiedAt) / 864e6);
  const reasons = [];
  if (sharedTags.size) reasons.push("shared tags");
  if (linked) reasons.push("linked notes");
  if (titleOverlap.size || headingOverlap.size) reasons.push("similar title/headings");
  if (bodyOverlap.size) reasons.push("shared keywords");
  if (folderOf(active.path) === folderOf(candidate.path)) reasons.push("same folder");
  return { path: candidate.path, score, reasons };
}
function findRelated(active, candidates, limit) {
  return [...candidates].filter((candidate) => candidate.path !== active.path).map((candidate) => scoreRelated(active, candidate)).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, Math.max(0, limit));
}
function tokens(value) {
  return new Set(value.toLowerCase().split(/[^a-z0-9À-ÿ]+/i).filter((token) => token.length > 1));
}
function overlap(left, right) {
  return new Set([...left].filter((item) => right.has(item)));
}
function normalize(value) {
  return value.trim().replace(/^#/, "").toLowerCase();
}
function folderOf(path) {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}
function linkMatches(target) {
  var _a;
  const normalizedTarget = target.replace(/\.md$/i, "").toLowerCase();
  const targetBasename = (_a = normalizedTarget.split("/").pop()) != null ? _a : normalizedTarget;
  return (link) => {
    var _a2;
    const normalizedLink = link.replace(/^\.[/\\]/, "").replace(/\.md$/i, "").toLowerCase();
    return normalizedLink === normalizedTarget || ((_a2 = normalizedLink.split("/").pop()) != null ? _a2 : normalizedLink) === targetBasename;
  };
}

// src/core/note-index.ts
var NoteIndex = class {
  constructor() {
    this.notes = /* @__PURE__ */ new Map();
  }
  upsert(note) {
    this.notes.set(note.path, {
      ...note,
      headings: [...note.headings],
      tags: [...note.tags],
      links: [...note.links]
    });
  }
  remove(path) {
    this.notes.delete(path);
  }
  get(path) {
    return this.notes.get(path);
  }
  search(query, limit) {
    const queryTokens = tokens(query);
    if (!queryTokens.size) return [];
    return [...this.notes.values()].map((note) => ({ note, score: searchScore(note, queryTokens) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path)).slice(0, Math.max(0, limit)).map((item) => item.note);
  }
  related(path, limit) {
    const active = this.notes.get(path);
    return active ? findRelated(active, this.notes.values(), limit) : [];
  }
};
function searchScore(note, query) {
  const title = overlapCount(tokens(note.title), query);
  const headings = overlapCount(tokens(note.headings.join(" ")), query);
  const tags = overlapCount(new Set(note.tags.map((tag) => tag.replace(/^#/, "").toLowerCase())), query);
  const body = overlapCount(tokens(note.text), query);
  return title * 8 + headings * 4 + tags * 3 + body;
}
function overlapCount(left, right) {
  return [...left].filter((token) => right.has(token)).length;
}

// src/integrations/google-auth.ts
var import_node_http = require("node:http");
var AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
var TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
var DEFAULT_SCOPE = "https://www.googleapis.com/auth/drive";
var OAuthAuthorizationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OAuthAuthorizationError";
  }
};
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function createPkcePair() {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64Url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}
function buildAuthorizationUrl(config, redirectUri, state, challenge) {
  var _a;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: (((_a = config.scopes) == null ? void 0 : _a.length) ? config.scopes : [DEFAULT_SCOPE]).join(" "),
    state,
    access_type: "offline",
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent"
  });
  return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}
function parseAuthorizationResponse(callbackUrl, expectedState) {
  const params = new URL(callbackUrl).searchParams;
  const error = params.get("error");
  if (error) throw new OAuthAuthorizationError(`Google authorization failed: ${error}`);
  const state = params.get("state");
  const code = params.get("code");
  if (!state || state !== expectedState) throw new OAuthAuthorizationError("Google authorization state did not match");
  if (!code) throw new OAuthAuthorizationError("Google authorization did not return a code");
  return { code, state };
}
function tokenFromResponse(value, refreshToken) {
  var _a, _b;
  if (!value.access_token) throw new OAuthAuthorizationError("Google token response did not include an access token");
  return {
    accessToken: value.access_token,
    refreshToken: (_a = value.refresh_token) != null ? _a : refreshToken,
    expiresAt: Date.now() + ((_b = value.expires_in) != null ? _b : 3600) * 1e3
  };
}
var GoogleAuthClient = class {
  constructor(config, transport) {
    this.config = config;
    this.transport = transport;
  }
  async exchangeCode(code, verifier, redirectUri) {
    const response = await this.transport.request({
      method: "POST",
      url: TOKEN_ENDPOINT,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier
      }).toString()
    });
    return tokenFromResponse(responseJson(requireSuccess(response)));
  }
  async refreshAccessToken(refreshToken) {
    const response = await this.transport.request({
      method: "POST",
      url: TOKEN_ENDPOINT,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        grant_type: "refresh_token"
      }).toString()
    });
    return tokenFromResponse(responseJson(requireSuccess(response)), refreshToken);
  }
};
var LoopbackGoogleAuth = class {
  constructor(config, transport, tokenStore, openExternal) {
    this.config = config;
    this.transport = transport;
    this.tokenStore = tokenStore;
    this.openExternal = openExternal;
  }
  async authorize() {
    const pkce = await createPkcePair();
    const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
    let callbackUrl = "";
    const server = (0, import_node_http.createServer)((request, response) => {
      var _a;
      callbackUrl = `http://127.0.0.1:${port}${(_a = request.url) != null ? _a : "/"}`;
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("Sken Brain authorization complete. You can close this window.");
    });
    let port = 0;
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new OAuthAuthorizationError("Could not open the Google OAuth callback"));
            return;
          }
          port = address.port;
          resolve();
        });
      });
      const redirectUri = `http://127.0.0.1:${port}`;
      await this.openExternal(buildAuthorizationUrl(this.config, redirectUri, state, pkce.challenge));
      const callback = await waitForCallback(server, () => callbackUrl);
      const authorization = parseAuthorizationResponse(callback, state);
      const token = await new GoogleAuthClient(this.config, this.transport).exchangeCode(authorization.code, pkce.verifier, redirectUri);
      await this.tokenStore.save(token);
      return token;
    } finally {
      server.close();
    }
  }
  async refresh(token) {
    if (!token.refreshToken) throw new OAuthAuthorizationError("Google authorization has no refresh token");
    const refreshed = await new GoogleAuthClient(this.config, this.transport).refreshAccessToken(token.refreshToken);
    await this.tokenStore.save(refreshed);
    return refreshed;
  }
  async clear() {
    await this.tokenStore.clear();
  }
  async getAccessToken() {
    const token = await this.tokenStore.load();
    if (!token) throw new OAuthAuthorizationError("Google authorization is required");
    if (token.expiresAt > Date.now() + 6e4) return token.accessToken;
    return (await this.refresh(token)).accessToken;
  }
};
function waitForCallback(server, getUrl) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const url = getUrl();
      if (!url) return;
      clearInterval(timer);
      resolve(url);
    }, 25);
    server.once("error", (error) => {
      clearInterval(timer);
      reject(error);
    });
  });
}

// src/integrations/google-drive.ts
var DRIVE_API = "https://www.googleapis.com/drive/v3/files";
var DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
var FOLDER_MIME = "application/vnd.google-apps.folder";
function remoteHash(file) {
  var _a, _b, _c;
  return (_c = file.md5Checksum) != null ? _c : `${(_a = file.modifiedTime) != null ? _a : ""}:${(_b = file.size) != null ? _b : "0"}`;
}
function isDownloadable(file) {
  return file.mimeType !== FOLDER_MIME && !file.mimeType.startsWith("application/vnd.google-apps.");
}
function escapeQueryValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}
function basename(path) {
  var _a;
  return (_a = path.split("/").pop()) != null ? _a : path;
}
var GoogleDriveClient = class {
  constructor(transport, getAccessToken) {
    this.transport = transport;
    this.getAccessToken = getAccessToken;
  }
  async request(request) {
    var _a;
    const token = await this.getAccessToken();
    return requireSuccess(await this.transport.request({
      ...request,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(_a = request.headers) != null ? _a : {}
      }
    }));
  }
  async listChildren(parentId, queryExtra = "") {
    var _a;
    const files = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        q: `'${parentId}' in parents and trashed = false${queryExtra}`,
        fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents)",
        pageSize: "1000"
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await this.request({ method: "GET", url: `${DRIVE_API}?${params.toString()}` });
      const page = responseJson(response);
      files.push(...(_a = page.files) != null ? _a : []);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }
  async listTree(rootId) {
    const result = [];
    const walk = async (parentId, prefix) => {
      var _a;
      for (const file of await this.listChildren(parentId)) {
        const path = normalizeVaultPath(prefix ? `${prefix}/${file.name}` : file.name);
        if (file.mimeType === FOLDER_MIME) {
          await walk(file.id, path);
        } else if (isDownloadable(file)) {
          result.push({
            path,
            hash: remoteHash(file),
            size: Number((_a = file.size) != null ? _a : 0),
            modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
            driveId: file.id,
            mimeType: file.mimeType
          });
        }
      }
    };
    await walk(rootId, "");
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
  async download(driveId) {
    const response = await this.request({ method: "GET", url: `${DRIVE_API}/${encodeURIComponent(driveId)}?alt=media` });
    return new Uint8Array(response.body);
  }
  async upload(path, bytes, parentId, mimeType2) {
    const boundary = `second-brain-${Date.now().toString(36)}`;
    const metadata = jsonBytes({ name: basename(path), parents: [parentId], mimeType: mimeType2 });
    const line = new TextEncoder().encode;
    const body = concatBytes(
      line(`--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
`),
      metadata,
      line(`\r
--${boundary}\r
Content-Type: ${mimeType2}\r
\r
`),
      bytes,
      line(`\r
--${boundary}--\r
`)
    );
    const response = await this.request({
      method: "POST",
      url: `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,mimeType,md5Checksum,modifiedTime,size`,
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    });
    const file = responseJson(response);
    return { driveId: file.id, hash: remoteHash(file) };
  }
  async update(driveId, bytes, mimeType2) {
    const response = await this.request({
      method: "PATCH",
      url: `${DRIVE_UPLOAD_API}/${encodeURIComponent(driveId)}?uploadType=media&fields=id,name,mimeType,md5Checksum,modifiedTime,size`,
      headers: { "Content-Type": mimeType2 },
      body: bytes
    });
    const file = responseJson(response);
    return { driveId: file.id, hash: remoteHash(file) };
  }
  async ensureFolder(path, rootId) {
    let parentId = rootId;
    const parts = normalizeVaultPath(path).split("/").filter(Boolean);
    for (const part of parts) {
      const matches = await this.listChildren(
        parentId,
        ` and name = '${escapeQueryValue(part)}' and mimeType = '${FOLDER_MIME}'`
      );
      const existing = matches[0];
      if (existing) {
        parentId = existing.id;
        continue;
      }
      const response = await this.request({
        method: "POST",
        url: DRIVE_API,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: part, mimeType: FOLDER_MIME, parents: [parentId] })
      });
      parentId = responseJson(response).id;
    }
    return parentId;
  }
};

// src/obsidian/request-transport.ts
var import_obsidian = require("obsidian");
var ObsidianRequestTransport = class {
  async request(request) {
    const body = request.body instanceof Uint8Array ? request.body.buffer.slice(request.body.byteOffset, request.body.byteOffset + request.body.byteLength) : request.body;
    const response = await (0, import_obsidian.requestUrl)({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body,
      throw: false
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.arrayBuffer
    };
  }
};

// src/obsidian/index-watcher.ts
var ObsidianIndexWatcher = class {
  constructor(app, index, registerEvent, debounceMs = 200) {
    this.app = app;
    this.index = index;
    this.registerEvent = registerEvent;
    this.debounceMs = debounceMs;
    this.timers = /* @__PURE__ */ new Map();
  }
  async start() {
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
  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
  schedule(file) {
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
  clearTimer(path) {
    const timer = this.timers.get(path);
    if (timer) clearTimeout(timer);
    this.timers.delete(path);
  }
  async indexFile(file) {
    var _a, _b, _c;
    if (!isSyncablePath(file.path) || file.extension.toLowerCase() !== "md") return;
    const text = await this.app.vault.read(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const note = {
      path: file.path,
      title: file.basename,
      headings: ((_a = cache == null ? void 0 : cache.headings) != null ? _a : []).map((heading) => heading.heading),
      tags: ((_b = cache == null ? void 0 : cache.tags) != null ? _b : []).map((tag) => tag.tag),
      links: ((_c = cache == null ? void 0 : cache.links) != null ? _c : []).map((link) => link.link),
      text,
      modifiedAt: file.stat.mtime
    };
    this.index.upsert(note);
  }
};
function isMarkdownFile(file) {
  return "extension" in file && typeof file.extension === "string" && file.extension.toLowerCase() === "md" && isSyncablePath(file.path);
}

// src/obsidian/ask-vault-modal.ts
var import_obsidian2 = require("obsidian");

// src/obsidian/ai-request.ts
async function runAiRequest(request, onState) {
  onState({ status: "loading" });
  try {
    onState({ status: "ready", value: await request() });
  } catch (error) {
    onState({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

// src/obsidian/ask-vault-modal.ts
var AskVaultModal = class extends import_obsidian2.Modal {
  constructor(app, ask) {
    super(app);
    this.ask = ask;
  }
  onOpen() {
    this.renderForm();
  }
  onClose() {
    var _a;
    (_a = this.markdownComponent) == null ? void 0 : _a.unload();
    this.contentEl.empty();
  }
  renderForm() {
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
        askButton.setText(state.status === "loading" ? "Processing\u2026" : "Ask");
        if (state.status === "loading") {
          const spinner = answer.createSpan({ cls: "sken-brain-ai-spinner" });
          spinner.setAttribute("aria-hidden", "true");
          answer.createSpan({ text: "AI sedang memproses\u2026" });
        } else if (state.status === "error") {
          answer.addClass("sken-brain-ai-status-error");
          answer.setText(state.message);
        } else {
          this.renderAnswer(answer, state.value);
        }
      });
    });
  }
  renderAnswer(container, preview) {
    var _a;
    (_a = this.markdownComponent) == null ? void 0 : _a.unload();
    this.markdownComponent = new import_obsidian2.Component();
    this.markdownComponent.load();
    const result = container.createDiv({ cls: "sken-brain-ai-markdown" });
    void import_obsidian2.MarkdownRenderer.render(this.app, preview.text, result, "", this.markdownComponent).catch((error) => {
      container.setText(error instanceof Error ? error.message : String(error));
    });
    if (preview.sources.length) container.createEl("small", { text: `Sources: ${preview.sources.join(", ")}` });
  }
};

// src/obsidian/preview-modal.ts
var import_obsidian3 = require("obsidian");
var PreviewModal = class extends import_obsidian3.Modal {
  constructor(app, loadingTitle, apply) {
    super(app);
    this.apply = apply;
    this.loadingTitle = loadingTitle;
  }
  onOpen() {
    this.renderLayout();
    this.setState({ status: "loading" });
  }
  onClose() {
    var _a;
    (_a = this.markdownComponent) == null ? void 0 : _a.unload();
    this.contentEl.empty();
  }
  setState(state) {
    var _a, _b;
    if (!this.bodyEl || !this.applyButton) return;
    (_a = this.markdownComponent) == null ? void 0 : _a.unload();
    this.markdownComponent = void 0;
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
    (_b = this.headingEl) == null ? void 0 : _b.setText(state.value.title);
    this.renderPreview(state.value);
    this.applyButton.style.display = "";
    this.applyButton.disabled = false;
  }
  renderLayout() {
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
  renderLoading() {
    const spinner = this.statusEl.createSpan({ cls: "sken-brain-ai-spinner" });
    spinner.setAttribute("aria-hidden", "true");
    this.statusEl.createSpan({ text: "AI sedang memproses\u2026" });
  }
  renderError(message) {
    this.statusEl.addClass("sken-brain-ai-status-error");
    this.statusEl.createSpan({ text: message });
  }
  showError(message) {
    this.statusEl.empty();
    this.statusEl.className = "sken-brain-ai-status sken-brain-ai-status-error";
    this.statusEl.createSpan({ text: message });
  }
  renderPreview(preview) {
    const result = this.bodyEl.createDiv({ cls: "sken-brain-ai-result" });
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
  renderProposedStructure(container, proposed) {
    const groups = [
      ["Tags", proposed.tags],
      ["Tasks", proposed.tasks],
      ["Links", proposed.links]
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
  renderMarkdown(markdown, container) {
    var _a;
    (_a = this.markdownComponent) == null ? void 0 : _a.unload();
    this.markdownComponent = new import_obsidian3.Component();
    this.markdownComponent.load();
    void import_obsidian3.MarkdownRenderer.render(this.app, markdown, container, "", this.markdownComponent).catch((error) => {
      this.showError(error instanceof Error ? error.message : String(error));
    });
  }
};

// src/obsidian/related-notes-view.ts
var import_obsidian4 = require("obsidian");

// src/obsidian/plugin-wiring.ts
var RELATED_NOTES_VIEW_TYPE = "sken-brain-related-notes";
function registerSecondBrainCommands(plugin, actions, createRelatedView) {
  const commands = [
    ["sken-brain:sync-now", "Sync Now", actions.syncNow],
    ["sken-brain:ask-vault", "Ask Vault", actions.askVault],
    ["sken-brain:summarize-note", "Summarize Note", actions.summarizeNote],
    ["sken-brain:explain-relation", "Explain relation", actions.explainRelation],
    ["sken-brain:extract-structure", "Extract structure", actions.extractStructure],
    ["sken-brain:create-note", "Create note from prompt", actions.createNote]
  ];
  for (const [id, name, callback] of commands) plugin.addCommand({ id, name, callback });
  plugin.registerView(RELATED_NOTES_VIEW_TYPE, createRelatedView);
}
function statusLabel(status) {
  if (status === "auth-required") return "Auth required";
  return status[0].toUpperCase() + status.slice(1);
}

// src/obsidian/related-notes-view.ts
var RelatedNotesView = class extends import_obsidian4.ItemView {
  constructor(leaf, index, onExplain) {
    super(leaf);
    this.index = index;
    this.onExplain = onExplain;
    this.activePath = "";
  }
  getViewType() {
    return RELATED_NOTES_VIEW_TYPE;
  }
  getDisplayText() {
    return "Related Notes";
  }
  async onOpen() {
    this.render();
  }
  async onClose() {
    this.contentEl.empty();
  }
  refresh(path) {
    this.activePath = path;
    this.render();
  }
  render() {
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
      card.createEl("p", { text: item.reasons.join(" \xB7 ") });
      card.createEl("button", { text: "Explain relation", cls: "sken-brain-compact-button" }).addEventListener("click", () => void this.onExplain(this.activePath, item.path));
    }
  }
};

// src/obsidian/settings-tab.ts
var import_obsidian5 = require("obsidian");
var DEFAULT_SETTINGS = {
  googleClientId: "",
  driveFolderId: "",
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  model: "gpt-4o-mini",
  syncIntervalMinutes: 5,
  conflictFolder: "_sync-conflicts",
  maxContextChars: 12e3,
  maxOutputTokens: 800,
  paused: false,
  deviceId: ""
};
function normalizeSettings(value) {
  const candidate = value && typeof value === "object" && "settings" in value ? value.settings : value;
  const settings = candidate && typeof candidate === "object" ? candidate : {};
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    provider: settings.provider === "deepseek" ? "deepseek" : "openai",
    syncIntervalMinutes: positiveNumber(settings.syncIntervalMinutes, DEFAULT_SETTINGS.syncIntervalMinutes),
    maxContextChars: positiveNumber(settings.maxContextChars, DEFAULT_SETTINGS.maxContextChars),
    maxOutputTokens: positiveNumber(settings.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens)
  };
}
var SecondBrainSettingTab = class extends import_obsidian5.PluginSettingTab {
  constructor(app, plugin, getSettings, saveSettings, actions) {
    super(app, plugin);
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.actions = actions;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Sken Brain" });
    const settings = this.getSettings();
    const update = async (patch) => {
      Object.assign(settings, patch);
      await this.saveSettings(settings);
    };
    new import_obsidian5.Setting(containerEl).setName("Google desktop client ID").setDesc("Stored locally on this device.").addText((text) => text.setValue(settings.googleClientId).onChange((value) => update({ googleClientId: value.trim() })));
    new import_obsidian5.Setting(containerEl).setName("Drive folder ID").setDesc("The Google Drive folder mirrored by this vault.").addText((text) => text.setValue(settings.driveFolderId).onChange((value) => update({ driveFolderId: value.trim() })));
    new import_obsidian5.Setting(containerEl).setName("Google authorization").addButton((button) => button.setButtonText("Re-authenticate").onClick(() => this.actions.reauthenticate())).addButton((button) => button.setButtonText("Clear credentials").onClick(() => this.actions.clearCredentials()));
    new import_obsidian5.Setting(containerEl).setName("AI provider").addDropdown((dropdown) => dropdown.addOption("openai", "OpenAI").addOption("deepseek", "DeepSeek").setValue(settings.provider).onChange((value) => update({ provider: value })));
    new import_obsidian5.Setting(containerEl).setName("API key").setDesc("Stored locally and never synced.").addText((text) => {
      text.setValue(settings.apiKey).onChange((value) => update({ apiKey: value }));
      text.inputEl.type = "password";
    });
    new import_obsidian5.Setting(containerEl).setName("Base URL").setDesc("Optional OpenAI-compatible API base URL.").addText((text) => text.setValue(settings.baseUrl).onChange((value) => update({ baseUrl: value.trim() })));
    new import_obsidian5.Setting(containerEl).setName("Model").addText((text) => text.setValue(settings.model).onChange((value) => update({ model: value.trim() })));
    new import_obsidian5.Setting(containerEl).setName("Sync interval (minutes)").addText((text) => text.setValue(String(settings.syncIntervalMinutes)).onChange((value) => update({ syncIntervalMinutes: positiveNumber(Number(value), settings.syncIntervalMinutes) })));
    new import_obsidian5.Setting(containerEl).setName("Conflict folder").addText((text) => text.setValue(settings.conflictFolder).onChange((value) => update({ conflictFolder: value.trim() || DEFAULT_SETTINGS.conflictFolder })));
    new import_obsidian5.Setting(containerEl).setName("Maximum AI context characters").addText((text) => text.setValue(String(settings.maxContextChars)).onChange((value) => update({ maxContextChars: positiveNumber(Number(value), settings.maxContextChars) })));
    new import_obsidian5.Setting(containerEl).setName("Maximum AI output tokens").addText((text) => text.setValue(String(settings.maxOutputTokens)).onChange((value) => update({ maxOutputTokens: positiveNumber(Number(value), settings.maxOutputTokens) })));
    new import_obsidian5.Setting(containerEl).setName("Pause sync").addToggle((toggle) => toggle.setValue(settings.paused).onChange((value) => update({ paused: value })));
    new import_obsidian5.Setting(containerEl).setName("Sync now").addButton((button) => button.setButtonText("Sync Now").onClick(() => this.actions.syncNow()));
  }
};
function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

// src/obsidian/status-bar.ts
var SyncStatusBar = class {
  constructor(element) {
    this.element = element;
  }
  setReport(report) {
    this.element.setText(statusLabel(report.status));
    this.element.dataset.syncStatus = report.status;
    this.element.title = report.errors.join("\n") || `${report.uploaded.length} uploaded, ${report.downloaded.length} downloaded`;
  }
  setText(text) {
    this.element.setText(text);
  }
};

// src/sync/manifest-store.ts
var DataManifestStore = class {
  constructor(loadData, saveData) {
    this.loadData = loadData;
    this.saveData = saveData;
  }
  async load() {
    const value = await this.loadData();
    if (!isStoredManifest(value)) return {};
    return value.entries;
  }
  async save(entries) {
    const value = { version: 1, entries };
    await this.saveData(value);
  }
  async clear() {
    await this.saveData(void 0);
  }
};
function isStoredManifest(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return candidate.version === 1 && !!candidate.entries && typeof candidate.entries === "object";
}

// src/core/conflicts.ts
function makeConflictPath(path, deviceId, now) {
  var _a;
  const normalized = normalizeVaultPath(path);
  const segments = normalized.split("/");
  const filename = (_a = segments.pop()) != null ? _a : normalized;
  const extensionIndex = filename.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const stem = hasExtension ? filename.slice(0, extensionIndex) : filename;
  const extension = hasExtension ? filename.slice(extensionIndex) : "";
  const safeDeviceId = deviceId.replace(/[^a-z0-9_-]+/gi, "-");
  const iso = new Date(now).toISOString();
  const timestamp = `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
  const folder = segments.length > 0 ? `${segments.join("/")}/` : "";
  return `_sync-conflicts/${folder}${stem} (conflict-${safeDeviceId}-${timestamp})${extension}`;
}

// src/core/sync-plan.ts
function planSync(snapshot, deviceId, now) {
  const paths = /* @__PURE__ */ new Set([
    ...Object.keys(snapshot.local),
    ...Object.keys(snapshot.remote),
    ...Object.keys(snapshot.base)
  ]);
  return [...paths].sort().map((path) => {
    const local = snapshot.local[path];
    const remote = snapshot.remote[path];
    const base = snapshot.base[path];
    if (!base) {
      if (local && !remote) return { type: "upload", path, reason: "new-local-file" };
      if (!local && remote) return { type: "download", path, remote, reason: "new-remote-file" };
      if (!local && !remote) return { type: "skip", path, reason: "unchanged" };
      if ((local == null ? void 0 : local.hash) === (remote == null ? void 0 : remote.hash)) return { type: "skip", path, reason: "same-new-file" };
      return {
        type: "conflict",
        path,
        remote,
        conflictPath: makeConflictPath(path, deviceId, now),
        reason: "new-file-conflict"
      };
    }
    const localChanged = local ? local.hash !== base.baseLocalHash : !base.localDeleted;
    const remoteChanged = remote ? remote.hash !== base.baseRemoteHash : !base.remoteDeleted;
    if (!local && !remote) return { type: "skip", path, reason: "deleted-on-both-sides" };
    if (local && remote) {
      if (local.hash === remote.hash) return { type: "skip", path, reason: "unchanged" };
      if (!localChanged && !remoteChanged) return { type: "skip", path, reason: "conflict-baseline" };
      if (localChanged && !remoteChanged) return { type: "upload", path, reason: "changed-locally" };
      if (!localChanged && remoteChanged) return { type: "download", path, remote, reason: "changed-remotely" };
      return {
        type: "conflict",
        path,
        remote,
        conflictPath: makeConflictPath(path, deviceId, now),
        reason: "changed-on-both-sides"
      };
    }
    if (!local && remote) {
      if (!localChanged && !remoteChanged) return { type: "skip", path, reason: "conflict-baseline" };
      if (!remoteChanged) return { type: "download", path, remote, reason: "preserve-remote-after-local-delete" };
      return {
        type: "conflict",
        path,
        remote,
        conflictPath: makeConflictPath(path, deviceId, now),
        reason: "local-deleted-remote-edited"
      };
    }
    if (local && !remote) {
      if (!localChanged && !remoteChanged) return { type: "skip", path, reason: "conflict-baseline" };
      if (!localChanged) return { type: "upload", path, reason: "preserve-local-after-remote-delete" };
      return { type: "conflict", path, reason: "remote-deleted-local-edited" };
    }
    return { type: "skip", path, reason: "unchanged" };
  });
}

// src/sync/sync-engine.ts
var SyncEngine = class {
  constructor(vault, drive, manifest, clock, deviceId, rootFolderId) {
    this.vault = vault;
    this.drive = drive;
    this.manifest = manifest;
    this.clock = clock;
    this.deviceId = deviceId;
    this.rootFolderId = rootFolderId;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  async sync() {
    const report = {
      status: "synced",
      uploaded: [],
      downloaded: [],
      conflicts: [],
      errors: []
    };
    if (this.paused) return { ...report, status: "offline", errors: ["Sync is paused"] };
    let base;
    let local;
    let remote;
    try {
      base = await this.manifest.load();
      [local, remote] = await Promise.all([
        this.retry(() => this.vault.listFiles()),
        this.retry(() => this.drive.listTree(this.rootFolderId))
      ]);
    } catch (error) {
      return this.failedReport(report, error);
    }
    const actions = planSync({
      local: byPath(local),
      remote: byPath(remote),
      base
    }, this.deviceId, this.clock.now());
    try {
      for (const action of actions) await this.apply(action, report);
      const afterLocal = await this.retry(() => this.vault.listFiles());
      const afterRemote = await this.retry(() => this.drive.listTree(this.rootFolderId));
      await this.manifest.save(buildManifest(afterLocal, afterRemote, this.clock.now(), base, actions));
    } catch (error) {
      return this.failedReport(report, error);
    }
    report.status = report.conflicts.length ? "conflict" : "synced";
    return report;
  }
  async apply(action, report) {
    if (action.type === "skip") return;
    if (action.type === "upload") {
      const data = new Uint8Array(await this.vault.read(action.path));
      const parentId = await this.drive.ensureFolder(parentPath(action.path), this.rootFolderId);
      if (action.remote) {
        await this.retry(() => this.drive.update(action.remote.driveId, data, mimeType(action.path)));
      } else {
        await this.retry(() => this.drive.upload(action.path, data, parentId, mimeType(action.path)));
      }
      report.uploaded.push(action.path);
      return;
    }
    if (action.type === "download") {
      if (!action.remote) throw new Error(`Missing remote file for download: ${action.path}`);
      const data = await this.retry(() => this.drive.download(action.remote.driveId));
      await this.vault.write(action.path, toArrayBuffer(data));
      report.downloaded.push(action.path);
      return;
    }
    report.conflicts.push(action.path);
    if (action.remote && action.conflictPath) {
      const data = await this.retry(() => this.drive.download(action.remote.driveId));
      await this.vault.write(action.conflictPath, toArrayBuffer(data));
    }
  }
  async retry(operation) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof RateLimitError || error instanceof TransientHttpError) || attempt >= 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }
  failedReport(report, error) {
    report.status = error instanceof AuthRequiredError ? "auth-required" : "offline";
    report.errors.push(error instanceof Error ? error.message : String(error));
    return report;
  }
};
function byPath(files) {
  return Object.fromEntries(files.map((file) => [file.path, file]));
}
function buildManifest(localFiles, remoteFiles, now, previous, actions) {
  const local = byPath(localFiles);
  const remote = byPath(remoteFiles);
  const conflicts = new Map(actions.filter((action) => action.type === "conflict").map((action) => [action.path, action]));
  const entries = {};
  for (const path of [.../* @__PURE__ */ new Set([...Object.keys(local), ...Object.keys(remote)])].sort()) {
    const localFile = local[path];
    const remoteFile = remote[path];
    if (!localFile || !remoteFile) {
      const previousEntry = previous[path];
      const conflict = conflicts.get(path);
      if (!previousEntry || !conflict) continue;
      if (localFile && !remoteFile && conflict.reason === "remote-deleted-local-edited") {
        entries[path] = {
          ...previousEntry,
          baseLocalHash: localFile.hash,
          localHash: localFile.hash,
          remoteDeleted: true,
          lastSyncedAt: now
        };
      } else if (!localFile && remoteFile && conflict.reason === "local-deleted-remote-edited") {
        entries[path] = {
          ...previousEntry,
          baseRemoteHash: remoteFile.hash,
          remoteHash: remoteFile.hash,
          localDeleted: true,
          lastSyncedAt: now
        };
      }
      continue;
    }
    entries[path] = {
      path,
      driveId: remoteFile.driveId,
      baseLocalHash: localFile.hash,
      baseRemoteHash: remoteFile.hash,
      localHash: localFile.hash,
      remoteHash: remoteFile.hash,
      localDeleted: false,
      remoteDeleted: false,
      lastSyncedAt: now
    };
  }
  return entries;
}
function toArrayBuffer(data) {
  return data.slice().buffer;
}
function parentPath(path) {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}
function mimeType(path) {
  var _a;
  const extension = (_a = path.split(".").pop()) == null ? void 0 : _a.toLowerCase();
  if (extension === "md") return "text/markdown";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "pdf") return "application/pdf";
  if (extension === "json") return "application/json";
  return "application/octet-stream";
}

// src/sync/vault-adapter.ts
var ObsidianVaultAdapter = class {
  constructor(app) {
    this.app = app;
  }
  async listFiles() {
    const files = this.app.vault.getFiles().filter((file) => isSyncablePath(file.path));
    return Promise.all(files.map(async (file) => {
      const bytes = await this.app.vault.readBinary(file);
      return {
        path: file.path,
        hash: await sha256(bytes),
        size: file.stat.size,
        modifiedAt: file.stat.mtime
      };
    }));
  }
  async read(path) {
    const file = this.getFile(path);
    return this.app.vault.readBinary(file);
  }
  async write(path, data) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && isVaultFile(existing)) {
      await this.app.vault.modifyBinary(existing, data);
      return;
    }
    if (existing) throw new Error(`Cannot write over folder: ${path}`);
    await this.ensureFolder(parentPath2(path));
    await this.app.vault.createBinary(path, data);
  }
  async delete(path) {
    await this.app.vault.delete(this.getFile(path), true);
  }
  async ensureFolder(path) {
    if (!path) return;
    const segments = path.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
  getFile(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !isVaultFile(file)) throw new Error(`File not found: ${path}`);
    return file;
  }
};
function isVaultFile(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return typeof candidate.path === "string" && typeof candidate.extension === "string" && !!candidate.stat;
}
function parentPath2(path) {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

// src/main.ts
var SecondBrainPlugin = class extends import_obsidian6.Plugin {
  async onload() {
    var _a, _b;
    this.pluginSettings = normalizeSettings(await this.loadData());
    if (!this.pluginSettings.deviceId) {
      this.pluginSettings.deviceId = `device-${(_b = (_a = crypto.randomUUID) == null ? void 0 : _a.call(crypto)) != null ? _b : Date.now().toString(36)}`;
      await this.saveSettings();
    }
    const transport = new ObsidianRequestTransport();
    const vault = new ObsidianVaultAdapter(this.app);
    this.index = new NoteIndex();
    this.watcher = new ObsidianIndexWatcher(this.app, this.index, (event) => this.registerEvent(event));
    await this.watcher.start();
    this.register(() => {
      var _a2;
      return (_a2 = this.watcher) == null ? void 0 : _a2.stop();
    });
    this.statusBar = new SyncStatusBar(this.addStatusBarItem());
    this.statusBar.setText("Sken Brain");
    this.addSettingTab(new SecondBrainSettingTab(
      this.app,
      this,
      () => this.pluginSettings,
      async (settings) => {
        this.pluginSettings = settings;
        await this.saveSettings();
      },
      {
        reauthenticate: () => this.reauthenticate(transport),
        clearCredentials: () => this.clearCredentials(),
        syncNow: () => this.syncNow(transport, vault)
      }
    ));
    const explainRelation = (activePath, relatedPath) => this.explainRelation(activePath, relatedPath, transport, vault);
    registerSecondBrainCommands(this, {
      syncNow: () => this.syncNow(transport, vault),
      askVault: () => this.askVault(transport, vault),
      summarizeNote: () => this.summarizeNote(transport, vault),
      explainRelation: () => {
        var _a2;
        return this.explainRelation((_a2 = this.activePath()) != null ? _a2 : "", void 0, transport, vault);
      },
      extractStructure: () => this.extractStructure(transport, vault),
      createNote: () => this.createNote(transport, vault)
    }, (leaf) => new RelatedNotesView(leaf, this.index, explainRelation));
    if (!this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE).length) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: false });
    }
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshRelatedView()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshRelatedView()));
    const scheduleSync = () => {
      if (this.pluginSettings.paused || !this.pluginSettings.googleToken) return;
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        this.syncTimer = void 0;
        void this.syncNow(transport, vault);
      }, 1e3);
    };
    this.registerEvent(this.app.vault.on("create", scheduleSync));
    this.registerEvent(this.app.vault.on("modify", scheduleSync));
    this.registerEvent(this.app.vault.on("delete", scheduleSync));
    this.registerEvent(this.app.vault.on("rename", scheduleSync));
    this.registerInterval(window.setInterval(() => {
      if (!this.pluginSettings.paused) void this.syncNow(transport, vault);
    }, Math.max(1, this.pluginSettings.syncIntervalMinutes) * 6e4));
    this.refreshRelatedView();
    if (this.pluginSettings.googleToken) void this.syncNow(transport, vault);
  }
  async syncNow(transport, vault) {
    if (this.pluginSettings.paused) return;
    if (!this.pluginSettings.googleClientId || !this.pluginSettings.driveFolderId) {
      this.showReport({ status: "offline", uploaded: [], downloaded: [], conflicts: [], errors: ["Configure Google client ID and Drive folder ID first"] });
      return;
    }
    try {
      const auth = this.googleAuth(transport);
      try {
        await auth.getAccessToken();
      } catch {
        await auth.authorize();
      }
      const drive = new GoogleDriveClient(transport, () => auth.getAccessToken());
      const engine = new SyncEngine(vault, drive, this.manifestStore(), { now: () => Date.now() }, this.pluginSettings.deviceId, this.pluginSettings.driveFolderId);
      this.showReport(await engine.sync());
    } catch (error) {
      this.showReport({ status: "auth-required", uploaded: [], downloaded: [], conflicts: [], errors: [error instanceof Error ? error.message : String(error)] });
    }
  }
  async askVault(transport, vault) {
    if (!this.aiCommands(transport, vault)) return;
    new AskVaultModal(this.app, (query) => this.aiCommands(transport, vault).askVault(query)).open();
  }
  async summarizeNote(transport, vault) {
    const path = this.activePath();
    const commands = this.aiCommands(transport, vault);
    if (!path || !commands) return;
    await this.openPreview("Summarize note", () => commands.summarizeNote(path), commands);
  }
  async explainRelation(activePath, relatedPath, transport, vault) {
    var _a;
    if (!activePath) return;
    const target = relatedPath != null ? relatedPath : (_a = this.index.related(activePath, 1)[0]) == null ? void 0 : _a.path;
    const commands = this.aiCommands(transport, vault);
    if (!target || !commands) return;
    await this.openPreview("Explain relation", () => commands.explainRelation(activePath, target), commands);
  }
  async extractStructure(transport, vault) {
    const path = this.activePath();
    const commands = this.aiCommands(transport, vault);
    if (!path || !commands) return;
    await this.openPreview("Extract structure", () => commands.extractStructure(path), commands);
  }
  async createNote(transport, vault) {
    const prompt = window.prompt("Create note from prompt");
    const commands = this.aiCommands(transport, vault);
    if (!prompt || !commands) return;
    await this.openPreview("Create note from prompt", () => commands.createNote(prompt), commands);
  }
  async openPreview(title, request, commands) {
    const modal = new PreviewModal(this.app, title, (preview) => commands.applyPreview(preview));
    modal.open();
    await runAiRequest(request, (state) => modal.setState(state));
  }
  aiCommands(transport, vault) {
    if (!this.pluginSettings.apiKey || !this.pluginSettings.model) {
      new import_obsidian6.Notice("Configure an AI provider, API key, and model in Sken Brain settings.");
      return void 0;
    }
    const settings = {
      provider: this.pluginSettings.provider,
      apiKey: this.pluginSettings.apiKey,
      baseUrl: this.pluginSettings.baseUrl || void 0,
      model: this.pluginSettings.model,
      maxContextChars: this.pluginSettings.maxContextChars,
      maxOutputTokens: this.pluginSettings.maxOutputTokens
    };
    const client = settings.provider === "deepseek" ? new DeepSeekClient(settings, transport) : new OpenAiClient(settings, transport);
    return new AiCommands(client, new LocalContextRetriever(this.index), vault, settings);
  }
  async reauthenticate(transport) {
    try {
      await this.googleAuth(transport).authorize();
      new import_obsidian6.Notice("Google Drive authorized.");
    } catch (error) {
      new import_obsidian6.Notice(error instanceof Error ? error.message : String(error));
    }
  }
  async clearCredentials() {
    this.pluginSettings.googleToken = void 0;
    await this.saveSettings();
    new import_obsidian6.Notice("Google credentials cleared on this device.");
  }
  googleAuth(transport) {
    const store = {
      load: async () => this.pluginSettings.googleToken,
      save: async (token) => {
        this.pluginSettings.googleToken = token;
        await this.saveSettings();
      },
      clear: async () => {
        this.pluginSettings.googleToken = void 0;
        await this.saveSettings();
      }
    };
    return new LoopbackGoogleAuth({ clientId: this.pluginSettings.googleClientId }, transport, store, (url) => import_electron.shell.openExternal(url));
  }
  manifestStore() {
    return new DataManifestStore(
      async () => {
        const data = await this.loadData();
        return data && typeof data === "object" ? data.manifest : void 0;
      },
      async (manifest) => {
        const data = await this.loadData();
        const next = data && typeof data === "object" ? { ...data } : {};
        if (manifest === void 0) delete next.manifest;
        else next.manifest = manifest;
        await this.saveData(next);
      }
    );
  }
  async saveSettings() {
    const data = await this.loadData();
    const next = data && typeof data === "object" ? { ...data } : {};
    next.settings = this.pluginSettings;
    await this.saveData(next);
  }
  activePath() {
    const file = this.app.workspace.getActiveFile();
    return (file == null ? void 0 : file.extension.toLowerCase()) === "md" ? file.path : void 0;
  }
  relatedView() {
    var _a;
    return (_a = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE)[0]) == null ? void 0 : _a.view;
  }
  refreshRelatedView() {
    var _a, _b;
    (_b = this.relatedView()) == null ? void 0 : _b.refresh((_a = this.activePath()) != null ? _a : "");
  }
  showReport(report) {
    var _a;
    (_a = this.statusBar) == null ? void 0 : _a.setReport(report);
    if (report.status === "conflict") new import_obsidian6.Notice(`Sync conflict: ${report.conflicts.length} file(s)`);
    if (report.status === "auth-required") new import_obsidian6.Notice("Google Drive authorization is required.");
  }
};
