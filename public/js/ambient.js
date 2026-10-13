/* CTGJ — живой фон секций: поднимающиеся небесные фонарики и золотые искры.
   Один fixed-canvas поверх фона секций, но под их содержимым (см. .ambient в style.css).
   Первый экран его перекрывает — там своя сцена. */
(function () {
  'use strict';

  const canvas = document.getElementById('ambient');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { canvas.remove(); return; }

  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;

  let W = 0, H = 0, dpr = 1;
  let lanterns = [];
  let sparks = [];
  let running = false;
  let last = 0;
  let time = 0;
  let lastScroll = window.scrollY;
  let light = false;

  // три уровня глубины: дальние — мелкие, бледные, медленные; ближние — крупные и яркие
  const LAYERS = [
    { size: [10, 14], speed: [10, 16], alpha: 0.45, parallax: 0.12, share: 0.42 },
    { size: [17, 24], speed: [16, 26], alpha: 0.78, parallax: 0.25, share: 0.36 },
    { size: [28, 38], speed: [24, 36], alpha: 0.95, parallax: 0.42, share: 0.22 },
  ];

  // телефон: экран маленький, поэтому без крупного ближнего уровня
  const isMobile = () => W < 700;

  function pickLayer() {
    const layers = isMobile() ? LAYERS.slice(0, 2) : LAYERS;
    const total = layers.reduce((n, L) => n + L.share, 0);
    const r = Math.random() * total;
    let acc = 0;
    for (const L of layers) { acc += L.share; if (r <= acc) return L; }
    return layers[0];
  }

  /* крупные фонарики держим у краёв экрана, подальше от колонок текста;
     по центру летят только мелкие и бледные дальние */
  function pickX(L) {
    const far = L === LAYERS[0];
    if (far && Math.random() < 0.35) return rand(0.08, 0.92) * W;
    // поля по бокам от колонки контента (та же сетка, что в CSS: max 1280px + отступы)
    const gutter = Math.min(48, Math.max(16, W * 0.04));
    const contentLeft = Math.max(gutter, (W - 1280) / 2 + gutter);
    if (contentLeft >= 60) {
      return Math.random() < 0.5 ? rand(14, contentLeft - 26) : rand(W - contentLeft + 26, W - 14);
    }
    // узкий экран: полей нет — держимся самого края
    return Math.random() < 0.5 ? rand(0.01, 0.1) * W : rand(0.9, 0.99) * W;
  }

  function newLantern(initial) {
    const L = pickLayer();
    return {
      L,
      x: pickX(L),
      y: initial ? rand(0, H) : H + rand(30, 160),
      s: rand(L.size[0], L.size[1]) * (isMobile() ? 0.8 : 1),
      v: rand(L.speed[0], L.speed[1]),
      ph: rand(0, TAU),
      sway: L === LAYERS[0] ? rand(6, 16) : rand(3, 8), // крупные качаются слабо — не заплывают на текст
      flick: rand(2, 5),
      hue: rand(0, 1), // от жёлто-оранжевого к красному
    };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // примерно вдвое реже, чем раньше: фон, а не главный герой
    const count = isMobile() ? (W < 420 ? 2 : 3) : Math.round(Math.min(11, Math.max(4, W / 135)));
    lanterns = Array.from({ length: count }, () => newLantern(true));
    sparks = Array.from({ length: isMobile() ? 4 : Math.round(count * 1.3) }, () => newSpark(true));
  }

  function newSpark(initial) {
    return {
      x: rand(0, W),
      y: initial ? rand(0, H) : H + 10,
      r: rand(0.6, 1.8),
      v: rand(8, 22),
      ph: rand(0, TAU),
      tw: rand(1.5, 3.5),
    };
  }

  /* круглый красный китайский фонарь: шар, золотые крышки, кисточка, 福 на крупных */
  const CHARS = ['福', '福', '春', '吉'];
  function drawLantern(l, flick) {
    const s = l.s;
    // на светлом фоне фонарики прозрачнее, чтобы не спорить с текстом
    const a = l.L.alpha * (light ? 0.62 : 0.9);
    const tilt = Math.sin(time * 0.8 + l.ph) * 0.07;
    const x = l.x + Math.sin(time * 0.5 + l.ph) * l.sway;
    const y = l.y;
    const r = s * 0.62;          // радиус шара (по ширине)
    const ry = r * 0.88;         // чуть приплюснут, как настоящий фонарь

    // ореол
    const glowR = s * (light ? 2.2 : 3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, `rgba(255, ${light ? 110 : 120}, 50, ${(light ? 0.2 : 0.34) * a * flick})`);
    g.addColorStop(1, 'rgba(255, 80, 30, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.globalAlpha = a;

    // шнур сверху
    ctx.strokeStyle = 'rgba(168, 118, 42, 0.8)';
    ctx.lineWidth = Math.max(0.6, s * 0.03);
    ctx.beginPath();
    ctx.moveTo(0, -ry - s * 0.12);
    ctx.lineTo(0, -ry - s * 0.4);
    ctx.stroke();

    // шар: светлая середина → красный → тёмно-красные края
    const body = ctx.createRadialGradient(-r * 0.3, -ry * 0.35, r * 0.1, 0, 0, r * 1.05);
    body.addColorStop(0, `rgb(255, ${Math.round(lerp(130, 170, flick - 0.7))}, 80)`);
    body.addColorStop(0.45, l.hue > 0.5 ? '#e0321f' : '#e84a24');
    body.addColorStop(1, '#7a0a06');
    ctx.beginPath();
    ctx.ellipse(0, 0, r, ry, 0, 0, TAU);
    ctx.fillStyle = body;
    ctx.fill();

    // рёбра-меридианы
    if (s > 10) {
      ctx.strokeStyle = 'rgba(90, 10, 5, 0.35)';
      ctx.lineWidth = Math.max(0.5, s * 0.025);
      for (const k of [0.25, 0.6]) {
        ctx.beginPath();
        ctx.ellipse(0, 0, r * k, ry, 0, 0, TAU);
        ctx.stroke();
      }
    }

    // золотой иероглиф на крупных фонарях
    if (s > 22) {
      ctx.fillStyle = 'rgba(255, 214, 130, 0.95)';
      ctx.font = `${Math.round(r * 0.95)}px 'Ma Shan Zheng', 'Noto Sans SC', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CHARS[Math.floor(l.hue * CHARS.length) % CHARS.length], 0, r * 0.06);
    }

    // золотые крышки сверху и снизу
    const capW = r * 0.95, capH = Math.max(1.5, s * 0.11);
    const cap = ctx.createLinearGradient(0, -capH / 2, 0, capH / 2);
    cap.addColorStop(0, '#f7d58b');
    cap.addColorStop(1, '#a8762a');
    ctx.fillStyle = cap;
    ctx.fillRect(-capW / 2, -ry - capH * 0.6, capW, capH);
    ctx.fillRect(-capW / 2, ry - capH * 0.4, capW, capH);

    // кисточка
    ctx.strokeStyle = '#c4281a';
    ctx.lineWidth = Math.max(1, s * 0.09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, ry + capH * 0.6);
    ctx.lineTo(Math.sin(time * 1.6 + l.ph) * s * 0.05, ry + capH * 0.6 + s * 0.38);
    ctx.stroke();

    ctx.restore();
  }

  function frame(now) {
    if (!running) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    time += dt;

    // прокрутка сдвигает фонарики с разной скоростью — эффект глубины
    const sy = window.scrollY;
    const dScroll = sy - lastScroll;
    lastScroll = sy;

    ctx.clearRect(0, 0, W, H);

    // искры
    for (let i = 0; i < sparks.length; i++) {
      const p = sparks[i];
      p.y -= p.v * dt + dScroll * 0.08;
      p.x += Math.sin(time * 0.7 + p.ph) * 0.15;
      if (p.y < -10) { sparks[i] = newSpark(false); continue; }
      if (p.y > H + 20) p.y = -5;
      const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * p.tw + p.ph));
      ctx.fillStyle = light ? `rgba(196, 128, 30, ${0.5 * tw})` : `rgba(255, 210, 120, ${0.65 * tw})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }

    // фонарики: сначала дальние, потом ближние
    lanterns.sort((a, b) => a.s - b.s);
    for (let i = 0; i < lanterns.length; i++) {
      const l = lanterns[i];
      l.y -= l.v * dt + dScroll * l.L.parallax;
      if (l.y < -80) { lanterns[i] = newLantern(false); continue; }
      if (l.y > H + 200) l.y = -60; // быстрый скролл вверх — переносим наверх
      const flick = 0.82 + 0.12 * Math.sin(time * l.flick + l.ph) + 0.06 * Math.sin(time * l.flick * 2.7);
      drawLantern(l, flick);
    }

    requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    lastScroll = window.scrollY;
    requestAnimationFrame(frame);
  }
  function stop() { running = false; }

  function syncTheme() { light = document.documentElement.getAttribute('data-theme') === 'light'; }
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  syncTheme();

  resize();
  window.addEventListener('resize', resize);

  // пока первый экран целиком закрывает окно, фонарики не видны — не тратим ресурсы
  const hero = document.getElementById('hero');
  const update = () => {
    const heroCovers = hero && hero.getBoundingClientRect().bottom >= window.innerHeight - 1;
    if (!document.hidden && !heroCovers) start(); else stop();
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  document.addEventListener('visibilitychange', update);
  update();
})();
