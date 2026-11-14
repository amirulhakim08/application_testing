import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, jsonError } from "@/lib/api-auth";
import { getTextInterpreter, voiceParserMode } from "@/lib/ai";
import { assertWithinRateLimit, errorCodeOf, recordUsage } from "@/lib/ai/guard";
import { parseVoiceExpenses } from "@/lib/voice-parser";
import { aiToProposals, rulesAreConfident } from "@/lib/voice-merge";
import { todayKL } from "@/lib/dates";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({
  transcript: z.string().trim().min(1).max(2000),
  defaultWorkspace: z.enum(["personal", "company"]).nullable().optional(),
});

/** Turns a (user-corrected) transcript into proposed expenses. Never saves anything. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("bad_request", 400);
  const { transcript } = parsed.data;
  const defaultWorkspace = parsed.data.defaultWorkspace ?? null;
  const today = todayKL();

  const rules = parseVoiceExpenses(transcript, { today, defaultWorkspace });
  const mode = voiceParserMode();
  const interpreter = getTextInterpreter();

  if (mode === "rules" || !interpreter || (mode === "auto" && rulesAreConfident(rules))) {
    return NextResponse.json({ proposals: rules, source: "rules" });
  }

  // Load category names (both workspaces) to constrain the model's choice.
  const { data: rows } = await supabase.from("expense_categories").select("name, workspaces(kind)").is("archived_at", null);
  const categories = { personal: [] as string[], company: [] as string[] };
  for (const r of rows ?? []) {
    const ws = r.workspaces as unknown as { kind: "personal" | "company" } | null;
    if (ws) categories[ws.kind].push(r.name as string);
  }

  const started = Date.now();
  try {
    await assertWithinRateLimit(supabase, user.id, "voice_parse");
    const ai = await interpreter.interpret({ transcript, today, categories });
    await recordUsage(supabase, { userId: user.id, kind: "voice_parse", provider: interpreter.name, success: true, durationMs: Date.now() - started });
    const proposals = aiToProposals(ai, rules, { today, categories, defaultWorkspace, transcript });
    return NextResponse.json({ proposals: proposals.length ? proposals : rules, source: proposals.length ? "ai" : "rules" });
  } catch (err) {
    const code = errorCodeOf(err);
    if (code !== "rate_limited") {
      await recordUsage(supabase, { userId: user.id, kind: "voice_parse", provider: interpreter.name, success: false, errorCode: code, durationMs: Date.now() - started });
    }
    // Free fallback: the rule-based result, clearly marked for review.
    return NextResponse.json({ proposals: rules, source: "rules", aiError: code });
  }
}
