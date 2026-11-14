import { describe, expect, it } from "vitest";
import { centsToDecimalString, formatMoney, parseToCents, percentChange, sumCents } from "@/lib/money";

describe("parseToCents", () => {
  it("parses common inputs exactly", () => {
    expect(parseToCents("85")).toBe(8500);
    expect(parseToCents("85.5")).toBe(8550);
    expect(parseToCents("RM 1,234.56")).toBe(123456);
    expect(parseToCents("0.10")).toBe(10);
    expect(parseToCents(0.1 + 0.2)).toBe(30); // float noise is removed
    expect(parseToCents("1.005")).toBe(101); // half-up on 3rd decimal
  });
  it("rejects garbage", () => {
    expect(parseToCents("abc")).toBeNull();
    expect(parseToCents("1,2")).toBeNull();
    expect(parseToCents("")).toBeNull();
    expect(parseToCents("1e5")).toBeNull();
  });
});

describe("arithmetic", () => {
  it("sums without floating point drift", () => {
    const values = Array.from({ length: 1000 }, () => parseToCents("0.10")!);
    expect(sumCents(values)).toBe(10000);
    expect(centsToDecimalString(sumCents(values))).toBe("100.00");
  });
  it("formats MYR", () => {
    expect(formatMoney(123456)).toBe("RM1,234.56");
    expect(formatMoney(5)).toBe("RM0.05");
  });
  it("percent change is undefined without a previous period", () => {
    expect(percentChange(1000, 0)).toBeNull();
    expect(percentChange(1500, 1000)).toBe(50);
    expect(percentChange(500, 1000)).toBe(-50);
  });
});
