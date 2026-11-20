import { describe, expect, it } from "vitest";
import { parsePaymentProof } from "@/lib/ocr/parse-payment-proof";

const TODAY = "2026-11-20";

describe("parsePaymentProof", () => {
  it("reads a DuitNow transfer screenshot", () => {
    const text = `Successful\nDuitNow Transfer\nRM 1,250.00\nRecipient Name KEDAI AINA\nDate 20 Nov 2026 10:15 AM\nReference ID 20261120MBBEMYKL010ORM12345678\nRecipient Reference Kek`;
    const r = parsePaymentProof(text, TODAY);
    expect(r.amountCents).toBe(125000);
    expect(r.date).toBe("2026-11-20");
    expect(r.reference).toBe("20261120MBBEMYKL010ORM12345678");
  });

  it("prefers the labelled amount over other RM values", () => {
    const text = `Baki tersedia RM 9,999.00\nJumlah\nRM32.30\nNo. Rujukan: M2611-5544\n19/11/2026`;
    const r = parsePaymentProof(text, TODAY);
    expect(r.amountCents).toBe(3230);
    expect(r.reference).toBe("M2611-5544");
    expect(r.date).toBe("2026-11-19");
  });

  it("returns nulls when nothing is readable", () => {
    expect(parsePaymentProof("hello world", TODAY)).toEqual({ amountCents: null, date: null, reference: null });
  });

  it("ignores references without digits and future dates", () => {
    const r = parsePaymentProof("Ref: SUCCESSFUL\n01/01/2030\nMYR 5.00", TODAY);
    expect(r.reference).toBeNull();
    expect(r.date).toBeNull();
    expect(r.amountCents).toBe(500);
  });
});
