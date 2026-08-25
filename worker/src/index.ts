const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const OBSIDIAN_CALLBACK_URL = "obsidian://sken-brain-auth";
const STATE_MAX_AGE_MS = 10 * 60_000;

export interface WorkerEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  STATE_SECRET: string;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface SignedState {
  state: string;
  issuedAt: number;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function handleRequest(
  request: Request,
  env: WorkerEnv,
  fetcher: Fetcher = fetch,
  now = Date.now(),
): Promise<Response> {
  if (request.method === "OPTIONS") return response(null, 204);

  try {
    validateEnv(env);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok" });
    }
    if (request.method === "GET" && url.pathname === "/oauth/start") {
      return await startAuthorization(url, env, now);
    }
    if (request.method === "GET" && url.pathname === "/oauth/callback") {
      return await finishAuthorization(url, env, now);
    }
    if (request.method === "POST" && url.pathname === "/oauth/exchange") {
      const body = await requestBody(request);
      return await exchangeToken(url, env, fetcher, now, body.code);
    }
    if (request.method === "POST" && url.pathname === "/oauth/refresh") {
      const body = await requestBody(request);
      return await refreshToken(env, fetcher, now, body.refreshToken);
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    return json({ error: "Sync service request failed" }, 500);
  }
}

function startAuthorization(url: URL, env: WorkerEnv, now: number): Promise<Response> {
  const state = requiredDeviceState(url.searchParams.get("state"));
  return signState({ state, issuedAt: now }, env.STATE_SECRET).then((signedState) => {
    const authorization = new URL(GOOGLE_AUTHORIZATION_URL);
    authorization.search = new URLSearchParams({
      response_type: "code",
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: callbackUrl(url),
      scope: GOOGLE_DRIVE_SCOPE,
      state: signedState,
      access_type: "offline",
      prompt: "consent",
    }).toString();
    return response(null, 302, { Location: authorization.toString() });
  });
}

async function finishAuthorization(url: URL, env: WorkerEnv, now: number): Promise<Response> {
  const signed = requiredString(url.searchParams.get("state"), "Missing authorization state");
  const state = await verifyState(signed, env.STATE_SECRET, now);
  const callback = new URL(OBSIDIAN_CALLBACK_URL);
  callback.searchParams.set("state", state.state);

  const googleError = url.searchParams.get("error");
  if (googleError) callback.searchParams.set("error", googleError);
  else callback.searchParams.set("code", requiredString(url.searchParams.get("code"), "Missing authorization code"));

  const callbackHref = callback.toString();
  const safeHref = escapeHtml(callbackHref);
  return response(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sken Brain authorization</title>
<p>Authorization complete. <a href="${safeHref}">Return to Obsidian</a>.</p>
</html>`, 200, { "Content-Type": "text/html; charset=utf-8" });
}

async function exchangeToken(
  url: URL,
  env: WorkerEnv,
  fetcher: Fetcher,
  now: number,
  code: unknown,
): Promise<Response> {
  const token = await googleToken(fetcher, {
    code: requiredString(code, "Missing authorization code"),
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: callbackUrl(url),
    grant_type: "authorization_code",
  });
  return json(normalizeToken(token, now));
}

async function refreshToken(
  env: WorkerEnv,
  fetcher: Fetcher,
  now: number,
  refreshTokenValue: unknown,
): Promise<Response> {
  const existingRefreshToken = requiredString(refreshTokenValue, "Missing refresh token");
  const token = await googleToken(fetcher, {
    refresh_token: existingRefreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  return json(normalizeToken(token, now, existingRefreshToken));
}

async function googleToken(fetcher: Fetcher, values: Record<string, string>): Promise<GoogleTokenResponse> {
  const result = await fetcher(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  });
  if (!result.ok) {
    let errorCode: unknown;
    try {
      const body = await result.json() as { error?: unknown };
      errorCode = body.error;
    } catch {
      // Google error details remain private; callers receive a stable public error.
    }
    if (errorCode === "invalid_grant") {
      throw new RequestError("Google authorization is required", 401);
    }
    throw new RequestError("Google token exchange failed", 502);
  }
  return await result.json() as GoogleTokenResponse;
}

function normalizeToken(token: GoogleTokenResponse, now: number, refreshTokenValue?: string) {
  if (!token.access_token) throw new RequestError("Google token response was invalid", 502);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshTokenValue,
    expiresAt: now + (token.expires_in ?? 3600) * 1000,
  };
}

async function signState(state: SignedState, secret: string): Promise<string> {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(state)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function verifyState(value: string, secret: string, now: number): Promise<SignedState> {
  const parts = value.split(".");
  if (parts.length !== 2) throw new RequestError("Invalid authorization state");
  const [payload, signature] = parts as [string, string];
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      decodeBase64Url(signature),
      new TextEncoder().encode(payload),
    );
  } catch {
    throw new RequestError("Invalid authorization state");
  }
  if (!valid) throw new RequestError("Invalid authorization state");

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
  } catch {
    throw new RequestError("Invalid authorization state");
  }
  if (!decoded || typeof decoded !== "object") throw new RequestError("Invalid authorization state");
  const state = decoded as Partial<SignedState>;
  if (typeof state.state !== "string" || typeof state.issuedAt !== "number") {
    throw new RequestError("Invalid authorization state");
  }
  requiredDeviceState(state.state);
  if (state.issuedAt > now + 60_000 || now - state.issuedAt > STATE_MAX_AGE_MS) {
    throw new RequestError("Authorization state expired");
  }
  return { state: state.state, issuedAt: state.issuedAt };
}

function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (value && typeof value === "object") return value as Record<string, unknown>;
  } catch {
    // Converted to one stable public error below.
  }
  throw new RequestError("Invalid JSON body");
}

function callbackUrl(url: URL): string {
  return new URL("/oauth/callback", url.origin).toString();
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new RequestError(message);
  return value;
}

function requiredDeviceState(value: unknown): string {
  const state = requiredString(value, "Missing device state");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new RequestError("Invalid device state");
  return state;
}

function validateEnv(env: WorkerEnv): void {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.STATE_SECRET) {
    throw new RequestError("Sync service is not configured", 500);
  }
}

function json(value: unknown, status = 200): Response {
  return response(JSON.stringify(value), status, { "Content-Type": "application/json; charset=utf-8" });
}

function response(body: BodyInit | null, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
