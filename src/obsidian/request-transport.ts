import { requestUrl } from "obsidian";
import type { HttpRequest, HttpResponse, HttpTransport } from "../integrations/http.js";

export class ObsidianRequestTransport implements HttpTransport {
  async request(request: HttpRequest): Promise<HttpResponse> {
    const body = request.body instanceof Uint8Array
      ? request.body.buffer.slice(request.body.byteOffset, request.body.byteOffset + request.body.byteLength) as ArrayBuffer
      : request.body;
    const response = await requestUrl({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body,
      throw: false,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.arrayBuffer,
    };
  }
}
