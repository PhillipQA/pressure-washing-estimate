// End-to-end tests for the pressure washing quote page.
// Email sending is stubbed in ./fixtures.js: these tests never send a real email.
const { test, expect } = require("./fixtures");
const { QuotePage, VALID_CUSTOMER } = require("./quote-page");

const RECIPIENT = "careers@finchharbor.com";

test.beforeEach(async ({ page }) => {
  await new QuotePage(page).open();
});

test.describe("Live price", () => {
  test("shows the published rates and no price before any size is entered", async ({ page }) => {
    const q = new QuotePage(page);
    await expect(page.locator('[data-rate-for="house"]')).toHaveText("$0.15 per sq ft");
    await expect(page.locator('[data-rate-for="driveway"]')).toHaveText("$0.12 per sq ft");
    await expect(page.locator('[data-rate-for="deck"]')).toHaveText("$0.30 per sq ft");
    await expect(page.locator('[data-rate-for="fence"]')).toHaveText("$1.00 per linear ft");
    await expect(q.total).toHaveText("$0.00");
    await expect(q.summary).toContainText("Enter a size for at least one area");
    await expect(q.totalNote).toHaveText("Every job has a $150 minimum.");
  });

  const singleServices = [
    { service: "house", size: "2000", line: "2,000 sq ft × $0.15", total: "$300.00" },
    { service: "driveway", size: "2000", line: "2,000 sq ft × $0.12", total: "$240.00" },
    { service: "deck", size: "1000", line: "1,000 sq ft × $0.30", total: "$300.00" },
    { service: "fence", size: "200", line: "200 linear ft × $1.00", total: "$200.00" }
  ];
  for (const c of singleServices) {
    test(`prices ${c.service} ${c.size} at ${c.total}`, async ({ page }) => {
      const q = new QuotePage(page);
      await q.setSizes({ [c.service]: c.size });
      await expect(q.summary).toContainText(c.line);
      await expect(q.total).toHaveText(c.total);
    });
  }

  test("applies the $150 minimum to a small job and shows the adjustment", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ fence: "100" });
    await expect(q.summary).toContainText("Subtotal$100.00");
    await expect(q.summary).toContainText("Minimum job adjustment+$50.00");
    await expect(q.total).toHaveText("$150.00");
    await expect(q.totalNote).toContainText("$150 minimum applies");
  });

  test("adds no adjustment when the job is exactly $150.00", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "1000" });
    await expect(q.total).toHaveText("$150.00");
    await expect(q.summary).not.toContainText("Minimum job adjustment");
  });

  test("does not round a $150.15 job down to the minimum", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "1001" });
    await expect(q.total).toHaveText("$150.15");
  });

  test("$149.85 job is raised to $150.00", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "999" });
    await expect(q.summary).toContainText("Subtotal$149.85");
    await expect(q.total).toHaveText("$150.00");
  });

  test("applies the minimum to the job total, not to each service", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "500", fence: "50" }); // $75 + $50
    await expect(q.summary).toContainText("Subtotal$125.00");
    await expect(q.total).toHaveText("$150.00");
  });

  test("combines all four services into one total", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "2000", driveway: "600", deck: "200", fence: "100" });
    await expect(q.total).toHaveText("$532.00"); // 300 + 72 + 60 + 100
    await expect(q.summary).not.toContainText("Minimum job adjustment");
  });

  test("updates the price when a size is changed or cleared", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "2000", deck: "200" });
    await expect(q.total).toHaveText("$360.00");
    await q.size("deck").fill("");
    await expect(q.total).toHaveText("$300.00");
    await q.size("house").fill("0");
    await expect(q.total).toHaveText("$0.00");
  });

  test("accepts commas as thousands separators and up to 2 decimals", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "1,500" });
    await expect(q.total).toHaveText("$225.00");
    await q.setSizes({ house: "1234.56" }); // $185.184 -> $185.18
    await expect(q.total).toHaveText("$185.18");
  });

  const badSizes = [
    { value: "-5", message: "can't be negative" },
    { value: "abc", message: "Enter a number" },
    { value: "1e3", message: "Enter a number" },
    { value: "12.345", message: "2 decimal places" },
    { value: "1,5", message: "thousands separators" },
    { value: "100001", message: "up to 100,000" }
  ];
  for (const c of badSizes) {
    test(`rejects size "${c.value}" and leaves it out of the price`, async ({ page }) => {
      const q = new QuotePage(page);
      await q.setSizes({ deck: c.value });
      await expect(q.sizeError("deck")).toContainText(c.message);
      await expect(q.size("deck")).toHaveAttribute("aria-invalid", "true");
      await expect(q.summary).toContainText("needs fixing");
      await expect(q.total).toHaveText("$0.00");
    });
  }

  test("Enter in a size box moves to the next box instead of submitting", async ({ page }) => {
    const q = new QuotePage(page);
    await q.size("house").fill("2000");
    await q.size("house").press("Enter");
    await expect(q.size("driveway")).toBeFocused();
    await q.size("fence").press("Enter");
    await expect(q.name).toBeFocused();
    await expect(q.fieldError("name")).toBeHidden();
    expect(await q.sentEmails()).toHaveLength(0);
  });
});

test.describe("Validation", () => {
  test("blocks an empty submit and sends nothing", async ({ page }) => {
    const q = new QuotePage(page);
    await q.submit.click();
    await expect(q.servicesError).toContainText("Enter a size for at least one area");
    await expect(q.size("house")).toBeFocused();
    await expect(q.status).toHaveText("Please fix the highlighted fields.");
    expect(await q.sentEmails()).toHaveLength(0);
  });

  test("requires name, phone, email and address but not notes", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "2000" });
    await q.submit.click();
    await expect(q.fieldError("name")).toHaveText("Enter your name.");
    await expect(q.fieldError("phone")).toHaveText("Enter your phone number.");
    await expect(q.fieldError("email")).toHaveText("Enter your email address.");
    await expect(q.fieldError("address")).toHaveText("Enter the address of the property.");
    await expect(q.fieldError("notes")).toBeHidden();
    await expect(q.name).toBeFocused();
    expect(await q.sentEmails()).toHaveLength(0);
  });

  test("marks required fields with a red asterisk and the required attribute", async ({ page }) => {
    for (const field of ["name", "phone", "email", "address"]) {
      await expect(page.locator(`label[for="${field}"] .req`)).toHaveText("*");
      await expect(page.locator(`#${field}`)).toHaveAttribute("required", "");
    }
    await expect(page.locator('label[for="notes"] .req')).toHaveCount(0);
    await expect(page.locator('label[for="notes"]')).toContainText("(optional)");
  });

  test("treats spaces-only details as empty", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ fence: "100" });
    await q.fillDetails({ name: "   ", address: "   " });
    await q.submit.click();
    await expect(q.fieldError("name")).toHaveText("Enter your name.");
    await expect(q.fieldError("address")).toHaveText("Enter the address of the property.");
    expect(await q.sentEmails()).toHaveLength(0);
  });

  for (const email of ["maria.example.com", "maria@example", "maria @example.com", "@example.com"]) {
    test(`rejects email "${email}"`, async ({ page }) => {
      const q = new QuotePage(page);
      await q.setSizes({ fence: "100" });
      await q.fillDetails({ email });
      await q.submit.click();
      await expect(q.fieldError("email")).toContainText("Enter a valid email address");
      expect(await q.sentEmails()).toHaveLength(0);
    });
  }

  for (const phone of ["12345", "call me", "1234567890123456"]) {
    test(`rejects phone "${phone}"`, async ({ page }) => {
      const q = new QuotePage(page);
      await q.setSizes({ fence: "100" });
      await q.fillDetails({ phone });
      await q.submit.click();
      await expect(q.fieldError("phone")).toContainText("Enter a valid phone number");
      expect(await q.sentEmails()).toHaveLength(0);
    });
  }

  test("accepts international phone formats and plus-addressed emails", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ fence: "100" });
    await q.fillDetails({ phone: "+63 917 123 4567", email: "maria+quotes@example.com" });
    await q.submit.click();
    await expect(q.success).toBeVisible();
  });

  test("clears the 'fix the highlighted fields' banner once everything is fixed", async ({ page }) => {
    const q = new QuotePage(page);
    await q.submit.click();
    await expect(q.status).toHaveText("Please fix the highlighted fields.");
    await q.setSizes({ house: "2000" });
    await q.fillDetails();
    await expect(q.status).toBeHidden();
  });
});

test.describe("Submitting (email stubbed)", () => {
  test("sends the customer details and the quote, then confirms", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "2000", driveway: "600", deck: "200", fence: "100" });
    await q.fillDetails({ notes: "Back gate code 1234" });
    await q.submit.click();

    await expect(q.submit).toHaveText("Sending…");
    await expect(q.submit).toBeDisabled();
    await expect(q.success).toBeVisible();
    await expect(q.form).toBeHidden();
    await expect(q.successTitle).toContainText(VALID_CUSTOMER.name);
    await expect(q.successTotal).toHaveText("$532.00");
    await expect(q.successId).toHaveText(/^PW-\d{8}-[A-Z0-9]{4}$/);

    const sent = await q.sentEmails();
    expect(sent).toHaveLength(1);
    const { serviceId, templateId, params } = sent[0];
    expect(serviceId).toMatch(/^service_/);
    expect(templateId).toMatch(/^template_/);
    expect(params).toMatchObject({
      to_email: RECIPIENT,
      reply_to: VALID_CUSTOMER.email,
      customer_name: VALID_CUSTOMER.name,
      customer_email: VALID_CUSTOMER.email,
      customer_phone: VALID_CUSTOMER.phone,
      service_address: VALID_CUSTOMER.address,
      notes: "Back gate code 1234",
      quote_subtotal: "$532.00",
      quote_total: "$532.00",
      minimum_applied: "No",
      quote_id: await q.successId.textContent()
    });
    expect(params.subject).toContain("$532.00");
    expect(params.message).toContain("House: 2,000 sq ft x $0.15 = $300.00");
    expect(params.message).toContain("Driveway: 600 sq ft x $0.12 = $72.00");
    expect(params.message).toContain("Deck: 200 sq ft x $0.30 = $60.00");
    expect(params.message).toContain("Fence: 100 linear ft x $1.00 = $100.00");
    expect(params.message_html).toContain("$532.00");
  });

  test("includes the minimum adjustment in the email for a small job", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ fence: "100" });
    await q.fillDetails();
    await q.submit.click();
    await expect(q.success).toBeVisible();
    const [{ params }] = await q.sentEmails();
    expect(params.quote_subtotal).toBe("$100.00");
    expect(params.quote_total).toBe("$150.00");
    expect(params.minimum_applied).toBe("Yes");
    expect(params.message).toContain("Minimum job adjustment ($150.00 minimum): +$50.00");
  });

  test("sends only one email when Send is clicked repeatedly", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "2000" });
    await q.fillDetails();
    await q.submit.click({ clickCount: 3 });
    await q.address.press("Enter");
    await expect(q.success).toBeVisible();
    expect(await q.sentEmails()).toHaveLength(1);
  });

  test("escapes customer text in the email", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ fence: "100" });
    await q.fillDetails({ name: "<b>Bold</b> Name", notes: "<script>alert(1)</script>" });
    await q.submit.click();
    await expect(q.success).toBeVisible();
    await expect(q.successTitle).toContainText("<b>Bold</b> Name"); // shown as text, not markup
    const [{ params }] = await q.sentEmails();
    expect(params.message_html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
    expect(params.message_html).toContain("&lt;script&gt;");
    expect(params.message_html).not.toContain("<script>");
  });

  test("Start a new quote clears everything", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "2000" });
    await q.fillDetails();
    await q.submit.click();
    await expect(q.success).toBeVisible();
    await q.newQuote.click();
    await expect(q.form).toBeVisible();
    await expect(q.success).toBeHidden();
    await expect(q.size("house")).toHaveValue("");
    await expect(q.name).toHaveValue("");
    await expect(q.total).toHaveText("$0.00");
    await expect(q.size("house")).toBeFocused();
  });

  test("sends nothing when the hidden spam trap is filled in", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ fence: "100" });
    await q.fillDetails();
    await q.honeypot.evaluate((el) => { el.value = "http://spam.example"; });
    await q.submit.click();
    await expect(q.success).toBeVisible();
    expect(await q.sentEmails()).toHaveLength(0);
  });

  for (const { mode, message } of [
    { mode: "serviceError", message: "our quote service couldn't send this" },
    { mode: "networkError", message: "check your connection" }
  ]) {
    test.describe(`when sending fails (${mode})`, () => {
      test.use({ emailMode: mode });

      test("shows an error, keeps the details and offers a mailto fallback", async ({ page }) => {
        const q = new QuotePage(page);
        await q.setSizes({ fence: "100" });
        await q.fillDetails();
        await q.submit.click();

        await expect(q.status).toContainText(message);
        await expect(q.success).toBeHidden();
        await expect(q.name).toHaveValue(VALID_CUSTOMER.name);
        await expect(q.submit).toBeEnabled();
        await expect(q.fallback).toBeVisible();
        const href = await q.fallbackLink.getAttribute("href");
        expect(href).toMatch(new RegExp("^mailto:" + RECIPIENT + "\\?subject="));
        expect(decodeURIComponent(href)).toContain("TOTAL: $150.00");

        await q.submit.click(); // retry is allowed
        await expect.poll(async () => (await q.sentEmails()).length).toBe(2);
      });
    });
  }
});

test.describe("Layout", () => {
  test("has no horizontal scroll with the largest values and a long name", async ({ page }) => {
    const q = new QuotePage(page);
    await q.setSizes({ house: "100,000", driveway: "100,000", deck: "100,000", fence: "100,000" });
    await expect(q.total).toHaveText("$157,000.00");
    await q.fillDetails({ name: "W".repeat(100) });
    expect(await q.hasHorizontalScroll()).toBe(false);
    await q.submit.click();
    await expect(q.success).toBeVisible();
    expect(await q.hasHorizontalScroll()).toBe(false);
  });

  test("shows the price panel right after the sizes", async ({ page }) => {
    const sizesBox = await page.locator(".area-services").boundingBox();
    const priceBox = await page.locator(".summary").boundingBox();
    const detailsBox = await page.locator(".area-details").boundingBox();
    const viewport = page.viewportSize();
    if (viewport.width < 900) {
      // Phone: stacked, price between sizes and details.
      expect(priceBox.y).toBeGreaterThan(sizesBox.y);
      expect(priceBox.y).toBeLessThan(detailsBox.y);
    } else {
      // Desktop: price panel beside the form.
      expect(priceBox.x).toBeGreaterThan(sizesBox.x + sizesBox.width - 1);
    }
  });
});
