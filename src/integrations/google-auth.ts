import {
  requireSuccess,
  responseJson,
  type HttpTransport,
} from "./http.js";

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
