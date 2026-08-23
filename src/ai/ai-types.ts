export type AiProvider = "openai" | "deepseek";

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxContextChars: number;
  maxOutputTokens: number;
}

export interface AiRequest {
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
}

export interface AiResponse {
  text: string;
}

export interface AiClient {
  complete(request: AiRequest): Promise<AiResponse>;
}

export type AiPreviewType = "ask-vault" | "explain-relation" | "summarize-note" | "extract-structure" | "create-note";

export interface ProposedStructure {
  tags: string[];
  tasks: string[];
  links: string[];
}

export interface AiChange {
  path: string;
  content: string;
  expectedHash?: string;
  mode: "create" | "replace";
}

export interface AiPreview {
  type: AiPreviewType;
  title: string;
  text: string;
  sources: string[];
  proposed?: ProposedStructure;
  changes: AiChange[];
}
