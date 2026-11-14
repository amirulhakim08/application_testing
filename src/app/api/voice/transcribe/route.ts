import { NextResponse } from "next/server";
import { requireUser, jsonError } from "@/lib/api-auth";
import { getTranscriptionProvider } from "@/lib/ai";
import { assertWithinRateLimit, errorCodeOf, recordUsage } from "@/lib/ai/guard";
import { MAX_AUDIO_BYTES } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|m4a|x-m4a|aac)(;.*)?$/;

/** Audio is held in memory only for this request and is never written to storage or logs. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;

  const provider = getTranscriptionProvider();
  if (!provider) return jsonError("not_configured", 501);

  if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 64 * 1024) return jsonError("too_large", 413);
  let file: File | null = null;
  try {
    const f = (await req.formData()).get("audio");
    file = f instanceof File ? f : null;
  } catch {
    return jsonError("bad_request", 400);
  }
  if (!file || file.size === 0) return jsonError("bad_request", 400);
  if (file.size > MAX_AUDIO_BYTES) return jsonError("too_large", 413);
  const type = file.type || "audio/webm";
  if (!AUDIO_TYPES.test(type)) return jsonError("unsupported_media", 415);

  const ext = type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : type.includes("mpeg") || type.includes("mp3") ? "mp3" : "webm";
  const started = Date.now();
  try {
    await assertWithinRateLimit(supabase, user.id, "transcription");
    const { text } = await provider.transcribe({ audio: Buffer.from(await file.arrayBuffer()), mimeType: type.split(";")[0], filename: `speech.${ext}` });
    await recordUsage(supabase, { userId: user.id, kind: "transcription", provider: provider.name, success: true, durationMs: Date.now() - started });
    return NextResponse.json({ text: text.slice(0, 2000) });
  } catch (err) {
    const code = errorCodeOf(err);
    if (code !== "rate_limited") {
      await recordUsage(supabase, { userId: user.id, kind: "transcription", provider: provider.name, success: false, errorCode: code, durationMs: Date.now() - started });
    }
    return jsonError(code, code === "rate_limited" ? 429 : 502);
  }
}
