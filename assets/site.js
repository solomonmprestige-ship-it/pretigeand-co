/* Prestige & Co — shared script
   Cookie consent, mobile menu, custom cursor, reveal on scroll,
   footer year, and the apply-page form switcher. */

/* ─── Cookie consent (key "pc_consent") ─────────────────── */
(function () {
  var CONSENT_KEY = 'pc_consent';
  var stored;
  try { stored = localStorage.getItem(CONSENT_KEY); } catch (e) { stored = null; }

  function pcConsent(choice) {
    if (typeof gtag === 'function') {
      gtag('consent', 'update', {
        analytics_storage: choice,
        ad_storage: choice,
        ad_user_data: choice,
        ad_personalization: choice
      });
    }
    try { localStorage.setItem(CONSENT_KEY, choice); } catch (e) {}
    var b = document.getElementById('pc-banner');
    if (b) { b.style.display = 'none'; document.body.style.paddingBottom = ''; }
  }
  window.pcConsent = pcConsent;

  if (stored === 'granted') {
    if (typeof gtag === 'function') {
      gtag('consent', 'update', {
        analytics_storage: 'granted',
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted'
      });
    }
  } else if (!stored) {
    var show = function () {
      var b = document.getElementById('pc-banner');
      if (b) { b.style.display = 'block'; document.body.style.paddingBottom = b.offsetHeight + 'px'; }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-consent]');
    if (btn) pcConsent(btn.getAttribute('data-consent'));
  });
})();

/* ─── Mobile menu ───────────────────────────────────────── */
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var menu = document.getElementById('nav-menu');
  if (!toggle || !menu) return;
  function setOpen(open) {
    menu.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Close' : 'Menu';
  }
  toggle.addEventListener('click', function () { setOpen(!menu.classList.contains('open')); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav') && menu.classList.contains('open')) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menu.classList.contains('open')) { setOpen(false); toggle.focus(); }
  });
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { setOpen(false); });
  });
})();

/* ─── Footer year ───────────────────────────────────────── */
(function () {
  var y = document.getElementById('yr');
  if (y) y.textContent = new Date().getFullYear();
})();

/* ─── Reveal on scroll ──────────────────────────────────── */
(function () {
  window.__pcReveal = true;
  var root = document.documentElement;
  if (!root.classList.contains('reveal-on')) return;
  var els = document.querySelectorAll('.r');
  if (!('IntersectionObserver' in window)) {
    root.classList.remove('reveal-on');
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach(function (el) { io.observe(el); });
})();

/* ─── Custom cursor (desktop, fine pointer, motion allowed) ─ */
(function () {
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || calm) return;

  var dot = document.createElement('div');
  var ring = document.createElement('div');
  dot.className = 'cur is-hidden';
  ring.className = 'cur-ring is-hidden';
  dot.setAttribute('aria-hidden', 'true');
  ring.setAttribute('aria-hidden', 'true');
  document.body.appendChild(dot);
  document.body.appendChild(ring);
  document.documentElement.classList.add('has-cursor');

  var mx = -100, my = -100, rx = -100, ry = -100, running = false;
  function frame() {
    rx += (mx - rx) * 0.18;
    ry += (my - ry) * 0.18;
    ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';
    if (Math.abs(mx - rx) > 0.1 || Math.abs(my - ry) > 0.1) requestAnimationFrame(frame);
    else running = false;
  }
  document.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY;
    dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
    dot.classList.remove('is-hidden');
    ring.classList.remove('is-hidden');
    if (!running) { running = true; requestAnimationFrame(frame); }
  });
  document.addEventListener('mouseleave', function () {
    dot.classList.add('is-hidden');
    ring.classList.add('is-hidden');
  });
  var LINKS = 'a, button, label, select, input[type="submit"], input[type="checkbox"], input[type="file"], [role="button"]';
  document.addEventListener('mouseover', function (e) {
    ring.classList.toggle('is-link', !!e.target.closest(LINKS));
  });
})();

/* ─── Apply page: form switcher (only runs on /apply/) ──── */
(function () {
  if (!document.getElementById('form-bo')) return;
  var params = new URLSearchParams(window.location.search);
  var type = params.get('type') || 'business-owner';
  var service = params.get('service') || '';
  var configs = {
    'business-owner': {
      title: 'Apply to work with us',
      intro: 'Tell us about your business, what you want to achieve, and by when.',
      formId: 'form-bo'
    },
    'investor': {
      title: 'Apply to work with us',
      intro: 'Tell us what you are looking for: sectors, deal size and location. We work with buyers seeking a controlling stake (50% or more).',
      formId: 'form-inv'
    },
    'property': {
      title: 'Introduce a property opportunity',
      intro: 'Tell us about the property opportunity, and what you want to achieve.',
      formId: 'form-prop'
    },
    'introducer': {
      title: 'Apply to join the ecosystem',
      intro: 'Tell us about your professional network and the introductions you have in mind.',
      formId: 'form-intro'
    }
  };
  var cfg = configs[type] || configs['business-owner'];
  var titleEl = document.getElementById('page-title');
  var introEl = document.getElementById('page-intro');
  if (titleEl) {
    titleEl.textContent = service ? cfg.title + ' — ' + service : cfg.title;
    document.title = titleEl.textContent + ' — Prestige & Co';
  }
  if (introEl) introEl.textContent = cfg.intro;
  if (service) {
    var svcEl = document.getElementById('f-service');
    if (svcEl) svcEl.value = service;
  }
  var formEl = document.getElementById(cfg.formId);
  if (formEl) formEl.style.display = 'flex';
  document.querySelectorAll('.f-select').forEach(function (sel) {
    sel.addEventListener('change', function () {
      this.classList.toggle('has-value', this.value !== '');
    });
  });
})();
