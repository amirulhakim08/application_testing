import { describe, expect, it } from "vitest";
import { elapsedPart, resolvePeriod } from "@/lib/periods";
import { todayKL } from "@/lib/dates";

describe("todayKL", () => {
  it("uses Kuala Lumpur time (UTC+8)", () => {
    // 2026-11-13 17:30 UTC is already 2026-11-14 01:30 in KL
    expect(todayKL(new Date("2026-11-13T17:30:00Z"))).toBe("2026-11-14");
    expect(todayKL(new Date("2026-11-13T15:59:00Z"))).toBe("2026-11-13");
  });
});

describe("resolvePeriod", () => {
  const today = "2026-11-14"; // Saturday
  it("defaults to this month, compared month-to-date", () => {
    const p = resolvePeriod(undefined, { today });
    expect(p.key).toBe("month");
    // whole month counts (incl. forward-dated expenses); comparison stays month-to-date
    expect(p.current).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(p.previous).toEqual({ from: "2026-10-01", to: "2026-10-14" });
  });
  it("today vs yesterday", () => {
    expect(resolvePeriod("today", { today }).previous).toEqual({ from: "2026-11-13", to: "2026-11-13" });
  });
  it("week starts Monday", () => {
    const p = resolvePeriod("week", { today });
    expect(p.current).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(p.previous).toEqual({ from: "2026-11-02", to: "2026-11-07" });
  });
  it("last month is full month", () => {
    const p = resolvePeriod("last_month", { today: "2026-03-31" });
    expect(p.current).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(p.previous).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });
  it("month-to-date clamps on short previous months", () => {
    const p = resolvePeriod("month", { today: "2026-03-31" });
    expect(p.previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("custom range swaps and computes equal-length previous window", () => {
    const p = resolvePeriod("custom", { today, from: "2026-11-10", to: "2026-11-01" });
    expect(p.current).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(p.previous).toEqual({ from: "2026-10-22", to: "2026-10-31" });
  });
  it("ignores invalid dates", () => {
    const p = resolvePeriod("custom", { today, from: "2026-02-30", to: "x" });
    expect(p.current).toEqual({ from: "2026-11-01", to: "2026-11-14" });
  });
  it("elapsed part of a period for averages", () => {
    expect(elapsedPart({ from: "2026-11-01", to: "2026-11-30" }, today)).toEqual({ from: "2026-11-01", to: "2026-11-14" });
    expect(elapsedPart({ from: "2026-10-01", to: "2026-10-31" }, today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});
