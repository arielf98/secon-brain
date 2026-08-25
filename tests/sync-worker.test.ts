import test from "node:test";
import assert from "node:assert/strict";

import { handleRequest, type WorkerEnv } from "../worker/src/index.js";

const env: WorkerEnv = {
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  STATE_SECRET: "state-signing-secret",
};

const deviceState = "a".repeat(32);

const unusedFetch: typeof fetch = async () => {
  throw new Error("unexpected fetch");
};

async function signedState(now = 1_000): Promise<string> {
  const response = await handleRequest(
    new Request(`https://sync.example/oauth/start?state=${deviceState}`),
    env,
    unusedFetch,
    now,
  );
  const location = response.headers.get("location");
  assert.ok(location);
  const state = new URL(location).searchParams.get("state");
  assert.ok(state);
  return state;
}

test("starts Google authorization with a signed state and Worker callback", async () => {
  const response = await handleRequest(
    new Request(`https://sync.example/oauth/start?state=${deviceState}`),
    env,
    unusedFetch,
    1_000,
  );

  assert.equal(response.status, 302);
  const location = response.headers.get("location");
  assert.ok(location);
  const url = new URL(location);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), "google-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://sync.example/oauth/callback");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/drive");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.notEqual(url.searchParams.get("state"), deviceState);
});

test("rejects an injectable device state before Google authorization", async () => {
  const response = await handleRequest(
    new Request("https://sync.example/oauth/start?state=%3C%2Fscript%3E%3Cscript%3Esteal()%3C%2Fscript%3E"),
    env,
    unusedFetch,
    1_000,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid device state" });
});

test("returns a verified Google callback to the Obsidian protocol", async () => {
  const state = await signedState();
  const callback = new URL("https://sync.example/oauth/callback");
  callback.searchParams.set("code", "authorization-code");
  callback.searchParams.set("state", state);

  const response = await handleRequest(new Request(callback), env, unusedFetch, 2_000);
  const html = await response.text();

  assert.equal(response.status, 200);
  const href = html.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  assert.ok(href);
  const target = new URL(href);
  assert.equal(target.protocol, "obsidian:");
  assert.equal(target.hostname, "sken-brain-auth");
  assert.equal(target.searchParams.get("code"), "authorization-code");
  assert.equal(target.searchParams.get("state"), deviceState);
  assert.doesNotMatch(html, /<script/i);
});

test("rejects a tampered callback state", async () => {
  const callback = new URL("https://sync.example/oauth/callback");
  callback.searchParams.set("code", "authorization-code");
  callback.searchParams.set("state", `${await signedState()}x`);

  const response = await handleRequest(new Request(callback), env, unusedFetch, 2_000);

  assert.equal(response.status, 400);
});

test("rejects an expired callback state", async () => {
  const callback = new URL("https://sync.example/oauth/callback");
  callback.searchParams.set("code", "authorization-code");
  callback.searchParams.set("state", await signedState(1_000));

  const response = await handleRequest(new Request(callback), env, unusedFetch, 10 * 60_000 + 1_001);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Authorization state expired" });
});

test("exchanges a Google code without exposing the client secret", async () => {
  let tokenRequest: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (_input, init) => {
    tokenRequest = init;
    return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
  };
  const response = await handleRequest(new Request("https://sync.example/oauth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "authorization-code" }),
  }), env, fakeFetch, 1_000);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: 3_601_000,
  });
  const body = new URLSearchParams(String(tokenRequest?.body));
  assert.equal(body.get("code"), "authorization-code");
  assert.equal(body.get("client_secret"), "google-client-secret");
  assert.equal(body.get("redirect_uri"), "https://sync.example/oauth/callback");
});

test("refreshes an access token and preserves the refresh token", async () => {
  const fakeFetch: typeof fetch = async () => Response.json({ access_token: "new-access", expires_in: 1800 });
  const response = await handleRequest(new Request("https://sync.example/oauth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: "existing-refresh" }),
  }), env, fakeFetch, 1_000);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    accessToken: "new-access",
    refreshToken: "existing-refresh",
    expiresAt: 1_801_000,
  });
});

test("maps an invalid refresh token to authorization required without leaking Google details", async () => {
  const fakeFetch: typeof fetch = async () => Response.json({
    error: "invalid_grant",
    error_description: "revoked refresh token: sensitive-detail",
  }, { status: 400 });
  const response = await handleRequest(new Request("https://sync.example/oauth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: "revoked-refresh" }),
  }), env, fakeFetch, 1_000);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Google authorization is required" });
});

test("redacts other Google token endpoint failures", async () => {
  const fakeFetch: typeof fetch = async () => Response.json({
    error: "invalid_client",
    error_description: "client secret was rejected",
  }, { status: 401 });
  const response = await handleRequest(new Request("https://sync.example/oauth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "authorization-code" }),
  }), env, fakeFetch, 1_000);

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Google token exchange failed" });
});
