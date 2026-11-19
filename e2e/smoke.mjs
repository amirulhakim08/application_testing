// End-to-end smoke test against a running BukuTigaLima + Supabase (see README "Testing").
// Usage: BASE_URL=http://localhost:3000 SHOTS=./e2e/screenshots node e2e/smoke.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // uses a globally installed Playwright if not in devDependencies
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now();
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS", name);
  } catch (e) {
    results.push(["FAIL", name]);
    console.log("FAIL", name, "\n   ", e.message.split("\n").slice(0, 4).join("\n    "));
    throw e;
  }
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

const browser = await chromium.launch();
const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctxA.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

const cardTotal = async (label) => {
  const section = page.locator(`section[aria-label="${label}"]`);
  return (await section.locator("div.tabular").first().innerText()).trim();
};

const emailA = `aina+${stamp}@example.com`;
let receiptPath;

try {
  await step("sign up → onboarding wizard creates the business → expense summary", async () => {
    await ctxA.addCookies([{ name: "kg_lang", value: "en", url: BASE }]);
    await page.goto(`${BASE}/signup`);
    await page.fill("#fullName", "Aina Rahman");
    await page.fill("#email", emailA);
    await page.fill("#password", "correct-horse-battery");
    await shot(page, "01-signup-mobile");
    await page.click("button[type=submit]");
    await page.waitForURL(`${BASE}/onboarding`);
    // Step 1: business information (name required)
    await page.getByRole("heading", { name: "Business information" }).waitFor();
    await page.fill("#biz-name", "Aina Bakery Sdn Bhd");
    await page.fill("#biz-registrationNo", "202601012345");
    await page.fill("#biz-address", "12 Jalan Bakery, 43000 Kajang, Selangor");
    await page.fill("#biz-phone", "012-345 6789");
    await shot(page, "01b-onboarding-business-mobile");
    await page.getByRole("button", { name: "Continue" }).click();
    // Step 2: bank (+ logo upload)
    await page.getByRole("heading", { name: "Bank details" }).waitFor();
    const logoPath = `/tmp/claude-0/logo-${stamp}.png`;
    await sharp({ create: { width: 300, height: 300, channels: 3, background: "#17324D" } }).png().toFile(logoPath);
    await page.locator("#biz-logo").setInputFiles(logoPath);
    await page.locator('img[alt="Business logo"]').waitFor();
    await page.fill("#bank-name", "Maybank");
    await page.fill("#bank-no", "5123 4567 8901");
    await page.getByRole("button", { name: "Continue" }).click();
    // Step 3: document preferences — invalid prefix is rejected
    await page.getByRole("heading", { name: "Document preferences" }).waitFor();
    await page.fill("#doc-invoicePrefix", "IN V!");
    await page.fill("#doc-tax", "8");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Use 1–8 capital letters or numbers").waitFor();
    await page.fill("#doc-invoicePrefix", "INV");
    await shot(page, "01c-onboarding-documents-mobile");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Your business is ready!" }).waitFor();
    await shot(page, "01d-onboarding-ready-mobile");
    await page.getByRole("link", { name: "Home →" }).click();
    await page.waitForURL(`${BASE}/`);
    // Home is a hub of shortcuts
    for (const name of ["Quotations", "Invoices", "Receipts", "My Expenses Summary"]) await page.locator(`section[aria-label="${name}"]`).waitFor();
    await shot(page, "02a-home-mobile");
    await page.locator('section[aria-label="My Expenses Summary"]').getByRole("link").first().click();
    await page.waitForURL(`${BASE}/expenses/summary`);
    await page.locator('section[aria-label="Aina Bakery Sdn Bhd"]').waitFor();
    assert.equal(await cardTotal("Personal"), "RM0.00");
    assert.equal(await cardTotal("Aina Bakery Sdn Bhd"), "RM0.00");
    await shot(page, "02-dashboard-empty-mobile");
    // Onboarding is done: visiting it again goes back to the app
    await page.goto(`${BASE}/onboarding`);
    await page.waitForURL(`${BASE}/`);
  });

  await step("settings: business profile, bank and document settings are saved", async () => {
    await page.goto(`${BASE}/settings`);
    assert.equal(await page.inputValue("#biz-name"), "Aina Bakery Sdn Bhd");
    assert.equal(await page.inputValue("#bank-no"), "5123 4567 8901");
    assert.equal(Number(await page.inputValue("#doc-tax")), 8);
    await page.fill("#biz-email", "hello@ainabakery.my");
    await page.locator("#syarikat").getByRole("button", { name: "Save" }).click();
    const toast = page.locator("[data-sonner-toast]").first();
    await toast.waitFor();
    assert.equal((await toast.innerText()).trim(), "Saved");
    await page.reload();
    assert.equal(await page.inputValue("#biz-email"), "hello@ainabakery.my");
    await shot(page, "02b-settings-business-mobile");
  });

  await step("manual expense (personal) updates personal total only", async () => {
    await page.goto(`${BASE}/add/manual`);
    await page.fill("#f-amount", "12.50");
    await page.getByRole("radio", { name: "Personal" }).click();
    await page.getByRole("radio", { name: "Food & Drinks" }).click();
    await page.fill("#f-description", "Nasi lemak");
    await shot(page, "03-manual-mobile");
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.waitForURL(`${BASE}/expenses/summary`);
    await page.getByText("Nasi lemak").first().waitFor();
    assert.equal(await cardTotal("Personal"), "RM12.50");
    assert.equal(await cardTotal("Aina Bakery Sdn Bhd"), "RM0.00");
  });

  await step("manual expense (company) remembers last workspace/category", async () => {
    await page.goto(`${BASE}/add/manual`);
    // last used workspace was Personal + Food & Drinks
    assert.equal(await page.getByRole("radio", { name: "Food & Drinks" }).getAttribute("aria-checked"), "true");
    await page.fill("#f-amount", "240");
    await page.getByRole("radio", { name: "Aina Bakery" }).click();
    await page.getByRole("radio", { name: "Office Supplies" }).click();
    await page.fill("#f-description", "Kotak kek");
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.waitForURL(`${BASE}/expenses/summary`);
    await page.getByText("Kotak kek").first().waitFor();
    assert.equal(await cardTotal("Personal"), "RM12.50");
    assert.equal(await cardTotal("Aina Bakery Sdn Bhd"), "RM240.00");
  });

  await step("duplicate manual entry triggers a warning before saving", async () => {
    await page.goto(`${BASE}/add/manual`);
    await page.fill("#f-amount", "240");
    await page.getByRole("radio", { name: "Aina Bakery" }).click();
    await page.getByRole("radio", { name: "Office Supplies" }).click();
    await page.fill("#f-description", "Kotak kek");
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.getByText("Possible duplicate").waitFor();
    await shot(page, "04-duplicate-warning-mobile");
    await page.getByRole("button", { name: "Go back" }).click();
    await page.goto(`${BASE}/expenses/summary`);
    assert.equal(await cardTotal("Aina Bakery Sdn Bhd"), "RM240.00");
  });

  await step("voice (typed fallback) — mixed BM/EN, two expenses, review then save", async () => {
    await page.goto(`${BASE}/add/voice`);
    await page.getByRole("button", { name: "Type instead" }).click();
    await page.fill("#transcript", "Semalam beli barang dapur RM85 dekat Lotus dan petrol fifty ringgit untuk personal");
    await page.getByRole("button", { name: "Interpret" }).click();
    await page.getByText("Proposed expenses").waitFor();
    assert.equal(await page.inputValue("#v0-amount"), "85.00");
    assert.equal(await page.inputValue("#v1-amount"), "50.00");
    assert.equal(await page.inputValue("#v0-description"), "Groceries at Lotus");
    // Save is blocked until a workspace is chosen for the first proposal
    assert.equal(await page.getByRole("button", { name: "Save 2 expenses" }).isDisabled(), true);
    await shot(page, "05-voice-review-mobile");
    await page.locator('[role=radiogroup][aria-label="Workspace"]').first().getByRole("radio", { name: "Personal" }).click();
    assert.equal(await page.locator('[role=radiogroup][aria-label="Category"]').first().getByRole("radio", { name: "Groceries" }).getAttribute("aria-checked"), "true");
    await page.getByRole("button", { name: "Save 2 expenses" }).click();
    await page.waitForURL(`${BASE}/expenses/summary`);
    await page.getByText("Groceries at Lotus").first().waitFor();
    assert.equal(await cardTotal("Personal"), "RM147.50");
  });

  await step("receipt scan without AI key: free on-device OCR reads the total, user must confirm", async () => {
    receiptPath = `/tmp/claude-0/receipt-${stamp}.png`;
    const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
    const [yy, mm, dd] = todayIso.split("-");
    const lines = [
      ["MYDIN MART", 40, 36],
      [`Date: ${dd}/${mm}/${yy} Time: 18:42`, 40, 26],
      ["Milo 1kg            25.90", 40, 26],
      ["Beras 5kg           24.10", 40, 26],
      ["SUBTOTAL            50.00", 40, 26],
      ["SST 6%               3.00", 40, 26],
      ["TOTAL               53.00", 40, 30],
      ["CASH               100.00", 40, 26],
      ["CHANGE              47.00", 40, 26],
    ];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${120 + lines.length * 60}"><rect width="100%" height="100%" fill="white"/>${lines
      .map(([text, x, size], i) => `<text x="${x}" y="${90 + i * 60}" font-size="${size}" font-family="DejaVu Sans Mono, monospace" xml:space="preserve">${text}</text>`)
      .join("")}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(receiptPath);
    await page.goto(`${BASE}/add/scan`);
    await page.locator('input[type=file]:not([capture])').setInputFiles(receiptPath);
    await page.getByText("Review details").waitFor({ timeout: 120000 });
    await page.getByText("Read with free on-device OCR").waitFor();
    assert.equal(await page.inputValue("#scan-amount"), "53.00");
    assert.equal(await page.inputValue("#scan-date"), todayIso);
    // OCR amounts always need explicit confirmation
    await page.getByRole("radio", { name: "Personal" }).click();
    assert.equal(await page.getByRole("radio", { name: "Groceries" }).getAttribute("aria-checked"), "true");
    assert.equal(await page.getByRole("button", { name: "Save expense" }).isDisabled(), true);
    await page.getByText("I've checked this amount").click();
    await page.fill("#scan-merchant", "Mydin");
    await shot(page, "06-scan-review-mobile");
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.waitForURL(`${BASE}/expenses/summary`);
    assert.equal(await cardTotal("Personal"), "RM200.50");
  });

  await step("re-scanning the same receipt image warns about a duplicate", async () => {
    await page.goto(`${BASE}/add/scan`);
    await page.locator('input[type=file]:not([capture])').setInputFiles(receiptPath);
    await page.getByText("Review details").waitFor({ timeout: 120000 });
    await page.getByText("Same receipt image").first().waitFor();
    await page.getByRole("radio", { name: "Personal" }).click();
    await page.getByText("I've checked this amount").click();
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.getByRole("heading", { name: "Possible duplicate" }).waitFor();
    await page.getByRole("button", { name: "Go back" }).click();
  });

  await step("history: search, filter, receipt preview via signed URL, CSV export", async () => {
    await page.goto(`${BASE}/expenses`);
    await page.fill('input[type=search]', "lotus");
    await page.waitForURL(/q=lotus/);
    await page.getByText("Groceries at Lotus").waitFor();
    assert.equal(await page.getByText("Kotak kek").count(), 0);
    await page.goto(`${BASE}/expenses?ws=company`);
    await page.getByText("Kotak kek").waitFor();
    assert.equal(await page.getByText("Nasi lemak").count(), 0);
    await page.goto(`${BASE}/expenses`);
    await shot(page, "07-history-mobile");
    const res = await page.request.get(`${BASE}/api/expenses/export`);
    assert.equal(res.status(), 200);
    const csv = await res.text();
    assert.match(csv, /Date,Time,Workspace/);
    assert.match(csv, /Groceries at Lotus/);
    assert.match(csv, /,53\.00,MYR,/);
    // receipt preview
    await page.getByText("Mydin").first().click();
    await page.getByRole("button", { name: "View receipt" }).click();
    const img = page.locator('img[alt="Receipt"]');
    await img.waitFor();
    assert.match(await img.getAttribute("src"), /\/storage\/v1\/object\/sign\/receipts\//);
  });

  let companyExpenseUrl;
  await step("edit: moving an expense from Company to Personal updates both totals", async () => {
    await page.goto(`${BASE}/expenses?ws=company`);
    await page.getByText("Kotak kek").click();
    await page.waitForURL(/\/expenses\/[0-9a-f-]{36}$/);
    companyExpenseUrl = page.url();
    await page.locator('[role=radiogroup][aria-label="Workspace"]').getByRole("radio", { name: "Personal" }).click();
    // Office Supplies does not exist in Personal -> mapped to Other
    assert.equal(await page.getByRole("radio", { name: "Other" }).getAttribute("aria-checked"), "true");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(`${BASE}/expenses`);
    await page.goto(`${BASE}/expenses/summary`);
    assert.equal(await cardTotal("Personal"), "RM440.50");
    assert.equal(await cardTotal("Aina Bakery Sdn Bhd"), "RM0.00");
  });

  await step("delete removes the expense from totals", async () => {
    await page.goto(companyExpenseUrl);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await page.waitForURL(`${BASE}/expenses`);
    await page.goto(`${BASE}/expenses/summary`);
    assert.equal(await cardTotal("Personal"), "RM200.50");
    await shot(page, "08-dashboard-mobile");
  });

  await step("period filters: Today excludes yesterday's voice expense", async () => {
    await page.goto(`${BASE}/expenses/summary?period=today`);
    assert.equal(await cardTotal("Personal"), "RM65.50"); // 12.50 nasi lemak + 53.00 receipt
  });

  await step("reports render with real data", async () => {
    await page.goto(`${BASE}/reports`);
    await page.getByText("Category distribution").waitFor();
    await page.locator(".recharts-surface").first().waitFor();
    await shot(page, "09-reports-mobile");
  });

  await step("categories: create, rename, archive", async () => {
    await page.goto(`${BASE}/categories`);
    await page.getByLabel("Add category (Personal)").fill("Pets");
    await page.getByLabel("Add category (Personal)").press("Enter");
    await page.getByText("Pets", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Rename Pets" }).click();
    await page.getByLabel("Category name").fill("Pet care");
    await page.getByLabel("Category name").press("Enter");
    await page.getByText("Pet care", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Archive Pet care" }).click();
    await page.getByRole("button", { name: "Restore Pet care" }).waitFor();
  });

  await step("settings: Bahasa Melayu localisation and dark mode", async () => {
    await page.goto(`${BASE}/settings`);
    await page.getByRole("radio", { name: "Bahasa Melayu" }).click();
    await page.getByRole("heading", { name: "Tetapan" }).waitFor();
    await page.getByRole("radio", { name: "Gelap" }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    await page.goto(`${BASE}/expenses/summary`);
    await page.getByText("Jumlah belanja").first().waitFor();
    await shot(page, "10-dashboard-dark-ms-mobile");
    await page.goto(`${BASE}/settings`);
    await page.getByRole("radio", { name: "English" }).click();
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    await page.getByRole("radio", { name: "Light" }).click();
  });

  await step("isolation: another user cannot see or open user A's expense", async () => {
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await ctxB.addCookies([{ name: "kg_lang", value: "en", url: BASE }]);
    await b.goto(`${BASE}/signup`);
    await b.fill("#email", `badu+${stamp}@example.com`);
    await b.fill("#password", "another-strong-pass");
    await b.click("button[type=submit]");
    await b.waitForURL(`${BASE}/onboarding`);
    await b.fill("#biz-name", "Badu Store");
    await b.getByRole("button", { name: "Continue" }).click();
    await b.getByRole("heading", { name: "Bank details" }).waitFor();
    await b.getByRole("button", { name: "Skip for now" }).click();
    await b.getByRole("heading", { name: "Document preferences" }).waitFor();
    await b.getByRole("button", { name: "Skip for now" }).click();
    await b.getByRole("heading", { name: "Your business is ready!" }).waitFor();
    await b.goto(`${BASE}/expenses/summary`);
    assert.equal(await b.getByText("Aina Bakery").count(), 0);
    assert.equal((await b.locator('section[aria-label="Personal"] div.tabular').first().innerText()).trim(), "RM0.00");
    await page.goto(`${BASE}/expenses`);
    await page.getByText("Nasi lemak").click();
    await page.waitForURL(/\/expenses\/[0-9a-f-]{36}$/);
    const aUrl = page.url();
    await b.goto(aUrl);
    // RLS returns no row, so the page renders Not found (streamed responses keep HTTP 200 in Next.js).
    await b.getByRole("heading", { name: "Not found" }).waitFor();
    assert.equal(await b.getByText("Nasi lemak").count(), 0);
    assert.equal(await b.locator("#edit-amount").count(), 0);
    const exp = await b.request.get(`${BASE}/api/expenses/export`);
    assert.doesNotMatch(await exp.text(), /Nasi lemak/);
    await ctxB.close();
  });

  await step("unauthenticated API access is rejected", async () => {
    const anon = await browser.newContext();
    const r1 = await anon.request.post(`${BASE}/api/voice/parse`, { data: { transcript: "RM5 kopi" } });
    assert.equal(r1.status(), 401);
    const r2 = await anon.request.get(`${BASE}/api/expenses/export`, { maxRedirects: 0 });
    assert.ok([302, 307].includes(r2.status()));
    await anon.close();
  });

  await step("desktop layout (sidebar) renders", async () => {
    const desk = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, storageState: await ctxA.storageState() });
    const d = await desk.newPage();
    await d.goto(`${BASE}/`);
    await d.getByRole("link", { name: "Expense Summary" }).first().waitFor();
    await shot(d, "11-dashboard-desktop");
    await d.goto(`${BASE}/reports`);
    await d.locator(".recharts-surface").first().waitFor();
    await d.waitForTimeout(400);
    await shot(d, "12-reports-desktop");
    await d.goto(`${BASE}/login`);
    await desk.clearCookies();
    await d.goto(`${BASE}/login`);
    await shot(d, "13-login-desktop");
    await desk.close();
  });
} finally {
  await browser.close();
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} steps passed`);
  process.exitCode = failed ? 1 : 0;
}
