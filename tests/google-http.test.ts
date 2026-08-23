import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthorizationUrl,
  createPkcePair,
  type GoogleOAuthConfig,
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

test("builds an OAuth URL with PKCE and state", async () => {
  const config: GoogleOAuthConfig = {
    clientId: "client-id",
    scopes: ["https://www.googleapis.com/auth/drive"],
  };
  const pkce = await createPkcePair();
  const url = buildAuthorizationUrl(config, "http://127.0.0.1:43123", "state-value", pkce.challenge);
  const params = new URL(url).searchParams;

  assert.equal(params.get("client_id"), "client-id");
  assert.equal(params.get("redirect_uri"), "http://127.0.0.1:43123");
  assert.equal(params.get("code_challenge"), pkce.challenge);
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("state"), "state-value");
  assert.equal(params.get("access_type"), "offline");
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
