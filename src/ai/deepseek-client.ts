import { requireSuccess, responseJson, type HttpTransport } from "../integrations/http.js";
import type { AiClient, AiRequest, AiResponse, AiSettings } from "./ai-types.js";
import { baseUrl } from "./openai-client.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com";

interface ChatPayload {
  choices?: Array<{ message?: { content?: string } }>;
}

export class DeepSeekClient implements AiClient {
  constructor(
    private readonly settings: AiSettings,
    private readonly transport: HttpTransport,
  ) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    const messages = [
      ...(request.system ? [{ role: "system", content: request.system }] : []),
      { role: "user", content: request.prompt },
    ];
    const response = await this.transport.request({
      method: "POST",
      url: `${baseUrl(this.settings.baseUrl, DEFAULT_BASE_URL)}/chat/completions`,
      headers: {
        Authorization: `Bearer ${this.settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages,
        max_tokens: request.maxOutputTokens ?? this.settings.maxOutputTokens,
        thinking: { type: "enabled" },
      }),
    });
    const payload = responseJson<ChatPayload>(requireSuccess(response));
    return { text: payload.choices?.[0]?.message?.content ?? "" };
  }
}
