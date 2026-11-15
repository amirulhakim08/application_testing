import { describe, expect, it } from "vitest";
import { averageDaily, categoryBreakdown, dailySeries, monthlySeries, summarizeWorkspace, type LedgerRow } from "@/lib/aggregate";
import { resolvePeriod } from "@/lib/periods";

const today = "2026-11-14";
const rows: LedgerRow[] = [
  { id: "1", workspaceKind: "personal", categoryId: "g", amountCents: 8500, date: "2026-11-13" },
  { id: "2", workspaceKind: "company", categoryId: "p", amountCents: 24000, date: "2026-11-14" },
  { id: "3", workspaceKind: "personal", categoryId: "t", amountCents: 5000, date: "2026-11-14" },
  { id: "4", workspaceKind: "personal", categoryId: "g", amountCents: 1010, date: "2026-10-05" },
  { id: "5", workspaceKind: "company", categoryId: "p", amountCents: 12000, date: "2026-10-14" },
  { id: "6", workspaceKind: "company", categoryId: "p", amountCents: 99999, date: "2026-10-20" }, // outside MTD comparison
];
const forward: LedgerRow = { id: "7", workspaceKind: "personal", categoryId: "t", amountCents: 25200, date: "2026-11-20" };

describe("summarizeWorkspace", () => {
  const p = resolvePeriod("month", { today });
  it("keeps personal and company totals independent", () => {
    const personal = summarizeWorkspace(rows, "personal", p.current, p.previous, today);
    const company = summarizeWorkspace(rows, "company", p.current, p.previous, today);
    expect(personal).toMatchObject({ total: 13500, today: 5000, count: 2, previousTotal: 1010 });
    expect(company).toMatchObject({ total: 24000, today: 24000, count: 1, previousTotal: 12000, changePct: 100 });
    expect(personal.total + company.total).toBe(37500);
  });
  it("never counts a row twice even if passed twice", () => {
    const s = summarizeWorkspace([...rows, rows[0]], "personal", p.current, p.previous, today);
    expect(s.total).toBe(13500);
    expect(s.count).toBe(2);
  });
  it("moving an expense between workspaces moves it between totals", () => {
    const moved = rows.map((r) => (r.id === "2" ? { ...r, workspaceKind: "personal" as const } : r));
    expect(summarizeWorkspace(moved, "personal", p.current, p.previous, today).total).toBe(37500);
    expect(summarizeWorkspace(moved, "company", p.current, p.previous, today).total).toBe(0);
  });
  it("forward-dated expenses in this month count in the month total but not today", () => {
    const s2 = summarizeWorkspace([...rows, forward], "personal", p.current, p.previous, today);
    expect(s2.total).toBe(13500 + 25200);
    expect(s2.today).toBe(5000);
    expect(s2.count).toBe(3);
  });
  it("deleted rows (filtered out) disappear from totals", () => {
    const remaining = rows.filter((r) => r.id !== "3");
    expect(summarizeWorkspace(remaining, "personal", p.current, p.previous, today).total).toBe(8500);
  });
  it("editing an amount updates totals", () => {
    const edited = rows.map((r) => (r.id === "1" ? { ...r, amountCents: 9000 } : r));
    expect(summarizeWorkspace(edited, "personal", p.current, p.previous, today).total).toBe(14000);
  });
});

describe("breakdowns and series", () => {
  const range = { from: "2026-11-01", to: "2026-11-14" };
  it("category breakdown sorted by total with shares", () => {
    const b = categoryBreakdown(rows, range);
    expect(b[0]).toMatchObject({ categoryId: "p", total: 24000 });
    expect(b.reduce((s, x) => s + x.total, 0)).toBe(37500);
    expect(b.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });
  it("daily series covers every day", () => {
    const d = dailySeries(rows, range);
    expect(d).toHaveLength(14);
    expect(d[13]).toEqual({ key: "2026-11-14", personal: 5000, company: 24000 });
  });
  it("monthly series", () => {
    const m = monthlySeries(rows, today, 2);
    expect(m).toEqual([
      { key: "2026-10", personal: 1010, company: 111999 },
      { key: "2026-11", personal: 13500, company: 24000 },
    ]);
  });
  it("average daily", () => {
    expect(averageDaily(1400, range)).toBe(100);
  });
});
