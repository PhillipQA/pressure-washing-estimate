// Page object for the quote page.
const VALID_CUSTOMER = {
  name: "Test Customer",
  country: "US",
  phone: "(415) 555-0132",
  email: "test.customer@example.com",
  address: "12 Harbor Rd, Springfield",
  notes: ""
};

class QuotePage {
  constructor(page) {
    this.page = page;
    this.total = page.locator("#total");
    this.totalNote = page.locator("#total-note");
    this.summary = page.locator("#summary-lines");
    this.servicesError = page.locator("#err-services");
    this.name = page.locator("#name");
    this.phone = page.locator("#phone");
    this.country = page.locator("#phone-country");
    this.email = page.locator("#email");
    this.address = page.locator("#address");
    this.notes = page.locator("#notes");
    this.honeypot = page.locator("#hp-field");
    this.submit = page.getByRole("button", { name: /Send my quote|Sending/ });
    this.status = page.locator("#form-status");
    this.fallback = page.locator("#fallback");
    this.fallbackLink = page.locator("#fallback-link");
    this.form = page.locator("#quote-form");
    this.success = page.locator("#success-view");
    this.successTitle = page.locator("#success-title");
    this.successId = page.locator("#success-id");
    this.successTotal = page.locator("#success-total");
    this.newQuote = page.getByRole("button", { name: "Start a new quote" });
  }

  size(service) {
    return this.page.locator(`#qty-${service}`);
  }

  sizeError(service) {
    return this.page.locator(`#err-qty-${service}`);
  }

  fieldError(field) {
    return this.page.locator(`#err-${field}`);
  }

  async open() {
    await this.page.goto("index.html");
    await this.page.waitForFunction(() => window.QuoteLogic && window.__sentEmails);
  }

  async setSizes(sizes) {
    for (const [service, value] of Object.entries(sizes)) {
      await this.size(service).fill(String(value));
    }
  }

  async fillDetails(overrides = {}) {
    const d = { ...VALID_CUSTOMER, ...overrides };
    await this.name.fill(d.name);
    await this.country.selectOption(d.country);
    await this.phone.fill(d.phone);
    await this.email.fill(d.email);
    await this.address.fill(d.address);
    await this.notes.fill(d.notes);
  }

  sentEmails() {
    return this.page.evaluate(() => window.__sentEmails);
  }

  hasHorizontalScroll() {
    return this.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  }
}

module.exports = { QuotePage, VALID_CUSTOMER };
