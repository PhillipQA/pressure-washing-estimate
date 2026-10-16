/* Page behaviour for the quote form. Pricing and validation live in quote-logic.js. */
(function () {
  "use strict";

  const L = window.QuoteLogic;
  const CFG = window.QUOTE_CONFIG || {};
  const RECIPIENT = CFG.RECIPIENT_EMAIL || "careers@finchharbor.com";
  const DETAIL_FIELDS = ["name", "phone", "email", "address", "notes"];
  const SEND_TIMEOUT_MS = 20000;
  const SUBMIT_LABEL = "Send my quote";

  const $ = (id) => document.getElementById(id);
  const form = $("quote-form");
  const quoteView = $("quote-view");
  const successView = $("success-view");
  const submitBtn = $("submit-btn");
  const statusEl = $("form-status");
  const servicesError = $("err-services");
  const summaryLines = $("summary-lines");
  const totalEl = $("total");
  const totalNote = $("total-note");
  const actionsTotal = $("actions-total");
  const minimumText = L.formatMoney(L.MINIMUM_CENTS).replace(/\.00$/, "");
  let sending = false;

  /* ---------- Email via EmailJS ---------- */

  function emailConfigured() {
    return ["EMAILJS_PUBLIC_KEY", "EMAILJS_SERVICE_ID", "EMAILJS_TEMPLATE_ID"].every(
      (key) => typeof CFG[key] === "string" && CFG[key].trim() !== "" && !/^YOUR_/.test(CFG[key])
    );
  }

  if (window.emailjs && emailConfigured()) {
    window.emailjs.init({ publicKey: CFG.EMAILJS_PUBLIC_KEY });
  }

  function sendEmail(params) {
    if (!emailConfigured()) return Promise.reject(new Error("not-configured"));
    if (!window.emailjs) return Promise.reject(new Error("emailjs-not-loaded"));
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), SEND_TIMEOUT_MS));
    return Promise.race([
      window.emailjs.send(CFG.EMAILJS_SERVICE_ID, CFG.EMAILJS_TEMPLATE_ID, params),
      timeout
    ]);
  }

  function sendErrorMessage(err) {
    if (err && err.message === "not-configured") {
      return "Email sending isn't set up yet (EmailJS keys missing in config.js).";
    }
    return "Sorry, we couldn't send your quote. Please check your connection and try again. Your details are still here.";
  }

  /* ---------- Helpers ---------- */

  function setFieldError(input, message) {
    const err = $("err-" + input.id);
    if (err) err.textContent = message || "";
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    const box = input.closest(".service, .field");
    if (box) box.classList.toggle("has-error", Boolean(message));
  }

  function setStatus(message, kind) {
    statusEl.textContent = message || "";
    statusEl.className = "form-status" + (kind ? " is-" + kind : "");
  }

  function setSending(on) {
    sending = on;
    submitBtn.disabled = on;
    submitBtn.setAttribute("aria-busy", String(on));
    submitBtn.textContent = on ? "Sending…" : SUBMIT_LABEL;
  }

  function makeQuoteId(date) {
    const pad = (n) => String(n).padStart(2, "0");
    const rand = Math.floor(Math.random() * Math.pow(36, 4)).toString(36).toUpperCase().padStart(4, "0");
    return "PW-" + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + "-" + rand;
  }

  function formatDate(date) {
    let text;
    try {
      text = date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    } catch (e) {
      text = date.toString();
    }
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* ignore */ }
    return tz ? text + " (" + tz + ")" : text;
  }

  /* ---------- Live price ---------- */

  function readQuantities() {
    const quantities = {};
    const errors = [];
    L.SERVICES.forEach((svc) => {
      const input = $("qty-" + svc.id);
      const parsed = L.parseQuantity(input.value);
      quantities[svc.id] = parsed.ok ? parsed.value : 0;
      if (!parsed.ok) errors.push({ input: input, message: parsed.error });
      input.closest(".service").classList.toggle("is-active", parsed.ok && parsed.value > 0);
    });
    return { quantities: quantities, errors: errors };
  }

  function breakdownHtml(calc) {
    const esc = L.escapeHtml;
    const items = calc.lines.map((line) =>
      "<li><span class=\"line-main\">" +
        "<span class=\"line-name\">" + esc(line.name) + "</span>" +
        "<span class=\"line-calc\">" + esc(L.formatQuantity(line.quantity)) + " " + esc(line.unit) +
        " × " + esc(L.formatMoney(line.rateCents)) + "</span>" +
      "</span><span class=\"line-amt\">" + esc(L.formatMoney(line.amountCents)) + "</span></li>"
    ).join("");
    let html = "<ul class=\"lines\">" + items + "</ul>";
    html += "<div class=\"sub-row\"><span>Subtotal</span><span>" + esc(L.formatMoney(calc.subtotalCents)) + "</span></div>";
    if (calc.minimumApplied) {
      html += "<div class=\"sub-row is-min\"><span>Minimum job adjustment</span><span>+" +
        esc(L.formatMoney(calc.adjustmentCents)) + "</span></div>";
    }
    return html;
  }

  function render() {
    const read = readQuantities();
    const calc = L.calculate(read.quantities);
    let html = calc.lines.length
      ? breakdownHtml(calc)
      : "<p class=\"summary-empty\">Enter a size for at least one area to see your price.</p>";
    if (read.errors.length) {
      html += "<p class=\"summary-warn\">A size above needs fixing, so it isn't included yet.</p>";
    }
    summaryLines.innerHTML = html;
    totalEl.textContent = L.formatMoney(calc.totalCents);
    actionsTotal.textContent = calc.lines.length ? L.formatMoney(calc.totalCents) : "—";
    totalNote.textContent = calc.minimumApplied
      ? "This job is under " + minimumText + ", so our " + minimumText + " minimum applies."
      : "Every job has a " + minimumText + " minimum.";
    totalNote.classList.toggle("is-min", calc.minimumApplied);
    return { calc: calc, errors: read.errors };
  }

  /* ---------- Wiring ---------- */

  L.SERVICES.forEach((svc) => {
    const rateEl = document.querySelector('[data-rate-for="' + svc.id + '"]');
    if (rateEl) rateEl.textContent = L.formatMoney(svc.rateCents) + " per " + svc.unit;

    const input = $("qty-" + svc.id);
    input.addEventListener("input", () => {
      const parsed = L.parseQuantity(input.value);
      setFieldError(input, parsed.ok ? "" : parsed.error);
      if (parsed.ok && parsed.value > 0) servicesError.textContent = "";
      render();
    });
  });

  DETAIL_FIELDS.forEach((name) => {
    const input = $(name);
    // Validate when leaving a field the customer has typed in (not while just tabbing through).
    input.addEventListener("blur", () => {
      if (input.value.trim() !== "") setFieldError(input, L.validateField(name, input.value));
    });
    // Once a field shows an error, clear it as soon as it's fixed.
    input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid") === "true") setFieldError(input, L.validateField(name, input.value));
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return; // no double emails from double clicks

    setStatus("", "");
    const result = render();
    let firstInvalid = null;

    result.errors.forEach((e) => {
      setFieldError(e.input, e.message);
      if (!firstInvalid) firstInvalid = e.input;
    });
    if (!result.errors.length && !result.calc.lines.length) {
      servicesError.textContent = "Enter a size for at least one area: house, driveway, deck or fence.";
      firstInvalid = $("qty-house");
    }

    const details = {};
    DETAIL_FIELDS.forEach((name) => {
      const input = $(name);
      const message = L.validateField(name, input.value);
      setFieldError(input, message);
      details[name] = input.value.trim();
      if (message && !firstInvalid) firstInvalid = input;
    });

    if (firstInvalid) {
      setStatus("Please fix the highlighted fields.", "error");
      firstInvalid.focus();
      return;
    }

    const now = new Date();
    const quote = { id: makeQuoteId(now), createdAt: formatDate(now), details: details, calc: result.calc };

    // Honeypot filled in: almost certainly a bot. Show success, send nothing.
    if ($("website").value) {
      showSuccess(quote);
      return;
    }

    setSending(true);
    try {
      await sendEmail(L.buildEmailParams(quote, RECIPIENT));
      showSuccess(quote);
    } catch (err) {
      console.error("Quote email failed:", err);
      setStatus(sendErrorMessage(err), "error");
    } finally {
      setSending(false);
    }
  });

  function showSuccess(quote) {
    $("success-name").textContent = quote.details.name;
    $("success-id").textContent = quote.id;
    $("success-lines").innerHTML = breakdownHtml(quote.calc);
    $("success-total").textContent = L.formatMoney(quote.calc.totalCents);
    quoteView.hidden = true;
    successView.hidden = false;
    window.scrollTo(0, 0);
    $("success-title").focus();
  }

  $("new-quote").addEventListener("click", () => {
    form.reset();
    form.querySelectorAll("input, textarea").forEach((input) => setFieldError(input, ""));
    servicesError.textContent = "";
    setStatus("", "");
    render();
    successView.hidden = true;
    quoteView.hidden = false;
    $("qty-house").focus();
  });

  render();
})();
