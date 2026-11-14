// End-to-end smoke test against a running KiraGo + Supabase (see README "Testing").
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
  await step("sign up creates Personal + Company workspaces", async () => {
    await page.goto(`${BASE}/signup`);
    await page.fill("#fullName", "Aina Rahman");
    await page.fill("#email", emailA);
    await page.fill("#password", "correct-horse-battery");
    await page.fill("#companyName", "Aina Bakery Sdn Bhd");
    await shot(page, "01-signup-mobile");
    await page.click("button[type=submit]");
    await page.waitForURL(`${BASE}/`);
    await page.getByText("Aina Bakery Sdn Bhd").first().waitFor();
    assert.equal(await cardTotal("Personal"), "RM0.00");
    assert.equal(await cardTotal("Aina Bakery Sdn Bhd"), "RM0.00");
    await shot(page, "02-dashboard-empty-mobile");
  });

  await step("manual expense (personal) updates personal total only", async () => {
    await page.goto(`${BASE}/add/manual`);
    await page.fill("#f-amount", "12.50");
    await page.getByRole("radio", { name: "Personal" }).click();
    await page.getByRole("radio", { name: "Food & Drinks" }).click();
    await page.fill("#f-description", "Nasi lemak");
    await shot(page, "03-manual-mobile");
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.waitForURL(`${BASE}/`);
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
    await page.getByRole("radio", { name: "Packaging" }).click();
    await page.fill("#f-description", "Kotak kek");
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.waitForURL(`${BASE}/`);
    await page.getByText("Kotak kek").first().waitFor();
    assert.equal(await cardTotal("Personal"), "RM12.50");
    assert.equal(await cardTotal("Aina Bakery Sdn Bhd"), "RM240.00");
  });

  await step("duplicate manual entry triggers a warning before saving", async () => {
    await page.goto(`${BASE}/add/manual`);
    await page.fill("#f-amount", "240");
    await page.getByRole("radio", { name: "Aina Bakery" }).click();
    await page.getByRole("radio", { name: "Packaging" }).click();
    await page.fill("#f-description", "Kotak kek");
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.getByText("Possible duplicate").waitFor();
    await shot(page, "04-duplicate-warning-mobile");
    await page.getByRole("button", { name: "Go back" }).click();
    await page.goto(`${BASE}/`);
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
    await page.waitForURL(`${BASE}/`);
    await page.getByText("Groceries at Lotus").first().waitFor();
    assert.equal(await cardTotal("Personal"), "RM147.50");
  });

  await step("receipt scan without AI key: stored privately, manual completion, no AI amount", async () => {
    receiptPath = `/tmp/claude-0/receipt-${stamp}.png`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="white"/>
      <text x="40" y="80" font-size="36" font-family="monospace">MYDIN MART ${stamp}</text>
      <text x="40" y="200" font-size="28" font-family="monospace">SUBTOTAL 50.00</text>
      <text x="40" y="250" font-size="28" font-family="monospace">SST 6% 3.00</text>
      <text x="40" y="320" font-size="32" font-family="monospace">TOTAL 53.00</text>
      <text x="40" y="380" font-size="28" font-family="monospace">CASH 100.00</text>
      <text x="40" y="430" font-size="28" font-family="monospace">CHANGE 47.00</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(receiptPath);
    await page.goto(`${BASE}/add/scan`);
    await page.locator('input[type=file]:not([capture])').setInputFiles(receiptPath);
    await page.getByText("Review details").waitFor();
    await page.getByText("Receipt AI isn't configured").first().waitFor();
    assert.equal(await page.inputValue("#scan-amount"), ""); // never invented
    await page.fill("#scan-amount", "53.00");
    await page.getByRole("radio", { name: "Personal" }).click();
    await page.getByRole("radio", { name: "Groceries" }).click();
    await page.fill("#scan-merchant", "Mydin");
    await shot(page, "06-scan-review-mobile");
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.waitForURL(`${BASE}/`);
    assert.equal(await cardTotal("Personal"), "RM200.50");
  });

  await step("re-scanning the same receipt image warns about a duplicate", async () => {
    await page.goto(`${BASE}/add/scan`);
    await page.locator('input[type=file]:not([capture])').setInputFiles(receiptPath);
    await page.getByText("Review details").waitFor();
    await page.getByText("Same receipt image").first().waitFor();
    await page.fill("#scan-amount", "53.00");
    await page.getByRole("radio", { name: "Personal" }).click();
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
    // Packaging doesn't exist in Personal -> mapped to Other
    assert.equal(await page.getByRole("radio", { name: "Other" }).getAttribute("aria-checked"), "true");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(`${BASE}/expenses`);
    await page.goto(`${BASE}/`);
    assert.equal(await cardTotal("Personal"), "RM440.50");
    assert.equal(await cardTotal("Aina Bakery Sdn Bhd"), "RM0.00");
  });

  await step("delete removes the expense from totals", async () => {
    await page.goto(companyExpenseUrl);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await page.waitForURL(`${BASE}/expenses`);
    await page.goto(`${BASE}/`);
    assert.equal(await cardTotal("Personal"), "RM200.50");
    await shot(page, "08-dashboard-mobile");
  });

  await step("period filters: Today excludes yesterday's voice expense", async () => {
    await page.goto(`${BASE}/?period=today`);
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
    await page.goto(`${BASE}/`);
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
    await b.goto(`${BASE}/signup`);
    await b.fill("#email", `badu+${stamp}@example.com`);
    await b.fill("#password", "another-strong-pass");
    await b.click("button[type=submit]");
    await b.waitForURL(`${BASE}/`);
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
    await d.getByRole("link", { name: "Analytics" }).waitFor();
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
