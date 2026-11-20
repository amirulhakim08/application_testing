import { NextResponse } from "next/server";
import { getContext } from "@/lib/data";
import { uuid } from "@/lib/validation";

/** Opens a payment's proof through a short-lived signed URL. Only members of the business can reach it (RLS). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return new Response("Not found", { status: 404 });
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("payments").select("proof_path").eq("id", id).eq("organization_id", ctx.company.id).maybeSingle();
  const path = data?.proof_path as string | null | undefined;
  if (!path) return new Response("Not found", { status: 404 });
  const { data: signed } = await ctx.supabase.storage.from("payment-proofs").createSignedUrl(path, 120);
  if (!signed?.signedUrl) return new Response("Not found", { status: 404 });
  return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
