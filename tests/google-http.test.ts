import test from "node:test";
import assert from "node:assert/strict";

import {
  createAuthorizationBrowser,
  OAuthAuthorizationError,
  WorkerGoogleAuth,
  type GoogleOAuthStateStore,
  type GoogleToken,
  type GoogleTokenStore,
} from "../src/integrations/google-auth.js";
import {
  AuthRequiredError,
  RateLimitError,
  requireSuccess,
  TransientHttpError,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from "../src/integrations/http.js";
import { GoogleDriveClient } from "../src/integrations/google-drive.js";

class FakeTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly handler: (request: HttpRequest) => HttpResponse) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return this.handler(request);
  }
}

const jsonResponse = (value: unknown, status = 200): HttpResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body: new TextEncoder().encode(JSON.stringify(value)).buffer,
});

test("uses the desktop external browser opener when one is available", () => {
  let opened = "";
  const reserveBrowser = createAuthorizationBrowser(
    () => { throw new Error("window.open should not be used on desktop"); },
    (url) => { opened = url; },
  );

  const browser = reserveBrowser();
  assert.ok(browser);
  browser.navigate("https://accounts.google.com/o/oauth2/v2/auth");

  assert.equal(opened, "https://accounts.google.com/o/oauth2/v2/auth");
});

class MemoryTokenStore implements GoogleTokenStore {
  constructor(public value?: GoogleToken) {}
  async load(): Promise<GoogleToken | undefined> { return this.value; }
  async save(token: GoogleToken): Promise<void> { this.value = token; }
  async clear(): Promise<void> { this.value = undefined; }
}

class MemoryStateStore implements GoogleOAuthStateStore {
  constructor(public value?: string) {}
  async load(): Promise<string | undefined> { return this.value; }
  async save(state: string): Promise<void> { this.value = state; }
  async clear(): Promise<void> { this.value = undefined; }
}

test("starts cross-platform authorization and saves the callback state", async () => {
  const tokenStore = new MemoryTokenStore();
  let reserved = false;
  const stateStore = new class extends MemoryStateStore {
    override async save(state: string): Promise<void> {
      assert.equal(reserved, true);
      await super.save(state);
    }
  }();
  let opened = "";
  const auth = new WorkerGoogleAuth(
    { serviceUrl: "https://sync.example/" },
    new FakeTransport(() => jsonResponse({})),
    tokenStore,
    stateStore,
    () => {
      reserved = true;
      return {
        navigate: (url: string) => { opened = url; },
        close: () => undefined,
      };
    },
  );

  await auth.beginAuthorization();

  assert.ok(stateStore.value);
  const url = new URL(opened);
  assert.equal(url.toString().startsWith("https://sync.example/oauth/start?"), true);
  assert.equal(url.searchParams.get("state"), stateStore.value);
});

test("reports when the authorization browser cannot be opened", async () => {
  const stateStore = new MemoryStateStore();
  const auth = new WorkerGoogleAuth(
    { serviceUrl: "https://sync.example" },
    new FakeTransport(() => jsonResponse({})),
    new MemoryTokenStore(),
    stateStore,
    () => undefined,
  );

  await assert.rejects(
    () => auth.beginAuthorization(),
    new OAuthAuthorizationError("Could not open the browser for Google authorization"),
  );
  assert.equal(stateStore.value, undefined);
});

test("exchanges a verified Obsidian callback and stores the token", async () => {
  const tokenStore = new MemoryTokenStore();
  const stateStore = new MemoryStateStore("expected-state");
  const transport = new FakeTransport((request) => {
    assert.equal(request.url, "https://sync.example/oauth/exchange");
    assert.deepEqual(JSON.parse(String(request.body)), { code: "authorization-code" });
    return jsonResponse({ accessToken: "access", refreshToken: "refresh", expiresAt: 10_000 });
  });
  const auth = new WorkerGoogleAuth(
    { serviceUrl: "https://sync.example" },
    transport,
    tokenStore,
    stateStore,
    () => undefined,
  );

  const token = await auth.completeAuthorization({ state: "expected-state", code: "authorization-code" });

  assert.deepEqual(token, { accessToken: "access", refreshToken: "refresh", expiresAt: 10_000 });
  assert.deepEqual(tokenStore.value, token);
  assert.equal(stateStore.value, undefined);
});

test("rejects an OAuth callback with the wrong device state", async () => {
  const transport = new FakeTransport(() => {
    throw new Error("unexpected request");
  });
  const auth = new WorkerGoogleAuth(
    { serviceUrl: "https://sync.example" },
    transport,
    new MemoryTokenStore(),
    new MemoryStateStore("expected-state"),
    () => undefined,
  );

  await assert.rejects(
    () => auth.completeAuthorization({ state: "wrong-state", code: "authorization-code" }),
    OAuthAuthorizationError,
  );
  assert.equal(transport.requests.length, 0);
});

test("refreshes an expired token through the sync service", async () => {
  const tokenStore = new MemoryTokenStore({ accessToken: "old", refreshToken: "refresh", expiresAt: 0 });
  const transport = new FakeTransport((request) => {
    assert.equal(request.url, "https://sync.example/oauth/refresh");
    assert.deepEqual(JSON.parse(String(request.body)), { refreshToken: "refresh" });
    return jsonResponse({ accessToken: "new", refreshToken: "refresh", expiresAt: Date.now() + 3_600_000 });
  });
  const auth = new WorkerGoogleAuth(
    { serviceUrl: "https://sync.example" },
    transport,
    tokenStore,
    new MemoryStateStore(),
    () => undefined,
  );

  assert.equal(await auth.getAccessToken(), "new");
  assert.equal(tokenStore.value?.accessToken, "new");
});

test("maps a rejected refresh token to authorization required", async () => {
  const auth = new WorkerGoogleAuth(
    { serviceUrl: "https://sync.example" },
    new FakeTransport(() => jsonResponse({ error: "Google authorization is required" }, 401)),
    new MemoryTokenStore({ accessToken: "old", refreshToken: "revoked", expiresAt: 0 }),
    new MemoryStateStore(),
    () => undefined,
  );

  await assert.rejects(() => auth.getAccessToken(), AuthRequiredError);
});

test("maps unauthorized HTTP responses to AuthRequiredError", () => {
  assert.throws(
    () => requireSuccess({ status: 401, headers: {}, body: new ArrayBuffer(0) }),
    AuthRequiredError,
  );
});

test("keeps retryable Drive failures typed", () => {
  assert.throws(
    () => requireSuccess({ status: 429, headers: {}, body: new ArrayBuffer(0) }),
    RateLimitError,
  );
  assert.throws(
    () => requireSuccess({ status: 503, headers: {}, body: new ArrayBuffer(0) }),
    TransientHttpError,
  );
});

test("lists a Drive folder tree with stable relative paths", async () => {
  const transport = new FakeTransport((request) => {
    const url = new URL(request.url);
    const parent = url.searchParams.get("q")?.match(/'([^']+)' in parents/)?.[1];
    if (parent === "root") {
      return jsonResponse({
        files: [
          { id: "folder-1", name: "Notes", mimeType: "application/vnd.google-apps.folder", parents: ["root"] },
          { id: "file-1", name: "root.md", mimeType: "text/markdown", size: "5", md5Checksum: "md5-root", modifiedTime: "2026-08-23T00:00:00.000Z", parents: ["root"] },
        ],
      });
    }
    if (parent === "folder-1") {
      return jsonResponse({
        files: [
          { id: "file-2", name: "idea.md", mimeType: "text/markdown", size: "4", md5Checksum: "md5-idea", modifiedTime: "2026-08-23T00:00:01.000Z", parents: ["folder-1"] },
        ],
      });
    }
    throw new Error(`unexpected request: ${request.url}`);
  });
  const client = new GoogleDriveClient(transport, async () => "access-token");

  const files = await client.listTree("root");

  assert.deepEqual(files.map((file) => file.path), ["Notes/idea.md", "root.md"]);
  assert.equal(files[0]?.hash, "md5-idea");
  assert.match(transport.requests[0]?.url ?? "", /trashed\+%3D\+false|trashed%20%3D%20false/);
  assert.equal(transport.requests[0]?.headers?.Authorization, "Bearer access-token");
});

test("keeps root-level uploads in the configured Drive folder", async () => {
  const transport = new FakeTransport(() => {
    throw new Error("root-level files should not create a subfolder");
  });
  const client = new GoogleDriveClient(transport, async () => "access-token");

  assert.equal(await client.ensureFolder("", "drive-root"), "drive-root");
  assert.equal(transport.requests.length, 0);
});

test("uploads multipart file content without losing the TextEncoder context", async () => {
  const transport = new FakeTransport(() => jsonResponse({
    id: "drive-file",
    name: "README.md",
    mimeType: "text/markdown",
    md5Checksum: "hash",
    modifiedTime: "2026-08-25T00:00:00.000Z",
    size: "4",
  }));
  const client = new GoogleDriveClient(transport, async () => "access-token");

  const result = await client.upload(
    "README.md",
    new TextEncoder().encode("test"),
    "drive-root",
    "text/markdown",
  );

  assert.equal(result.driveId, "drive-file");
  assert.equal(transport.requests[0]?.method, "POST");
});
