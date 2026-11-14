import { isISODate, addDays, type ISODate } from "@/lib/dates";
import { parseToCents } from "@/lib/money";
import type { VoiceInterpretation } from "@/lib/ai/schemas";
import type { ProposedExpense } from "@/lib/voice-parser";
import type { WorkspaceKind } from "@/lib/aggregate";

/** Should the free rule-based result be good enough to skip a paid AI call? */
export function rulesAreConfident(list: ProposedExpense[]): boolean {
  return list.length > 0 && list.every((p) => p.confidence.amount === "high" && p.categoryName !== "Other" && !p.issues.includes("amount_ambiguous"));
}

/**
 * Validate AI interpretation (untrusted) and convert to proposals.
 * Amounts the AI produced that the rule parser did not also hear are marked low confidence.
 */
export function aiToProposals(
  ai: VoiceInterpretation,
  rules: ProposedExpense[],
  opts: { today: ISODate; categories: Record<WorkspaceKind, string[]>; defaultWorkspace: WorkspaceKind | null; transcript: string },
): ProposedExpense[] {
  const ruleAmounts = new Set(rules.map((r) => r.amountCents).filter((x) => x !== null));
  return ai.expenses.slice(0, 10).map((e, i) => {
    const issues: string[] = [];
    const cents = e.amount ? parseToCents(e.amount) : null;
    const amountCents = cents !== null && cents > 0 && cents < 100_000_000_000 ? cents : null;
    let amountConf: ProposedExpense["confidence"]["amount"] = "missing";
    if (amountCents !== null) amountConf = ruleAmounts.has(amountCents) ? "high" : e.amount_confidence >= 0.8 ? "medium" : "low";
    if (amountCents === null) issues.push("amount_missing");
    else if (amountConf === "low") issues.push("amount_unclear");

    const ruleMatch = rules[i];
    const date =
      e.date && isISODate(e.date) && e.date <= addDays(opts.today, 1) && e.date >= addDays(opts.today, -366) ? e.date : ruleMatch?.date ?? opts.today;
    const workspace: WorkspaceKind | null = e.workspace ?? ruleMatch?.workspace ?? opts.defaultWorkspace;
    if (!workspace) issues.push("workspace_missing");
    const allowed = opts.categories[workspace ?? "personal"];
    const category = allowed.find((c) => c.toLowerCase() === (e.category ?? "").toLowerCase()) ?? ruleMatch?.categoryName ?? "Other";
    const clean = (s: string | null, n: number) => (s ? s.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) || null : null);

    return {
      amountCents,
      currency: "MYR",
      description: clean(e.description, 240) ?? ruleMatch?.description ?? "Expense",
      merchant: clean(e.merchant, 120),
      categoryName: category,
      date,
      workspace,
      confidence: {
        amount: amountConf,
        category: "medium",
        date: e.date ? "high" : "medium",
        workspace: e.workspace ? "high" : workspace ? "medium" : "missing",
      },
      issues,
      sourceText: opts.transcript,
    };
  });
}
