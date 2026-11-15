import { describe, expect, it } from "vitest";
import { classifyLabel, findReceiptDate, parseLine, parseReceiptText } from "@/lib/ocr/parse-receipt-text";
import { sanitizeReceipt } from "@/lib/receipt-sanitize";

const today = "2026-11-15";
const cats = ["Groceries", "Food & Drinks", "Transport", "Other", "Packaging", "Supplies"];
const run = (text: string, ocrConfidence = 85) => sanitizeReceipt(parseReceiptText(text, { today, ocrConfidence }), today, cats);

describe("parseLine / classifyLabel", () => {
  it("reads trailing amounts with OCR noise", () => {
    expect(parseLine("TOTAL RM 53.OO")).toMatchObject({ label: "TOTAL", amount: "53.00" });
    expect(parseLine("Grand Total 1,234.50")).toMatchObject({ amount: "1234.50" });
    expect(parseLine("Rounding Adj -0.02")).toMatchObject({ amount: "0.02", negative: true });
    expect(parseLine("Date: 12.11.2026").amount).toBeNull();
  });
  it("classifies Malay and English summary lines", () => {
    expect(classifyLabel("SUB TOTAL")).toBe("subtotal");
    expect(classifyLabel("Jumlah Besar")).toBe("final_total");
    expect(classifyLabel("TOTAL INCL. SST")).toBe("final_total");
    expect(classifyLabel("Total SST 6%")).toBe("tax");
    expect(classifyLabel("TUNAI")).toBe("cash_tendered");
    expect(classifyLabel("BAKI")).toBe("change");
    expect(classifyLabel("Visa ****1234")).toBe("card_payment");
    expect(classifyLabel("Total Qty")).toBe("skip");
    expect(classifyLabel("CASHIER: AINA")).toBeNull();
    expect(classifyLabel("Nasi Lemak Ayam")).toBeNull();
  });
});

describe("parseReceiptText → sanitizeReceipt", () => {
  it("grocery receipt with SST and cash/change", () => {
    const r = run(`MYDIN MOHAMED HOLDINGS BHD
(Co. No. 123456-X)
Lot 1, Jalan Mydin, 43000 Kajang
TAX INVOICE
Date: 14/11/2026  Time: 18:42
Milo 1kg            25.90
Beras 5kg           24.10
SUBTOTAL            50.00
SST 6%               3.00
TOTAL               53.00
CASH               100.00
CHANGE              47.00`);
    expect(r.total.amountCents).toBe(5300);
    expect(r.merchant.value).toBe("MYDIN MOHAMED HOLDINGS BHD");
    expect(r.date.value).toBe("2026-11-14");
    expect(r.time.value).toBe("18:42");
    expect(r.tax.value).toBe(300);
    expect(r.items.map((i) => i.name)).toEqual(["Milo 1kg", "Beras 5kg"]);
    expect(r.needsReview).toBe(true); // OCR confidence is capped
    expect(r.total.confidence).toBeLessThanOrEqual(0.75);
  });

  it("petrol paid by card", () => {
    const r = run(`PETRONAS STESEN TAMAN MELATI
SHELL? no
13-11-26 07:15 AM
RON95  20.00L     41.00
TOTAL RM          41.00
VISA              41.00`);
    expect(r.total.amountCents).toBe(4100);
    expect(r.date.value).toBe("2026-11-13");
    expect(r.time.value).toBe("07:15");
    expect(r.total.status).not.toBe("ambiguous");
  });

  it("mamak bill without subtotal, with service charge", () => {
    const r = run(`RESTORAN NASI KANDAR PELITA
12 Nov 2026 21:05
Nasi Kandar Ayam     12.50
Teh Tarik x2          5.60
Service Charge 10%    1.81
Jumlah               19.91`);
    expect(r.total.amountCents).toBe(1991);
    expect(r.date.value).toBe("2026-11-12");
    expect(r.categoryName).toBe("Food & Drinks");
  });

  it("rounding adjustment", () => {
    const r = run(`99 SPEEDMART
15/11/2026
SUB TOTAL 10.62
ROUNDING ADJ -0.02
TOTAL 10.60`);
    expect(r.total.amountCents).toBe(1060);
  });

  it("no TOTAL line: falls back to cash minus change but stays in review", () => {
    const r = run(`KEDAI RUNCIT AH SENG
TUNAI 50.00
BAKI 12.40`);
    expect(r.total.amountCents).toBe(3760);
    expect(r.needsReview).toBe(true);
  });

  it("nothing readable: total is missing, never invented", () => {
    const r = run(`~~~ blurry ~~~\nthank you`, 30);
    expect(r.total.amountCents).toBeNull();
    expect(r.total.status).toBe("missing");
  });

  it("noisy OCR digits", () => {
    const r = run(`AEON BIG
Date 1O/11/2O26
T0TAL 8O.5O
TOTAL 80.50`);
    expect(r.total.amountCents).toBe(8050);
    expect(r.date.value).toBe("2026-11-10");
  });

  it("ignores future dates", () => {
    expect(findReceiptDate("printed 01/01/2030 ... 14/11/2026", today)).toBe("2026-11-14");
  });
});
