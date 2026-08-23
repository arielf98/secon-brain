import {
  requireSuccess,
  responseJson,
  type HttpTransport,
} from "./http.js";
import { createServer } from "node:http";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEFAULT_SCOPE = "https://www.googleapis.com/auth/drive";

export interface GoogleOAuthConfig {
  clientId: string;
  scopes?: string[];
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface GoogleToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface GoogleTokenStore {
  load(): Promise<GoogleToken | undefined>;
  save(token: GoogleToken): Promise<void>;
  clear(): Promise<void>;
}

export interface GoogleAuth {
  authorize(): Promise<GoogleToken>;
  refresh(token: GoogleToken): Promise<GoogleToken>;
  clear(): Promise<void>;
  getAccessToken(): Promise<string>;
}

export interface AuthorizationCode {
  code: string;
  state: string;
}

export class OAuthAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthAuthorizationError";
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64Url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function buildAuthorizationUrl(
  config: GoogleOAuthConfig,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: (config.scopes?.length ? config.scopes : [DEFAULT_SCOPE]).join(" "),
    state,
    access_type: "offline",
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

export function parseAuthorizationResponse(callbackUrl: string, expectedState: string): AuthorizationCode {
  const params = new URL(callbackUrl).searchParams;
  const error = params.get("error");
  if (error) throw new OAuthAuthorizationError(`Google authorization failed: ${error}`);

  const state = params.get("state");
  const code = params.get("code");
  if (!state || state !== expectedState) throw new OAuthAuthorizationError("Google authorization state did not match");
  if (!code) throw new OAuthAuthorizationError("Google authorization did not return a code");
  return { code, state };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function tokenFromResponse(value: TokenResponse, refreshToken?: string): GoogleToken {
  if (!value.access_token) throw new OAuthAuthorizationError("Google token response did not include an access token");
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (value.expires_in ?? 3600) * 1000,
  };
}

export class GoogleAuthClient {
  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly transport: HttpTransport,
  ) {}

  async exchangeCode(code: string, verifier: string, redirectUri: string): Promise<GoogleToken> {
    const response = await this.transport.request({
      method: "POST",
      url: TOKEN_ENDPOINT,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }).toString(),
    });
    return tokenFromResponse(responseJson<TokenResponse>(requireSuccess(response)));
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleToken> {
    const response = await this.transport.request({
      method: "POST",
      url: TOKEN_ENDPOINT,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        grant_type: "refresh_token",
      }).toString(),
    });
    return tokenFromResponse(responseJson<TokenResponse>(requireSuccess(response)), refreshToken);
  }
}

export class LoopbackGoogleAuth implements GoogleAuth {
  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly transport: HttpTransport,
    private readonly tokenStore: GoogleTokenStore,
    private readonly openExternal: (url: string) => Promise<void> | void,
  ) {}

  async authorize(): Promise<GoogleToken> {
    const pkce = await createPkcePair();
    const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
    let callbackUrl = "";
    const server = createServer((request, response) => {
      callbackUrl = `http://127.0.0.1:${port}${request.url ?? "/"}`;
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("Second Brain authorization complete. You can close this window.");
    });

    let port = 0;
    try {
      await new Promise<void>((resolve, reject) => {
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

  async refresh(token: GoogleToken): Promise<GoogleToken> {
    if (!token.refreshToken) throw new OAuthAuthorizationError("Google authorization has no refresh token");
    const refreshed = await new GoogleAuthClient(this.config, this.transport).refreshAccessToken(token.refreshToken);
    await this.tokenStore.save(refreshed);
    return refreshed;
  }

  async clear(): Promise<void> {
    await this.tokenStore.clear();
  }

  async getAccessToken(): Promise<string> {
    const token = await this.tokenStore.load();
    if (!token) throw new OAuthAuthorizationError("Google authorization is required");
    if (token.expiresAt > Date.now() + 60_000) return token.accessToken;
    return (await this.refresh(token)).accessToken;
  }
}

function waitForCallback(server: ReturnType<typeof createServer>, getUrl: () => string): Promise<string> {
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
