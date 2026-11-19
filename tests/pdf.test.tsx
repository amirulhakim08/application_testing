import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { BusinessDocument, type PdfDocumentData } from "@/lib/pdf/document";
import { amountInWords, integerToWords } from "@/lib/pdf/words";

describe("amount in words", () => {
  it("Malay", () => {
    expect(amountInWords(320000, "ms")).toBe("Ringgit Malaysia Tiga Ribu Dua Ratus Sahaja");
    expect(amountInWords(45300, "ms")).toBe("Ringgit Malaysia Empat Ratus Lima Puluh Tiga Sahaja");
    expect(amountInWords(111150, "ms")).toBe("Ringgit Malaysia Seribu Seratus Sebelas dan Sen Lima Puluh Sahaja");
    expect(integerToWords(12, "ms")).toBe("Dua Belas");
    expect(integerToWords(2_500_000, "ms")).toBe("Dua Juta Lima Ratus Ribu");
  });
  it("English", () => {
    expect(amountInWords(500000, "en")).toBe("Ringgit Malaysia Five Thousand Only");
    expect(amountInWords(9999, "en")).toBe("Ringgit Malaysia Ninety-Nine and Cents Ninety-Nine Only");
  });
});

function sample(n: number, template: PdfDocumentData["template"]): PdfDocumentData {
  return {
    template,
    title: "INVOIS",
    number: "INV-2026-0001",
    company: { name: "Aina Bakery Sdn Bhd", lines: ["No. SSM: 202601012345", "Kajang"] },
    party: { label: "Dibilkan kepada", name: "Encik Ali", lines: ["Syarikat Maju Jaya"] },
    meta: [{ label: "Tarikh", value: "19 Nov 2026" }],
    columns: { no: "No.", description: "Perkara", qty: "Kuantiti", price: "Harga", tax: "SST", amount: "Jumlah" },
    items: Array.from({ length: n }, (_, i) => ({
      no: i + 1,
      description: `Item ${i + 1} — penerangan panjang yang perlu dibalut ke baris seterusnya tanpa terpotong di tepi halaman`,
      qty: "1",
      unit: "unit",
      price: "100.00",
      tax: "8%",
      amount: "100.00",
    })),
    totals: [{ label: "JUMLAH", value: "RM10,800.00", strong: true }],
    amountInWords: amountInWords(1080000, "ms"),
    sections: [{ title: "Terma", body: "Bayaran dalam 30 hari." }],
    footer: "Bukan e-Invois LHDN.",
    pageLabel: (p, t) => `Muka ${p} / ${t}`,
  };
}

describe("PDF rendering", () => {
  it.each(["classic", "modern", "navy"] as const)("%s template renders a valid multi-page A4 PDF", async (tpl) => {
    const buf = await renderToBuffer(<BusinessDocument d={sample(80, tpl)} />);
    const head = buf.subarray(0, 5).toString("latin1");
    expect(head).toBe("%PDF-");
    const pages = (buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(1); // 80 long items must flow onto more pages
  }, 60000);
});
