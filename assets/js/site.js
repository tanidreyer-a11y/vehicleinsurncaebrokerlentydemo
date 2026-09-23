// Shared page behaviour: fills in broker details from config.js, runs the reveal system,
// the header border, the phone action bar and the FAQ accordion.
(function () {
  const S = window.SITE || {};
  const root = document.documentElement;
  root.classList.add("js");

  /* ── Broker details ─────────────────────────────────────────────────────── */
  const fspLine = S.fspNumber ? `Authorised Financial Services Provider · FSP ${S.fspNumber}` : "Authorised Financial Services Provider";
  const values = { ...S, fspLine };
  document.querySelectorAll("[data-site]").forEach((el) => {
    const v = values[el.dataset.site];
    if (v) el.textContent = v;
  });
  const waText = encodeURIComponent("Hi, I'd like a car insurance quote please.");
  document.querySelectorAll("[data-site-href]").forEach((el) => {
    if (el.dataset.siteHref === "tel") el.href = `tel:+${S.phoneIntl}`;
    if (el.dataset.siteHref === "wa") el.href = `https://wa.me/${S.phoneIntl}?text=${waText}`;
    if (el.dataset.siteHref === "mail" && S.email) el.href = `mailto:${S.email}`;
  });
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

  /* ── Reveals ────────────────────────────────────────────────────────────── */
  // Rows in the same list stagger 60ms apart.
  document.querySelectorAll(".cover__types, .why__list").forEach((list) => {
    list.querySelectorAll(".reveal-row").forEach((row, i) => (row.style.transitionDelay = `${i * 60}ms`));
  });

  const targets = document.querySelectorAll(".mask, .reveal-copy, .reveal-photo, .reveal-row, .steps");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
    );
    targets.forEach((t) => io.observe(t));
  } else {
    targets.forEach((t) => t.classList.add("is-in"));
  }
  // Two frames so the initial transformed state is painted before it's released
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-loaded")));
  // Safety net: nothing may stay hidden if the observer never fires (print, odd embeds)
  setTimeout(() => targets.forEach((t) => t.classList.add("is-in")), 6000);

  /* ── Header border + phone action bar ───────────────────────────────────── */
  const top = document.querySelector(".top");
  const heroActions = document.querySelector(".hero__actions");
  const bar = document.querySelector(".actionbar");
  if (top) {
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "position:absolute;top:8px;height:1px;width:1px";
    document.body.prepend(sentinel);
    new IntersectionObserver(([e]) => top.classList.toggle("is-scrolled", !e.isIntersecting)).observe(sentinel);
  }
  if (bar && heroActions) {
    new IntersectionObserver(([e]) => bar.classList.toggle("is-visible", !e.isIntersecting && e.boundingClientRect.top < 0)).observe(heroActions);
  }

  /* ── FAQ: animate both open and close (native <details> only animates open) ─ */
  document.querySelectorAll(".qa").forEach((qa) => {
    const summary = qa.querySelector("summary");
    const body = qa.querySelector(".qa__body");
    summary.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (qa.open && qa.classList.contains("is-open")) {
        qa.classList.remove("is-open");
        const done = () => { if (!qa.classList.contains("is-open")) qa.open = false; };
        body.addEventListener("transitionend", done, { once: true });
        setTimeout(done, 320); // reduced motion has no transition to end
      } else {
        qa.open = true;
        requestAnimationFrame(() => requestAnimationFrame(() => qa.classList.add("is-open")));
      }
    });
  });
})();
