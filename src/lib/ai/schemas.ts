import { z } from "zod";
import { AMOUNT_KINDS } from "@/lib/receipt-total";

/**
 * Schemas sent to the model as structured-output formats. Kept simple
 * (no numeric bounds) for structured-output compatibility; everything is
 * re-validated and sanitised on our side after parsing.
 */
const field = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value: value.nullable(), confidence: z.number().describe("0 to 1") });

export const ReceiptExtractionSchema = z.object({
  is_receipt: z.boolean().describe("false if the image is not a purchase receipt or invoice"),
  merchant: field(z.string()),
  date: field(z.string().describe("YYYY-MM-DD")),
  time: field(z.string().describe("HH:MM 24h")),
  currency: field(z.string().describe("ISO 4217 code, e.g. MYR")),
  final_total: field(z.string().describe("Final amount actually payable, digits with 2 decimals, e.g. 53.00")),
  tax_amount: field(z.string()),
  discount_amount: field(z.string()),
  amount_candidates: z
    .array(
      z.object({
        label: z.string().describe("Label exactly as printed, e.g. TOTAL, SUBTOTAL, CASH, CHANGE, SST 6%"),
        amount: z.string().describe("digits with 2 decimals"),
        kind: z.enum(AMOUNT_KINDS),
      }),
    )
    .describe("Every monetary summary line printed on the receipt"),
  suggested_category: z.string().nullable(),
  items: z.array(z.object({ name: z.string(), quantity: z.number().nullable(), amount: z.string().nullable() })),
  warnings: z.array(z.string()).describe("Problems such as blurry, cropped, handwritten, multiple receipts"),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;

export const VoiceInterpretationSchema = z.object({
  expenses: z.array(
    z.object({
      amount: z.string().nullable().describe("digits with 2 decimals, null if not clearly stated"),
      currency: z.string().nullable(),
      description: z.string().describe("Short English description, e.g. 'Groceries at Lotus'"),
      merchant: z.string().nullable(),
      category: z.string().nullable().describe("Must be one of the provided category names"),
      date: z.string().nullable().describe("YYYY-MM-DD"),
      workspace: z.enum(["personal", "company"]).nullable().describe("Only when explicitly mentioned"),
      amount_confidence: z.number(),
    }),
  ),
});
export type VoiceInterpretation = z.infer<typeof VoiceInterpretationSchema>;
