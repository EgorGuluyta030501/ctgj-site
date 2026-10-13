/* CTGJ — логика сайта */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // статичная копия на GitHub Pages — без сервера заявок (см. README)
  const DEMO = /\.github\.io$/.test(location.hostname);
  const LANGS = ['ru', 'en', 'zh'];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } },
  };

  /* ================= Языки ================= */
  let lang = (() => {
    const q = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(q)) return q;
    const saved = store.get('ctgj-lang');
    if (LANGS.includes(saved)) return saved;
    const nav = (navigator.language || 'ru').slice(0, 2);
    return nav === 'zh' ? 'zh' : nav === 'ru' ? 'ru' : (nav === 'uk' || nav === 'be' || nav === 'kk') ? 'ru' : 'en';
  })();

  const t = (key) => (window.I18N[lang] && window.I18N[lang][key]) || window.I18N.ru[key] || '';

  function splitWords(el) {
    const text = el.textContent.trim();
    el.setAttribute('aria-label', text);
    el.innerHTML = '';
    // для китайского — по 2 иероглифа, иначе по словам
    const parts = lang === 'zh' ? text.match(/.{1,2}/gu) || [] : text.split(/\s+/);
    parts.forEach((word, i) => {
      const w = document.createElement('span');
      w.className = 'w';
      w.setAttribute('aria-hidden', 'true');
      const inner = document.createElement('span');
      inner.textContent = word;
      inner.style.setProperty('--i', i);
      w.appendChild(inner);
      el.appendChild(w);
      if (lang !== 'zh' && i < parts.length - 1) el.appendChild(document.createTextNode(' '));
    });
  }

  function applyLang(next) {
    lang = next;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    $$('[data-i18n-content]').forEach((el) => { el.setAttribute('content', t(el.dataset.i18nContent)); });
    $$('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $$('.lang').forEach((b) => b.classList.toggle('is-active', b.dataset.lang === lang));
    $$('[data-split]').forEach((el) => {
      const wasIn = el.classList.contains('in');
      splitWords(el);
      if (wasIn) requestAnimationFrame(() => el.classList.add('in'));
    });
    buildMarquee();
    store.set('ctgj-lang', lang);
    document.dispatchEvent(new Event('ctgj:lang'));
  }

  $$('.lang').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.lang === lang) return;
    applyLang(b.dataset.lang);
    const url = new URL(location.href);
    url.searchParams.set('lang', lang);
    history.replaceState(null, '', url);
  }));

  /* ================= Бегущая строка ================= */
  function buildMarquee() {
    const track = $('#marquee');
    if (!track) return;
    const chars = ['龙', '福', '运', '商', '贸', '路', '金'];
    let html = '';
    for (let k = 1; k <= 7; k++) html += `<span class="marquee__item">${escapeHtml(t('marquee.' + k))}<i>${chars[k - 1]}</i></span>`;
    track.innerHTML = html + html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  applyLang(lang);

  /* ================= Тема: тёмная / светлая ================= */
  const themeSwitch = $('#theme-switch');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  function setTheme(theme, animate) {
    const light = theme === 'light';
    if (animate && !reduced) {
      document.body.classList.add('theme-anim');
      setTimeout(() => document.body.classList.remove('theme-anim'), 600);
    }
    if (light) document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    themeSwitch.setAttribute('aria-checked', String(light));
    if (themeMeta) themeMeta.setAttribute('content', light ? '#f6f1e8' : '#07080f');
    store.set('ctgj-theme', theme);
  }
  setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark', false);
  themeSwitch.addEventListener('click', () => {
    setTheme(themeSwitch.getAttribute('aria-checked') === 'true' ? 'dark' : 'light', true);
  });
  $('#year').textContent = new Date().getFullYear();

  /* ================= Прелоадер с драконом ================= */
  const loader = $('#loader');
  let heroScene = null;

  function finishLoader() {
    if (loader.classList.contains('is-leaving')) return;
    loader.classList.add('is-leaving');
    setTimeout(() => {
      document.body.classList.remove('is-loading');
      document.body.classList.add('is-ready');
      startHero();
      initReveal();
    }, 120); // первый экран проявляется под гаснущей заставкой
    setTimeout(() => {
      loader.classList.add('is-done');
      if (introScene) introScene.destroy();
    }, 800);
  }

  let introScene = null;
  const seenIntro = (() => { try { return sessionStorage.getItem('ctgj-intro'); } catch (e) { return null; } })();
  // ?intro=0 — пропустить заставку (удобно при правках)
  const skipIntro = new URLSearchParams(location.search).get('intro') === '0';
  if (reduced || skipIntro || !window.SkyScene) {
    loader.classList.add('show-brand');
    setTimeout(finishLoader, skipIntro ? 0 : 900);
  } else {
    // при повторном заходе в той же сессии — ускоренная версия
    // вся заставка укладывается примерно в 4 секунды (повторный заход — быстрее)
    const speed = seenIntro ? 1.5 : 1;
    let brandShown = false;
    introScene = new window.SkyScene($('#loader-canvas'), {
      mode: 'intro',
      sky: true,
      startTime: 0.6, // дракон влетает в кадр сразу, без пустого неба
      speed,
      onFrame(time) {
        if (!brandShown && time > 1.75) { brandShown = true; loader.classList.add('show-brand'); }
        // закрываем сразу после петли, пока дракон улетает
        if (time > 3.4) finishLoader();
      },
    });
    introScene.start();
    try { sessionStorage.setItem('ctgj-intro', '1'); } catch (e) { /* нет доступа */ }
  }
  $('#loader-skip').addEventListener('click', finishLoader);
  loader.addEventListener('click', (e) => { if (e.target === loader || e.target.tagName === 'CANVAS') finishLoader(); });
  // страховка: прелоадер не держим дольше 9 секунд
  setTimeout(finishLoader, 9000);

  /* ================= Hero: дракон плывёт над городом ================= */
  /* ---------- фоновое видео ---------- */
  const heroVideo = $('#hero-video');
  const saveData = navigator.connection && navigator.connection.saveData;
  // при «уменьшении движения» и режиме экономии трафика остаётся только постер
  const useVideo = heroVideo && !reduced && !saveData;
  if (useVideo) {
    heroVideo.src = window.matchMedia('(max-width: 768px)').matches ? 'video/hero-mobile.mp4' : 'video/hero.mp4';
    heroVideo.preload = 'auto'; // начинаем грузить ещё во время заставки
  }
  function playVideo() {
    if (!useVideo) return;
    const p = heroVideo.play();
    if (p && p.catch) p.catch(() => { /* автозапуск заблокирован — остаётся постер */ });
  }

  function startHero() {
    playVideo();
    const hero = $('#hero');
    if (useVideo) {
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !document.hidden) playVideo(); else heroVideo.pause();
      }).observe(hero);
    }
    if (reduced || !window.SkyScene || heroScene) return;
    const canvas = $('#hero-canvas');
    // поверх видео только небесные фонарики: дракон летает лишь на заставке
    heroScene = new window.SkyScene(canvas, { mode: 'hero', sky: false, dragon: false, moon: false, stars: false, clouds: false, startTime: 0 });
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !document.hidden) heroScene.start(); else heroScene.stop();
    });
    io.observe(hero);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { heroScene.stop(); if (useVideo) heroVideo.pause(); }
      else if (hero.getBoundingClientRect().bottom > 0) { heroScene.start(); playVideo(); }
    });
  }

  /* ================= Плавный скролл (Lenis, если загрузился) ================= */
  let lenis = null;
  function initLenis() {
    if (reduced || !window.Lenis || lenis) return;
    lenis = new window.Lenis({ duration: 1.15, smoothWheel: true });
    const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    lenis.on('scroll', onScroll);
  }
  // библиотека грузится асинхронно и не задерживает запуск сайта; без неё скролл просто обычный
  if (!reduced) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js';
    s.async = true;
    s.onload = initLenis;
    document.head.appendChild(s);
  }

  function scrollToEl(target) {
    const offset = -($('#header').offsetHeight - 1);
    if (lenis) lenis.scrollTo(target, { offset });
    else window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY + offset, behavior: reduced ? 'auto' : 'smooth' });
  }

  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const target = id === '#top' ? document.body : $(id);
    if (!target) return;
    e.preventDefault();
    closeMenu();
    if (id === '#top') { lenis ? lenis.scrollTo(0) : window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    scrollToEl(target);
  }));

  /* ================= Мобильное меню ================= */
  const header = $('#header');
  const burger = $('#burger');
  const nav = $('#nav');
  function closeMenu() {
    nav.classList.remove('is-open');
    header.classList.remove('menu-open');
    burger.setAttribute('aria-expanded', 'false');
    if (lenis) lenis.start();
  }
  burger.addEventListener('click', () => {
    const open = !nav.classList.contains('is-open');
    nav.classList.toggle('is-open', open);
    header.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    if (lenis) open ? lenis.stop() : lenis.start();
  });

  /* ================= Скролл: шапка, прогресс, параллакс ================= */
  const progress = $('#progress');
  const parallax = $$('[data-parallax]');
  const toTop = $('#to-top');
  const toTopFill = $('#to-top-fill');
  const RING = 2 * Math.PI * 24;
  const steps = $('.process__steps');
  const sections = $$('main section[id]');
  const navLinks = $$('.nav__link');
  let lastY = window.scrollY;
  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  function update() {
    ticking = false;
    const y = window.scrollY;
    const vh = window.innerHeight;
    const max = document.documentElement.scrollHeight - vh;

    header.classList.toggle('is-scrolled', y > 30);
    if (!nav.classList.contains('is-open')) header.classList.toggle('is-hidden', y > lastY && y > vh * 0.6);
    lastY = y;
    progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;

    if (!reduced) parallax.forEach((el) => { el.style.transform = `translateY(${y * parseFloat(el.dataset.parallax)}px)`; });

    // кнопка «наверх»: появляется после первого экрана, кольцо показывает прогресс
    toTop.classList.toggle('is-visible', y > vh * 0.9);
    toTopFill.style.strokeDashoffset = (RING * (1 - (max > 0 ? y / max : 0))).toFixed(1);

    // линия процесса
    if (steps) {
      const r = steps.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (vh * 0.75 - r.top) / (r.height + vh * 0.2)));
      steps.style.setProperty('--p', p.toFixed(3));
      const items = $$('.step', steps);
      items.forEach((s, i) => s.classList.toggle('is-lit', p > i / items.length + 0.02));
    }

    // активный пункт меню
    let current = '';
    sections.forEach((s) => { if (s.getBoundingClientRect().top < vh * 0.4) current = s.id; });
    navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + current));
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();

  toTop.addEventListener('click', () => {
    if (lenis) lenis.scrollTo(0, { duration: 1.6 });
    else window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  });

  /* ================= Проекты: карусель со стрелками ================= */
  const track = $('#projects-track');
  const prevBtn = $('#prj-prev');
  const nextBtn = $('#prj-next');
  const bar = $('#prj-bar');

  function trackStep() {
    const card = $('.project', track);
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return card ? card.offsetWidth + gap : track.clientWidth * 0.8;
  }
  function updateTrack() {
    const max = track.scrollWidth - track.clientWidth;
    const x = track.scrollLeft;
    prevBtn.disabled = x <= 4;
    nextBtn.disabled = x >= max - 4;
    const visible = track.clientWidth / track.scrollWidth;
    bar.style.width = (visible * 100).toFixed(1) + '%';
    bar.style.left = (max > 0 ? (x / max) * (1 - visible) * 100 : 0).toFixed(1) + '%';
  }
  prevBtn.addEventListener('click', () => track.scrollBy({ left: -trackStep(), behavior: reduced ? 'auto' : 'smooth' }));
  nextBtn.addEventListener('click', () => track.scrollBy({ left: trackStep(), behavior: reduced ? 'auto' : 'smooth' }));
  track.addEventListener('scroll', () => requestAnimationFrame(updateTrack), { passive: true });
  window.addEventListener('resize', updateTrack);
  updateTrack();

  /* ================= Появление при скролле ================= */
  function initReveal() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    // задержки «лесенкой» для соседних элементов
    $$('[data-reveal]').forEach((el) => {
      const sib = Array.from(el.parentElement.children).filter((c) => c.hasAttribute('data-reveal'));
      const i = sib.indexOf(el);
      if (i > 0) el.style.setProperty('--d', Math.min(i * 0.09, 0.5) + 's');
      io.observe(el);
    });
    $$('[data-split]').forEach((el) => io.observe(el));
  }

  /* ================= «Магнитные» кнопки и наклон фонарей за курсором ================= */
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduced) {
    $$('[data-magnetic]').forEach((el) => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        el.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
      });
      el.addEventListener('mouseleave', () => { el.style.transform = ''; });
    });

    // лёгкий 3D-наклон фонарей за курсором
    $$('.lantern').forEach((l) => {
      const flip = $('.lantern__flip', l);
      l.addEventListener('mousemove', (e) => {
        const r = flip.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        flip.style.transform = `rotateX(${-y * 10}deg) rotateZ(${x * 4}deg)`;
      });
      l.addEventListener('mouseleave', () => { flip.style.transform = ''; });
    });
  }

  /* ================= Фонари: поворот по нажатию (тач) ================= */
  $$('.lantern').forEach((l) => {
    l.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (window.matchMedia('(hover: hover)').matches) return;
      const was = l.classList.contains('is-flipped');
      $$('.lantern.is-flipped').forEach((x) => x.classList.remove('is-flipped'));
      l.classList.toggle('is-flipped', !was);
    });
    l.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === l) l.classList.toggle('is-flipped');
    });
  });

  /* ================= Конверт с заявкой ================= */
  const mail = $('#mail');
  const letter = $('.letter', mail);
  const timers = [];
  let lastFocus = null;
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { while (timers.length) clearTimeout(timers.pop()); };

  function openMail(service) {
    clearTimers();
    lastFocus = document.activeElement;
    const form = $('form', letter);
    letter.classList.remove('is-sent');
    form.reset();
    $('.form-msg', form).textContent = '';
    if (service) form.elements.service.value = service;
    mail.hidden = false;
    mail.className = 'mail';
    document.body.classList.add('mail-open');
    if (lenis) lenis.stop();
    void mail.offsetWidth;
    if (reduced) {
      mail.classList.add('is-open', 'stage-flap', 'stage-paper', 'stage-letter');
      form.elements.name.focus();
      return;
    }
    mail.classList.add('is-open');
    later(() => mail.classList.add('stage-flap'), 450);
    later(() => mail.classList.add('stage-paper'), 850);
    later(() => { mail.classList.add('stage-letter'); }, 1250);
    later(() => form.elements.name.focus({ preventScroll: true }), 1900);
  }

  function closeMail(fly) {
    clearTimers();
    if (fly && !reduced) {
      mail.classList.add('stage-fly');
      later(hideMail, 1000);
    } else {
      mail.classList.remove('stage-letter');
      mail.classList.remove('is-open');
      later(hideMail, reduced ? 0 : 450);
    }
  }

  function hideMail() {
    mail.hidden = true;
    mail.className = 'mail';
    document.body.classList.remove('mail-open');
    if (lenis) lenis.start();
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  $$('[data-open-request]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    closeMenu();
    openMail(b.dataset.service);
  }));
  $$('[data-close]', mail).forEach((b) => b.addEventListener('click', () => closeMail(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !mail.hidden) closeMail(false);
    if (e.key === 'Tab' && !mail.hidden) {
      // держим фокус внутри письма
      const f = $$('button, input, select, textarea', letter).filter((x) => x.offsetParent && !x.classList.contains('hp'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  /* ================= Отправка заявок ================= */
  $$('.js-request-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('.form-msg', form);
      const btn = $('button[type="submit"]', form);
      const data = Object.fromEntries(new FormData(form).entries());
      msg.textContent = '';
      msg.classList.remove('is-ok');
      $$('.field', form).forEach((f) => f.classList.remove('is-invalid'));

      const name = (data.name || '').trim();
      const phone = (data.phone || '').trim();
      const email = (data.email || '').trim();
      const fail = (key, field) => {
        msg.textContent = t(key);
        if (field && form.elements[field]) form.elements[field].closest('.field').classList.add('is-invalid');
      };
      if (!name || (!phone && !email)) {
        msg.textContent = t('form.required');
        if (!name) form.elements.name.closest('.field').classList.add('is-invalid');
        if (!phone && !email) form.elements.phone.closest('.field').classList.add('is-invalid');
        return;
      }
      // та же проверка, что на сервере, — чтобы не отправлять заведомо отклонённую заявку
      if (email && !/^[^s@]+@[^s@]+.[^s@]+$/.test(email)) return fail('form.badEmail', 'email');
      if (!form.elements.consent.checked) return fail('form.consentRequired');

      const label = btn.querySelector('span') || btn;
      const old = label.textContent;
      label.textContent = t('form.sending');
      btn.disabled = true;
      try {
        let res;
        if (DEMO) {
          // демо-показ на GitHub Pages: сервера нет, заявка никуда не отправляется
          await new Promise((r) => setTimeout(r, 600));
          res = { ok: true };
        } else try {
          res = await fetch('/api/requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name, phone, email,
              company: data.company || '',
              service: data.service || '',
              message: data.message || '',
              ctgj_trap: data.ctgj_trap || '',
              lang,
              source: form.closest('.letter') ? 'envelope' : 'contacts',
            }),
          });
        } catch (netErr) {
          return fail('form.network');
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 429) return fail('form.tooMany');
          if (body.code === 'email') return fail('form.badEmail', 'email');
          if (body.code === 'required') return fail('form.required', 'name');
          return fail('form.error');
        }
        if (form.closest('.letter')) {
          letter.classList.add('is-sent');
          later(() => closeMail(true), 2600);
        } else {
          form.reset();
          msg.classList.add('is-ok');
          msg.textContent = t('form.successText');
        }
      } finally {
        label.textContent = old;
        btn.disabled = false;
      }
    });
  });

  /* ================= Партнёры ================= */
  // логотипы — из public/партнеры, список отдаёт partners.json (сервер или сборка GitHub Pages)
  (async function loadPartners() {
    const section = $('#partners');
    const grid = $('#partners-grid');
    const moreBtn = $('#partners-more');
    if (!section || !grid) return;
    let list = [];
    try {
      const res = await fetch('партнеры/partners.json', { cache: 'no-cache' });
      if (res.ok) list = await res.json();
    } catch (e) { /* нет списка — раздел остаётся скрытым */ }
    if (!Array.isArray(list) || !list.length) return;

    const LIMIT = 15; // сколько показываем сразу; остальные — по кнопке
    grid.innerHTML = list.map((p, i) => `
      <li class="partner${i >= LIMIT ? ' is-hidden' : ''}" data-reveal style="--i:${i % 10}">
        <img src="партнеры/${encodeURIComponent(p.file)}" alt="${escapeHtml(p.name)}" title="${escapeHtml(p.name)}" loading="lazy">
      </li>`).join('');
    section.hidden = false;

    // световое пятно следует за курсором
    grid.addEventListener('pointermove', (e) => {
      const tile = e.target.closest('.partner');
      if (!tile) return;
      const rect = tile.getBoundingClientRect();
      tile.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      tile.style.setProperty('--my', `${e.clientY - rect.top}px`);
    });

    // плавное появление: вешаем наблюдатель, если раздел уже инициализирован после заставки
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.1 });
    $$('[data-reveal], [data-split]', section).forEach((el, k) => {
      if (el.classList.contains('partner')) el.style.setProperty('--d', Math.min((k % 5) * 0.06, 0.3) + 's');
      io.observe(el);
    });

    if (list.length > LIMIT) {
      moreBtn.hidden = false;
      let open = false;
      moreBtn.addEventListener('click', () => {
        open = !open;
        $$('.partner', grid).forEach((li, i) => {
          if (i >= LIMIT) { li.classList.toggle('is-hidden', !open); if (open) li.classList.add('in'); }
        });
        moreBtn.textContent = t(open ? 'partners.showLess' : 'partners.showAll');
        moreBtn.dataset.i18n = open ? 'partners.showLess' : 'partners.showAll';
      });
    }
  })();

  /* ================= Страница проекта ================= */
  // Открывается по клику на карточку; адрес #project-N, работает кнопка «Назад» браузера.
  const pview = $('#pview');
  const pviewBody = $('#pview-body');
  const projectCards = $$('.project[data-project]');
  const PROJECT_COUNT = projectCards.length;
  let currentProject = -1;
  let pushedProject = false;
  let projectReturnFocus = null;

  // фото проектов (img/projects); для CC BY-SA обязательна подпись автора
  const P_PHOTOS = [
    { src: 'img/projects/p1.jpg', credit: 'The EITI, CC BY-SA 2.0', link: 'https://commons.wikimedia.org/wiki/File:Taganito_Mining_Corp._nickel_ore_conveyor_belts_-_Flickr.jpg' },
    { src: 'img/projects/p2.jpg' },
    { src: 'img/projects/p3.jpg', fit: 'contain' }, // рендер насоса на белом фоне — не обрезать
    { src: 'img/projects/p4.jpg' },
    { src: 'img/projects/p5.jpg', credit: 'Vis M, CC BY-SA 4.0', link: 'https://commons.wikimedia.org/wiki/File:UTM_Autograph.jpg' },
  ];

  function projectHtml(i) {
    const k = `prj.${i + 1}`;
    const e = (key) => escapeHtml(t(key));
    const photo = P_PHOTOS[i] || {};
    const credit = photo.credit
      ? `<figcaption class="pview__credit">Фото: <a href="${photo.link}" target="_blank" rel="noopener">${escapeHtml(photo.credit)}</a></figcaption>`
      : '';
    return `
      <article class="pview__page">
        <header class="container pview__head">
          <span class="pview__tag">${e(k + '.tag')}</span>
          <h2 class="h2 pview__title" id="pview-title">${e(k + '.t')}</h2>
          <span class="pview__label">${e('prj.task')}</span>
          <p class="pview__lead">${e(k + '.task')}</p>
        </header>
        <section class="pview__split">
          <figure class="pview__photo${photo.fit === 'contain' ? ' pview__photo--contain' : ''}">
            ${photo.src ? `<img src="${photo.src}" alt="${e(k + '.t')}">` : ''}
            ${credit}
            <div class="pview__result">
              <h3>${e('prj.result')}</h3>
              <p>${e(k + '.result')}</p>
            </div>
          </figure>
          <div class="pview__info">
            <span class="pview__chip">${e(k + '.tag')}</span>
            <h3 class="pview__ctx">${e('prj.context')}</h3>
            <p class="pview__ctx-sub">${e('prj.f1')} · ${e('prj.f2')} · ${e('prj.f3')}</p>
            <div class="pview__cols">
              <div><h4><i></i>${e('prj.problem')}</h4><p>${e(k + '.problem')}</p></div>
              <div><h4><i></i>${e('prj.solution')}</h4><p>${e(k + '.solution')}</p></div>
            </div>
            <button class="btn btn--red" type="button" data-pview-request>${e('prj.cta')}</button>
          </div>
        </section>
      </article>`;
  }

  function renderProject(i, dir) {
    const old = $('.pview__page', pviewBody);
    const place = () => {
      pviewBody.innerHTML = projectHtml(i);
      $('[data-pview-request]', pviewBody).addEventListener('click', () => openMail('supply'));
      const page = $('.pview__page', pviewBody);
      if (dir && !reduced) {
        page.style.setProperty('--dir', dir > 0 ? '40px' : '-40px');
        page.classList.add('is-entering');
        requestAnimationFrame(() => requestAnimationFrame(() => page.classList.remove('is-entering')));
      }
    };
    if (old && dir && !reduced) {
      old.style.setProperty('--dir', dir > 0 ? '-40px' : '40px');
      old.classList.add('is-leaving');
      setTimeout(() => { place(); pview.scrollTop = 0; }, 260);
    } else {
      place();
      pview.scrollTop = 0;
    }
  }

  function openProject(i, opts = {}) {
    i = ((i % PROJECT_COUNT) + PROJECT_COUNT) % PROJECT_COUNT;
    const wasOpen = !pview.hidden;
    const dir = wasOpen && currentProject !== i ? (opts.dir || (i > currentProject ? 1 : -1)) : 0;
    currentProject = i;
    renderProject(i, dir);
    const hash = `#project-${i + 1}`;
    if (opts.push !== false && location.hash !== hash) {
      if (wasOpen) history.replaceState({ project: i }, '', hash);
      else { history.pushState({ project: i }, '', hash); pushedProject = true; }
    }
    if (!wasOpen) {
      projectReturnFocus = document.activeElement;
      pview.hidden = false;
      document.body.classList.add('pview-open');
      if (lenis) lenis.stop();
      requestAnimationFrame(() => pview.classList.add('is-open'));
      setTimeout(() => $('.pview__back', pview).focus({ preventScroll: true }), 50);
    }
  }

  function hideProject() {
    if (pview.hidden) return;
    pview.classList.remove('is-open');
    document.body.classList.remove('pview-open');
    if (lenis) lenis.start();
    currentProject = -1;
    setTimeout(() => { if (currentProject < 0) pview.hidden = true; }, reduced ? 0 : 450);
    if (projectReturnFocus && projectReturnFocus.focus) projectReturnFocus.focus({ preventScroll: true });
  }

  function closeProject() {
    if (pushedProject && history.state && history.state.project !== undefined) {
      pushedProject = false;
      history.back(); // уберёт #project-N, popstate закроет страницу
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      hideProject();
    }
  }

  projectCards.forEach((card) => {
    const open = () => openProject(Number(card.dataset.project));
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
  $$('[data-pclose]', pview).forEach((b) => b.addEventListener('click', closeProject));
  $('#pview-prev').addEventListener('click', () => openProject(currentProject - 1, { dir: -1 }));
  $('#pview-next').addEventListener('click', () => openProject(currentProject + 1, { dir: 1 }));

  document.addEventListener('keydown', (e) => {
    if (pview.hidden || !mail.hidden) return;
    if (e.key === 'Escape') closeProject();
    else if (e.key === 'ArrowLeft') openProject(currentProject - 1, { dir: -1 });
    else if (e.key === 'ArrowRight') openProject(currentProject + 1, { dir: 1 });
  });

  // свайп влево/вправо на телефоне
  let touchX = null, touchY = null;
  pview.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
  pview.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) openProject(currentProject + (dx < 0 ? 1 : -1), { dir: dx < 0 ? 1 : -1 });
  }, { passive: true });

  // адрес #project-N: «Назад»/«Вперёд» в браузере и прямые ссылки
  function syncFromHash() {
    const m = /^#project-(\d+)$/.exec(location.hash);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= PROJECT_COUNT) openProject(Number(m[1]) - 1, { push: false });
    else hideProject();
  }
  window.addEventListener('popstate', syncFromHash);
  if (/^#project-\d+$/.test(location.hash)) {
    // открыли по прямой ссылке — показываем после заставки
    const waitReady = setInterval(() => {
      if (document.body.classList.contains('is-ready')) { clearInterval(waitReady); syncFromHash(); }
    }, 100);
  }

  // смена языка — перерисовать открытый проект
  document.addEventListener('ctgj:lang', () => { if (currentProject >= 0) renderProject(currentProject, 0); });
})();
