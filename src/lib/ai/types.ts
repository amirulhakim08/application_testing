import type { ReceiptExtraction, VoiceInterpretation } from "./schemas";

export interface ReceiptVisionProvider {
  readonly name: string;
  readonly model: string;
  extractReceipt(input: { image: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp"; today: string; categories: string[] }): Promise<ReceiptExtraction>;
}

export interface TranscriptionProvider {
  readonly name: string;
  readonly model: string;
  transcribe(input: { audio: Buffer; mimeType: string; filename: string }): Promise<{ text: string }>;
}

export interface ExpenseTextInterpreter {
  readonly name: string;
  readonly model: string;
  interpret(input: {
    transcript: string;
    today: string;
    categories: { personal: string[]; company: string[] };
  }): Promise<VoiceInterpretation>;
}

/** Error with a stable, user-presentable code. Never includes personal content. */
export class AIError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "timeout"
      | "rate_limited"
      | "provider_error"
      | "invalid_output"
      | "refused"
      | "too_large"
      | "unsupported_media",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AIError";
  }
}
