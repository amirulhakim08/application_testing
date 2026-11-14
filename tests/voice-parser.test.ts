import { describe, expect, it } from "vitest";
import { findDate, numberWordsToDigits, parseVoiceExpenses } from "@/lib/voice-parser";

const today = "2026-11-14"; // Saturday

describe("numberWordsToDigits", () => {
  it.each([
    ["petrol fifty ringgit", "petrol 50 ringgit"],
    ["lima puluh ringgit", "50 ringgit"],
    ["dua ratus empat puluh", "240"],
    ["seratus dua puluh lima", "125"],
    ["dua belas ringgit", "12 ringgit"],
    ["seribu lima ratus", "1500"],
    ["one hundred and twenty ringgit", "120 ringgit"],
    ["twenty five ringgit", "25 ringgit"],
    ["two thousand", "2000"],
  ])("%s", (input, expected) => {
    expect(numberWordsToDigits(input)).toBe(expected);
  });
});

describe("parseVoiceExpenses — spec examples", () => {
  it("Example 1: Malay groceries yesterday at Lotus", () => {
    const [e] = parseVoiceExpenses("Semalam beli barang dapur RM85 dekat Lotus.", { today });
    expect(e.amountCents).toBe(8500);
    expect(e.categoryName).toBe("Groceries");
    expect(e.date).toBe("2026-11-13");
    expect(e.merchant).toBe("Lotus");
    expect(e.description).toBe("Groceries at Lotus");
    expect(e.workspace).toBeNull(); // must ask the user
    expect(e.issues).toContain("workspace_missing");
    expect(e.confidence.amount).toBe("high");
  });
  it("Example 1 uses the explicitly selected workspace when provided", () => {
    const [e] = parseVoiceExpenses("Semalam beli barang dapur RM85 dekat Lotus.", { today, defaultWorkspace: "personal" });
    expect(e.workspace).toBe("personal");
    expect(e.confidence.workspace).toBe("medium");
  });
  it("Example 2: company packaging today", () => {
    const [e] = parseVoiceExpenses("Company beli packaging RM240 hari ini.", { today });
    expect(e.amountCents).toBe(24000);
    expect(e.categoryName).toBe("Packaging");
    expect(e.workspace).toBe("company");
    expect(e.date).toBe(today);
  });
  it("Example 3: mixed language number words", () => {
    const [e] = parseVoiceExpenses("Petrol fifty ringgit untuk personal", { today });
    expect(e.amountCents).toBe(5000);
    expect(e.categoryName).toBe("Transport");
    expect(e.workspace).toBe("personal");
    expect(e.description).toBe("Petrol");
  });
});

describe("parseVoiceExpenses — more cases", () => {
  it("splits multiple expenses and shares the date", () => {
    const list = parseVoiceExpenses("Semalam makan tengahari RM15 dan isi minyak RM50", { today, defaultWorkspace: "personal" });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ amountCents: 1500, categoryName: "Food & Drinks", date: "2026-11-13" });
    expect(list[1]).toMatchObject({ amountCents: 5000, categoryName: "Transport", date: "2026-11-13" });
  });
  it("context in a later expense does not leak backwards", () => {
    const list = parseVoiceExpenses("Semalam beli barang dapur RM85 dekat Lotus dan petrol fifty ringgit untuk personal", { today });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ amountCents: 8500, workspace: null, date: "2026-11-13", description: "Groceries at Lotus" });
    expect(list[1]).toMatchObject({ amountCents: 5000, workspace: "personal", date: "2026-11-13", categoryName: "Transport" });
  });
  it("per-expense dates", () => {
    const list = parseVoiceExpenses("kopi RM5 hari ini dan parking RM3 semalam", { today, defaultWorkspace: "personal" });
    expect(list.map((e) => e.date)).toEqual(["2026-11-14", "2026-11-13"]);
  });
  it("English with decimals", () => {
    const [e] = parseVoiceExpenses("Paid RM12.50 for coffee at Starbucks today", { today, defaultWorkspace: "personal" });
    expect(e.amountCents).toBe(1250);
    expect(e.merchant).toBe("Starbucks");
    expect(e.categoryName).toBe("Food & Drinks");
  });
  it("missing amount is flagged, never invented", () => {
    const [e] = parseVoiceExpenses("beli barang dapur dekat Tesco", { today });
    expect(e.amountCents).toBeNull();
    expect(e.issues).toContain("amount_missing");
  });
  it("bare number is a low-confidence guess", () => {
    const [e] = parseVoiceExpenses("parking 5", { today });
    expect(e.amountCents).toBe(500);
    expect(e.confidence.amount).toBe("low");
  });
  it("date numbers are not mistaken for amounts", () => {
    const [e] = parseVoiceExpenses("3 hari lepas bayar bil elektrik RM120", { today, defaultWorkspace: "personal" });
    expect(e.amountCents).toBe(12000);
    expect(e.date).toBe("2026-11-11");
    expect(e.categoryName).toBe("Bills");
  });
  it("Malay ringgit and sen", () => {
    const [e] = parseVoiceExpenses("parking 2 ringgit 50 sen", { today });
    expect(e.amountCents).toBe(250);
  });
  it("company spoken in Malay", () => {
    const [e] = parseVoiceExpenses("bayar pos laju RM18 untuk syarikat", { today });
    expect(e.workspace).toBe("company");
    expect(e.categoryName).toBe("Shipping");
  });
});

describe("findDate", () => {
  it("handles weekdays and explicit dates", () => {
    expect(findDate("isnin lepas", today)?.date).toBe("2026-11-09");
    expect(findDate("on friday", today)?.date).toBe("2026-11-13");
    expect(findDate("12/11", today)?.date).toBe("2026-11-12");
    expect(findDate("20 disember", today)?.date).toBe("2025-12-20"); // future date -> last year
    expect(findDate("kelmarin", today)?.date).toBe("2026-11-12");
  });
});
