const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../quote-logic.js");

const calc = (q) => L.calculate(q);

test("each service uses the published rate", () => {
  assert.equal(calc({ house: 2000 }).subtotalCents, 30000); // 2,000 x $0.15 = $300.00
  assert.equal(calc({ driveway: 2000 }).subtotalCents, 24000); // 2,000 x $0.12 = $240.00
  assert.equal(calc({ deck: 1000 }).subtotalCents, 30000); // 1,000 x $0.30 = $300.00
  assert.equal(calc({ fence: 200 }).subtotalCents, 20000); // 200 x $1.00 = $200.00
});

test("$150 minimum applies only when the job is under $150", () => {
  const under = calc({ house: 999 }); // $149.85
  assert.equal(under.subtotalCents, 14985);
  assert.equal(under.minimumApplied, true);
  assert.equal(under.adjustmentCents, 15);
  assert.equal(under.totalCents, 15000);

  const exact = calc({ house: 1000 }); // exactly $150.00
  assert.equal(exact.minimumApplied, false);
  assert.equal(exact.adjustmentCents, 0);
  assert.equal(exact.totalCents, 15000);

  assert.equal(calc({ house: 1001 }).totalCents, 15015); // $150.15
  assert.equal(calc({ driveway: 1249 }).totalCents, 15000); // $149.88 -> $150
  assert.equal(calc({ driveway: 1250 }).totalCents, 15000); // exactly $150
  assert.equal(calc({ deck: 499 }).totalCents, 15000); // $149.70 -> $150
  assert.equal(calc({ deck: 501 }).totalCents, 15030);
  assert.equal(calc({ fence: 149 }).totalCents, 15000);
  assert.equal(calc({ fence: 151 }).totalCents, 15100);
  assert.equal(calc({ fence: 1 }).totalCents, 15000);
});

test("minimum applies to the whole job, not to each service", () => {
  const small = calc({ house: 500, fence: 50 }); // $75 + $50 = $125
  assert.equal(small.subtotalCents, 12500);
  assert.equal(small.totalCents, 15000);

  const big = calc({ house: 600, fence: 80 }); // $90 + $80 = $170
  assert.equal(big.minimumApplied, false);
  assert.equal(big.totalCents, 17000);
});

test("all four services combine into one total", () => {
  const job = calc({ house: 2000, driveway: 600, deck: 200, fence: 100 }); // 300 + 72 + 60 + 100
  assert.equal(job.lines.length, 4);
  assert.equal(job.totalCents, 53200);
  assert.deepEqual(job.lines.map((l) => l.amountCents), [30000, 7200, 6000, 10000]);
});

test("no sizes means no price", () => {
  assert.equal(calc({}).totalCents, 0);
  assert.equal(calc({ house: 0, deck: 0 }).lines.length, 0);
  assert.equal(calc({ house: 0 }).minimumApplied, false);
});

test("decimals are priced to the nearest cent without float drift", () => {
  assert.equal(calc({ deck: 333.33 }).subtotalCents, 10000); // 99.999 -> $100.00
  assert.equal(calc({ house: 1234.56 }).subtotalCents, 18518); // 185.184 -> $185.18
  assert.equal(calc({ driveway: 0.1, fence: 0.2 }).totalCents, 15000); // tiny job still pays the minimum
});

test("money and size formatting", () => {
  assert.equal(L.formatMoney(53200), "$532.00");
  assert.equal(L.formatMoney(1234567), "$12,345.67");
  assert.equal(L.formatMoney(15), "$0.15");
  assert.equal(L.formatQuantity(1500), "1,500");
  assert.equal(L.formatQuantity(100.5), "100.5");
});

test("size input parsing", () => {
  assert.deepEqual(L.parseQuantity(""), { ok: true, value: 0 });
  assert.deepEqual(L.parseQuantity("   "), { ok: true, value: 0 });
  assert.equal(L.parseQuantity("1500").value, 1500);
  assert.equal(L.parseQuantity(" 1500 ").value, 1500);
  assert.equal(L.parseQuantity("1,500").value, 1500);
  assert.equal(L.parseQuantity("12.5").value, 12.5);
  assert.equal(L.parseQuantity("12.").value, 12);
  assert.equal(L.parseQuantity("100000").value, 100000);
  for (const bad of ["abc", "-5", "1e3", "1,5", "12.345", "100001", "5 ft", "+5", ".", "0x10"]) {
    assert.equal(L.parseQuantity(bad).ok, false, "should reject " + JSON.stringify(bad));
  }
});

test("customer detail validation", () => {
  assert.ok(L.validateField("name", ""));
  assert.ok(L.validateField("name", "   "));
  assert.equal(L.validateField("name", "Maria Santos"), "");
  assert.equal(L.validateField("name", "Seán O'Brien-López"), "");
  assert.ok(L.validateField("email", ""));
  assert.ok(L.validateField("email", "maria.example.com"));
  assert.ok(L.validateField("email", "maria@example"));
  assert.ok(L.validateField("email", "maria @example.com"));
  assert.equal(L.validateField("email", "maria+quotes@example.com"), "");
  assert.ok(L.validateField("phone", ""));
  assert.ok(L.validateField("phone", "12345"));
  assert.ok(L.validateField("phone", "call me"));
  assert.equal(L.validateField("phone", "(555) 123-4567"), "");
  assert.equal(L.validateField("phone", "+63 917 123 4567"), "");
  assert.ok(L.validateField("address", ""));
  assert.ok(L.validateField("address", "12"));
  assert.equal(L.validateField("address", "12 Harbor Rd, Springfield"), "");
  assert.equal(L.validateField("notes", ""), "");
  assert.ok(L.validateField("notes", "x".repeat(1001)));
});

test("email has the customer details and the quote, with customer text escaped", () => {
  const quote = {
    id: "PW-20261017-AB12",
    createdAt: "Oct 17, 2026, 1:30 AM",
    details: {
      name: "<b>Maria</b>",
      email: "maria@example.com",
      phone: "555-123-4567",
      address: "12 Harbor Rd",
      notes: "Gate code 1234\n<script>alert(1)</script>"
    },
    calc: L.calculate({ house: 500, fence: 50 })
  };
  const p = L.buildEmailParams(quote, "careers@finchharbor.com");
  assert.equal(p.to_email, "careers@finchharbor.com");
  assert.equal(p.reply_to, "maria@example.com");
  assert.equal(p.customer_email, "maria@example.com");
  assert.equal(p.quote_total, "$150.00");
  assert.equal(p.minimum_applied, "Yes");
  assert.match(p.subject, /PW-20261017-AB12/);
  assert.match(p.message_html, /&lt;b&gt;Maria&lt;\/b&gt;/);
  assert.doesNotMatch(p.message_html, /<b>Maria/);
  assert.doesNotMatch(p.message_html, /<script>/);
  assert.match(p.message_html, /555-123-4567/);
  assert.match(p.message_html, /12 Harbor Rd/);
  assert.match(p.message_html, /\$150\.00/);
  assert.match(p.message, /House: 500 sq ft x \$0\.15 = \$75\.00/);
  assert.match(p.message, /Fence: 50 linear ft x \$1\.00 = \$50\.00/);
  assert.match(p.message, /Minimum job adjustment/);
  assert.match(p.message, /TOTAL: \$150\.00/);
});
