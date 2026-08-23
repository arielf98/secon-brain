import { requireSuccess, responseJson, type HttpTransport } from "../integrations/http.js";
import type { AiClient, AiRequest, AiResponse, AiSettings } from "./ai-types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface ResponsesPayload {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}

export class OpenAiClient implements AiClient {
  constructor(
    private readonly settings: AiSettings,
    private readonly transport: HttpTransport,
  ) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    const response = await this.transport.request({
      method: "POST",
      url: `${baseUrl(this.settings.baseUrl, DEFAULT_BASE_URL)}/responses`,
      headers: {
        Authorization: `Bearer ${this.settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.settings.model,
        input: [
          ...(request.system ? [{ role: "system", content: [{ type: "input_text", text: request.system }] }] : []),
          { role: "user", content: [{ type: "input_text", text: request.prompt }] },
        ],
        max_output_tokens: request.maxOutputTokens ?? this.settings.maxOutputTokens,
      }),
    });
    const payload = responseJson<ResponsesPayload>(requireSuccess(response));
    const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
    return { text };
  }
}

export function baseUrl(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/$/, "");
}
