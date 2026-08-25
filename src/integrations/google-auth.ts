import {
  requireSuccess,
  responseJson,
  type HttpTransport,
} from "./http.js";

export interface WorkerGoogleAuthConfig {
  serviceUrl: string;
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

export interface GoogleOAuthStateStore {
  load(): Promise<string | undefined>;
  save(state: string): Promise<void>;
  clear(): Promise<void>;
}

export interface GoogleAuth {
  beginAuthorization(): Promise<void>;
  completeAuthorization(params: Record<string, string>): Promise<GoogleToken>;
  clear(): Promise<void>;
  getAccessToken(): Promise<string>;
}

export interface AuthorizationBrowser {
  navigate(url: string): void;
  close(): void;
}

export class OAuthAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthAuthorizationError";
  }
}

export class WorkerGoogleAuth implements GoogleAuth {
  constructor(
    private readonly config: WorkerGoogleAuthConfig,
    private readonly transport: HttpTransport,
    private readonly tokenStore: GoogleTokenStore,
    private readonly stateStore: GoogleOAuthStateStore,
    private readonly reserveBrowser: () => AuthorizationBrowser | undefined,
  ) {}

  async beginAuthorization(): Promise<void> {
    const state = randomState();
    const url = new URL(this.endpoint("/oauth/start"));
    url.searchParams.set("state", state);
    const browser = this.reserveBrowser();
    if (!browser) throw new OAuthAuthorizationError("Could not open the browser for Google authorization");
    try {
      await this.stateStore.save(state);
      browser.navigate(url.toString());
    } catch (error) {
      browser.close();
      await this.stateStore.clear();
      throw error;
    }
  }

  async completeAuthorization(params: Record<string, string>): Promise<GoogleToken> {
    const expectedState = await this.stateStore.load();
    if (!expectedState || params.state !== expectedState) {
      throw new OAuthAuthorizationError("Google authorization state did not match");
    }
    if (params.error) {
      await this.stateStore.clear();
      throw new OAuthAuthorizationError(`Google authorization failed: ${params.error}`);
    }
    if (!params.code) throw new OAuthAuthorizationError("Google authorization did not return a code");

    const response = requireSuccess(await this.transport.request({
      method: "POST",
      url: this.endpoint("/oauth/exchange"),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: params.code }),
    }));
    const token = validToken(responseJson<unknown>(response));
    await this.tokenStore.save(token);
    await this.stateStore.clear();
    return token;
  }

  async clear(): Promise<void> {
    await Promise.all([this.tokenStore.clear(), this.stateStore.clear()]);
  }

  async getAccessToken(): Promise<string> {
    const token = await this.tokenStore.load();
    if (!token) throw new OAuthAuthorizationError("Google authorization is required");
    if (token.expiresAt > Date.now() + 60_000) return token.accessToken;
    if (!token.refreshToken) throw new OAuthAuthorizationError("Google authorization has no refresh token");

    const response = requireSuccess(await this.transport.request({
      method: "POST",
      url: this.endpoint("/oauth/refresh"),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: token.refreshToken }),
    }));
    const refreshed = validToken(responseJson<unknown>(response), token.refreshToken);
    await this.tokenStore.save(refreshed);
    return refreshed.accessToken;
  }

  private endpoint(path: string): string {
    const value = this.config.serviceUrl.trim();
    if (!value) throw new OAuthAuthorizationError("Configure the sync service URL first");
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new OAuthAuthorizationError("Sync service URL is invalid");
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
      throw new OAuthAuthorizationError("Sync service URL must use HTTPS");
    }
    return new URL(path, `${url.origin}/`).toString();
  }
}

function validToken(value: unknown, refreshToken?: string): GoogleToken {
  if (!value || typeof value !== "object") throw new OAuthAuthorizationError("Sync service returned an invalid token");
  const token = value as Partial<GoogleToken>;
  if (typeof token.accessToken !== "string" || typeof token.expiresAt !== "number") {
    throw new OAuthAuthorizationError("Sync service returned an invalid token");
  }
  return {
    accessToken: token.accessToken,
    refreshToken: typeof token.refreshToken === "string" ? token.refreshToken : refreshToken,
    expiresAt: token.expiresAt,
  };
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
