import { describe, expect, it } from "vitest";
import { categoryLabel } from "@/lib/category-labels";

describe("categoryLabel", () => {
  it("translates default categories for BM", () => {
    expect(categoryLabel("Food & Drinks", "ms")).toBe("Makanan & Minuman");
    expect(categoryLabel("Professional Fees", "ms")).toBe("Yuran Profesional");
    expect(categoryLabel("Other", "ms")).toBe("Lain-lain");
  });
  it("keeps English as-is", () => {
    expect(categoryLabel("Food & Drinks", "en")).toBe("Food & Drinks");
  });
  it("keeps user-created names as saved", () => {
    expect(categoryLabel("Kopi Pagi", "ms")).toBe("Kopi Pagi");
  });
});
