import { z } from "zod";
import { isISODate } from "./dates";
import { parseToCents } from "./money";

export const uuid = z.string().uuid();

export const isoDate = z.string().refine(isISODate, "Invalid date");

/** Positive money amount given as a string; returns integer cents. */
export const moneyString = z
  .string()
  .trim()
  .transform((s, ctx) => {
    const c = parseToCents(s);
    if (c === null || c <= 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount greater than 0" });
      return z.NEVER;
    }
    if (c >= 100_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Amount is too large" });
      return z.NEVER;
    }
    return c;
  });

const optionalMoney = z
  .string()
  .trim()
  .optional()
  .transform((s, ctx) => {
    if (!s) return null;
    const c = parseToCents(s);
    if (c === null || c < 0) {
      ctx.addIssue({ code: "custom", message: "Invalid amount" });
      return z.NEVER;
    }
    return c;
  });

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : null));

export const ENTRY_METHODS = ["receipt_scan", "voice", "manual"] as const;

export const expenseInputSchema = z.object({
  amount: moneyString,
  currency: z.string().regex(/^[A-Z]{3}$/).default("MYR"),
  workspaceId: uuid,
  categoryId: uuid.nullable().optional().transform((v) => v ?? null),
  merchant: optText(120),
  description: optText(240),
  notes: optText(1000),
  expenseDate: isoDate,
  expenseTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  taxAmount: optionalMoney,
  discountAmount: optionalMoney,
  entryMethod: z.enum(ENTRY_METHODS),
  receiptFileId: uuid.nullable().optional().transform((v) => v ?? null),
  aiExtractionId: uuid.nullable().optional().transform((v) => v ?? null),
  items: z
    .array(z.object({ name: z.string().trim().min(1).max(160), quantity: z.number().positive().max(100000).nullable(), amount: z.string().nullable() }))
    .max(100)
    .optional(),
  /** Set by the client after the user has seen a duplicate warning. */
  confirmDuplicate: z.boolean().optional(),
});
export type ExpenseInput = z.input<typeof expenseInputSchema>;
export type ExpenseParsed = z.output<typeof expenseInputSchema>;

export const categoryNameSchema = z.string().trim().min(1, "Name is required").max(40);

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB raw upload
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // ~ several minutes of compressed speech
export const MAX_AUDIO_SECONDS = 120;

/** Verify image magic bytes — never trust the declared MIME type alone. */
export function sniffImageType(buf: Uint8Array): (typeof ALLOWED_IMAGE_TYPES)[number] | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  )
    return "image/webp";
  return null;
}
