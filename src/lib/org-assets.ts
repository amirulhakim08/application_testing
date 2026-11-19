import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Private bucket for organization assets. Objects live under "<organization_id>/<file>". */
export const ORG_ASSETS_BUCKET = "org-assets";
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Short-lived signed URL for a business logo (never a permanent public link). */
export async function signedLogoUrl(supabase: SupabaseClient, logoPath: string | null, seconds = 600) {
  if (!logoPath) return null;
  const { data } = await supabase.storage.from(ORG_ASSETS_BUCKET).createSignedUrl(logoPath, seconds);
  return data?.signedUrl ?? null;
}
