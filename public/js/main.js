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
    // проверка целостности: если файл на CDN подменят, браузер его не выполнит
    s.integrity = 'sha384-eD5ubmuCcvTdCADWuSchJYE7wcj2nzNr0itbrh6w/KJyBiltSZ8w3VFRBSWu5YQ8';
    s.crossOrigin = 'anonymous';
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

  function openMail(service, message) {
    clearTimers();
    lastFocus = document.activeElement;
    const form = $('form', letter);
    letter.classList.remove('is-sent');
    form.reset();
    $('.form-msg', form).textContent = '';
    if (service) form.elements.service.value = service;
    if (message) form.elements.message.value = message;
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
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('form.badEmail', 'email');
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
  // Страницы партнёров (#partner-id). id = имя файла логотипа без номера: «02-shitian.png» → shitian.
  // Тексты — в i18n.js (ключи ptn.<id>.*). Контакты производителей намеренно не показываем: все запросы идут через CTGJ.
  // Логотип без записи здесь просто выводится в сетке, без перехода на страницу.
  const P_INFO = [
    { id: 'fulaier', name: 'Fulaier', photo: 'img/partners/fulaier.jpg' },
    // fit: 'contain' — предмет на белом фоне; 'blur' — широкое фото целиком на размытом фоне; без fit — фото на всю панель
    { id: 'shitian', name: 'Shitian', photo: 'img/partners/shitian.jpg', fit: 'blur' },
    { id: 'dbd-power', name: 'DBD Power', photo: 'img/partners/dbd-power.jpg' },
    { id: 'huxi', name: 'HUXI', photo: 'img/partners/huxi.jpg', fit: 'blur' },
    { id: 'shanghai-sunshine-pump', name: 'Shanghai Sunshine Pump', photo: 'img/partners/shanghai-sunshine-pump.jpg', fit: 'contain' },
    { id: 'innofluid', name: 'Innofluid', photo: 'img/partners/innofluid.jpg', fit: 'contain' },
    { id: 'yisite', name: 'Yisite', photo: 'img/partners/yisite.jpg', fit: 'blur' },
    { id: 'snf', name: 'SNF', photo: 'img/partners/snf.jpg', fit: 'blur' },
    { id: 'sunresin', name: 'Sunresin', photo: 'img/partners/sunresin.jpg' },
    { id: 'ddsy', name: 'DDSY', photo: 'img/partners/ddsy.jpg', fit: 'blur' },
  ];
  const partnerLogos = {}; // id → файл логотипа из partners.json
  const partnerId = (file) => file.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]*/, '').toLowerCase();

  // логотипы — из public/партнеры, список отдаёт partners.json (сервер или сборка GitHub Pages)
  const partnersReady = (async function loadPartners() {
    const section = $('#partners');
    const grid = $('#partners-grid');
    if (!section || !grid) return;
    let list = [];
    try {
      const res = await fetch('партнеры/partners.json', { cache: 'no-cache' });
      if (res.ok) list = await res.json();
    } catch (e) { /* нет списка — раздел остаётся скрытым */ }
    if (!Array.isArray(list) || !list.length) return;

    // плитка: логотип + короткая подпись (направление партнёра, ключ ptn.<id>.tag)
    const tileHtml = (p, i, clone) => {
      const id = partnerId(p.file);
      const idx = P_INFO.findIndex((x) => x.id === id);
      const cap = idx >= 0 ? `ptn.${id}.tag` : '';
      const attrs = clone ? ' aria-hidden="true"' : '';
      const link = idx >= 0
        ? ` is-link" role="button" tabindex="${clone ? -1 : 0}" data-partner="${idx}"${clone ? '' : ` aria-label="${escapeHtml(P_INFO[idx].name)}"`}`
        : '"';
      return `
      <li class="partner${link}${attrs} style="--i:${i % 10}">
        <span class="partner__logo"><img src="партнеры/${encodeURIComponent(p.file)}" alt="${clone ? '' : escapeHtml(p.name)}"></span>
        ${cap ? `<span class="partner__cap" data-i18n="${cap}">${escapeHtml(t(cap))}</span>` : ''}
        ${idx >= 0 ? '<i class="partner__go" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></i>' : ''}
      </li>`;
    };
    list.forEach((p) => { partnerLogos[partnerId(p.file)] = p.file; });
    // если партнёров мало, повторяем набор, чтобы лента была шире экрана и не было пустоты
    let set = list.slice();
    while (set.length < 8) set = set.concat(list);
    // вторая копия нужна для бесшовного круга: лента сдвигается ровно на половину своей длины
    grid.innerHTML = set.map((p, i) => tileHtml(p, i, i >= list.length)).join('')
      + set.map((p, i) => tileHtml(p, i, true)).join('');
    section.hidden = false;

    // скорость постоянная (~45 px/с) при любой ширине плиток и числе партнёров
    const marquee = $('#partners-marquee');
    const setSpeed = () => grid.style.setProperty('--dur', `${Math.max(grid.scrollWidth / 2 / 45, 12)}s`);
    setSpeed();
    window.addEventListener('resize', setSpeed);
    $$('img', grid).forEach((img) => img.addEventListener('load', setSpeed, { once: true }));

    // клик по логотипу — страница партнёра
    const openTile = (e) => {
      const tile = e.target.closest('.partner[data-partner]');
      if (tile) openView('partner', Number(tile.dataset.partner));
    };
    grid.addEventListener('click', openTile);
    grid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTile(e); }
    });

    // световое пятно следует за курсором
    grid.addEventListener('pointermove', (e) => {
      const tile = e.target.closest('.partner');
      if (!tile) return;
      const rect = tile.getBoundingClientRect();
      tile.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      tile.style.setProperty('--my', `${e.clientY - rect.top}px`);
    });

    // на телефоне наведения нет: касание ленты ставит её на паузу, через 3 с она едет дальше
    let resume = 0;
    marquee.addEventListener('touchstart', () => {
      marquee.classList.add('is-paused');
      clearTimeout(resume);
      resume = setTimeout(() => marquee.classList.remove('is-paused'), 3000);
    }, { passive: true });

    // плавное появление: вешаем наблюдатель, если раздел уже инициализирован после заставки
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.1 });
    $$('[data-reveal], [data-split]', section).forEach((el) => io.observe(el));
  })();


  /* ================= Страница проекта / партнёра ================= */
  // Открывается по клику на карточку проекта (#project-N) или логотип партнёра (#partner-id);
  // работает кнопка «Назад» браузера.
  const pview = $('#pview');
  const pviewBody = $('#pview-body');
  const projectCards = $$('.project[data-project]');
  const PROJECT_COUNT = projectCards.length;
  let currentProject = -1;
  let pushedProject = false;
  let projectReturnFocus = null;

  // фото проектов (img/projects); если фото под CC BY — добавить credit и link, подпись выведется на фото
  const P_PHOTOS = [
    { src: 'img/projects/p1.jpg' },
    { src: 'img/projects/p2.jpg' },
    { src: 'img/projects/p3.jpg', fit: 'contain' }, // рендер насоса на белом фоне — не обрезать
    { src: 'img/projects/p4.jpg' },
    { src: 'img/projects/p5.jpg' },
    { src: 'img/projects/p6.jpg', fit: 'contain' }, // отливки DDSY на белом фоне (с сайта ddsyzz.com)
    { src: 'img/projects/p7.jpg', fit: 'blur' }, // небольшое фото брикетов из презентации SNF
  ];

  // url() внутри CSS-переменной браузер считает от файла style.css (css/…), поэтому передаём полный адрес
  const absUrl = (src) => new URL(src, location.href).href;

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
          <figure class="pview__photo${photo.fit ? ` pview__photo--${photo.fit}` : ''}"${photo.fit === 'blur' ? ` style="--img:url('${absUrl(photo.src)}')"` : ''}>
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

  function partnerHtml(i) {
    const p = P_INFO[i];
    const k = `ptn.${p.id}`;
    const e = (key) => escapeHtml(t(key));
    const items = (key) => t(key).split('|').map((s) => s.trim()).filter(Boolean);
    const logo = partnerLogos[p.id];
    const legal = t(k + '.legal');
    const facts = items(k + '.facts').map((f) => {
      const [value, label] = f.split('::').map((s) => s.trim());
      return `<li><b>${escapeHtml(value)}</b><span>${escapeHtml(label || '')}</span></li>`;
    }).join('');
    return `
      <article class="pview__page pview__page--partner">
        <header class="container pview__head">
          <span class="pview__tag">${e(k + '.tag')}</span>
          <h2 class="h2 pview__title" id="pview-title">${escapeHtml(p.name)}</h2>
          ${legal ? `<span class="pview__label">${escapeHtml(legal)}</span>` : ''}
          <p class="pview__lead">${e(k + '.lead')}</p>
        </header>
        <section class="pview__split">
          <figure class="pview__photo${p.fit ? ` pview__photo--${p.fit}` : ''}"${p.fit === 'blur' ? ` style="--img:url('${absUrl(p.photo)}')"` : ''}>
            <img src="${p.photo}" alt="${escapeHtml(p.name)}">
            <div class="pview__result">
              <h3>${e('ptn.via')}</h3>
              <p>${e('ptn.viaText')}</p>
            </div>
          </figure>
          <div class="pview__info">
            ${logo
              ? `<span class="pview__chip pview__chip--logo"><img src="партнеры/${encodeURIComponent(logo)}" alt="${escapeHtml(p.name)}"></span>`
              : `<span class="pview__chip">${escapeHtml(p.name)}</span>`}
            <h3 class="pview__ctx">${e('ptn.about')}</h3>
            <p class="pview__about">${e(k + '.about')}</p>
            ${facts ? `<ul class="pview__facts">${facts}</ul>` : ''}
            <h4 class="pview__sub"><i></i>${e('ptn.products')}</h4>
            <ul class="pview__tags">${items(k + '.products').map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
            <button class="btn btn--red" type="button" data-pview-request>${e('ptn.cta')}</button>
          </div>
        </section>
      </article>`;
  }

  // два вида страниц в одном окне: проекты и партнёры
  const VIEWS = {
    project: {
      count: () => PROJECT_COUNT,
      html: projectHtml,
      hash: (i) => `#project-${i + 1}`,
      parse: (h) => {
        const m = /^#project-(\d+)$/.exec(h);
        return m && Number(m[1]) >= 1 && Number(m[1]) <= PROJECT_COUNT ? Number(m[1]) - 1 : -1;
      },
      labels: { back: 'prj.back', prev: 'prj.prevOne', next: 'prj.nextOne' },
      request: () => openMail('supply'),
    },
    partner: {
      count: () => P_INFO.length,
      html: partnerHtml,
      hash: (i) => `#partner-${P_INFO[i].id}`,
      parse: (h) => {
        const m = /^#partner-([\w-]+)$/.exec(h);
        return m ? P_INFO.findIndex((p) => p.id === m[1]) : -1;
      },
      labels: { back: 'ptn.back', prev: 'ptn.prevOne', next: 'ptn.nextOne' },
      // в заявку подставляем производителя — менеджер сразу видит, о чём запрос
      request: (i) => openMail('supply', t('ptn.request').replace('{name}', P_INFO[i].name)),
    },
  };
  let viewKind = null;

  // подписи «Все проекты / Все партнёры» и стрелок зависят от вида страницы
  function setViewLabels(kind) {
    const L = VIEWS[kind].labels;
    const back = $('.pview__back span', pview);
    back.dataset.i18n = L.back;
    back.textContent = t(L.back);
    [['#pview-prev', L.prev], ['#pview-next', L.next]].forEach(([sel, key]) => {
      const b = $(sel, pview);
      b.dataset.i18nAria = key;
      b.setAttribute('aria-label', t(key));
    });
  }

  function renderProject(i, dir) {
    const V = VIEWS[viewKind];
    const old = $('.pview__page', pviewBody);
    const place = () => {
      pviewBody.innerHTML = V.html(i);
      $('[data-pview-request]', pviewBody).addEventListener('click', () => V.request(i));
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

  function openView(kind, i, opts = {}) {
    const V = VIEWS[kind];
    const count = V.count();
    if (!count) return;
    i = ((i % count) + count) % count;
    const wasOpen = !pview.hidden;
    const sameKind = wasOpen && viewKind === kind;
    const dir = sameKind && currentProject !== i ? (opts.dir || (i > currentProject ? 1 : -1)) : 0;
    if (viewKind !== kind) setViewLabels(kind);
    viewKind = kind;
    currentProject = i;
    renderProject(i, dir);
    const hash = V.hash(i);
    if (opts.push !== false && location.hash !== hash) {
      if (wasOpen) history.replaceState({ view: kind, i }, '', hash);
      else { history.pushState({ view: kind, i }, '', hash); pushedProject = true; }
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
  const openProject = (i, opts) => openView('project', i, opts);
  const step = (d) => openView(viewKind, currentProject + d, { dir: d });

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
    if (pushedProject && history.state && history.state.view) {
      pushedProject = false;
      history.back(); // уберёт #project-N / #partner-id, popstate закроет страницу
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
  $('#pview-prev').addEventListener('click', () => step(-1));
  $('#pview-next').addEventListener('click', () => step(1));

  document.addEventListener('keydown', (e) => {
    if (pview.hidden || !mail.hidden) return;
    if (e.key === 'Escape') closeProject();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });

  // свайп влево/вправо на телефоне
  let touchX = null, touchY = null;
  pview.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
  pview.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  // адрес #project-N / #partner-id: «Назад»/«Вперёд» в браузере и прямые ссылки
  function syncFromHash() {
    for (const kind of Object.keys(VIEWS)) {
      const i = VIEWS[kind].parse(location.hash);
      if (i >= 0) { openView(kind, i, { push: false }); return; }
    }
    hideProject();
  }
  window.addEventListener('popstate', syncFromHash);
  if (/^#(project|partner)-[\w-]+$/.test(location.hash)) {
    // открыли по прямой ссылке — показываем после заставки (и после загрузки логотипов)
    const waitReady = setInterval(() => {
      if (document.body.classList.contains('is-ready')) { clearInterval(waitReady); partnersReady.finally(syncFromHash); }
    }, 100);
  }

  // смена языка — перерисовать открытую страницу
  document.addEventListener('ctgj:lang', () => { if (currentProject >= 0) renderProject(currentProject, 0); });
})();
