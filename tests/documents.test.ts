import { describe, expect, it } from "vitest";
import { daysOverdue, parseScaled, paymentStatus, priceDocument, priceLine, quotationDisplayStatus, reminderMessage, whatsappLink, whatsappNumber } from "@/lib/documents";

describe("priceLine", () => {
  it("multiplies, discounts and taxes per line", () => {
    expect(priceLine({ quantity: "2", unitPrice: "150.00", taxRate: "8" })).toMatchObject({ gross: 30000, subtotal: 30000, tax: 2400, total: 32400, error: null });
    expect(priceLine({ quantity: "1", unitPrice: "99.99", discount: "9.99" })).toMatchObject({ gross: 9999, discount: 999, subtotal: 9000, tax: 0 });
  });
  it("rounds half-up like PostgreSQL", () => {
    // 1.005 kg x RM1.00 = RM1.005 -> RM1.01
    expect(priceLine({ quantity: "1.005", unitPrice: "1.00" }).gross).toBe(101);
    // RM0.10 x 6.25% = 0.00625 -> RM0.01
    expect(priceLine({ quantity: "1", unitPrice: "0.10", taxRate: "6.25" }).tax).toBe(1);
    // 0.1 + 0.2 style floats never appear
    expect(priceLine({ quantity: "3", unitPrice: "0.10" }).gross).toBe(30);
  });
  it("rejects invalid input instead of guessing", () => {
    expect(priceLine({ quantity: "0", unitPrice: "1" }).error).toBe("quantity");
    expect(priceLine({ quantity: "1", unitPrice: "1.005" }).error).toBe("price");
    expect(priceLine({ quantity: "1", unitPrice: "10.00", discount: "10.01" }).error).toBe("discount");
    expect(priceLine({ quantity: "1", unitPrice: "10.00", taxRate: "101" }).error).toBe("tax");
  });
  it("handles large values exactly", () => {
    expect(priceLine({ quantity: "1000", unitPrice: "300000.00" }).gross).toBe(30_000_000_000);
  });
});

describe("priceDocument (same example as supabase/tests/sales_test.sql)", () => {
  it("totals = subtotal - discounts + charges + tax", () => {
    const t = priceDocument(
      [
        { quantity: "2", unitPrice: "150.00", taxRate: "8" },
        { quantity: "1", unitPrice: "99.99", discount: "9.99" },
      ],
      [{ label: "Caj perkhidmatan", kind: "percent", value: "10" }],
    );
    expect(t).toMatchObject({ subtotal: 39999, discountTotal: 999, chargesTotal: 3900, taxTotal: 2400, total: 45300, valid: true });
  });
  it("fixed charges and empty documents", () => {
    expect(priceDocument([{ quantity: "1", unitPrice: "100" }], [{ label: "Penghantaran", kind: "fixed", value: "15.50" }]).total).toBe(11550);
    expect(priceDocument([]).valid).toBe(false);
  });
  it("RM5,000 invoice example", () => {
    expect(priceDocument([{ quantity: "1", unitPrice: "5000.00" }]).total).toBe(500000);
  });
});

describe("statuses", () => {
  it("payment status from real payments", () => {
    expect(paymentStatus(500000, 0)).toBe("unpaid");
    expect(paymentStatus(500000, 200000)).toBe("partial");
    expect(paymentStatus(500000, 500000)).toBe("paid");
    expect(paymentStatus(120000, 50000 + 30000)).toBe("partial");
  });
  it("overdue days only with a balance", () => {
    expect(daysOverdue("2026-11-01", "2026-11-19", 50000)).toBe(18);
    expect(daysOverdue("2026-11-19", "2026-11-19", 50000)).toBe(0);
    expect(daysOverdue("2026-11-01", "2026-11-19", 0)).toBe(0);
    expect(daysOverdue(null, "2026-11-19", 50000)).toBe(0);
  });
  it("quotation expiry is derived", () => {
    expect(quotationDisplayStatus("sent", "2026-11-18", "2026-11-19")).toBe("expired");
    expect(quotationDisplayStatus("accepted", "2026-11-18", "2026-11-19")).toBe("accepted");
    expect(quotationDisplayStatus("draft", "2026-11-19", "2026-11-19")).toBe("draft");
  });
});

describe("reminders", () => {
  it("normalises Malaysian numbers", () => {
    expect(whatsappNumber("012-345 6789")).toBe("60123456789");
    expect(whatsappNumber("+60 12-345 6789")).toBe("60123456789");
    expect(whatsappNumber("123")).toBeNull();
  });
  it("builds the spec reminder text and a wa.me link", () => {
    const msg = reminderMessage({ lang: "ms", number: "INV-2026-0001", outstandingCents: 50000, businessName: "Aina Bakery" });
    expect(msg).toContain("invois INV-2026-0001 masih mempunyai baki RM500.00");
    expect(whatsappLink("0123456789", msg)).toMatch(/^https:\/\/wa\.me\/60123456789\?text=Assalamualaikum/);
  });
  it("parseScaled", () => {
    expect(parseScaled("1,234.5", 2)).toBe(123450n);
    expect(parseScaled("-1", 2)).toBeNull();
  });
});
