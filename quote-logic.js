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

  /* ---------- Email ---------- */

  const LOCAL_PART_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
  const DOMAIN_LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

  /**
   * Practical email check (RFC 5321/5322 "dot-atom" form):
   * one @; local part up to 64 chars with no leading, trailing or double dots;
   * a domain of at least two labels (letters, digits, inner hyphens); a top-level domain of 2+ letters.
   */
  function isValidEmail(value) {
    const v = String(value == null ? "" : value).trim();
    if (!v || v.length > 254) return false;
    const at = v.indexOf("@");
    if (at < 1 || at !== v.lastIndexOf("@")) return false;
    const local = v.slice(0, at);
    const domain = v.slice(at + 1);
    if (local.length > 64 || !LOCAL_PART_RE.test(local)) return false;
    const labels = domain.split(".");
    if (labels.length < 2 || !labels.every(function (l) { return DOMAIN_LABEL_RE.test(l); })) return false;
    const tld = labels[labels.length - 1];
    return /^[A-Za-z]{2,63}$/.test(tld) || /^xn--[A-Za-z0-9-]{1,59}$/.test(tld);
  }

  /* ---------- Phone ---------- */

  // Calling codes. min/max = digits in the national number, after the country code and any leading trunk "0".
  const COUNTRIES = [
    { iso: "AU", name: "Australia", dial: "61", min: 9, max: 9, trunk: true },
    { iso: "BR", name: "Brazil", dial: "55", min: 10, max: 11, trunk: true },
    { iso: "CA", name: "Canada", dial: "1", min: 10, max: 10 },
    { iso: "CN", name: "China", dial: "86", min: 9, max: 11, trunk: true },
    { iso: "FR", name: "France", dial: "33", min: 9, max: 9, trunk: true },
    { iso: "DE", name: "Germany", dial: "49", min: 6, max: 11, trunk: true },
    { iso: "HK", name: "Hong Kong", dial: "852", min: 8, max: 8 },
    { iso: "IN", name: "India", dial: "91", min: 10, max: 10, trunk: true },
    { iso: "IE", name: "Ireland", dial: "353", min: 7, max: 9, trunk: true },
    { iso: "IT", name: "Italy", dial: "39", min: 6, max: 11 },
    { iso: "JP", name: "Japan", dial: "81", min: 9, max: 10, trunk: true },
    { iso: "KE", name: "Kenya", dial: "254", min: 9, max: 9, trunk: true },
    { iso: "MY", name: "Malaysia", dial: "60", min: 8, max: 10, trunk: true },
    { iso: "MX", name: "Mexico", dial: "52", min: 10, max: 10 },
    { iso: "NL", name: "Netherlands", dial: "31", min: 9, max: 9, trunk: true },
    { iso: "NZ", name: "New Zealand", dial: "64", min: 8, max: 10, trunk: true },
    { iso: "NG", name: "Nigeria", dial: "234", min: 8, max: 10, trunk: true },
    { iso: "PH", name: "Philippines", dial: "63", min: 8, max: 10, trunk: true },
    { iso: "SA", name: "Saudi Arabia", dial: "966", min: 8, max: 9, trunk: true },
    { iso: "SG", name: "Singapore", dial: "65", min: 8, max: 8 },
    { iso: "ZA", name: "South Africa", dial: "27", min: 9, max: 9, trunk: true },
    { iso: "KR", name: "South Korea", dial: "82", min: 8, max: 10, trunk: true },
    { iso: "ES", name: "Spain", dial: "34", min: 9, max: 9 },
    { iso: "AE", name: "United Arab Emirates", dial: "971", min: 8, max: 9, trunk: true },
    { iso: "GB", name: "United Kingdom", dial: "44", min: 9, max: 10, trunk: true },
    { iso: "US", name: "United States", dial: "1", min: 10, max: 10 },
    { iso: "ZZ", name: "Other (type + and country code)", dial: "", min: 0, max: 0 }
  ];
  const COUNTRY_BY_ISO = {};
  COUNTRIES.forEach(function (c) { COUNTRY_BY_ISO[c.iso] = c; });

  const TIMEZONE_COUNTRY = {
    "Asia/Manila": "PH", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Singapore": "SG",
    "Asia/Kuala_Lumpur": "MY", "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Tokyo": "JP",
    "Asia/Seoul": "KR", "Asia/Shanghai": "CN", "Asia/Hong_Kong": "HK", "Europe/London": "GB",
    "Europe/Dublin": "IE", "Europe/Berlin": "DE", "Europe/Paris": "FR", "Europe/Madrid": "ES",
    "Europe/Rome": "IT", "Europe/Amsterdam": "NL", "Africa/Johannesburg": "ZA", "Africa/Lagos": "NG",
    "Africa/Nairobi": "KE", "Pacific/Auckland": "NZ", "America/Toronto": "CA", "America/Vancouver": "CA",
    "America/Edmonton": "CA", "America/Winnipeg": "CA", "America/Halifax": "CA", "America/St_Johns": "CA",
    "America/Regina": "CA", "America/Mexico_City": "MX", "America/Cancun": "MX", "America/Monterrey": "MX",
    "America/Tijuana": "MX", "America/Sao_Paulo": "BR", "America/New_York": "US", "America/Chicago": "US",
    "America/Denver": "US", "America/Los_Angeles": "US", "America/Phoenix": "US", "America/Anchorage": "US",
    "America/Detroit": "US", "America/Boise": "US", "Pacific/Honolulu": "US"
  };

  /** Best guess at the visitor's country: time zone first, then browser language region, else US. */
  function detectCountry(env) {
    const e = env || {};
    const tz = e.timeZone || "";
    if (TIMEZONE_COUNTRY[tz]) return TIMEZONE_COUNTRY[tz];
    if (/^Australia\//.test(tz)) return "AU";
    if (/^America\/(Indiana|Kentucky|North_Dakota)\//.test(tz)) return "US";
    const langs = e.languages || [];
    for (let i = 0; i < langs.length; i++) {
      const m = /^[a-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2})(?:$|[-_])/.exec(langs[i] || "");
      if (m && COUNTRY_BY_ISO[m[1].toUpperCase()] && m[1].toUpperCase() !== "ZZ") return m[1].toUpperCase();
    }
    return "US";
  }

  /** For a number typed with "+", find the country whose calling code it starts with (keeps the chosen one if it fits). */
  function countryFromDialPrefix(digits, preferredIso) {
    const preferred = COUNTRY_BY_ISO[preferredIso];
    if (preferred && preferred.dial && digits.indexOf(preferred.dial) === 0) return preferred;
    let best = null;
    COUNTRIES.forEach(function (c) {
      if (!c.dial || digits.indexOf(c.dial) !== 0) return;
      if (!best || c.dial.length > best.dial.length) best = c;
    });
    if (best && best.dial === "1") return COUNTRY_BY_ISO.US; // +1 defaults to the US unless Canada was chosen
    return best;
  }

  /**
   * Validate a phone number for the chosen country (ISO code).
   * A number typed with its own "+code" overrides the dropdown.
   * Returns { ok, error, country, e164, display }.
   */
  function parsePhone(raw, iso) {
    const v = String(raw == null ? "" : raw).trim();
    let country = COUNTRY_BY_ISO[iso] || COUNTRY_BY_ISO.US;
    if (!v) return { ok: false, error: "Enter your phone number.", country: country };
    if (!/^\+?[0-9\s().-]+$/.test(v)) {
      return { ok: false, error: "Enter a valid phone number using digits, spaces, dashes or brackets.", country: country };
    }
    let digits = v.replace(/\D/g, "");

    if (v.charAt(0) === "+") {
      const match = countryFromDialPrefix(digits, country.iso);
      if (!match) {
        // Calling code not in our list: accept any E.164-length number.
        if (digits.length < 8 || digits.length > 15) {
          return { ok: false, error: "Enter a valid phone number with its country code.", country: COUNTRY_BY_ISO.ZZ };
        }
        return { ok: true, error: "", country: COUNTRY_BY_ISO.ZZ, e164: "+" + digits, display: "+" + digits };
      }
      country = match;
      digits = digits.slice(country.dial.length);
    } else if (country.iso === "ZZ") {
      return { ok: false, error: "Enter a valid phone number starting with + and your country code.", country: country };
    } else if (country.dial === "1" && digits.length === 11 && digits.charAt(0) === "1") {
      digits = digits.slice(1); // 1 (415) 555-0132
    }

    if (country.trunk && digits.charAt(0) === "0") digits = digits.slice(1); // 0917… -> 917…

    if (digits.length < country.min || digits.length > country.max) {
      const range = country.min === country.max ? String(country.min) : country.min + "–" + country.max;
      return {
        ok: false,
        error: "Enter a valid phone number: " + country.name + " numbers have " + range +
          " digits after +" + country.dial + ".",
        country: country
      };
    }
    if (country.dial === "1" && !/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
      return { ok: false, error: "Enter a valid phone number: US and Canadian numbers look like (415) 555-0132.", country: country };
    }
    return {
      ok: true,
      error: "",
      country: country,
      e164: "+" + country.dial + digits,
      display: "+" + country.dial + " " + digits
    };
  }

  /* ---------- Field validation ---------- */

  /** Returns an error message for a customer detail field, or "" when valid. ctx.country = phone country ISO code. */
  function validateField(field, raw, ctx) {
    const v = String(raw == null ? "" : raw).trim();
    switch (field) {
      case "name":
        if (!v) return "Enter your name.";
        if (v.length < 2) return "Enter your full name.";
        if (v.length > 100) return "Keep your name under 100 characters.";
        return "";
      case "email":
        if (!v) return "Enter your email address.";
        if (!isValidEmail(v)) return "Enter a valid email address, like name@example.com.";
        return "";
      case "phone":
        return parsePhone(v, ctx && ctx.country).error;
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
      "Additional comments: " + (d.notes || "-"),
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

    // Email-safe HTML: tables and inline styles only (Gmail/Outlook strip <style> and most CSS).
    const BRAND = "#0a66c2";
    const INK = "#0e1b2c";
    const MUTED = "#55657a";
    const LINE = "#e3e8ef";
    const FONT = "font-family:Arial,Helvetica,sans-serif;";
    const minimumShort = minimum.replace(/\.00$/, "");
    const phoneHref = "tel:" + String(d.phone).replace(/[^\d+]/g, "");
    const mapsHref = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(d.address);
    const replyHref = "mailto:" + d.email + "?subject=" + encodeURIComponent("Your pressure washing quote " + quote.id);
    const total = esc(formatMoney(c.totalCents));

    const link = function (href, textHtml) {
      return '<a href="' + esc(href) + '" style="color:' + BRAND + ';text-decoration:none;">' + textHtml + "</a>";
    };
    const sectionTitle = function (title) {
      return '<tr><td style="padding:26px 28px 8px;' + FONT + 'font-size:12px;font-weight:bold;letter-spacing:1px;' +
        'text-transform:uppercase;color:' + BRAND + ';">' + title + "</td></tr>";
    };
    const detailRow = function (label, valueHtml, last) {
      const border = last ? "" : "border-bottom:1px solid " + LINE + ";";
      return "<tr>" +
        '<td width="140" style="padding:11px 12px 11px 0;' + border + FONT + 'font-size:13px;color:' + MUTED + ';vertical-align:top;">' + label + "</td>" +
        '<td style="padding:11px 0;' + border + FONT + 'font-size:15px;color:' + INK + ';vertical-align:top;word-break:break-word;">' + valueHtml + "</td></tr>";
    };
    const lineRows = c.lines.map(function (l) {
      return "<tr>" +
        '<td style="padding:12px 0;border-bottom:1px solid ' + LINE + ';' + FONT + 'font-size:15px;color:' + INK + ';">' +
          "<strong>" + esc(l.name) + "</strong><br>" +
          '<span style="font-size:13px;color:' + MUTED + ';">' + esc(formatQuantity(l.quantity)) + " " + esc(l.unit) +
          " &times; " + esc(formatMoney(l.rateCents)) + "</span></td>" +
        '<td align="right" style="padding:12px 0;border-bottom:1px solid ' + LINE + ';' + FONT + 'font-size:15px;color:' + INK +
          ';white-space:nowrap;vertical-align:top;">' + esc(formatMoney(l.amountCents)) + "</td></tr>";
    }).join("");
    const sumRow = function (label, value, color) {
      return '<tr><td style="padding:12px 0 0;' + FONT + 'font-size:14px;color:' + color + ';">' + label + "</td>" +
        '<td align="right" style="padding:12px 0 0;' + FONT + 'font-size:14px;color:' + color + ';white-space:nowrap;">' + value + "</td></tr>";
    };
    const button = function (href, label, primary) {
      return '<td style="padding:0 10px 10px 0;"><a href="' + esc(href) + '" style="display:inline-block;padding:12px 22px;' +
        'border-radius:8px;' + FONT + 'font-size:14px;font-weight:bold;text-decoration:none;' +
        (primary ? "background:" + BRAND + ";color:#ffffff;" : "background:#eaf2fc;color:" + BRAND + ";") + '">' + label + "</a></td>";
    };
    const rates = SERVICES.map(function (s) {
      return esc(s.name) + " " + esc(formatMoney(s.rateCents)) + "/" + esc(s.unit);
    }).join(" &middot; ");

    const html =
      '<div style="margin:0;padding:24px 12px;background:#f2f6fa;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;' +
        'background:#ffffff;border:1px solid #dbe3ed;border-radius:14px;border-collapse:separate;overflow:hidden;">' +

      // Header: what this is and the price, at a glance
      '<tr><td style="background:' + BRAND + ';padding:28px;' + FONT + 'color:#ffffff;border-radius:14px 14px 0 0;">' +
        '<div style="font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#d6e6f8;">New pressure washing quote</div>' +
        '<div style="font-size:38px;font-weight:bold;line-height:1.15;margin:6px 0 6px;color:#ffffff;">' + total + "</div>" +
        '<div style="font-size:14px;color:#e3eefb;">' + esc(d.name) + " &middot; Quote " + esc(quote.id) + "</div>" +
        '<div style="font-size:13px;color:#c9ddf5;margin-top:2px;">' + esc(quote.createdAt) + "</div>" +
        (c.minimumApplied
          ? '<div style="display:inline-block;margin-top:14px;padding:5px 12px;border-radius:999px;background:#ffffff;color:' + BRAND +
            ';font-size:12px;font-weight:bold;">' + esc(minimumShort) + " minimum applied</div>"
          : "") +
      "</td></tr>" +

      // Customer details
      sectionTitle("Customer details") +
      '<tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
        detailRow("Full name", "<strong>" + esc(d.name) + "</strong>") +
        detailRow("Email", link("mailto:" + d.email, esc(d.email))) +
        detailRow("Phone", link(phoneHref, esc(d.phone))) +
        detailRow("Property address", link(mapsHref, esc(d.address)), true) +
      "</table></td></tr>" +

      // Additional comments
      sectionTitle("Additional comments") +
      '<tr><td style="padding:0 28px;"><div style="padding:14px 16px;background:#f4f7fb;border-left:4px solid ' + BRAND +
        ';border-radius:6px;' + FONT + 'font-size:15px;line-height:1.55;color:' + (d.notes ? INK : MUTED) + ';word-break:break-word;">' +
        (d.notes ? esc(d.notes).replace(/\r?\n/g, "<br>") : "<em>No additional comments.</em>") +
      "</div></td></tr>" +

      // Quote breakdown
      sectionTitle("Quote breakdown") +
      '<tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
        lineRows +
        sumRow("Subtotal", esc(formatMoney(c.subtotalCents)), MUTED) +
        (c.minimumApplied
          ? sumRow("Minimum job adjustment (" + esc(minimum) + " minimum)", "+" + esc(formatMoney(c.adjustmentCents)), "#8a4b00")
          : "") +
        '<tr><td colspan="2" style="padding:14px 0 0;"><div style="border-top:2px solid ' + INK + ';font-size:0;line-height:0;">&nbsp;</div></td></tr>' +
        '<tr><td style="padding:12px 0 0;' + FONT + 'font-size:17px;font-weight:bold;color:' + INK + ';">Total</td>' +
          '<td align="right" style="padding:12px 0 0;' + FONT + 'font-size:24px;font-weight:bold;color:' + BRAND + ';white-space:nowrap;">' + total + "</td></tr>" +
      "</table></td></tr>" +

      // Quick actions
      '<tr><td style="padding:28px 28px 4px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
        button(replyHref, "Reply to customer", true) +
        button(phoneHref, "Call customer", false) +
      "</tr></table></td></tr>" +

      // Footer
      '<tr><td style="padding:16px 28px 28px;' + FONT + 'font-size:12px;line-height:1.6;color:' + MUTED + ';">' +
        "Sent from the online quote page. Rates: " + rates + " &middot; Minimum job " + esc(minimumShort) + "." +
      "</td></tr>" +
      "</table></div>";


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
    isValidEmail: isValidEmail,
    COUNTRIES: COUNTRIES,
    detectCountry: detectCountry,
    parsePhone: parsePhone,
    escapeHtml: escapeHtml,
    buildEmail: buildEmail,
    buildEmailParams: buildEmailParams,
    buildMailto: buildMailto
  };
});
