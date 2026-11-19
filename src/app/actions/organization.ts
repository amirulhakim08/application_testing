"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { z } from "zod";
import { getBaseContext } from "@/lib/data";
import { LOGO_MAX_BYTES, LOGO_TYPES, ORG_ASSETS_BUCKET } from "@/lib/org-assets";

type Result = { ok: true; organizationId?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : null));

const businessSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120),
  registrationNo: optText(40),
  address: optText(400),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((s) => (s ? s : null))
    .refine((s) => s === null || z.email().safeParse(s).success, "Invalid email"),
  phone: optText(40),
  website: optText(200),
});
export type BusinessInput = z.input<typeof businessSchema>;

const bankSchema = z.object({
  bankName: optText(80),
  bankAccountNo: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((s) => (s ? s : null))
    .refine((s) => s === null || /^[0-9][0-9 -]*$/.test(s), "Account number may contain digits, spaces and dashes only"),
  bankAccountHolder: optText(120),
});
export type BankInput = z.input<typeof bankSchema>;

const prefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,8}$/, "Use 1–8 capital letters or numbers");
const documentSchema = z.object({
  documentTemplate: z.enum(["classic", "modern", "navy"]),
  quotationPrefix: prefix,
  invoicePrefix: prefix,
  deliveryOrderPrefix: prefix,
  receiptPrefix: prefix,
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  quotationValidityDays: z.coerce.number().int().min(1).max(365),
  taxLabel: z.string().trim().min(1).max(20).default("SST"),
  defaultTaxRate: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a rate such as 8 or 6.5")
    .refine((s) => Number(s) <= 100, "Rate cannot exceed 100%"),
  taxRegistrationNo: optText(40),
  defaultNotes: optText(1000),
  defaultTerms: optText(2000),
});
export type DocumentSettingsInput = z.input<typeof documentSchema>;

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "form");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

/** Owner/admin of the active business, or an error. Membership is re-checked by RLS on every write. */
async function requireManager() {
  const ctx = await getBaseContext();
  if (!ctx.organization) return { error: "No business yet" } as const;
  if (ctx.organization.role === "staff") return { error: "Only the business owner can change this" } as const;
  return { ctx, org: ctx.organization } as const;
}

/** Onboarding step 1: creates the business (owner membership, settings and default categories in one transaction). */
export async function createOrganization(input: BusinessInput): Promise<Result> {
  const ctx = await getBaseContext();
  const r = businessSchema.safeParse(input);
  if (!r.success) return { ok: false, error: "Please check the highlighted fields", fieldErrors: fieldErrors(r.error) };
  if (ctx.organization) return updateOrganization(input);
  const { data, error } = await ctx.supabase.rpc("create_organization", {
    p_name: r.data.name,
    p_registration_no: r.data.registrationNo,
    p_address: r.data.address,
    p_email: r.data.email,
    p_phone: r.data.phone,
    p_website: r.data.website,
  });
  if (error || !data) return { ok: false, error: "Could not create the business. Please try again." };
  revalidatePath("/", "layout");
  return { ok: true, organizationId: data as string };
}

export async function updateOrganization(input: BusinessInput): Promise<Result> {
  const m = await requireManager();
  if ("error" in m) return { ok: false, error: m.error ?? "Not allowed" };
  const r = businessSchema.safeParse(input);
  if (!r.success) return { ok: false, error: "Please check the highlighted fields", fieldErrors: fieldErrors(r.error) };
  const { error } = await m.ctx.supabase
    .from("organizations")
    .update({
      name: r.data.name,
      registration_no: r.data.registrationNo,
      address: r.data.address,
      email: r.data.email,
      phone: r.data.phone,
      website: r.data.website,
    })
    .eq("id", m.org.id);
  if (error) return { ok: false, error: "Could not save" };
  await audit(m.ctx, m.org.id, "organization.update");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateBank(input: BankInput): Promise<Result> {
  const m = await requireManager();
  if ("error" in m) return { ok: false, error: m.error ?? "Not allowed" };
  const r = bankSchema.safeParse(input);
  if (!r.success) return { ok: false, error: "Please check the highlighted fields", fieldErrors: fieldErrors(r.error) };
  const { error } = await m.ctx.supabase
    .from("organizations")
    .update({ bank_name: r.data.bankName, bank_account_no: r.data.bankAccountNo, bank_account_holder: r.data.bankAccountHolder })
    .eq("id", m.org.id);
  if (error) return { ok: false, error: "Could not save" };
  await audit(m.ctx, m.org.id, "organization.bank_update");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateDocumentSettings(input: DocumentSettingsInput): Promise<Result> {
  const m = await requireManager();
  if ("error" in m) return { ok: false, error: m.error ?? "Not allowed" };
  const r = documentSchema.safeParse(input);
  if (!r.success) return { ok: false, error: "Please check the highlighted fields", fieldErrors: fieldErrors(r.error) };
  const d = r.data;
  const { error } = await m.ctx.supabase
    .from("organization_settings")
    .update({
      document_template: d.documentTemplate,
      quotation_prefix: d.quotationPrefix,
      invoice_prefix: d.invoicePrefix,
      delivery_order_prefix: d.deliveryOrderPrefix,
      receipt_prefix: d.receiptPrefix,
      payment_terms_days: d.paymentTermsDays,
      quotation_validity_days: d.quotationValidityDays,
      tax_label: d.taxLabel,
      default_tax_rate: d.defaultTaxRate,
      tax_registration_no: d.taxRegistrationNo,
      default_notes: d.defaultNotes,
      default_terms: d.defaultTerms,
    })
    .eq("organization_id", m.org.id);
  if (error) return { ok: false, error: "Could not save" };
  await audit(m.ctx, m.org.id, "organization.settings_update");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function completeOnboarding(): Promise<Result> {
  const m = await requireManager();
  if ("error" in m) return { ok: false, error: m.error ?? "Not allowed" };
  const { error } = await m.ctx.supabase
    .from("organization_settings")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("organization_id", m.org.id)
    .is("onboarding_completed_at", null);
  if (error) return { ok: false, error: "Could not save" };
  // Deliberately no revalidatePath: revalidating here re-renders /onboarding, which redirects completed
  // businesses to "/" before the "ready" screen is shown. App pages are dynamic and read fresh data anyway.
  return { ok: true };
}

/** Uploads a logo. The image is re-encoded server-side (strips metadata, max 600 px) before it is stored privately. */
export async function uploadLogo(form: FormData): Promise<Result> {
  const m = await requireManager();
  if ("error" in m) return { ok: false, error: m.error ?? "Not allowed" };
  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image" };
  if (file.size > LOGO_MAX_BYTES) return { ok: false, error: "Logo must be 2 MB or smaller" };
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return { ok: false, error: "Use a JPG, PNG or WebP image" };

  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(600, 600, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return { ok: false, error: "This image could not be read" };
  }

  const path = `${m.org.id}/logo-${Date.now()}.png`;
  const { error } = await m.ctx.supabase.storage.from(ORG_ASSETS_BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
  if (error) return { ok: false, error: "Could not upload the logo" };
  const old = m.org.logoPath;
  const { error: upErr } = await m.ctx.supabase.from("organizations").update({ logo_path: path }).eq("id", m.org.id);
  if (upErr) {
    await m.ctx.supabase.storage.from(ORG_ASSETS_BUCKET).remove([path]);
    return { ok: false, error: "Could not save the logo" };
  }
  if (old) await m.ctx.supabase.storage.from(ORG_ASSETS_BUCKET).remove([old]);
  await audit(m.ctx, m.org.id, "organization.logo_update");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeLogo(): Promise<Result> {
  const m = await requireManager();
  if ("error" in m) return { ok: false, error: m.error ?? "Not allowed" };
  if (!m.org.logoPath) return { ok: true };
  await m.ctx.supabase.storage.from(ORG_ASSETS_BUCKET).remove([m.org.logoPath]);
  await m.ctx.supabase.from("organizations").update({ logo_path: null }).eq("id", m.org.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

async function audit(ctx: Awaited<ReturnType<typeof getBaseContext>>, organizationId: string, action: string) {
  await ctx.supabase.from("audit_logs").insert({ user_id: ctx.user.id, organization_id: organizationId, action, entity: "organization", entity_id: organizationId });
}
