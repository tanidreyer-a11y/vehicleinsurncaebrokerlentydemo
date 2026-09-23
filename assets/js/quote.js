// The quote form. Steps are described as data (buildSteps), rendered one screen at a
// time, saved to the phone as the customer goes, and submitted as a flat list of
// [label, value] pairs that becomes one row in the Google Sheet.
(function () {
  const S = window.SITE || {};
  const D = window.QDATA;
  const STORE_KEY = "quote-draft-v2";
  const MAX_VEHICLES = 3;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ── Small helpers ──────────────────────────────────────────────────────── */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const idOf = (path) => "f-" + path.replace(/\./g, "-");
  function get(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function set(obj, path, val) {
    const ks = path.split(".");
    let o = obj;
    ks.slice(0, -1).forEach((k, i) => {
      if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {};
      o = o[k];
    });
    o[ks[ks.length - 1]] = val;
  }
  const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0) || v === false;
  const digits = (s) => String(s || "").replace(/\D/g, "");
  function formatMoney(raw) {
    const n = digits(raw).replace(/^0+(?=\d)/, "");
    return n ? "R " + n.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "";
  }

  /* ── South African ID number ────────────────────────────────────────────── */
  // 13 digits: YYMMDD, gender (0000-4999 female, 5000-9999 male), citizenship, 8, check digit (Luhn).
  function parseSaId(raw) {
    const id = digits(raw);
    if (id.length !== 13) return { ok: false, msg: "An SA ID number has 13 digits." };
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      let n = +id[12 - i];
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    if (sum % 10 !== 0) return { ok: false, msg: "That ID number doesn't add up. Please check the digits." };
    const yy = +id.slice(0, 2), mm = +id.slice(2, 4), dd = +id.slice(4, 6);
    const now = new Date();
    const year = yy > now.getFullYear() % 100 ? 1900 + yy : 2000 + yy;
    const dob = new Date(year, mm - 1, dd);
    if (dob.getMonth() !== mm - 1 || dob.getDate() !== dd) return { ok: false, msg: "The date of birth in that ID number isn't valid. Please check it." };
    let age = now.getFullYear() - year;
    if (now < new Date(now.getFullYear(), mm - 1, dd)) age--;
    return {
      ok: true,
      age,
      dob: dob.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }),
      gender: +id[6] >= 5 ? "Male" : "Female",
      citizen: id[10] === "0" ? "SA citizen" : "Permanent resident",
      formatted: `${id.slice(0, 6)} ${id.slice(6, 10)} ${id.slice(10)}`,
    };
  }

  /* ── State ──────────────────────────────────────────────────────────────── */
  const params = new URLSearchParams(location.search);
  let data = { vehicles: [{}], trailer: {} };
  let startedAt = Date.now();
  let steps = [];
  let current = 0;
  let returnToReview = false;
  let submitting = false;

  function saveDraft() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ data, step: steps[current]?.id, startedAt, savedAt: Date.now() })); } catch (e) {}
  }
  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { return null; }
  }
  function clearDraft() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  /* ── The questions ──────────────────────────────────────────────────────── */
  const yesNo = ["Yes", "No"];

  function vehicleName(d, i) {
    const v = d.vehicles[i] || {};
    const name = [v.make !== "Other" ? v.make : "", v.model].filter(Boolean).join(" ");
    if (name) return `your ${name}`;
    return d.vehicles.length > 1 || i > 0 ? `vehicle ${i + 1}` : "your car";
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function vehicleSteps(d, i) {
    const scope = `vehicles.${i}`;
    const prefix = `Vehicle ${i + 1}`;
    const section = `Vehicle ${i + 1}`;
    const nm = vehicleName(d, i);
    const common = { scope, prefix, section, vehicle: i };
    return [
      {
        ...common, id: `veh${i}-car`,
        title: i === 0 ? "Let's start with your car" : `Vehicle ${i + 1}: the basics`,
        sub: "Your licence disc or registration papers have all of this.",
        fields: [
          { name: "year", label: "Year", short: "Year", type: "select", options: D.YEARS, required: true, half: true },
          { name: "make", label: "Make", short: "Make", type: "select", options: D.MAKES, required: true, half: true },
          { name: "makeOther", label: "Which make?", short: "Make (other)", type: "text", required: true, when: (d, v) => v.make === "Other" },
          { name: "model", label: "Model", short: "Model", type: "combo", required: true, placeholder: "Pick or type the model",
            list: (d, v) => D.MODELS[v.make] || [] },
          { name: "variant", label: "Engine or spec", short: "Variant", type: "text", optional: true, placeholder: "e.g. 1.4 GLX automatic",
            hint: "If you know it. It helps get the value right." },
          { name: "reg", label: "Registration number", short: "Registration", type: "text", optional: true, upper: true, autocomplete: "off",
            placeholder: "e.g. JV 12 KW GP", hint: "Leave blank if it isn't registered yet." },
          { name: "owner", label: "Who is it registered to?", short: "Registered owner", type: "choice", required: true,
            options: ["Me", "My spouse or partner", "Bank / finance house", "A company", "Someone else"] },
          { name: "finance", label: "Is it paid off?", short: "Finance", type: "choice", required: true, options: ["Paid off", "Still financed", "Leased"] },
          { name: "financeBank", label: "Financed through", short: "Finance house", type: "select", options: D.BANKS, required: true, half: true,
            when: (d, v) => v.finance && v.finance !== "Paid off" },
          { name: "financeLeft", label: "Time left on the contract", short: "Finance remaining", type: "select", half: true, required: true,
            options: ["Less than 1 year", "1 to 2 years", "2 to 3 years", "3 to 4 years", "More than 4 years"],
            when: (d, v) => v.finance && v.finance !== "Paid off" },
        ],
        extra: i > 0 ? `<button type="button" class="linkbtn" data-action="remove-vehicle" data-index="${i}">Remove this vehicle</button>` : "",
      },
      {
        ...common, id: `veh${i}-driver`,
        title: `Who drives ${nm}?`,
        sub: "Insurers price the cover on the person who drives it most.",
        fields: [
          { name: "use", label: "What is it used for?", short: "Use", type: "choice", required: true,
            options: ["Private only", "Private and driving to work", "Business use", "E-hailing (Uber, Bolt)"] },
          { name: "driver", label: "Who is the regular driver?", short: "Regular driver", type: "choice", required: true, options: ["Me", "Someone else"] },
          { name: "driverName", label: "Driver's full name", short: "Driver name", type: "text", required: true, when: (d, v) => v.driver === "Someone else" },
          { name: "driverId", label: "Driver's SA ID number", short: "Driver ID number", type: "idnumber", required: true, when: (d, v) => v.driver === "Someone else",
            hint: "If they don't have an SA ID, mention it in the notes at the end and leave this blank.", optionalIfNoted: true },
          { name: "driverMarital", label: "Driver's marital status", short: "Driver marital status", type: "select", options: D.MARITAL, required: true, half: true,
            when: (d, v) => v.driver === "Someone else" },
          { name: "driverRelation", label: "Relationship to you", short: "Driver relationship", type: "select", required: true, half: true,
            options: ["Spouse or partner", "Son or daughter", "Parent", "Other family", "Employee", "Friend", "Other"], when: (d, v) => v.driver === "Someone else" },
          { name: "licenceCode", label: "Driver's licence code", short: "Licence code", type: "select", options: D.LICENCE_CODES, required: true },
          { name: "licenceYear", label: "Year the licence was issued", short: "Licence issued", type: "select", options: D.LICENCE_YEARS, required: true,
            hint: "It's printed on the licence card." },
        ],
      },
      {
        ...common, id: `veh${i}-security`,
        title: `Where does ${nm} sleep at night?`,
        sub: "Security makes a real difference to the premium.",
        fields: [
          { name: "parking", label: "Parking at night", short: "Night parking", type: "choice", required: true,
            options: ["Locked garage", "Behind a locked gate", "Carport", "Secure complex", "In the street"] },
          { name: "tracker", label: "Tracking device", short: "Tracking device", type: "select", options: D.TRACKERS, required: true, half: true },
          { name: "immobiliser", label: "Immobiliser", short: "Immobiliser", type: "select", required: true, half: true,
            options: ["Factory fitted", "Fitted afterwards", "None", "Not sure"] },
          { name: "trackerOther", label: "Which tracking company?", short: "Tracker (other)", type: "text", required: true, when: (d, v) => v.tracker === "Other" },
          { name: "gearLock", label: "Gear lock", short: "Gear lock", type: "choice", options: yesNo, required: true, half: true },
          { name: "smashGrab", label: "Smash-and-grab film", short: "Smash & grab film", type: "choice", options: yesNo, required: true, half: true },
          { name: "radio", label: "Radio", short: "Radio", type: "choice", required: true, options: ["Factory fitted", "Aftermarket", "None"] },
          { name: "radioModel", label: "Radio make and model", short: "Radio make & model", type: "text", optional: true, when: (d, v) => v.radio === "Aftermarket" },
        ],
      },
      {
        ...common, id: `veh${i}-value`,
        title: "Cover, value and claims",
        sub: "If you're not sure of the value, tick the box and I'll look it up.",
        fields: [
          { name: "coverType", label: "What cover would you like?", short: "Cover type", type: "choice", required: true,
            options: ["Comprehensive", "Third party, fire and theft", "Third party only", "Not sure, advise me"] },
          { name: "value", label: "Roughly what it's worth today", short: "Retail value", type: "money", required: true, unsure: "Not sure, please look it up" },
          { name: "extras", label: "Any extras fitted?", short: "Extras", type: "multi", options: D.EXTRAS, optional: true, hint: "Tap all that apply." },
          { name: "extrasOther", label: "Other extras", short: "Extras (other)", type: "text", optional: true, when: (d, v) => (v.extras || []).includes("Other") },
          { name: "carHire", label: "Would you like car hire if it's in for repairs?", short: "Car hire", type: "choice", options: yesNo, required: true },
          { name: "claims", label: "Claims on any car in the last 3 years?", short: "Claims (3 yrs)", type: "choice", required: true,
            options: ["None", "1", "2", "3 or more"] },
          { name: "claimsDetail", label: "What happened, and when?", short: "Claims detail", type: "textarea", required: true,
            placeholder: "e.g. 2020, hijacked", when: (d, v) => v.claims && v.claims !== "None" },
        ],
        extra: i === d.vehicles.length - 1 && d.vehicles.length < MAX_VEHICLES
          ? `<button type="button" class="addbtn" data-action="add-vehicle"><span aria-hidden="true">+</span> Add another vehicle</button>` : "",
      },
    ];
  }

  function buildSteps(d) {
    const out = [];
    d.vehicles.forEach((_, i) => out.push(...vehicleSteps(d, i)));
    out.push({
      id: "trailer", section: "Caravan or trailer", scope: "trailer",
      title: "Anything you tow?",
      sub: "Caravans and trailers can go on the same policy.",
      fields: [
        { name: "want", label: "Would you like to insure a caravan or trailer too?", short: "Trailer wanted", type: "choice", options: ["Yes", "No"], required: true, default: "No" },
        { name: "type", label: "What is it?", short: "Trailer type", type: "choice", required: true, options: ["Caravan", "Trailer", "Boat trailer", "Other"], when: (d, t) => t.want === "Yes" },
        { name: "year", label: "Year", short: "Trailer year", type: "select", options: D.YEARS, required: true, half: true, when: (d, t) => t.want === "Yes" },
        { name: "value", label: "Value", short: "Trailer value", type: "money", required: true, half: true, when: (d, t) => t.want === "Yes" },
        { name: "makeModel", label: "Make and model", short: "Trailer make & model", type: "text", required: true, when: (d, t) => t.want === "Yes" },
        { name: "parking", label: "Where is it kept?", short: "Trailer parking", type: "choice", required: true, options: ["Garage", "Carport", "Shade net", "Open yard", "Storage facility"], when: (d, t) => t.want === "Yes" },
      ],
    });
    out.push({
      id: "you", section: "About you",
      title: "Now a little about you",
      sub: "The person the policy will be in the name of.",
      fields: [
        { name: "you.firstName", label: "First name", short: "First name", type: "text", autocomplete: "given-name", required: true, half: true },
        { name: "you.lastName", label: "Surname", short: "Surname", type: "text", autocomplete: "family-name", required: true, half: true },
        { name: "you.idType", label: "I'll identify with my", short: "ID type", type: "choice", options: ["SA ID number", "Passport"], required: true, default: "SA ID number" },
        { name: "you.idNumber", label: "SA ID number", short: "ID number", type: "idnumber", required: true, adult: true, when: (d) => d.you?.idType !== "Passport",
          hint: "I'll read your date of birth from it, so you don't have to type it." },
        { name: "you.passport", label: "Passport number", short: "Passport number", type: "text", required: true, upper: true, when: (d) => d.you?.idType === "Passport" },
        { name: "you.dob", label: "Date of birth", short: "Date of birth", type: "date", required: true, half: true, when: (d) => d.you?.idType === "Passport" },
        { name: "you.gender", label: "Gender", short: "Gender", type: "select", options: ["Female", "Male"], required: true, half: true, when: (d) => d.you?.idType === "Passport" },
        { name: "you.marital", label: "Marital status", short: "Marital status", type: "select", options: D.MARITAL, required: true, half: true },
        { name: "you.occupation", label: "Occupation", short: "Occupation", type: "combo", list: () => D.OCCUPATIONS, required: true, half: true, placeholder: "Pick or type" },
      ],
    });
    out.push({
      id: "contact", section: "Contact",
      title: "How can I reach you?",
      sub: "Your quote comes to you this way. Nothing gets shared or sold.",
      fields: [
        { name: "contact.cell", label: "Cellphone number", short: "Cell", type: "tel", autocomplete: "tel-national", required: true, phone: true, placeholder: "e.g. 082 123 4567" },
        { name: "contact.email", label: "Email address", short: "Email", type: "email", autocomplete: "email", required: true, placeholder: "you@example.com" },
        { name: "contact.altPhone", label: "Work or home number", short: "Other number", type: "tel", optional: true, phone: true },
        { name: "contact.by", label: "Best way to contact you", short: "Contact by", type: "choice", required: true, options: ["Phone call", "WhatsApp", "Email"] },
        { name: "contact.when", label: "Best time", short: "Best time", type: "choice", required: true, options: ["Morning", "Afternoon", "Evening", "Any time"] },
      ],
    });
    out.push({
      id: "address", section: "Address",
      title: "Where do you live?",
      sub: "Insurers need your home address, because where a car sleeps affects the risk.",
      fields: [
        { name: "address.street", label: "Street address", short: "Street address", type: "text", autocomplete: "address-line1", required: true, placeholder: "e.g. 12 Oak Street" },
        { name: "address.complex", label: "Complex or unit", short: "Complex / unit", type: "text", autocomplete: "address-line2", optional: true },
        { name: "address.suburb", label: "Suburb", short: "Suburb", type: "text", autocomplete: "address-level3", required: true, half: true },
        { name: "address.city", label: "City or town", short: "City", type: "text", autocomplete: "address-level2", required: true, half: true },
        { name: "address.province", label: "Province", short: "Province", type: "select", options: D.PROVINCES, required: true, half: true },
        { name: "address.code", label: "Postal code", short: "Postal code", type: "text", autocomplete: "postal-code", inputmode: "numeric", maxlength: 4, required: true, half: true,
          validate: (v) => (/^\d{4}$/.test(v) ? "" : "A postal code has 4 digits.") },
        { name: "address.postal", label: "Postal address", short: "Postal address same", type: "choice", options: ["Same as above", "Different"], default: "Same as above", required: true },
        { name: "address.postalAddress", label: "Postal address", short: "Postal address", type: "textarea", required: true, when: (d) => d.address?.postal === "Different" },
      ],
    });


    out.push({
      id: "history", section: "Insurance history", scope: "history",
      title: "Your insurance so far",
      sub: "This helps me find a better deal than what you have now.",
      fields: [
        { name: "insured", label: "Are you insured at the moment?", short: "Currently insured", type: "choice", options: yesNo, required: true },
        { name: "insurer", label: "Who with?", short: "Current insurer", type: "select", options: D.INSURERS, required: true, half: true, when: (d, h) => h.insured === "Yes" },
        { name: "years", label: "For how long?", short: "Years with insurer", type: "select", required: true, half: true,
          options: ["Less than a year", "1 to 2 years", "3 to 5 years", "More than 5 years"], when: (d, h) => h.insured === "Yes" },
        { name: "premium", label: "Monthly premium", short: "Current premium", type: "money", optional: true, half: true, when: (d, h) => h.insured === "Yes" },
        { name: "excess", label: "Excess on your policy", short: "Current excess", type: "money", optional: true, half: true, when: (d, h) => h.insured === "Yes" },
        { name: "previous", label: "Were you insured before that?", short: "Previous insurer", type: "select", optional: true, options: ["No", ...D.INSURERS] },
        { name: "previousYears", label: "For how long?", short: "Years with previous", type: "select", optional: true,
          options: ["Less than a year", "1 to 2 years", "3 to 5 years", "More than 5 years"], when: (d, h) => h.previous && h.previous !== "No" },
      ],
    });
    out.push({
      id: "consent", section: "Final details",
      title: "Almost done",
      fields: [
        { name: "consent.itc", label: "May insurers run a credit (ITC) check for your quote?", short: "ITC check", type: "choice", required: true,
          options: ["Yes, I give permission", "I'd like to discuss it first"], hint: "Most insurers need this to give you their best price." },
        { name: "consent.heard", label: "How did you hear about me?", short: "Heard via", type: "choice", optional: true,
          options: ["Business card", "A friend or family member", "Social media", "Google", "Other"], when: () => !params.get("src") },
        { name: "consent.notes", label: "Anything else I should know?", short: "Notes", type: "textarea", optional: true,
          placeholder: "e.g. a second driver without an SA ID, or a good time to call" },
        { name: "consent.popia", label: "I agree that my details may be used to prepare my insurance quotes and shared with insurers for that purpose.", short: "POPIA consent",
          type: "check", required: "Please tick the box so I can prepare your quotes.", link: true },
      ],
    });
    out.push({ id: "review", section: "Review", title: "Check your details", sub: "Tap Edit to change anything. Then send it through.", review: true, fields: [] });
    return out;
  }

  /* ── Rendering ──────────────────────────────────────────────────────────── */
  const ICONS = {
    car: '<path d="M5 16h14M6.5 16v2M17.5 16v2M4 16v-3.5L6 8h12l2 4.5V16M4 12.5h16"/><circle cx="8" cy="13.8" r=".6"/><circle cx="16" cy="13.8" r=".6"/>',
    sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3 12a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3zM6 17v2M18 17v2"/>',
    house: '<path d="M4 11l8-6 8 6M6 9.5V19h12V9.5M10 19v-5h4v5"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
    trailer: '<path d="M3 7h13v9H3zM16 13h3l2 3h-5M3 16h18"/><circle cx="8" cy="17.5" r="1.5"/>',
  };
  const TICK = '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

  const scopeOf = (step) => (step.scope ? get(data, step.scope) || {} : data);
  const fullPath = (step, f) => (step.scope ? `${step.scope}.${f.name}` : f.name);
  const visible = (step, f) => !f.when || f.when(data, scopeOf(step));

  function fieldHtml(step, f) {
    const path = fullPath(step, f);
    const id = idOf(path);
    let val = get(data, path);
    if (val === undefined && f.default !== undefined) { set(data, path, f.default); val = f.default; }
    const opt = f.optional ? ' <span class="opt">optional</span>' : "";
    const hint = f.hint ? `<p class="hint" id="${id}-hint">${esc(f.hint)}</p>` : "";
    const describedBy = `${f.hint ? id + "-hint " : ""}${id}-err`;
    const err = `<p class="err" id="${id}-err" role="alert"></p>`;
    const cls = `field field--${f.type}${f.half ? " field--half" : ""}`;
    const hidden = visible(step, f) ? "" : " hidden";
    const req = f.optional ? "" : " aria-required=\"true\"";
    const opts = (f.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));

    switch (f.type) {
      case "choice":
      case "multi": {
        const multi = f.type === "multi";
        const cols = opts.length === 2 ? " opts--2" : opts.length > 6 ? " opts--list" : "";
        return `<fieldset class="${cls}" data-path="${path}"${hidden}${req} aria-describedby="${describedBy}">
          <legend>${esc(f.label)}${opt}</legend>${hint}
          <div class="opts${cols}">${opts.map((o) => {
            const on = multi ? (val || []).includes(o.value) : val === o.value;
            return `<label class="opt-btn"><input type="${multi ? "checkbox" : "radio"}" name="${path}" value="${esc(o.value)}"${on ? " checked" : ""}><span>${multi ? TICK : ""}${esc(o.label)}</span></label>`;
          }).join("")}</div>${err}</fieldset>`;
      }
      case "cards":
        return `<fieldset class="${cls}" data-path="${path}"${req} aria-describedby="${describedBy}">
          <legend class="sr-only">${esc(f.label)}</legend>
          <div class="cards">${opts.map((o) => `<label class="card-opt"><input type="checkbox" name="${path}" value="${o.value}"${(val || []).includes(o.value) ? " checked" : ""}>
            <span class="card-opt__icon"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[o.icon] || ""}</svg></span>
            <span class="card-opt__text"><strong>${esc(o.label)}</strong>${o.hint ? `<small>${esc(o.hint)}</small>` : ""}</span>
            <span class="card-opt__check">${TICK}</span></label>`).join("")}</div>${err}</fieldset>`;
      case "select":
        return `<div class="${cls}" data-path="${path}"${hidden}>
          <label for="${id}">${esc(f.label)}${opt}</label>${hint}
          <div class="select"><select id="${id}" name="${path}" aria-describedby="${describedBy}"${req}>
            <option value="">Choose</option>${opts.map((o) => `<option value="${esc(o.value)}"${val === o.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}
          </select></div>${err}</div>`;
      case "textarea":
        return `<div class="${cls}" data-path="${path}"${hidden}><label for="${id}">${esc(f.label)}${opt}</label>${hint}
          <textarea id="${id}" name="${path}" rows="3" placeholder="${esc(f.placeholder || "")}" aria-describedby="${describedBy}"${req}>${esc(val || "")}</textarea>${err}</div>`;
      case "check":
        return `<div class="${cls}" data-path="${path}"${hidden}><label class="check"><input type="checkbox" id="${id}" name="${path}"${val ? " checked" : ""} aria-describedby="${describedBy}">
          <span class="check__box">${TICK}</span><span>${esc(f.label)}${f.link ? ' <a href="privacy.html" target="_blank" rel="noopener">Privacy notice</a>' : ""}</span></label>${err}</div>`;
      case "money": {
        const unsure = val === "Not sure";
        return `<div class="${cls}" data-path="${path}"${hidden}><label for="${id}">${esc(f.label)}${opt}</label>${hint}
          <input id="${id}" name="${path}" type="text" inputmode="numeric" autocomplete="off" placeholder="R 0" value="${unsure ? "" : esc(val || "")}"${unsure ? " disabled" : ""} aria-describedby="${describedBy}"${req}>
          ${f.unsure ? `<label class="check check--sm"><input type="checkbox" data-unsure="${path}"${unsure ? " checked" : ""}><span class="check__box">${TICK}</span><span>${esc(f.unsure)}</span></label>` : ""}${err}</div>`;
      }
      case "repeat": {
        const items = val || [];
        return `<div class="${cls}" data-path="${path}"${hidden}><p class="label">${esc(f.label)}${opt}</p>${hint}
          <div class="repeat">${items.map((it, n) => `<div class="repeat__row">
            <input aria-label="Item ${n + 1}" name="${path}.${n}.item" type="text" placeholder="e.g. Samsung phone" value="${esc(it.item || "")}">
            <input aria-label="Item ${n + 1} value" name="${path}.${n}.value" data-money type="text" inputmode="numeric" placeholder="R 0" value="${esc(it.value || "")}">
            <button type="button" class="iconbtn" data-action="remove-item" data-path="${path}" data-index="${n}" aria-label="Remove item ${n + 1}">×</button></div>`).join("")}
          </div><button type="button" class="addbtn addbtn--sm" data-action="add-item" data-path="${path}"><span aria-hidden="true">+</span> Add an item</button>${err}</div>`;
      }
      case "combo": {
        const list = f.list ? f.list(data, scopeOf(step)) : [];
        return `<div class="${cls}" data-path="${path}"${hidden}><label for="${id}">${esc(f.label)}${opt}</label>${hint}
          <input id="${id}" name="${path}" type="text" list="${id}-list" autocomplete="off" placeholder="${esc(f.placeholder || "")}" value="${esc(val || "")}" aria-describedby="${describedBy}"${req}>
          <datalist id="${id}-list">${list.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>${err}</div>`;
      }
      case "idnumber":
        return `<div class="${cls}" data-path="${path}"${hidden}><label for="${id}">${esc(f.label)}${opt}</label>${hint}
          <input id="${id}" name="${path}" type="text" inputmode="numeric" autocomplete="off" maxlength="16" placeholder="13 digits" value="${esc(val || "")}" aria-describedby="${id}-decoded ${describedBy}"${req}>
          <p class="decoded" id="${id}-decoded" aria-live="polite"></p>${err}</div>`;
      default: {
        // text, email, tel, date, month
        const type = f.type === "tel" ? "tel" : f.type;
        return `<div class="${cls}" data-path="${path}"${hidden}><label for="${id}">${esc(f.label)}${opt}</label>${hint}
          <input id="${id}" name="${path}" type="${type}"${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ""}${f.inputmode ? ` inputmode="${f.inputmode}"` : ""}${f.maxlength ? ` maxlength="${f.maxlength}"` : ""}${f.upper ? ' autocapitalize="characters"' : ""}
            placeholder="${esc(f.placeholder || "")}" value="${esc(val || "")}" aria-describedby="${describedBy}"${req}${type === "date" ? ` max="${new Date().toISOString().slice(0, 10)}"` : ""}>${err}</div>`;
      }
    }
  }

  const stage = $("#stage");
  const form = $("#quote");
  const nextBtn = $("#next");
  const backBtn = $("#back");

  function render(direction) {
    const step = steps[current];
    let body;
    if (step.review) body = reviewHtml();
    else body = `<div class="fields">${step.fields.map((f) => fieldHtml(step, f)).join("")}</div>${step.extra || ""}`;

    stage.innerHTML = `<div class="step ${direction ? "enter-" + direction : ""}">
      <div class="errsum" id="errsum" tabindex="-1" hidden></div>
      <h1 class="step__title" tabindex="-1">${esc(step.title)}</h1>
      ${step.sub ? `<p class="step__sub">${esc(step.sub)}</p>` : ""}
      ${body}</div>`;

    // chrome: progress, counters, buttons
    const total = steps.length;
    $("#stepcount").textContent = `Step ${current + 1} of ${total}`;
    const minsLeft = Math.max(1, Math.ceil(((total - current - 1) * 18) / 60));
    $("#timeleft").textContent = step.review ? "Last step" : `About ${minsLeft} min left`;
    $(".progress__bar").style.transform = `scaleX(${(current + 1) / total})`;
    $(".progress").setAttribute("aria-valuenow", String(current + 1));
    $(".progress").setAttribute("aria-valuemax", String(total));
    backBtn.hidden = current === 0;
    nextBtn.querySelector("span").textContent = step.review ? "Send my details" : returnToReview ? "Save and review" : "Continue";
    nextBtn.classList.toggle("btn--send", !!step.review);

    $$(".field--idnumber input", stage).forEach(updateIdReadout);
    if (current > 0) $(".step__title", stage).focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function reviewHtml() {
    const { sections } = collect();
    return `<div class="review">${sections.map((s) => `<section class="review__sec">
        <header><h2>${esc(s.title)}</h2><button type="button" class="linkbtn" data-action="edit" data-step="${s.stepId}">Edit<span class="sr-only"> ${esc(s.title)}</span></button></header>
        <dl>${s.rows.map(([k, v]) => `<div><dt>${esc(k.replace(/^Vehicle \d+ · /, ""))}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></section>`).join("")}
      </div><div class="senderr" id="senderr" hidden></div>`;
  }

  /* ── Visibility & live bits ─────────────────────────────────────────────── */
  function refreshVisibility() {
    const step = steps[current];
    if (step.review) return;
    step.fields.forEach((f) => {
      const el = stage.querySelector(`[data-path="${fullPath(step, f)}"]`);
      if (!el) return;
      const show = visible(step, f);
      if (el.hidden === show) {
        el.hidden = !show;
        if (show) el.classList.add("is-arriving"), setTimeout(() => el.classList.remove("is-arriving"), 400);
      }
      if (f.type === "combo" && f.list) {
        const dl = $(`#${idOf(fullPath(step, f))}-list`);
        const list = f.list(data, scopeOf(step));
        if (dl && dl.dataset.sig !== list.join("|")) {
          dl.dataset.sig = list.join("|");
          dl.innerHTML = list.map((m) => `<option value="${esc(m)}">`).join("");
        }
      }
    });
  }

  function updateIdReadout(input) {
    const out = document.getElementById(input.id + "-decoded");
    if (!out) return;
    const r = digits(input.value).length === 13 ? parseSaId(input.value) : null;
    if (r && r.ok) {
      out.innerHTML = `${TICK}<span>Born ${esc(r.dob)} · ${r.gender} · ${r.citizen}</span>`;
      out.classList.add("is-ok");
    } else {
      out.textContent = "";
      out.classList.remove("is-ok");
    }
  }

  /* ── Input handling ─────────────────────────────────────────────────────── */
  function onInput(e) {
    const el = e.target;
    if (el.dataset.unsure) {
      const path = el.dataset.unsure;
      const input = document.getElementById(idOf(path));
      set(data, path, el.checked ? "Not sure" : "");
      input.disabled = el.checked;
      if (el.checked) input.value = "";
      else input.focus();
      clearError(path);
      saveDraft();
      return;
    }
    const path = el.name;
    if (!path) return;
    const wrap = el.closest("[data-path]");
    const type = wrap && wrap.className.match(/field--(\w+)/)?.[1];

    if (el.type === "checkbox" && (type === "multi" || type === "cards")) {
      set(data, path, $$(`input[name="${path}"]:checked`, wrap).map((i) => i.value));
    } else if (el.type === "checkbox") {
      set(data, path, el.checked);
    } else if (type === "money" || el.hasAttribute("data-money")) {
      const f = formatMoney(el.value);
      if (el.value !== f) el.value = f;
      set(data, path, f);
    } else if (type === "idnumber") {
      set(data, path, el.value.trim());
      updateIdReadout(el);
    } else {
      set(data, path, el.value);
    }
    if (type === "cards" && e.type === "change") {
      // cover choice changes which steps exist
      steps = buildSteps(data);
    }
    if (wrap) clearError(wrap.dataset.path);
    refreshVisibility();
    saveDraft();
  }
  form.addEventListener("input", onInput);
  form.addEventListener("change", (e) => {
    if (e.target.type === "radio" || e.target.type === "checkbox" || e.target.tagName === "SELECT") onInput(e);
    // make/model changes rename the vehicle in later step titles
    if (/^vehicles\.\d+\.(make|model)$/.test(e.target.name)) steps = buildSteps(data);
  });
  form.addEventListener("focusout", (e) => {
    if (e.target.hasAttribute?.("autocapitalize") && e.target.value) {
      e.target.value = e.target.value.toUpperCase();
      set(data, e.target.name, e.target.value);
      saveDraft();
    }
  });

  /* ── Validation ─────────────────────────────────────────────────────────── */
  function fieldError(step, f) {
    const v = get(data, fullPath(step, f));
    const blank = isEmpty(typeof v === "string" ? v.trim() : v);
    if (blank) {
      if (f.optional || f.optionalIfNoted) return "";
      if (typeof f.required === "string") return f.required;
      if (["choice", "select", "multi", "cards"].includes(f.type)) return "Please choose an option.";
      if (f.type === "money") return f.unsure ? "Please enter an amount, or tick the box if you're not sure." : "Please enter an amount.";
      return f.type === "textarea" ? "Please add a few words here." : "Please fill this in.";
    }
    if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "That email address doesn't look right. Please check it.";
    if (f.phone) {
      const n = digits(v);
      if (!(/^0\d{9}$/.test(n) || /^27\d{9}$/.test(n))) return "Please enter a 10-digit South African number, e.g. 082 123 4567.";
    }
    if (f.type === "idnumber") {
      const r = parseSaId(v);
      if (!r.ok) return r.msg;
      if (f.adult && r.age < 18) return "The policyholder needs to be 18 or older.";
    }
    if (f.type === "money" && v !== "Not sure" && !digits(v)) return "Please enter an amount.";
    if (f.validate) return f.validate(v);
    return "";
  }

  function clearError(path) {
    const wrap = stage.querySelector(`[data-path="${path}"]`);
    if (!wrap || !wrap.classList.contains("has-error")) return;
    wrap.classList.remove("has-error");
    const err = wrap.querySelector(".err");
    if (err) err.textContent = "";
    $$("input,select,textarea", wrap).forEach((i) => i.removeAttribute("aria-invalid"));
  }

  function validateStep() {
    const step = steps[current];
    const errors = [];
    step.fields.forEach((f) => {
      if (!visible(step, f)) return;
      const msg = fieldError(step, f);
      const path = fullPath(step, f);
      const wrap = stage.querySelector(`[data-path="${path}"]`);
      if (!wrap) return;
      wrap.classList.toggle("has-error", !!msg);
      wrap.querySelector(".err").textContent = msg;
      $$("input,select,textarea", wrap).forEach((i) => (msg ? i.setAttribute("aria-invalid", "true") : i.removeAttribute("aria-invalid")));
      if (msg) {
        errors.push({ path, msg, label: f.short || f.label });
        // restart the nudge animation
        wrap.classList.remove("nudge");
        void wrap.offsetWidth;
        wrap.classList.add("nudge");
      }
    });
    const sum = $("#errsum");
    if (errors.length > 1) {
      sum.innerHTML = `<p><strong>${errors.length} things need your attention:</strong></p><ul>${errors.map((e) => `<li><a href="#${idOf(e.path)}" data-focus="${e.path}">${esc(e.label)}</a>: ${esc(e.msg)}</li>`).join("")}</ul>`;
      sum.hidden = false;
      sum.focus();
      sum.scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "instant" : "smooth" });
    } else {
      sum.hidden = true;
      if (errors.length === 1) focusField(errors[0].path);
    }
    return errors.length === 0;
  }

  function focusField(path) {
    const wrap = stage.querySelector(`[data-path="${path}"]`);
    if (!wrap) return;
    const target = wrap.querySelector("input:not([type=hidden]):not(:disabled), select, textarea");
    wrap.scrollIntoView({ block: "center", behavior: reduceMotion.matches ? "instant" : "smooth" });
    if (target) target.focus({ preventScroll: true });
  }

  /* ── Navigation ─────────────────────────────────────────────────────────── */
  function goTo(index, { push = true, direction } = {}) {
    const dir = direction || (index > current ? "fwd" : "back");
    current = Math.max(0, Math.min(index, steps.length - 1));
    if (push) history.pushState({ qstep: steps[current].id }, "", "#" + steps[current].id);
    render(dir);
    saveDraft();
  }
  const indexOf = (id) => Math.max(0, steps.findIndex((s) => s.id === id));

  nextBtn.addEventListener("click", () => {
    if (submitting) return;
    const step = steps[current];
    if (step.review) return submit();
    if (!validateStep()) return;
    steps = buildSteps(data);
    if (returnToReview) {
      returnToReview = false;
      return goTo(indexOf("review"));
    }
    goTo(indexOf(step.id) + 1);
  });
  backBtn.addEventListener("click", () => history.back());
  function restart() {
    clearDraft();
    history.replaceState(null, "", location.pathname + location.search);
    location.reload();
  }
  window.addEventListener("popstate", (e) => {
    if (document.body.classList.contains("is-done")) return;
    const id = e.state?.qstep || location.hash.slice(1);
    if (!id) return;
    returnToReview = false;
    const i = indexOf(id);
    goTo(i, { push: false, direction: i < current ? "back" : "fwd" });
  });
  // Enter in a single-line field moves on, like a native app
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    nextBtn.click();
  });

  stage.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action], [data-focus]");
    if (!a) return;
    if (a.dataset.focus) {
      e.preventDefault();
      return focusField(a.dataset.focus);
    }
    const act = a.dataset.action;
    if (act === "add-vehicle") {
      if (!validateStep()) return;
      data.vehicles.push({});
      steps = buildSteps(data);
      goTo(indexOf(`veh${data.vehicles.length - 1}-car`));
    } else if (act === "remove-vehicle") {
      const i = +a.dataset.index;
      data.vehicles.splice(i, 1);
      steps = buildSteps(data);
      goTo(indexOf(`veh${i - 1}-value`), { direction: "back" });
    } else if (act === "add-item" || act === "remove-item") {
      const path = a.dataset.path;
      const items = get(data, path) || [];
      if (act === "add-item") items.push({ item: "", value: "" });
      else items.splice(+a.dataset.index, 1);
      set(data, path, items);
      const step = steps[current];
      const f = step.fields.find((x) => fullPath(step, x) === path);
      const wrap = stage.querySelector(`[data-path="${path}"]`);
      wrap.outerHTML = fieldHtml(step, f);
      if (act === "add-item") {
        const rows = $$(`[data-path="${path}"] .repeat__row`, stage);
        const last = rows[rows.length - 1];
        last.classList.add("is-arriving");
        last.querySelector("input").focus();
      }
      saveDraft();
    } else if (act === "edit") {
      returnToReview = true;
      goTo(indexOf(a.dataset.step), { direction: "back" });
    } else if (act === "restart") {
      restart();
    }
  });

  /* ── Collecting the answers ─────────────────────────────────────────────── */
  function display(f, v) {
    if (Array.isArray(v)) {
      if (f.type === "repeat") return v.filter((it) => it.item || it.value).map((it) => `${it.item || "Item"} (${it.value || "value?"})`).join("; ");
      if (f.type === "cards") return v.map((x) => f.options.find((o) => o.value === x)?.label || x).join(", ");
      return v.join(", ");
    }
    if (v === true) return "Yes";
    if (f.type === "month" && /^\d{4}-\d{2}$/.test(v)) {
      const [y, m] = v.split("-");
      return new Date(+y, +m - 1, 1).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
    }
    if (f.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
    if (f.type === "idnumber") return parseSaId(v).formatted || v;
    return String(v).trim();
  }

  function collect() {
    const sections = [];
    const fields = [];
    for (const step of steps) {
      if (step.review) continue;
      const rows = [];
      for (const f of step.fields) {
        if (!visible(step, f)) continue;
        const v = get(data, fullPath(step, f));
        if (isEmpty(v)) continue;
        const text = display(f, v);
        if (!text) continue;
        const label = (step.prefix ? step.prefix + " · " : "") + (f.short || f.label);
        rows.push([label, text]);
        if (f.type === "idnumber") {
          const r = parseSaId(v);
          if (r.ok) {
            const who = step.prefix ? step.prefix + " · Driver " : "";
            rows.push([`${who}${who ? "date of birth" : "Date of birth"}`, r.dob]);
            rows.push([`${who}${who ? "gender" : "Gender"}`, r.gender]);
          }
        }
      }
      if (!rows.length) continue;
      const last = sections[sections.length - 1];
      if (last && last.title === step.section) last.rows.push(...rows);
      else sections.push({ title: step.section, stepId: step.id, rows });
      fields.push(...rows);
    }
    return { sections, fields };
  }

  function makeReference() {
    const d = new Date();
    const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let r = "";
    for (let i = 0; i < 4; i++) r += chars[Math.floor(Math.random() * chars.length)];
    return `Q${stamp}-${r}`;
  }

  /* ── Submitting ─────────────────────────────────────────────────────────── */
  async function submit() {
    if (submitting) return;
    submitting = true;
    nextBtn.classList.add("is-busy");
    nextBtn.disabled = true;
    nextBtn.querySelector("span").textContent = "Sending";
    const errBox = $("#senderr");
    errBox.hidden = true;

    const { sections, fields } = collect();
    const you = data.you || {};
    const name = `${you.firstName || ""} ${you.lastName || ""}`.trim();
    const payload = {
      reference: makeReference(),
      submittedAt: new Date().toISOString(),
      source: params.get("src") === "card" ? "Business card QR" : data.consent?.heard || "Website",
      secondsToComplete: Math.round((Date.now() - startedAt) / 1000),
      website: $("#website").value, // honeypot: people never see it, bots fill it in
      summary: {
        name,
        cell: data.contact?.cell || "",
        email: data.contact?.email || "",
        contactBy: data.contact?.by || "",
        bestTime: data.contact?.when || "",
        cover: data.vehicles.map((v) => v.coverType).filter(Boolean).join("; ") + (data.trailer?.want === "Yes" ? " + " + (data.trailer.type || "trailer") : ""),
        vehicles: data.vehicles.map((v) => [v.year, v.make === "Other" ? v.makeOther : v.make, v.model].filter(Boolean).join(" ")).join("; "),
      },
      sections,
      fields,
    };

    const local = !S.appsScriptUrl && /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname);
    try {
      let ok = false;
      if (S.appsScriptUrl) {
        // text/plain keeps this a "simple" request, so Google's endpoint needs no CORS preflight
        const res = await fetch(S.appsScriptUrl, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "text/plain;charset=utf-8" } });
        const out = await res.json().catch(() => ({}));
        ok = res.ok && out.ok !== false;
      } else if (local) {
        const res = await fetch("/api/local-submit", { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } });
        ok = res.ok;
      } else {
        // No endpoint configured and not on the test server: behave as a demo.
        console.warn("[quote] No appsScriptUrl set in config.js; submission not sent.", payload);
        ok = true;
      }
      if (!ok) throw new Error("Server said no");
      clearDraft();
      showDone(payload, !S.appsScriptUrl);
    } catch (err) {
      console.error("[quote] submit failed", err);
      const wa = `https://wa.me/${S.phoneIntl}?text=${encodeURIComponent(`Hi, I tried to send a quote request online but it didn't go through. I'm ${name}, ${payload.summary.cell}. Cover: ${payload.summary.cover}.`)}`;
      errBox.innerHTML = `<p><strong>That didn't go through.</strong> Your answers are still saved on this phone. Check your connection and tap <em>Send my details</em> again, or <a href="${wa}">send me a WhatsApp</a> instead.</p>`;
      errBox.hidden = false;
      errBox.scrollIntoView({ block: "center" });
    } finally {
      submitting = false;
      nextBtn.classList.remove("is-busy");
      nextBtn.disabled = false;
      if (steps[current]?.review) nextBtn.querySelector("span").textContent = "Send my details";
    }
  }

  function showDone(payload, testMode) {
    const first = data.you?.firstName || "";
    const how = { "Phone call": "give you a call", WhatsApp: "WhatsApp you", Email: "email you" }[payload.summary.contactBy] || "be in touch";
    $("#done-title").textContent = first ? `Thank you, ${first}. You're all done.` : "Thank you. You're all done.";
    $("#done-ref").textContent = payload.reference;
    $("#done-how").textContent = `I'll ${how} within ${S.responseTime || "one working day"} with your quotes.`;
    $("#done-test").hidden = !testMode;
    document.body.classList.add("is-done");
    $("#done").hidden = false;
    $("#done h1").focus();
    window.scrollTo({ top: 0, behavior: "instant" });
    history.replaceState({ qstep: "done" }, "", location.pathname + location.search);
  }

  /* ── Start ──────────────────────────────────────────────────────────────── */
  // Each step manages its own scroll; a restored position would hide the top of the step
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const draft = loadDraft();
  if (draft && draft.data && Date.now() - (draft.savedAt || 0) < 1000 * 60 * 60 * 24 * 30) {
    data = draft.data;
    data.vehicles = data.vehicles?.length ? data.vehicles : [{}];
    startedAt = draft.startedAt || startedAt;
    steps = buildSteps(data);
    current = indexOf(draft.step || "veh0-car");
    if (current > 0 || (data.you && data.you.firstName)) {
      const note = $("#resume");
      note.hidden = false;
    }
  } else {
    steps = buildSteps(data);
  }
  history.replaceState({ qstep: steps[current].id }, "", "#" + steps[current].id);
  render();
  $("#resume-restart")?.addEventListener("click", restart);

  // expose for quick console testing
  window.__quote = { parseSaId, get data() { return data; }, collect };
})();
