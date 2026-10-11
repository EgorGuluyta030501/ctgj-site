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

  function pickLayer() {
    const r = Math.random();
    let acc = 0;
    for (const L of LAYERS) { acc += L.share; if (r <= acc) return L; }
    return LAYERS[0];
  }

  function newLantern(initial) {
    const L = pickLayer();
    return {
      L,
      x: rand(0.03, 0.97) * W,
      y: initial ? rand(0, H) : H + rand(30, 160),
      s: rand(L.size[0], L.size[1]),
      v: rand(L.speed[0], L.speed[1]),
      ph: rand(0, TAU),
      sway: rand(6, 18),
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
    const count = Math.round(Math.min(22, Math.max(9, W / 68)));
    lanterns = Array.from({ length: count }, () => newLantern(true));
    sparks = Array.from({ length: Math.round(count * 1.6) }, () => newSpark(true));
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

  /* небесный фонарик: купол шире сверху, светящееся отверстие снизу */
  function drawLantern(l, flick) {
    const s = l.s;
    const a = l.L.alpha;
    const tilt = Math.sin(time * 0.8 + l.ph) * 0.08;
    const x = l.x + Math.sin(time * 0.5 + l.ph) * l.sway;
    const y = l.y;

    // ореол
    const glowR = s * (light ? 2.4 : 3.2);
    const g = ctx.createRadialGradient(x, y + s * 0.3, 0, x, y + s * 0.3, glowR);
    g.addColorStop(0, `rgba(255, ${light ? 140 : 170}, ${light ? 50 : 70}, ${(light ? 0.32 : 0.35) * a * flick})`);
    g.addColorStop(1, 'rgba(255, 120, 40, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - glowR, y + s * 0.3 - glowR, glowR * 2, glowR * 2);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.globalAlpha = a;

    const w = s * 0.6, h = s * 1.35; // выше и стройнее — как настоящий небесный фонарь
    // корпус: от светлой середины к красным краям
    const body = ctx.createLinearGradient(-w, 0, w, 0);
    const edge = l.hue > 0.5 ? '#c4281a' : '#d9561f';
    body.addColorStop(0, edge);
    body.addColorStop(0.5, `rgb(255, ${Math.round(lerp(190, 225, flick - 0.7))}, ${Math.round(lerp(90, 130, flick - 0.7))})`);
    body.addColorStop(1, edge);
    ctx.beginPath();
    ctx.moveTo(-w * 0.62, h * 0.5);
    ctx.bezierCurveTo(-w * 0.95, h * 0.05, -w * 1.02, -h * 0.45, -w * 0.55, -h * 0.55);
    ctx.quadraticCurveTo(0, -h * 0.72, w * 0.55, -h * 0.55);
    ctx.bezierCurveTo(w * 1.02, -h * 0.45, w * 0.95, h * 0.05, w * 0.62, h * 0.5);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();

    // рёбра каркаса
    if (s > 11) {
      ctx.strokeStyle = 'rgba(120, 30, 10, 0.35)';
      ctx.lineWidth = Math.max(0.6, s * 0.04);
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.62); ctx.lineTo(0, h * 0.5);
      ctx.moveTo(-w * 0.5, -h * 0.5); ctx.quadraticCurveTo(-w * 0.6, 0, -w * 0.38, h * 0.5);
      ctx.moveTo(w * 0.5, -h * 0.5); ctx.quadraticCurveTo(w * 0.6, 0, w * 0.38, h * 0.5);
      ctx.stroke();
    }

    // нижний обод и огонь внутри
    ctx.beginPath();
    ctx.ellipse(0, h * 0.5, w * 0.62, s * 0.1, 0, 0, TAU);
    ctx.fillStyle = 'rgba(110, 30, 10, 0.75)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, h * 0.46, w * 0.32 * flick, s * 0.12 * flick, 0, 0, TAU);
    ctx.fillStyle = `rgba(255, 245, 190, ${0.9 * flick})`;
    ctx.fill();

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
