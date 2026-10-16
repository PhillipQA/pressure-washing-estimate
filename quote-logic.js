/*
 * Quote logic: pricing, input parsing, validation and email content.
 * Pure functions with no DOM access, so the same file runs in the browser
 * (window.QuoteLogic) and in Node for the unit tests (require).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.QuoteLogic = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Rates are stored in cents so totals never pick up floating-point drift.
  const SERVICES = [
    { id: "house", name: "House", unit: "sq ft", unitLong: "square feet", rateCents: 15 },
    { id: "driveway", name: "Driveway", unit: "sq ft", unitLong: "square feet", rateCents: 12 },
    { id: "deck", name: "Deck", unit: "sq ft", unitLong: "square feet", rateCents: 30 },
    { id: "fence", name: "Fence", unit: "linear ft", unitLong: "linear feet", rateCents: 100 }
  ];
  const MINIMUM_CENTS = 15000; // $150 minimum job
  const MAX_QUANTITY = 100000; // larger areas need an on-site quote

  function groupThousands(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatMoney(cents) {
    const value = Math.round(cents);
    const sign = value < 0 ? "-" : "";
    const abs = Math.abs(value);
    return sign + "$" + groupThousands(String(Math.floor(abs / 100))) + "." + String(abs % 100).padStart(2, "0");
  }

  function formatQuantity(quantity) {
    const text = Number.isInteger(quantity)
      ? String(quantity)
      : quantity.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    const parts = text.split(".");
    parts[0] = groupThousands(parts[0]);
    return parts.join(".");
  }

  /**
   * Parse a size typed by the customer.
   * Blank or 0 means "not needed". Returns { ok: true, value } or { ok: false, error }.
   */
  function parseQuantity(raw) {
    let s = String(raw == null ? "" : raw).trim();
    if (s === "") return { ok: true, value: 0 };
    if (s.charAt(0) === "-") return { ok: false, error: "Size can't be negative." };
    if (s.indexOf(",") !== -1) {
      // Only accept commas used as thousands separators, e.g. 1,500 or 12,000.5
      if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) {
        return { ok: false, error: "Enter a number like 1500 (commas only as thousands separators)." };
      }
      s = s.replace(/,/g, "");
    }
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return { ok: false, error: "Enter a number, like 1500." };
    if (/\.\d{3,}$/.test(s)) return { ok: false, error: "Use no more than 2 decimal places." };
    const value = Number(s);
    if (value > MAX_QUANTITY) {
      return { ok: false, error: "Enter a size up to " + formatQuantity(MAX_QUANTITY) + ". Larger areas need an on-site quote." };
    }
    return { ok: true, value: value };
  }

  function lineCents(quantity, rateCents) {
    const hundredths = Math.round(quantity * 100);
    return Math.round((hundredths * rateCents) / 100);
  }

  /**
   * Price a job. quantities: { house, driveway, deck, fence } (numbers; 0/blank = not needed).
   * The $150 minimum applies to the whole job, not to each service.
   */
  function calculate(quantities) {
    const q = quantities || {};
    const lines = [];
    let subtotalCents = 0;
    SERVICES.forEach(function (svc) {
      const quantity = Number(q[svc.id]);
      if (!isFinite(quantity) || quantity <= 0) return;
      const amountCents = lineCents(quantity, svc.rateCents);
      lines.push({
        id: svc.id,
        name: svc.name,
        unit: svc.unit,
        quantity: quantity,
        rateCents: svc.rateCents,
        amountCents: amountCents
      });
      subtotalCents += amountCents;
    });
    const hasWork = lines.length > 0;
    const minimumApplied = hasWork && subtotalCents < MINIMUM_CENTS;
    const totalCents = hasWork ? Math.max(subtotalCents, MINIMUM_CENTS) : 0;
    return {
      lines: lines,
      subtotalCents: subtotalCents,
      minimumApplied: minimumApplied,
      adjustmentCents: totalCents - subtotalCents,
      totalCents: totalCents
    };
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /** Returns an error message for a customer detail field, or "" when valid. */
  function validateField(field, raw) {
    const v = String(raw == null ? "" : raw).trim();
    switch (field) {
      case "name":
        if (!v) return "Enter your name.";
        if (v.length < 2) return "Enter your full name.";
        if (v.length > 100) return "Keep your name under 100 characters.";
        return "";
      case "email":
        if (!v) return "Enter your email address.";
        if (v.length > 254 || !EMAIL_RE.test(v)) return "Enter a valid email address, like name@example.com.";
        return "";
      case "phone": {
        if (!v) return "Enter your phone number.";
        const digits = v.replace(/\D/g, "").length;
        if (!/^\+?[0-9\s().-]+$/.test(v) || digits < 7 || digits > 15) {
          return "Enter a valid phone number, like (555) 123-4567.";
        }
        return "";
      }
      case "address":
        if (!v) return "Enter the address of the property.";
        if (v.length < 5) return "Enter the full address of the property.";
        if (v.length > 200) return "Keep the address under 200 characters.";
        return "";
      case "notes":
        if (v.length > 1000) return "Keep notes under 1,000 characters.";
        return "";
      default:
        return "";
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  /** Build the subject, plain-text and HTML bodies for the company email. */
  function buildEmail(quote) {
    const d = quote.details;
    const c = quote.calc;
    const esc = escapeHtml;
    const minimum = formatMoney(MINIMUM_CENTS);

    const subject = "New pressure washing quote " + quote.id + " – " + d.name + " – " + formatMoney(c.totalCents);

    const textLines = [
      "New pressure washing quote " + quote.id,
      "Date: " + quote.createdAt,
      "",
      "CUSTOMER",
      "Name: " + d.name,
      "Email: " + d.email,
      "Phone: " + d.phone,
      "Property address: " + d.address,
      "Notes: " + (d.notes || "-"),
      "",
      "QUOTE"
    ];
    c.lines.forEach(function (l) {
      textLines.push(
        l.name + ": " + formatQuantity(l.quantity) + " " + l.unit + " x " + formatMoney(l.rateCents) +
        " = " + formatMoney(l.amountCents)
      );
    });
    textLines.push("Subtotal: " + formatMoney(c.subtotalCents));
    if (c.minimumApplied) {
      textLines.push("Minimum job adjustment (" + minimum + " minimum): +" + formatMoney(c.adjustmentCents));
    }
    textLines.push("TOTAL: " + formatMoney(c.totalCents));
    const text = textLines.join("\n");

    const td = 'style="padding:8px 10px;border-bottom:1px solid #e3e8ef;"';
    const tdR = 'align="right" style="padding:8px 10px;border-bottom:1px solid #e3e8ef;white-space:nowrap;"';
    const th = 'style="padding:8px 10px;border-bottom:2px solid #0e1b2c;font-size:13px;color:#55657a;"';
    const detail = function (label, valueHtml) {
      return '<tr><td style="padding:6px 16px 6px 0;color:#55657a;white-space:nowrap;vertical-align:top;">' + label +
        '</td><td style="padding:6px 0;">' + valueHtml + "</td></tr>";
    };
    const rows = c.lines.map(function (l) {
      return "<tr><td " + td + ">" + esc(l.name) + "</td>" +
        "<td " + tdR + ">" + esc(formatQuantity(l.quantity)) + " " + esc(l.unit) + "</td>" +
        "<td " + tdR + ">" + esc(formatMoney(l.rateCents)) + " / " + esc(l.unit) + "</td>" +
        "<td " + tdR + "><strong>" + esc(formatMoney(l.amountCents)) + "</strong></td></tr>";
    }).join("");
    const footRow = function (label, value, strong) {
      const size = strong ? "font-size:17px;font-weight:bold;" : "";
      return '<tr><td colspan="3" align="right" style="padding:8px 10px;' + size + '">' + label +
        '</td><td align="right" style="padding:8px 10px;white-space:nowrap;' + size + '">' + value + "</td></tr>";
    };

    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;color:#0e1b2c;max-width:640px;line-height:1.45;">' +
      '<h2 style="margin:0 0 4px;font-size:20px;">New pressure washing quote: ' + esc(formatMoney(c.totalCents)) + "</h2>" +
      '<p style="margin:0 0 18px;color:#55657a;">Quote ' + esc(quote.id) + " &middot; " + esc(quote.createdAt) + "</p>" +
      '<h3 style="margin:0 0 6px;font-size:16px;">Customer</h3>' +
      '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:18px;">' +
      detail("Name", esc(d.name)) +
      detail("Email", '<a href="mailto:' + esc(d.email) + '">' + esc(d.email) + "</a>") +
      detail("Phone", esc(d.phone)) +
      detail("Property address", esc(d.address)) +
      detail("Notes", d.notes ? esc(d.notes).replace(/\r?\n/g, "<br>") : "&mdash;") +
      "</table>" +
      '<h3 style="margin:0 0 6px;font-size:16px;">Quote</h3>' +
      '<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">' +
      "<thead><tr><th align=\"left\" " + th + ">Service</th><th align=\"right\" " + th + ">Size</th>" +
      "<th align=\"right\" " + th + ">Rate</th><th align=\"right\" " + th + ">Amount</th></tr></thead>" +
      "<tbody>" + rows + "</tbody><tfoot>" +
      footRow("Subtotal", esc(formatMoney(c.subtotalCents)), false) +
      (c.minimumApplied
        ? footRow("Minimum job adjustment (" + esc(minimum) + " minimum)", "+" + esc(formatMoney(c.adjustmentCents)), false)
        : "") +
      footRow("Total", esc(formatMoney(c.totalCents)), true) +
      "</tfoot></table></div>";

    return { subject: subject, text: text, html: html };
  }

  /** Template parameters sent to EmailJS. */
  function buildEmailParams(quote, recipient) {
    const email = buildEmail(quote);
    const d = quote.details;
    const c = quote.calc;
    return {
      to_email: recipient,
      reply_to: d.email,
      subject: email.subject,
      message: email.text,
      message_html: email.html,
      quote_id: quote.id,
      quote_date: quote.createdAt,
      customer_name: d.name,
      customer_email: d.email,
      customer_phone: d.phone,
      service_address: d.address,
      notes: d.notes || "",
      quote_subtotal: formatMoney(c.subtotalCents),
      quote_total: formatMoney(c.totalCents),
      minimum_applied: c.minimumApplied ? "Yes" : "No"
    };
  }

  /** mailto: link with the same quote, used as a fallback if the email service fails. */
  function buildMailto(quote, recipient) {
    const email = buildEmail(quote);
    return "mailto:" + recipient +
      "?subject=" + encodeURIComponent(email.subject) +
      "&body=" + encodeURIComponent(email.text);
  }

  return {
    SERVICES: SERVICES,
    MINIMUM_CENTS: MINIMUM_CENTS,
    MAX_QUANTITY: MAX_QUANTITY,
    formatMoney: formatMoney,
    formatQuantity: formatQuantity,
    parseQuantity: parseQuantity,
    calculate: calculate,
    validateField: validateField,
    escapeHtml: escapeHtml,
    buildEmail: buildEmail,
    buildEmailParams: buildEmailParams,
    buildMailto: buildMailto
  };
});
