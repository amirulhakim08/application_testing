import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  return { supabase, user } as const;
}

export function jsonError(code: string, status: number, message?: string) {
  return NextResponse.json({ error: code, message }, { status });
}
