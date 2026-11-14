import { describe, expect, it } from "vitest";
import { resolveReceiptTotal } from "@/lib/receipt-total";

describe("resolveReceiptTotal", () => {
  it("accepts a consistent final total", () => {
    const r = resolveReceiptTotal({
      finalTotal: "53.00",
      finalTotalConfidence: 0.95,
      candidates: [
        { label: "SUBTOTAL", amount: "50.00", kind: "subtotal" },
        { label: "SST 6%", amount: "3.00", kind: "tax" },
        { label: "TOTAL", amount: "53.00", kind: "final_total" },
        { label: "CASH", amount: "100.00", kind: "cash_tendered" },
        { label: "CHANGE", amount: "47.00", kind: "change" },
      ],
    });
    expect(r).toMatchObject({ amountCents: 5300, status: "ok" });
  });
  it("never picks cash tendered and flags it", () => {
    const r = resolveReceiptTotal({
      finalTotal: "100.00",
      finalTotalConfidence: 0.9,
      candidates: [
        { label: "TOTAL", amount: "53.00", kind: "final_total" },
        { label: "CASH", amount: "100.00", kind: "cash_tendered" },
        { label: "CHANGE", amount: "47.00", kind: "change" },
      ],
    });
    expect(r.status).toBe("ambiguous");
    expect(r.options).toEqual([10000, 5300]);
    expect(r.amountCents).toBe(5300); // corroborated by cash - change
    expect(r.reasons).toContain("total_matches_non_paid_line");
  });
  it("handles rounding adjustment", () => {
    const r = resolveReceiptTotal({
      finalTotal: "10.60",
      finalTotalConfidence: 0.9,
      candidates: [
        { label: "Subtotal", amount: "10.62", kind: "subtotal" },
        { label: "Rounding Adj (-)", amount: "0.02", kind: "rounding" },
        { label: "Total", amount: "10.60", kind: "final_total" },
      ],
    });
    expect(r).toMatchObject({ amountCents: 1060, status: "ok" });
  });
  it("missing total is never invented", () => {
    const r = resolveReceiptTotal({ finalTotal: null, finalTotalConfidence: 0, candidates: [{ label: "SST", amount: "3.00", kind: "tax" }] });
    expect(r).toMatchObject({ amountCents: null, status: "missing" });
  });
  it("low confidence requires review", () => {
    const r = resolveReceiptTotal({ finalTotal: "12.00", finalTotalConfidence: 0.5, candidates: [] });
    expect(r.status).toBe("review");
  });
  it("two different totals without corroboration -> ambiguous, no pick", () => {
    const r = resolveReceiptTotal({
      finalTotal: "45.00",
      finalTotalConfidence: 0.9,
      candidates: [
        { label: "TOTAL", amount: "45.00", kind: "final_total" },
        { label: "VISA", amount: "54.00", kind: "card_payment" },
      ],
    });
    expect(r.status).toBe("ambiguous");
    expect(r.amountCents).toBeNull();
  });
});
