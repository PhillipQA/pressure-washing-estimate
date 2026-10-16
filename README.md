# Pressure Washing Estimate

A one-page tool a pressure washing company can use to give a customer a price on the spot.

The customer enters the size of each area to clean and the price updates as they type. They add their contact details and submit. The page then emails the customer's details and the full quote to **careers@finchharbor.com**.

- **Live page:** https://phillipqa.github.io/pressure-washing-estimate/
- **Repository:** https://github.com/PhillipQA/pressure-washing-estimate

## Pricing

| Service | Rate |
|---|---|
| House | $0.15 per sq ft |
| Driveway | $0.12 per sq ft |
| Deck | $0.30 per sq ft |
| Fence | $1.00 per linear ft |
| Minimum job | $150 |

Worked examples:

| Job | Subtotal | Total |
|---|---|---|
| House 2,000 sq ft | $300.00 | **$300.00** |
| Fence 100 ft | $100.00 | **$150.00** (minimum applied, +$50.00) |
| House 500 sq ft + Fence 50 ft | $125.00 | **$150.00** (minimum applied) |
| House 1,000 sq ft | $150.00 | **$150.00** (exactly the minimum, no adjustment) |
| House 2,000 + Driveway 600 + Deck 200 + Fence 100 | $532.00 | **$532.00** |

## Assumptions

The brief said questions would not be answered, so these decisions are recorded here:

1. A customer can combine any of the four services in one quote. The $150 minimum applies to the job total, not to each service.
2. A job that comes to exactly $150.00 costs $150.00. The minimum only adds an adjustment when the subtotal is below $150.
3. The customer enters each size themselves:
   - Square feet for the house, driveway and deck; linear feet for the fence.
   - Whole numbers or up to 2 decimal places. Commas are accepted as thousands separators (`1,500`).
   - Blank or 0 means the service isn't needed.
   - The maximum is 100,000 per area. Anything larger needs an on-site quote.
4. Amounts are calculated in cents and rounded to the nearest cent, so there is no floating-point drift.
5. The page asks for the details a company needs to follow up on a quote:
   - Required: name, phone, email and property address.
   - Optional: notes.
   - **Email** must be a properly formed address: one @, no leading, trailing or double dots, a real-looking domain and a top-level domain of 2+ letters. `name+tag@sub.example.co.uk` passes; `maria@example`, `maria..x@example.com` and `maria@example.c` don't.
   - **Phone** has a country-code dropdown.
     - The country is preselected from the visitor's time zone, then their browser language, falling back to the US.
     - Typing a number that starts with `+code` switches the dropdown to that country.
     - The number is checked against that country's length. US and Canadian numbers also follow the North American area-code rules.
     - A leading trunk 0 is accepted (`0917 123 4567` for the Philippines).
     - The email gets the number in international format (`+63 9171234567`).
     - Countries not in the list can use "Other" with `+code`.
6. The email goes to the company (careers@finchharbor.com) only. The customer sees the confirmation and quote number on screen. Reply-To is set to the customer's email so the company can answer directly.

## How it works

- **Static site.** It has no build step and no server.
  - `index.html` and `styles.css`: the page.
  - `app.js`: page behaviour.
  - `quote-logic.js`: pricing, input parsing, validation and email content. It has no DOM code, so it is unit-tested in Node.
- **Hosting:** GitHub Pages.
- **Email:** sent from the browser with [EmailJS](https://www.emailjs.com/).
  - The EmailJS template's recipient is fixed to careers@finchharbor.com.
  - The public key and IDs are in `config.js`. EmailJS public keys are designed to be public.
- **Honest confirmation.** The success screen only appears after EmailJS confirms the email was sent. If sending fails or takes more than 20 seconds:
  - The customer sees an error saying whether it was their connection or the email service.
  - They can retry without retyping anything.
  - They get a link that opens the same quote in their own email app, already addressed to careers@finchharbor.com, so the lead is never lost.
- **Defensive by default:**
  - Inline validation; focus moves to the first problem. The "fix the highlighted fields" banner clears once everything is fixed.
  - Pressing Enter (or "Go" on a phone keyboard) in a size box moves to the next box instead of submitting a half-filled form.
  - The submit button locks while sending, so a double click sends one email.
  - A hidden honeypot field catches bots.
  - All customer text is HTML-escaped in the email.
  - Accessibility: labelled fields, keyboard friendly, and the price is announced to screen readers when it changes.
- **Responsive.** On a phone the price sits right under the sizes. On desktop it's a sticky side panel.

### EmailJS template settings

| Field | Value |
|---|---|
| Subject | `{{subject}}` |
| Content | `{{{message_html}}}` |
| To Email | `careers@finchharbor.com` |
| From Name | `{{customer_name}}` |
| Reply To | `{{customer_email}}` |

Also sent, if you prefer to lay out the template yourself:
- Customer: `customer_phone`, `service_address`, `notes`
- Quote: `quote_id`, `quote_date`, `quote_subtotal`, `quote_total`, `minimum_applied`
- Plain-text body: `message`

## Known limitations

These come from a red-team review before submission.

- **Anyone can send to the inbox.** A page that sends email from the browser has to expose its EmailJS public key. That means someone could script submissions to careers@finchharbor.com and use up the free plan (200 emails a month).
  - The fixed recipient means the key can't be used to email anyone else.
  - Mitigations for production: EmailJS's origin allowlist and CAPTCHA, or moving sending behind a small server function.
- **Possible duplicate after a timeout.** If EmailJS answers after the 20-second timeout, a customer who retries could send a duplicate email.
- **Unpinned email library.** The EmailJS script loads from jsDelivr at major version 4 without a pinned version or integrity hash.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Tests

```bash
node --test
```

17 unit tests cover:
- Every rate.
- The $150 boundary: $149.85 → $150.00, $150.00 stays $150.00, $150.15 stays $150.15.
- Combined jobs, the largest allowed job ($157,000.00) and decimal rounding.
- The mailto fallback.
- Size parsing: rejects `abc`, `-5`, `1e3`, `1,5`, `12.345` and `100001`.
- Detail validation, including valid vs malformed emails, per-country phone rules, `+code` detection and country auto-detection.
- HTML escaping in the email.

A headless-browser smoke test was also run at 390px and 1280px wide, with the email service stubbed. It checked:
- Empty submit is blocked and nothing is sent.
- A negative size shows an error.
- Fence 100 ft shows $150.00 with the minimum note.
- The combined job shows $532.00, with no horizontal scroll.
- An invalid email is blocked.
- A double-click sends exactly one email, with the right IDs, recipient, total and reply-to.
- `<script>` in the notes is escaped.
- The success screen appears, and "Start a new quote" resets the page.

### End-to-end tests (Playwright)

```bash
npm install
npx playwright install chromium
npm run test:e2e          # against a local copy (starts its own server)
npm run test:e2e:live     # against the live GitHub Pages site
npx playwright show-report
```

**No test sends a real email.**
- `tests-e2e/fixtures.js` replaces the EmailJS library with a stub that records what would have been sent, so the tests can still check the exact email content.
- Any request to the real EmailJS API is aborted and fails the test.
- The stub can also simulate an email service error and a network failure.

There are 65 tests, each run on desktop Chrome and a Pixel 7 phone (130 runs). They live in `tests-e2e/quote.spec.js` and use a page object in `tests-e2e/quote-page.js`:

| Area | What's covered |
|---|---|
| Live price | The four rates; each service alone; the $150 minimum at $149.85 / $150.00 / $150.15; minimum on the job total; all four combined ($532.00); changing and clearing sizes; `1,500` and decimals |
| Bad sizes | `-5`, `abc`, `1e3`, `12.345`, `1,5` and `100001` are each rejected and left out of the price; Enter in a size box doesn't submit |
| Validation | Empty submit blocked; name, phone, email and address required but notes optional; red asterisks; spaces-only input; 10 malformed emails rejected and 3 valid ones accepted; bad phones per country; `+63` switches the dropdown; a UK number with trunk 0 is accepted; changing the country re-checks the number; country codes listed; error banner clears once fixed |
| Submitting | Exact email content (recipient, reply-to, every customer field, line items, totals, quote ID matches the screen); minimum shown in the email; one email from repeated clicks; HTML escaped; Start a new quote resets; spam trap sends nothing |
| Failures | Service error and network failure: the right message, details kept, mailto fallback to careers@finchharbor.com, retry allowed |
| Country detection | Manila → PH, London → GB, New York → US, Sydney → AU, UTC with en-CA → CA; "Start a new quote" returns to the detected country |
| Layout | No horizontal scroll with the largest values and a 100-character name; price panel after the sizes on a phone and beside the form on desktop |

The tests also run on every push through GitHub Actions (`.github/workflows/tests.yml`).

A second, attack-focused browser run checked:
- Enter in a size box does not submit.
- A triple click plus Enter while sending sends one email.
- A filled honeypot sends nothing.
- The largest sizes and a 100-character name cause no horizontal scroll at 360px.
- An email service error and a network failure each show the right message and the mailto fallback, keep the data, and allow a retry.

### Manual test checklist

| # | Check | Steps / data | Expected |
|---|---|---|---|
| 1 | Single service price | House `2000` | Total $300.00 |
| 2 | Minimum applied | Fence `100` | Subtotal $100.00, adjustment +$50.00, total $150.00, minimum note shown |
| 3 | Minimum boundary | House `1000` | Total $150.00, no adjustment line |
| 4 | Combined job | House 2000, Driveway 600, Deck 200, Fence 100 | Total $532.00 |
| 5 | Nothing selected | Submit with all sizes blank | "Enter a size for at least one area…", nothing sent |
| 6 | Bad size | Deck `-5`, then `abc` | Inline error; that line is left out of the price |
| 7 | Required details | Submit with details empty | An inline error on each field, focus on the first, nothing sent |
| 8 | Bad email | `maria.example.com` | "Enter a valid email address…" |
| 9 | Happy path | Valid sizes and details, submit | Button shows "Sending…", then a success screen with the quote number. The email arrives at careers@finchharbor.com with the same details and total |
| 10 | Double submit | Double-click Send | Exactly one email |
| 11 | Injection | Name `<b>Test</b>` | Shown as plain text in the email |
| 12 | Mobile | 375px wide | Single column, no horizontal scroll, price visible right after the sizes |
| 13 | Send failure | DevTools → Offline, then submit | Error message; details are kept; retry works once back online |
