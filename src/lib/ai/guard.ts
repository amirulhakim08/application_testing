import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError } from "./types";

type Kind = "receipt_scan" | "transcription" | "voice_parse";

const LIMITS: Record<Kind, () => number> = {
  receipt_scan: () => Number(process.env.AI_RATE_LIMIT_SCANS_PER_HOUR ?? 30),
  transcription: () => Number(process.env.AI_RATE_LIMIT_TRANSCRIPTIONS_PER_HOUR ?? 60),
  voice_parse: () => Number(process.env.AI_RATE_LIMIT_TRANSCRIPTIONS_PER_HOUR ?? 60),
};

/** Per-user hourly limit backed by ai_usage_events (works across serverless instances). */
export async function assertWithinRateLimit(supabase: SupabaseClient, userId: string, kind: Kind) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await supabase
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("cached", false)
    .gte("created_at", since);
  if (error) return; // fail open on monitoring errors; provider-side limits still apply
  if ((count ?? 0) >= LIMITS[kind]()) throw new AIError("rate_limited");
}

/** Records usage metadata only — never the image, audio, transcript or amounts. */
export async function recordUsage(
  supabase: SupabaseClient,
  e: { userId: string; kind: Kind; provider: string; success: boolean; cached?: boolean; errorCode?: string; durationMs?: number },
) {
  await supabase.from("ai_usage_events").insert({
    user_id: e.userId,
    kind: e.kind,
    provider: e.provider,
    success: e.success,
    cached: e.cached ?? false,
    error_code: e.errorCode ?? null,
    duration_ms: e.durationMs ?? null,
  });
}

export function errorCodeOf(err: unknown): string {
  return err instanceof AIError ? err.code : "internal";
}
