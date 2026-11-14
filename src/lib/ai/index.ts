import "server-only";
import { AnthropicVisionProvider } from "./anthropic";
import { OpenAITranscriptionProvider } from "./openai";
import type { ExpenseTextInterpreter, ReceiptVisionProvider, TranscriptionProvider } from "./types";

/** Provider registry. Add new providers here; callers depend only on the interfaces. */
export function getVisionProvider(): ReceiptVisionProvider | null {
  const p = process.env.AI_VISION_PROVIDER ?? "anthropic";
  if (p === "anthropic" && process.env.ANTHROPIC_API_KEY) return new AnthropicVisionProvider();
  return null;
}

export function getTextInterpreter(): ExpenseTextInterpreter | null {
  const p = process.env.AI_VISION_PROVIDER ?? "anthropic";
  if (p === "anthropic" && process.env.ANTHROPIC_API_KEY) return new AnthropicVisionProvider();
  return null;
}

export function getTranscriptionProvider(): TranscriptionProvider | null {
  const p = process.env.AI_TRANSCRIPTION_PROVIDER ?? "openai";
  if (p === "openai" && process.env.OPENAI_API_KEY) return new OpenAITranscriptionProvider();
  return null;
}

export function voiceParserMode(): "auto" | "rules" | "ai" {
  const m = process.env.VOICE_PARSER;
  return m === "rules" || m === "ai" ? m : "auto";
}

export function aiCapabilities() {
  return {
    receiptScan: getVisionProvider() !== null,
    transcription: getTranscriptionProvider() !== null,
    voiceAI: getTextInterpreter() !== null && voiceParserMode() !== "rules",
  };
}
