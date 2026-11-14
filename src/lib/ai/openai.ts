import "server-only";
import OpenAI, { toFile } from "openai";
import { AIError, type TranscriptionProvider } from "./types";

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly name = "openai";
  readonly model = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";

  async transcribe({ audio, mimeType, filename }: { audio: Buffer; mimeType: string; filename: string }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AIError("not_configured");
    const client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });
    try {
      const res = await client.audio.transcriptions.create({
        model: this.model,
        file: await toFile(audio, filename, { type: mimeType }),
        // Vocabulary hint for Malaysian code-switched speech; contains no user data.
        prompt: "Malaysian expense note in Bahasa Melayu and English, e.g. 'Semalam beli barang dapur RM85 dekat Lotus', 'petrol fifty ringgit'.",
      });
      return { text: (res.text ?? "").trim() };
    } catch (err) {
      if (err instanceof OpenAI.RateLimitError) throw new AIError("rate_limited");
      if (err instanceof OpenAI.APIConnectionTimeoutError) throw new AIError("timeout");
      if (err instanceof OpenAI.APIError) throw new AIError("provider_error", `status_${err.status ?? "unknown"}`);
      throw new AIError("provider_error");
    }
  }
}
