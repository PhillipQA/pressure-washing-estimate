// Test fixtures: every test gets a page where email sending is replaced by a recorder.
// No test can send a real email:
//   1. the EmailJS library (loaded from the CDN) is swapped for a stub that only records calls, and
//   2. any request to the real EmailJS API is aborted and fails the test.
const base = require("@playwright/test");

const OUTCOMES = {
  // EmailJS accepts the email (after a short delay, so "Sending…" can be observed).
  ok: "new Promise(function (resolve) { setTimeout(function () { resolve({ status: 200, text: 'OK' }); }, 400); })",
  // EmailJS answers with an error, e.g. monthly quota used up.
  serviceError: "Promise.reject({ status: 426, text: 'Quota exceeded' })",
  // The request never reaches EmailJS (customer offline).
  networkError: "Promise.reject(new TypeError('Failed to fetch'))"
};

function emailStub(mode) {
  return [
    "window.__sentEmails = [];",
    "window.emailjs = {",
    "  init: function (options) { window.__emailInit = options; },",
    "  send: function (serviceId, templateId, params) {",
    "    window.__sentEmails.push({ serviceId: serviceId, templateId: templateId, params: params });",
    "    return " + OUTCOMES[mode] + ";",
    "  }",
    "};"
  ].join("\n");
}

const test = base.test.extend({
  // Switch per describe block with: test.use({ emailMode: "serviceError" })
  emailMode: ["ok", { option: true }],

  page: async ({ page, emailMode }, use) => {
    const realEmailRequests = [];
    await page.route(/api\.emailjs\.com/, (route) => {
      realEmailRequests.push(route.request().url());
      return route.abort();
    });
    await page.route(/@emailjs\/browser/, (route) =>
      route.fulfill({ contentType: "application/javascript", body: emailStub(emailMode) })
    );

    await use(page);

    base.expect(realEmailRequests, "no request may reach the real EmailJS API").toEqual([]);
  }
});

module.exports = { test, expect: base.expect };
