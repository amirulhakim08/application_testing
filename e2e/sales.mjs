// End-to-end test for the sales modules (Phase 2) against a running app + local Supabase.
// Usage: BASE_URL=http://localhost:3000 SHOTS=./e2e/screenshots node e2e/sales.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";
import fs from "node:fs";

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
    console.log("FAIL", name, "\n   ", e.message.split("\n").slice(0, 6).join("\n    "));
    throw e;
  }
};
const shot = async (p, name) => SHOTS && p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const kl = (offsetDays = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date(Date.now() + offsetDays * 86400000));
const day = kl().slice(2).replaceAll("-", ""); // YYMMDD, numbers are PREFIX-YYMMDDNNN

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
await ctx.addCookies([{ name: "kg_lang", value: "en", url: BASE }]);

async function signupWithBusiness(p, email, business) {
  await p.goto(`${BASE}/signup`);
  await p.fill("#fullName", "Owner");
  await p.fill("#email", email);
  await p.fill("#password", "correct-horse-battery");
  await p.click("button[type=submit]");
  await p.waitForURL(`${BASE}/onboarding`);
  await p.fill("#biz-name", business);
  await p.fill("#biz-phone", "03-1234 5678");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByRole("heading", { name: "Bank details" }).waitFor();
  await p.fill("#bank-name", "Maybank");
  await p.fill("#bank-no", "5123 4567 8901");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByRole("heading", { name: "Document preferences" }).waitFor();
  await p.fill("#doc-tax", "8");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByRole("heading", { name: "Your business is ready!" }).waitFor();
}

async function addItem(p, idx, { description, qty, price, discount, tax }) {
  if (idx > 0) await p.getByRole("button", { name: "Add item" }).click();
  await p.fill(`#item-${idx}-description`, description);
  if (qty !== undefined) await p.fill(`#item-${idx}-qty`, qty);
  if (price !== undefined) await p.fill(`#item-${idx}-price`, price);
  if (discount !== undefined) await p.fill(`#item-${idx}-discount`, discount);
  if (tax !== undefined) await p.fill(`#item-${idx}-tax`, tax);
}

let quotationUrl, invoiceUrl, bigInvoiceUrl;

try {
  await step("owner signs up and sets up the business", async () => {
    await signupWithBusiness(page, `sales+${stamp}@example.com`, "Kedai Runcit Aina");
  });

  await step("Test 2a: create customer and catalog item", async () => {
    await page.goto(`${BASE}/customers`);
    await page.getByText("No customers yet").waitFor();
    await page.getByRole("button", { name: "New customer" }).click();
    await page.fill("#cus-name", "Encik Ali");
    await page.fill("#cus-company", "Syarikat Maju Jaya");
    await page.fill("#cus-phone", "012-345 6789");
    await page.fill("#cus-billing", "12 Jalan Industri, 43000 Kajang");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await page.getByRole("link", { name: /Encik Ali/ }).waitFor();

    await page.goto(`${BASE}/products`);
    await page.getByRole("button", { name: "New item" }).click();
    await page.fill("#prd-name", "Website Development");
    await page.fill("#prd-price", "150");
    await page.fill("#prd-unit", "page");
    assert.equal(await page.inputValue("#prd-tax"), "8"); // business default SST rate
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await page.getByText("RM150.00").waitFor();
    await shot(page, "s01-products");
  });

  await step("Test 2b: quotation with catalog item, custom item, discount and service charge", async () => {
    await page.goto(`${BASE}/quotations/new`);
    await page.selectOption("#doc-customer", { label: "Encik Ali — Syarikat Maju Jaya" });
    await page.getByLabel("From catalog").selectOption({ label: "Website Development — RM150.00" });
    await page.fill("#item-0-qty", "2");
    await addItem(page, 1, { description: "Domain setup", price: "99.99", discount: "9.99", tax: "0" });
    await page.getByRole("button", { name: "Add charge (e.g. service charge)" }).click(); // defaults to 10%
    // live preview: 300 + 99.99 - 9.99 + 39.00 + 24.00 = 453.00
    await page.getByText("RM453.00").first().waitFor();
    await shot(page, "s02-quotation-editor");
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/quotations\/[0-9a-f-]{36}$/);
    quotationUrl = page.url();
    await page.getByRole("heading", { name: `QT-${day}001` }).waitFor();
    await page.getByText("RM453.00").first().waitFor();
    await page.getByText("Draft").first().waitFor();
    await shot(page, "s03-quotation-view");
  });

  await step("Test 3: mark sent → convert to invoice (double click safe), quotation preserved", async () => {
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await page.getByText("Sent", { exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Edit" }).count(), 0);
    const convert = page.getByRole("button", { name: "Convert to Invoice" });
    await convert.dblclick();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    invoiceUrl = page.url();
    await page.getByText("Draft (number given on issue)").waitFor();
    await page.getByText("RM453.00").first().waitFor();
    await page.goto(quotationUrl);
    await page.getByText("Accepted").first().waitFor();
    await page.getByRole("link", { name: "Open invoice" }).waitFor();
    await page.goto(`${BASE}/invoices?status=draft`);
    assert.equal(await page.locator('a[href^="/invoices/"]:not([href="/invoices/new"])').count(), 1, "exactly one draft invoice from the conversion");
  });

  await step("issue invoice: numbered and immutable", async () => {
    await page.goto(invoiceUrl);
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Issue invoice" }).click();
    await page.getByRole("heading", { name: `INV-${day}001` }).waitFor();
    await page.getByText("Unpaid").first().waitFor();
    assert.equal(await page.getByRole("link", { name: "Edit" }).count(), 0);
    await page.goto(`${invoiceUrl}/edit`);
    await page.waitForURL(invoiceUrl); // issued invoices redirect away from the editor
  });

  await step("Test 4/5: RM5,000 invoice, RM2,000 then RM3,000; receipts per payment", async () => {
    await page.goto(`${BASE}/invoices/new`);
    await page.selectOption("#doc-customer", { label: "Encik Ali — Syarikat Maju Jaya" });
    await addItem(page, 0, { description: "Projek pengubahsuaian", qty: "1", price: "5000", tax: "0" });
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    bigInvoiceUrl = page.url();
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Issue invoice" }).click();
    await page.getByRole("heading", { name: `INV-${day}002` }).waitFor();

    await page.getByRole("button", { name: "Record payment" }).click();
    assert.equal(await page.inputValue("#pay-amount"), "5000.00"); // prefilled with the balance
    await page.fill("#pay-amount", "2000");
    await page.fill("#pay-ref", "MBB-778");
    // Double-click submit: the request key makes the second call return the same payment
    await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).dblclick();
    await page.getByText(`Receipt RC-${day}001 issued`).waitFor();
    await page.getByTestId("invoice-balance").filter({ hasText: "RM3,000.00" }).waitFor();
    await page.getByText("Partially paid").first().waitFor();
    assert.equal(await page.getByText(/MBB-778/).count(), 1, "one payment row, no duplicate");

    // Overpayment is refused
    await page.getByRole("button", { name: "Record payment" }).click();
    await page.fill("#pay-amount", "3000.01");
    await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
    await page.getByText("The amount is more than the invoice balance.").waitFor();
    await page.fill("#pay-amount", "3000");
    await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
    await page.getByText(`Receipt RC-${day}002 issued`).waitFor();
    await page.getByTestId("invoice-balance").filter({ hasText: "RM0.00" }).waitFor();
    await page.getByText("Paid", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Record payment" }).count(), 0);
    await shot(page, "s04-invoice-paid");
  });

  await step("void a payment restores the balance; voided receipt kept", async () => {
    await page.getByRole("button", { name: "Void payment" }).last().click();
    await page.fill("#vp-reason", "Cheque bounced");
    await page.getByRole("dialog").getByRole("button", { name: "Void payment" }).click();
    await page.getByTestId("invoice-balance").filter({ hasText: "RM3,000.00" }).waitFor();
    await page.getByText("Cheque bounced").waitFor();
  });

  await step("Phase 3: PDFs for invoice, quotation and receipt in all templates", async () => {
    const invId = bigInvoiceUrl.split("/").pop();
    for (const tpl of ["classic", "modern", "navy"]) {
      const r = await page.request.get(`${BASE}/api/documents/invoice/${invId}/pdf?template=${tpl}`);
      assert.equal(r.status(), 200, `invoice pdf ${tpl}`);
      assert.equal(r.headers()["content-type"], "application/pdf");
      assert.ok((await r.body()).subarray(0, 5).toString() === "%PDF-", "starts with %PDF-");
    }
    const dl = await page.request.get(`${BASE}/api/documents/invoice/${invId}/pdf?download=1`);
    assert.match(dl.headers()["content-disposition"] ?? "", /attachment; filename="[^"]*INV-\d{6}002\.pdf"/);
    // The invoice page offers the PDF buttons
    await page.getByRole("link", { name: "View PDF / Print" }).waitFor();
    const rcLink = page.locator('a[href^="/api/documents/receipt/"]').first();
    const rc = await page.request.get(`${BASE}${await rcLink.getAttribute("href")}`);
    assert.equal(rc.status(), 200);
    assert.ok((await rc.body()).subarray(0, 5).toString() === "%PDF-");
    await page.goto(`${BASE}/quotations`);
    await page.locator('a[href^="/quotations/"]').filter({ hasText: "QT-" }).first().click();
    const qtLink = page.getByRole("link", { name: "View PDF / Print" });
    const qt = await page.request.get(`${BASE}${await qtLink.getAttribute("href")}`);
    assert.equal(qt.status(), 200);
    // Not-found and bad kinds are refused
    assert.equal((await page.request.get(`${BASE}/api/documents/invoice/00000000-0000-0000-0000-000000000000/pdf`)).status(), 404);
    assert.equal((await page.request.get(`${BASE}/api/documents/bogus/${invId}/pdf`)).status(), 404);
  });

  await step("Phase 3: delivery order from invoice → issue → delivered", async () => {
    await page.goto(bigInvoiceUrl);
    await page.getByRole("button", { name: "Create Delivery Order" }).click();
    await page.waitForURL(/\/delivery-orders\/[0-9a-f-]{36}\/edit$/);
    assert.equal(await page.inputValue("[id^=do-desc-]"), "Projek pengubahsuaian");
    await page.fill("[id^=do-qty-]", "2");
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/delivery-orders\/[0-9a-f-]{36}$/);
    await page.getByText("Draft (number given on issue)").waitFor();
    await page.getByRole("button", { name: "Issue delivery order" }).click();
    await page.getByRole("heading", { name: `DO-${day}001` }).waitFor();
    await page.getByRole("button", { name: "Mark delivered" }).click();
    await page.fill("#dl-recv", "Pak Mat");
    await page.getByRole("dialog").getByRole("button", { name: "Mark delivered" }).click();
    await page.getByText("Pak Mat").waitFor();
    await page.getByText("Delivered", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Cancel delivery order" }).count(), 0, "delivered orders cannot be cancelled");
    const doPdf = await page.request.get(`${BASE}${await page.getByRole("link", { name: "View PDF / Print" }).getAttribute("href")}`);
    assert.equal(doPdf.status(), 200);
    if (SHOTS) fs.writeFileSync(`${SHOTS}/delivery-order.pdf`, await doPdf.body());
    await shot(page, "s11-delivery-order");
    await page.goto(`${BASE}/delivery-orders`);
    await page.getByText(`DO-${day}001`).waitFor();
  });

  await step("Test 6: overdue invoice appears in Outstanding with days overdue and reminder", async () => {
    await page.goto(`${BASE}/invoices/new`);
    await page.selectOption("#doc-customer", { label: "Encik Ali — Syarikat Maju Jaya" });
    await page.fill("#doc-date", kl(-40));
    await page.fill("#doc-second", kl(-10));
    await addItem(page, 0, { description: "Bekalan bulan lepas", qty: "1", price: "500", tax: "0" });
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Issue invoice" }).click();
    await page.getByText("Overdue 10 days").first().waitFor();

    await page.goto(`${BASE}/outstanding`);
    // 453.00 + 3,000.00 + 500.00
    await page.getByTestId("outstanding-total").filter({ hasText: "RM3,953.00" }).waitFor();
    await page.getByText("Overdue 10 days").first().waitFor();
    await page.getByText("Partially paid").first().waitFor(); // overdue never hides partial payment status
    await page.getByRole("button", { name: "WhatsApp reminder" }).first().click();
    const msg = await page.getByRole("dialog").locator("textarea").inputValue();
    assert.match(msg, /INV-\d{9}/);
    const href = await page.getByRole("link", { name: "Open WhatsApp" }).getAttribute("href");
    assert.match(href, /^https:\/\/wa\.me\/60123456789\?text=/);
    await shot(page, "s05-outstanding");
  });

  await step("standalone payment (walk-in sale) issues a receipt", async () => {
    await page.goto(`${BASE}/payments`);
    await page.getByRole("button", { name: "Record payment without invoice" }).click();
    await page.fill("#pay-desc", "Jualan kaunter");
    await page.fill("#pay-amount", "45");
    await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
    await page.getByText(/Receipt RC-\d{6}003 issued/).waitFor();
    await page.goto(`${BASE}/receipts`);
    await page.getByText("Jualan kaunter").waitFor();
    await shot(page, "s06-receipts");
  });

  await step("direct sale receipt: items, service charge, paid at once, no invoice", async () => {
    const invoicesBefore = await page.request.get(`${BASE}/invoices`).then((r) => r.text()).then((h) => (h.match(/INV-\d{9}/g) ?? []).length);
    await page.goto(`${BASE}/receipts`);
    await page.getByRole("link", { name: "New sale receipt" }).click();
    await page.waitForURL(`${BASE}/receipts/new`);
    await addItem(page, 0, { description: "Nasi lemak", qty: "2", price: "12.50", tax: "6" });
    await addItem(page, 1, { description: "Teh tarik", qty: "1", price: "3", tax: "0" });
    await page.getByRole("button", { name: /Add charge/ }).click(); // default: service charge 10%
    await page.selectOption("#sale-method", "duitnow");
    await page.getByText("RM32.30").first().waitFor(); // 28.00 + 2.80 charge + 1.50 tax
    await page.getByRole("button", { name: "Issue paid receipt" }).dblclick();
    await page.waitForURL(/\/receipts\/[0-9a-f-]{36}$/);
    await page.getByRole("heading", { name: `RC-${day}004` }).waitFor();
    await page.getByText("Direct sale").first().waitFor();
    await page.getByText("Walk-in customer (no name)").waitFor();
    await page.getByText("RM32.30").first().waitFor();
    const pdf = await page.request.get(`${BASE}${await page.getByRole("link", { name: "View PDF / Print" }).getAttribute("href")}`);
    assert.equal(pdf.status(), 200);
    if (SHOTS) fs.writeFileSync(`${SHOTS}/sale-receipt.pdf`, await pdf.body());
    await shot(page, "s12-sale-receipt");
    // Double click created one sale only, and no invoice was created
    await page.goto(`${BASE}/receipts`);
    assert.equal(await page.getByText(`RC-${day}005`).count(), 0, "no duplicate receipt");
    const invoicesAfter = await page.request.get(`${BASE}/invoices`).then((r) => r.text()).then((h) => (h.match(/INV-\d{9}/g) ?? []).length);
    assert.equal(invoicesAfter, invoicesBefore, "no invoice created");
  });

  await step("customer typed manually: one-off (not saved) and saved to the list", async () => {
    // One-off customer on a quotation: printed on the document, customer list unchanged
    await page.goto(`${BASE}/customers`);
    const before = await page.locator('a[href^="/customers/"]').count();
    await page.goto(`${BASE}/quotations/new`);
    await page.getByRole("radio", { name: "Type manually" }).click();
    await page.fill("#cm-name", "Puan Siti");
    await page.fill("#cm-phone", "012-3456789");
    await page.fill("#cm-address", "Lot 5, Bangi");
    await page.getByLabel("Save to customer list").uncheck();
    await addItem(page, 0, { description: "Kek coklat", qty: "1", price: "80" });
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/quotations\/[0-9a-f-]{36}$/);
    await page.getByText("Puan Siti").first().waitFor();
    await page.getByText("Lot 5, Bangi").waitFor();
    // Editing the draft keeps the typed details
    await page.getByRole("link", { name: "Edit" }).click();
    assert.equal(await page.inputValue("#cm-name"), "Puan Siti");
    // Convert → invoice → issue works without a listed customer
    await page.goBack();
    await page.getByRole("button", { name: "Convert to invoice" }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Issue invoice" }).click();
    await page.getByRole("heading", { name: /INV-\d{9}/ }).waitFor();
    await page.getByText("Puan Siti").first().waitFor();
    await page.goto(`${BASE}/customers`);
    assert.equal(await page.locator('a[href^="/customers/"]').count(), before, "one-off customer not added to the list");

    // Saved to the list (default) from a direct sale receipt
    await page.goto(`${BASE}/receipts/new`);
    await page.getByRole("radio", { name: "Type manually" }).click();
    await page.fill("#cm-name", "Encik Rahman");
    await addItem(page, 0, { description: "Roti canai", qty: "3", price: "1.50", tax: "0" });
    await page.getByRole("button", { name: "Issue paid receipt" }).click();
    await page.waitForURL(/\/receipts\/[0-9a-f-]{36}$/);
    await page.getByText("Encik Rahman").first().waitFor();
    await page.goto(`${BASE}/customers`);
    await page.getByRole("link", { name: /Encik Rahman/ }).waitFor();
    assert.equal(await page.locator('a[href^="/customers/"]').count(), before + 1, "saved customer added once");
  });

  await step("day/night toggle switches the theme and remembers it", async () => {
    await page.goto(`${BASE}/`);
    const before = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    await page.getByRole("button", { name: before ? "Switch to day mode" : "Switch to night mode" }).first().click();
    await page.waitForFunction((b) => document.documentElement.classList.contains("dark") !== b, before);
    await page.waitForTimeout(500);
    await page.goto(`${BASE}/receipts`);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), !before, "theme kept after navigation");
    await shot(page, "s13-receipts-night");
    await page.goto(`${BASE}/receipts/new`);
    await shot(page, "s14-sale-editor-night");
    await page.getByRole("button", { name: !before ? "Switch to day mode" : "Switch to night mode" }).first().click();
  });

  await step("customer profile shows totals and history", async () => {
    await page.goto(`${BASE}/customers`);
    await page.getByRole("link", { name: /Encik Ali/ }).click();
    await page.getByText("Total invoiced").waitFor();
    // invoiced 453 + 5,000 + 500 = 5,953; received 2,000 (3,000 voided); outstanding 3,953
    await page.getByText("RM5,953.00").waitFor();
    await page.getByText("RM2,000.00").first().waitFor();
    await page.getByText("RM3,953.00").waitFor();
    await shot(page, "s07-customer");
  });

  await step("Test 12: another business cannot open these documents", async () => {
    const other = await browser.newContext();
    await other.addCookies([{ name: "kg_lang", value: "en", url: BASE }]);
    const b = await other.newPage();
    await signupWithBusiness(b, `other+${stamp}@example.com`, "Bistro Lain");
    // PDFs of the first business are not served to the second one
    assert.equal((await b.request.get(`${BASE}/api/documents/invoice/${bigInvoiceUrl.split("/").pop()}/pdf`)).status(), 404, "foreign invoice PDF refused");
    for (const url of [quotationUrl, invoiceUrl, bigInvoiceUrl]) {
      await b.goto(url);
      await b.getByRole("heading", { name: "Not found" }).waitFor();
    }
    await b.goto(`${BASE}/customers`);
    assert.equal(await b.getByText("Encik Ali").count(), 0);
    await b.goto(`${BASE}/outstanding`);
    await b.getByText("No outstanding invoices").waitFor();
    // B's numbering starts from 0001 for B
    await b.goto(`${BASE}/quotations/new`);
    await addItem(b, 0, { description: "Nasi lemak", qty: "10", price: "5" });
    await b.getByRole("button", { name: "Save draft" }).click();
    await b.getByRole("heading", { name: `QT-${day}001` }).waitFor();
    await other.close();
  });

  await step("mobile layout: invoice and outstanding render at phone width", async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
    const mp = await m.newPage();
    await mp.goto(bigInvoiceUrl);
    await mp.getByTestId("invoice-balance").waitFor();
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `no horizontal page scroll (got ${overflow}px)`);
    await shot(mp, "s08-invoice-mobile");
    await mp.goto(`${BASE}/quotations/new`);
    await shot(mp, "s09-editor-mobile");
    await mp.getByRole("banner").getByRole("button", { name: "Menu" }).click();
    await mp.getByRole("link", { name: "Outstanding Invoices" }).click();
    await mp.waitForURL(`${BASE}/outstanding`);
    await shot(mp, "s10-outstanding-mobile");
    await m.close();
  });
} finally {
  await browser.close();
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} steps passed`);
  process.exitCode = failed ? 1 : 0;
}
