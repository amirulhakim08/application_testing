import { describe, expect, it } from "vitest";
import { findDuplicates, merchantsSimilar } from "@/lib/duplicates";
import { csvCell, toCsv } from "@/lib/csv";
import { expenseInputSchema, sniffImageType } from "@/lib/validation";
import { mapCategoryAcrossWorkspaces, suggestCategoryName } from "@/lib/categories";

describe("duplicates", () => {
  const existing = [
    { id: "a", amountCents: 8500, date: "2026-11-13", merchant: "LOTUS'S STORES (MALAYSIA) SDN BHD", description: null, imageSha256: "x".repeat(64) },
    { id: "b", amountCents: 8500, date: "2026-11-12", merchant: null, description: "Groceries", imageSha256: null },
    { id: "c", amountCents: 1200, date: "2026-11-13", merchant: "Lotus's", description: null, imageSha256: null },
  ];
  it("exact image fingerprint wins", () => {
    const m = findDuplicates({ amountCents: 1, date: "2026-01-01", merchant: null, imageSha256: "x".repeat(64) }, existing);
    expect(m[0]).toMatchObject({ level: "exact_image" });
  });
  it("same merchant/date/amount is likely", () => {
    const m = findDuplicates({ amountCents: 8500, date: "2026-11-13", merchant: "Lotus's" }, existing);
    expect(m.map((x) => [x.expense.id, x.level])).toEqual([["a", "likely"], ["b", "possible"]]);
  });
  it("excludes the expense being edited", () => {
    expect(findDuplicates({ amountCents: 1200, date: "2026-11-13", merchant: "Lotus", excludeId: "c" }, existing)).toHaveLength(0);
  });
  it("merchant similarity", () => {
    expect(merchantsSimilar("MYDIN MOHAMED HOLDINGS BHD", "Mydin")).toBe(true);
    expect(merchantsSimilar("Tesco", "Mydin")).toBe(false);
  });
});

describe("csv", () => {
  it("escapes quotes, commas and formula injection", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(toCsv(["a"], [["x"]])).toBe("﻿a\r\nx\r\n");
  });
});

describe("expenseInputSchema", () => {
  const base = { amount: "12.30", workspaceId: "6f1d2c1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f", expenseDate: "2026-11-14", entryMethod: "manual" };
  it("parses amount to cents", () => {
    expect(expenseInputSchema.parse(base).amount).toBe(1230);
  });
  it("rejects zero, negative and invalid dates", () => {
    expect(expenseInputSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...base, amount: "-5" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...base, expenseDate: "2026-02-30" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...base, workspaceId: "nope" }).success).toBe(false);
  });
});

describe("image sniffing", () => {
  it("detects by magic bytes", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("<svg>"))).toBeNull();
  });
});

describe("categories", () => {
  it("suggests by keyword per workspace", () => {
    expect(suggestCategoryName("Facebook ads boost", "company")).toBe("Marketing");
    expect(suggestCategoryName("isi minyak", "company")).toBe("Fuel");
    expect(suggestCategoryName("isi minyak", "personal")).toBe("Fuel");
    expect(suggestCategoryName("random thing", "personal")).toBeNull();
  });
  it("maps categories when moving workspaces", () => {
    const company = [{ id: "1", name: "Travel" }, { id: "2", name: "Other" }];
    expect(mapCategoryAcrossWorkspaces("Travel", company)?.id).toBe("1");
    expect(mapCategoryAcrossWorkspaces("Groceries", company)?.id).toBe("2");
  });
});
