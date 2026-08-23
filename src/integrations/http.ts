export interface HttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: ArrayBufferLike;
}

export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response: HttpResponse,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class AuthRequiredError extends HttpError {
  constructor(response: HttpResponse) {
    super("Google authorization is required", response.status, response);
    this.name = "AuthRequiredError";
  }
}

export class RateLimitError extends HttpError {
  constructor(response: HttpResponse) {
    super("Google request was rate limited", response.status, response);
    this.name = "RateLimitError";
  }
}

export class TransientHttpError extends HttpError {
  constructor(response: HttpResponse) {
    super("A temporary HTTP error occurred", response.status, response);
    this.name = "TransientHttpError";
  }
}

export function requireSuccess(response: HttpResponse): HttpResponse {
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

export function responseText(response: HttpResponse): string {
  return new TextDecoder().decode(new Uint8Array(response.body));
}

export function responseJson<T>(response: HttpResponse): T {
  return JSON.parse(responseText(response)) as T;
}
