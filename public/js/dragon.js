/* CTGJ — китайский дракон и ночная сцена на canvas.
   Без зависимостей. Используется в прелоадере и в hero-блоке.
   window.SkyScene(canvas, options) — см. описание опций ниже. */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
  const rand = (a, b) => a + Math.random() * (b - a);

  const GOLD = {
    dark: '#8f5e17',
    base: '#c48a2c',
    mid: '#e2a945',
    light: '#f7cf6b',
    shine: '#fff1bf',
    belly: '#f4dcA4',
    line: 'rgba(110, 62, 8, 0.55)',
  };
  const FIRE = { deep: '#c2361f', red: '#e2502b', orange: '#ff8a2a', yellow: '#ffc457' };

  /* Язычок пламени — используется для гривы, плавников, хвоста, бороды. */
  function flame(ctx, x, y, angle, len, width, phase, curl) {
    const steps = 9;
    const left = [], right = [];
    let a = angle, px = x, py = y;
    const seg = len / steps;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const w = width * Math.pow(1 - u, 0.85) * (k === 0 ? 1 : 1);
      const nx = -Math.sin(a), ny = Math.cos(a);
      left.push(px + nx * w * 0.5, py + ny * w * 0.5);
      right.push(px - nx * w * 0.5, py - ny * w * 0.5);
      a += (Math.sin(phase + k * 0.7) * 0.22 + curl) * u;
      px += Math.cos(a) * seg;
      py += Math.sin(a) * seg;
    }
    ctx.moveTo(left[0], left[1]);
    for (let k = 2; k < left.length; k += 2) ctx.lineTo(left[k], left[k + 1]);
    ctx.lineTo(px, py);
    for (let k = right.length - 2; k >= 0; k -= 2) ctx.lineTo(right[k], right[k + 1]);
    ctx.closePath();
  }

  /* ------------------------------------------------------------------ */
  class Dragon {
    /* size — толщина тела в px; length — длина тела в «толщинах»;
       path(t) -> {x, y} — траектория головы во времени. */
    constructor(opts) {
      this.size = opts.size || 60;
      this.length = opts.length || 15;
      this.n = opts.segments || 96;
      this.path = opts.path;
      this.side = opts.side || 1;
      this.particles = [];
      this.pts = [];
      this.trail = [];
    }

    sample(t) {
      const L = this.size * this.length;
      const spacing = L / this.n;
      const trailLen = L * 0.7;
      const pts = [];
      const trail = [];
      let tau = t;
      let prev = this.path(tau);
      pts.push(prev);
      let need = spacing;
      let total = 0;
      const dt = 1 / 480;
      let guard = 0;
      while (guard++ < 30000) {
        tau -= dt;
        const p = this.path(tau);
        let dx = p.x - prev.x, dy = p.y - prev.y;
        let seg = Math.hypot(dx, dy);
        let fx = prev.x, fy = prev.y;
        while (seg >= need) {
          const k = need / seg;
          fx += dx * k; fy += dy * k;
          dx = p.x - fx; dy = p.y - fy;
          seg -= need;
          total += need;
          need = spacing;
          if (pts.length <= this.n) pts.push({ x: fx, y: fy });
          else trail.push({ x: fx, y: fy });
        }
        need -= seg;
        total += seg;
        prev = p;
        if (total > L + trailLen) break;
      }
      while (pts.length <= this.n) pts.push({ ...pts[pts.length - 1] });
      this.pts = pts;
      this.trail = trail;

      // касательные (к голове) и нормали (к спине)
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let tx = a.x - b.x, ty = a.y - b.y;
        const l = Math.hypot(tx, ty) || 1;
        tx /= l; ty /= l;
        pts[i].tx = tx; pts[i].ty = ty;
        pts[i].nx = ty * this.side; pts[i].ny = -tx * this.side;
        pts[i].w = this.width(i / (n - 1));
      }
    }

    width(u) {
      const s = this.size;
      if (u < 0.05) return s * lerp(0.7, 0.86, u / 0.05);
      if (u < 0.22) return s * lerp(0.86, 1, (u - 0.05) / 0.17);
      return s * lerp(1, 0.1, Math.pow((u - 0.22) / 0.78, 1.25));
    }

    /* полоса вдоль тела: от смещения a до b (доли толщины, + к спине) */
    band(ctx, a, b, from = 0, to = this.pts.length - 1) {
      const p = this.pts;
      ctx.beginPath();
      for (let i = from; i <= to; i++) {
        const q = p[i];
        ctx.lineTo(q.x + q.nx * q.w * b, q.y + q.ny * q.w * b);
      }
      for (let i = to; i >= from; i--) {
        const q = p[i];
        ctx.lineTo(q.x + q.nx * q.w * a, q.y + q.ny * q.w * a);
      }
      ctx.closePath();
    }

    draw(ctx, t) {
      this.sample(t);
      const p = this.pts, n = p.length, s = this.size;

      // золотые световые ленты позади дракона
      this.drawTrail(ctx, t);

      // дальние лапы
      this.drawLeg(ctx, Math.round(n * 0.17), t, Math.PI, true);
      this.drawLeg(ctx, Math.round(n * 0.56), t, Math.PI + 1.3, true);

      // спинной гребень
      ctx.beginPath();
      for (let i = 3; i < n * 0.93; i += 3) {
        const q = p[i];
        const u = i / n;
        const h = q.w * (0.75 + 0.25 * Math.sin(i * 1.7)) * (u < 0.1 ? 0.6 : 1);
        const ang = Math.atan2(q.ny - q.ty * 0.9, q.nx - q.tx * 0.9);
        flame(ctx, q.x + q.nx * q.w * 0.38, q.y + q.ny * q.w * 0.38, ang, h, q.w * 0.42, t * 5 + i * 0.4, -0.12 * this.side);
      }
      ctx.fillStyle = FIRE.red;
      ctx.fill();

      // кисть хвоста
      this.drawTail(ctx, t);

      // тело с подсветкой
      ctx.save();
      ctx.shadowColor = 'rgba(255, 176, 60, 0.55)';
      ctx.shadowBlur = s * 0.9;
      this.band(ctx, -0.5, 0.5);
      ctx.fillStyle = GOLD.base;
      ctx.fill();
      ctx.restore();

      this.band(ctx, -0.06, 0.47); ctx.fillStyle = GOLD.mid; ctx.fill();
      this.band(ctx, 0.08, 0.36); ctx.fillStyle = GOLD.light; ctx.fill();
      ctx.globalAlpha = 0.75;
      this.band(ctx, 0.2, 0.27); ctx.fillStyle = GOLD.shine; ctx.fill();
      ctx.globalAlpha = 1;

      // брюхо с пластинами
      this.band(ctx, -0.49, -0.1); ctx.fillStyle = GOLD.belly; ctx.fill();
      ctx.beginPath();
      for (let i = 2; i < n - 2; i += 2) {
        const q = p[i];
        ctx.moveTo(q.x - q.nx * q.w * 0.49, q.y - q.ny * q.w * 0.49);
        ctx.lineTo(q.x - q.nx * q.w * 0.1 - q.tx * q.w * 0.06, q.y - q.ny * q.w * 0.1 - q.ty * q.w * 0.06);
      }
      ctx.strokeStyle = 'rgba(160, 105, 30, 0.6)';
      ctx.lineWidth = Math.max(1, s * 0.025);
      ctx.stroke();

      // чешуя
      ctx.beginPath();
      for (let i = 2; i < n - 3; i += 2) {
        const q = p[i];
        const r = q.w * 0.12;
        if (r < 1.2) continue;
        const head = Math.atan2(q.ty, q.tx);
        for (let row = 0; row < 4; row++) {
          const off = -0.02 + row * 0.13;
          const shift = (row % 2) * q.w * 0.09;
          const cx = q.x + q.nx * q.w * off - q.tx * shift;
          const cy = q.y + q.ny * q.w * off - q.ty * shift;
          ctx.moveTo(cx + Math.cos(head + Math.PI / 2) * r, cy + Math.sin(head + Math.PI / 2) * r);
          ctx.arc(cx, cy, r, head + Math.PI / 2, head + Math.PI * 1.5);
        }
      }
      ctx.strokeStyle = GOLD.line;
      ctx.lineWidth = Math.max(0.8, s * 0.022);
      ctx.stroke();

      // контур тела
      this.band(ctx, -0.5, 0.5);
      ctx.strokeStyle = 'rgba(100, 55, 10, 0.5)';
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.stroke();

      // ближние лапы
      this.drawLeg(ctx, Math.round(n * 0.2), t, 0, false);
      this.drawLeg(ctx, Math.round(n * 0.59), t, 1.3, false);

      this.drawHead(ctx, t);
      this.emit(t);
    }

    /* золотые световые ленты, закручивающиеся вокруг тела и за хвостом */
    drawTrail(ctx, t) {
      const all = this.pts.slice(Math.round(this.pts.length * 0.35)).concat(this.trail);
      if (all.length < 4) return;
      const b = this.pts[this.pts.length - 1];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const s = this.size;
      for (const [ph, amp] of [[0, 1.5], [Math.PI, 1.9]]) {
        const pts = [];
        for (let i = 0; i < all.length; i++) {
          const q = all[i];
          const nx = q.nx !== undefined ? q.nx : b.nx, ny = q.ny !== undefined ? q.ny : b.ny;
          const o = Math.sin(i * 0.11 - t * 2.2 + ph) * s * amp * (0.4 + (i / all.length) * 0.9);
          pts.push(q.x + nx * o, q.y + ny * o);
        }
        for (const [w, a] of [[s * 0.35, 0.05], [s * 0.12, 0.14], [s * 0.035, 0.5]]) {
          // сегментами, чтобы лента затухала к концу
          const chunks = 6;
          const per = Math.ceil(pts.length / 2 / chunks);
          for (let c = 0; c < chunks; c++) {
            ctx.beginPath();
            for (let i = c * per; i <= Math.min(pts.length / 2 - 1, (c + 1) * per); i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
            const fade = Math.sin(((c + 0.5) / chunks) * Math.PI);
            ctx.strokeStyle = `rgba(255, 200, 100, ${a * fade})`;
            ctx.lineWidth = w;
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    drawTail(ctx, t) {
      const p = this.pts, q = p[p.length - 1], s = this.size;
      const back = Math.atan2(-q.ty, -q.tx);
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) {
        const ang = back + k * 0.32 * this.side;
        flame(ctx, q.x, q.y, ang, s * (1.9 - Math.abs(k) * 0.3), s * 0.42, t * 6 + k, 0.1 * k);
      }
      ctx.fillStyle = FIRE.red;
      ctx.fill();
      ctx.beginPath();
      for (let k = -1; k <= 1; k++) {
        flame(ctx, q.x, q.y, back + k * 0.25 * this.side, s * (1.3 - Math.abs(k) * 0.2), s * 0.25, t * 6 + k + 2, 0.1 * k);
      }
      ctx.fillStyle = FIRE.orange;
      ctx.fill();
    }

    drawLeg(ctx, idx, t, phase, far) {
      const q = this.pts[clamp(idx, 0, this.pts.length - 1)];
      const s = this.size * 0.95;
      const ph = t * 4.2 + phase;
      // локальный базис: f — вперёд, d — вниз (к брюху)
      const fx = q.tx, fy = q.ty, dx = -q.nx, dy = -q.ny;
      const ax = q.x + dx * q.w * 0.18 + (far ? -fx * s * 0.12 : 0);
      const ay = q.y + dy * q.w * 0.18 + (far ? -fy * s * 0.12 : 0);
      const a1 = 0.75 + Math.sin(ph) * 0.55;
      const jx = ax + (dx * Math.cos(a1) - fx * Math.sin(a1)) * s * 0.85;
      const jy = ay + (dy * Math.cos(a1) - fy * Math.sin(a1)) * s * 0.85;
      const a2 = 0.9 + Math.sin(ph + 1.2) * 0.45;
      const kx = jx + (dx * Math.cos(a2) + fx * Math.sin(a2)) * s * 0.75;
      const ky = jy + (dy * Math.cos(a2) + fy * Math.sin(a2)) * s * 0.75;

      const col = far ? GOLD.dark : GOLD.mid;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // тень/контур
      ctx.strokeStyle = far ? '#5e3a0c' : '#9a6418';
      ctx.lineWidth = s * 0.42;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(jx, jy); ctx.lineTo(kx, ky); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = s * 0.32;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(jx, jy); ctx.lineTo(kx, ky); ctx.stroke();
      // мощное плечо
      ctx.beginPath();
      ctx.ellipse(ax + (jx - ax) * 0.25, ay + (jy - ay) * 0.25, s * 0.42, s * 0.27, Math.atan2(jy - ay, jx - ax), 0, TAU);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = far ? '#5e3a0c' : 'rgba(120,70,15,0.7)';
      ctx.lineWidth = s * 0.04;
      ctx.stroke();

      // пламя на локте
      ctx.beginPath();
      const back = Math.atan2(-fy, -fx);
      flame(ctx, jx, jy, back + 0.3 * this.side, s * 0.7, s * 0.24, ph * 1.3, 0.05);
      flame(ctx, jx, jy, back - 0.1 * this.side, s * 0.55, s * 0.18, ph * 1.3 + 1, 0.05);
      ctx.fillStyle = far ? FIRE.deep : FIRE.orange;
      ctx.fill();

      // когти
      const base = Math.atan2(ky - jy, kx - jx);
      ctx.strokeStyle = far ? '#c9b48a' : '#fff4d6';
      ctx.lineWidth = s * 0.07;
      for (let c = -1; c <= 1; c++) {
        const ang = base + c * 0.55 + 0.4 * this.side * 0;
        const ex = kx + Math.cos(ang) * s * 0.32;
        const ey = ky + Math.sin(ang) * s * 0.32;
        const cx = kx + Math.cos(ang - 0.6) * s * 0.3;
        const cy = ky + Math.sin(ang - 0.6) * s * 0.3;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.quadraticCurveTo(cx, cy, ex, ey);
        ctx.stroke();
      }
    }

    drawHead(ctx, t) {
      const q = this.pts[0];
      const s = this.size * 1.3;
      const heading = Math.atan2(q.ty, q.tx);
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(heading);
      ctx.scale(1, this.side);
      ctx.translate(-s * 0.15, 0);

      const jaw = 0.2 + Math.sin(t * 2.3) * 0.1;

      // грива — за головой
      ctx.beginPath();
      for (let k = 0; k < 11; k++) {
        const y = lerp(-0.6, 0.45, k / 10) * s;
        const ang = Math.PI + lerp(-1.05, 0.55, k / 10);
        flame(ctx, s * 0.35, y, ang, s * (2.1 + Math.sin(k * 2.1) * 0.45), s * 0.5, t * 5 + k, 0.1);
      }
      ctx.fillStyle = FIRE.deep;
      ctx.fill();
      ctx.beginPath();
      for (let k = 0; k < 9; k++) {
        const y = lerp(-0.55, 0.4, k / 8) * s;
        const ang = Math.PI + lerp(-0.9, 0.5, k / 8);
        flame(ctx, s * 0.35, y, ang, s * (1.6 + Math.sin(k * 1.3) * 0.3), s * 0.4, t * 5 + k + 1, 0.08);
      }
      ctx.fillStyle = FIRE.red;
      ctx.fill();
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const y = lerp(-0.45, 0.3, k / 6) * s;
        const ang = Math.PI + lerp(-0.7, 0.4, k / 6);
        flame(ctx, s * 0.35, y, ang, s * (1.1 + Math.sin(k * 1.7) * 0.2), s * 0.28, t * 5 + k + 2, 0.06);
      }
      ctx.fillStyle = FIRE.orange;
      ctx.fill();

      // рога (дальний и ближний)
      this.horn(ctx, s, s * 0.32, -s * 0.52, '#7a4f1c', t);
      this.horn(ctx, s, s * 0.45, -s * 0.56, '#b07a3a', t + 0.4);

      // пасть изнутри
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(s * 0.55, s * 0.1);
      ctx.lineTo(s * 1.85, s * 0.06);
      ctx.lineTo(s * 0.55 + Math.cos(jaw) * s * 1.2, s * 0.1 + Math.sin(jaw) * s * 1.2);
      ctx.closePath();
      ctx.fillStyle = '#5c0d10';
      ctx.fill();
      // язык
      ctx.beginPath();
      ctx.moveTo(s * 0.7, s * 0.2);
      ctx.quadraticCurveTo(s * 1.3, s * (0.2 + jaw * 0.6), s * 1.55, s * (0.12 + jaw * 0.9));
      ctx.strokeStyle = '#d43a4a';
      ctx.lineWidth = s * 0.09;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();

      // нижняя челюсть
      ctx.save();
      ctx.translate(s * 0.55, s * 0.12);
      ctx.rotate(jaw);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.02);
      ctx.lineTo(s * 1.05, 0);
      ctx.quadraticCurveTo(s * 1.18, s * 0.06, s * 1.08, s * 0.16);
      ctx.bezierCurveTo(s * 0.8, s * 0.3, s * 0.3, s * 0.32, -s * 0.1, s * 0.22);
      ctx.closePath();
      ctx.fillStyle = GOLD.mid;
      ctx.fill();
      ctx.strokeStyle = 'rgba(100,55,10,0.6)';
      ctx.lineWidth = s * 0.03;
      ctx.stroke();
      // нижние зубы
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const x = s * (0.35 + k * 0.15);
        ctx.moveTo(x, 0); ctx.lineTo(x + s * 0.04, -s * 0.09); ctx.lineTo(x + s * 0.08, 0);
      }
      ctx.fillStyle = '#fffaf0';
      ctx.fill();
      // борода
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        flame(ctx, s * (0.25 + k * 0.17), s * 0.24, Math.PI * 0.62 + k * 0.05, s * (0.75 - k * 0.1), s * 0.18, t * 5 + k, 0.08);
      }
      ctx.fillStyle = FIRE.orange;
      ctx.fill();
      ctx.restore();

      // верхняя часть головы
      const g = ctx.createLinearGradient(0, -s * 0.7, 0, s * 0.3);
      g.addColorStop(0, GOLD.light);
      g.addColorStop(0.55, GOLD.mid);
      g.addColorStop(1, GOLD.base);
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.42);
      ctx.bezierCurveTo(s * 0.05, -s * 0.78, s * 0.55, -s * 0.72, s * 0.78, -s * 0.46);
      ctx.bezierCurveTo(s * 1.0, -s * 0.34, s * 1.22, -s * 0.44, s * 1.48, -s * 0.36);
      ctx.bezierCurveTo(s * 1.78, -s * 0.4, s * 1.98, -s * 0.2, s * 1.92, s * 0.02);
      ctx.lineTo(s * 1.86, s * 0.08);
      ctx.bezierCurveTo(s * 1.5, s * 0.12, s * 1.0, s * 0.06, s * 0.55, s * 0.14);
      ctx.bezierCurveTo(s * 0.3, s * 0.3, s * 0.0, s * 0.46, -s * 0.3, s * 0.42);
      ctx.bezierCurveTo(-s * 0.62, s * 0.3, -s * 0.62, -s * 0.3, -s * 0.3, -s * 0.42);
      ctx.closePath();
      ctx.save();
      ctx.shadowColor = 'rgba(255,180,70,0.6)';
      ctx.shadowBlur = s * 0.6;
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(100,55,10,0.6)';
      ctx.lineWidth = s * 0.03;
      ctx.stroke();

      // щёчные «бакенбарды» поверх стыка головы и шеи
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const y = lerp(-0.3, 0.35, k / 4) * s;
        flame(ctx, s * 0.15, y, Math.PI + lerp(-0.45, 0.45, k / 4), s * (0.95 - Math.abs(k - 2) * 0.12), s * 0.26, t * 5.5 + k * 1.3, 0.07);
      }
      ctx.fillStyle = FIRE.orange;
      ctx.fill();
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const y = lerp(-0.15, 0.25, k / 2) * s;
        flame(ctx, s * 0.1, y, Math.PI + lerp(-0.3, 0.3, k / 2), s * 0.6, s * 0.16, t * 5.5 + k * 2, 0.05);
      }
      ctx.fillStyle = FIRE.yellow;
      ctx.fill();

      // верхние зубы и клыки
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const x = s * (0.7 + k * 0.17);
        const big = k === 0 || k === 5;
        ctx.moveTo(x, s * 0.1);
        ctx.lineTo(x + s * 0.04, s * (big ? 0.28 : 0.18));
        ctx.lineTo(x + s * 0.08, s * 0.09);
      }
      ctx.fillStyle = '#fffaf0';
      ctx.fill();

      // щека — спиральный завиток
      ctx.beginPath();
      ctx.arc(s * 0.38, s * 0.02, s * 0.2, 0.3, TAU * 0.85);
      ctx.arc(s * 0.42, -s * 0.0, s * 0.09, TAU * 0.85, 0.3 + TAU, false);
      ctx.strokeStyle = 'rgba(150, 90, 20, 0.7)';
      ctx.lineWidth = s * 0.04;
      ctx.stroke();

      // нос
      ctx.beginPath();
      ctx.ellipse(s * 1.72, -s * 0.16, s * 0.14, s * 0.1, -0.3, 0, TAU);
      ctx.fillStyle = GOLD.light;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * 1.76, -s * 0.14, s * 0.045, 0, TAU);
      ctx.fillStyle = '#4a2a08';
      ctx.fill();

      // надбровье
      ctx.beginPath();
      ctx.moveTo(s * 0.45, -s * 0.48);
      ctx.quadraticCurveTo(s * 0.85, -s * 0.66, s * 1.2, -s * 0.42);
      ctx.strokeStyle = GOLD.dark;
      ctx.lineWidth = s * 0.1;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.beginPath();
      flame(ctx, s * 0.55, -s * 0.55, Math.PI + 0.5, s * 0.8, s * 0.2, t * 5, 0.05);
      ctx.fillStyle = FIRE.orange;
      ctx.fill();

      // глаз
      ctx.save();
      ctx.shadowColor = 'rgba(255, 220, 120, 0.95)';
      ctx.shadowBlur = s * 0.5;
      ctx.beginPath();
      ctx.ellipse(s * 0.88, -s * 0.33, s * 0.17, s * 0.1, -0.15, 0, TAU);
      const eg = ctx.createRadialGradient(s * 0.88, -s * 0.33, 0, s * 0.88, -s * 0.33, s * 0.17);
      eg.addColorStop(0, '#fffbe0');
      eg.addColorStop(0.5, '#ffd250');
      eg.addColorStop(1, '#d26a00');
      ctx.fillStyle = eg;
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(s * 0.92, -s * 0.33, s * 0.03, s * 0.08, -0.15, 0, TAU);
      ctx.fillStyle = '#1c0d02';
      ctx.fill();

      // усы
      this.whisker(ctx, s, s * 1.6, -s * 0.05, t, 0);
      this.whisker(ctx, s, s * 1.5, s * 0.02, t, 1.7);

      ctx.restore();
    }

    horn(ctx, s, x, y, color, t) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = s * 0.14;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - s * 0.3, y - s * 0.35, x - s * 0.7, y - s * 0.45, x - s * 1.15, y - s * 0.8);
      ctx.stroke();
      ctx.lineWidth = s * 0.09;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.42, y - s * 0.38);
      ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.75, x - s * 0.3, y - s * 0.98);
      ctx.moveTo(x - s * 0.8, y - s * 0.55);
      ctx.quadraticCurveTo(x - s * 0.85, y - s * 0.85, x - s * 0.72, y - s * 1.05);
      ctx.stroke();
      ctx.restore();
    }

    whisker(ctx, s, x, y, t, ph) {
      const segs = 22;
      let px = x, py = y;
      let a = -0.15 + ph * 0.12;
      const step = s * 0.16;
      ctx.lineCap = 'round';
      ctx.strokeStyle = GOLD.light;
      for (let k = 0; k < segs; k++) {
        const u = k / segs;
        a += -0.135 + Math.sin(t * 3.2 - k * 0.45 + ph) * 0.09;
        const nx = px + Math.cos(a) * step, ny = py + Math.sin(a) * step;
        ctx.lineWidth = Math.max(0.6, s * 0.06 * (1 - u));
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        px = nx; py = ny;
      }
    }

    emit(t) {
      const p = this.pts;
      if (!p.length) return;
      for (let k = 0; k < 3; k++) {
        const q = p[(Math.random() * p.length) | 0];
        this.particles.push({
          x: q.x + rand(-1, 1) * q.w * 0.6,
          y: q.y + rand(-1, 1) * q.w * 0.6,
          vx: -q.tx * rand(10, 50) + rand(-15, 15),
          vy: -q.ty * rand(10, 50) + rand(-25, 5),
          life: 0, max: rand(0.8, 1.8),
          r: rand(0.8, 2.6),
        });
      }
      if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
    }

    drawParticles(ctx, dt) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const out = [];
      for (const pt of this.particles) {
        pt.life += dt;
        if (pt.life > pt.max) continue;
        pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        const a = 1 - pt.life / pt.max;
        ctx.fillStyle = `rgba(255, ${190 + (pt.r * 20) | 0}, 110, ${a * 0.9})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, TAU);
        ctx.fill();
        out.push(pt);
      }
      this.particles = out;
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Ночная сцена: звёзды, луна, небесные фонарики, облака + дракон.
     options:
       mode: 'intro' | 'hero'
       sky: true — рисовать градиент неба (иначе прозрачный фон)
       onFrame(t) — колбэк каждого кадра */
  class SkyScene {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opt = Object.assign({ mode: 'hero', sky: false, moon: true, clouds: true }, options);
      this.time = options.startTime || 0;
      this.running = false;
      this.last = 0;
      this.resize = this.resize.bind(this);
      this.frame = this.frame.bind(this);
      this.resize();
      global.addEventListener('resize', this.resize);
    }

    resize() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const r = this.canvas.getBoundingClientRect();
      this.W = Math.max(1, r.width);
      this.H = Math.max(1, r.height);
      this.canvas.width = Math.round(this.W * dpr);
      this.canvas.height = Math.round(this.H * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.build();
    }

    build() {
      const { W, H } = this;
      const m = Math.min(W, H);
      const intro = this.opt.mode === 'intro';
      const size = clamp(m * (intro ? 0.08 : 0.045), 20, intro ? 82 : 46);
      this.dragon = new Dragon({ size, length: intro ? 15 : 16, path: intro ? this.introPath() : this.heroPath(size) });
      this.stars = Array.from({ length: Math.round((W * H) / 5200) }, () => ({
        x: Math.random() * W, y: Math.random() * H * 0.8,
        r: Math.random() * 1.3 + 0.2, ph: Math.random() * TAU, sp: rand(0.6, 2.2),
      }));
      this.lanterns = Array.from({ length: Math.round(clamp(W / 70, 8, 26)) }, () => this.newLantern(true));
      this.clouds = Array.from({ length: 14 }, (_, i) => ({
        x: (i / 13) * W * 1.2 - W * 0.1, y: H * rand(0.86, 1.02),
        r: m * rand(0.12, 0.24), sp: rand(4, 12),
      }));
    }

    newLantern(initial) {
      const { W, H } = this;
      const depth = Math.random();
      return {
        x: Math.random() * W,
        y: initial ? Math.random() * H : H + 30,
        s: lerp(3, 11, depth * depth),
        v: lerp(6, 26, depth),
        ph: Math.random() * TAU,
        a: lerp(0.35, 1, depth),
      };
    }

    /* петля вокруг центра экрана — прелоадер */
    introPath() {
      const { W, H } = this;
      const R = Math.min(W * 0.2, H * 0.27);
      const tm = 2.0, win = 1.7;
      const v = Math.max(W * 0.42, 420);
      return (tau) => {
        const th = TAU * smoother((tau - (tm - win / 2)) / win);
        const bx = W / 2 + v * (tau - tm);
        const by = H * 0.5 + R - (tau - tm) * H * 0.12 + Math.sin(tau * 2.4) * H * 0.03;
        return { x: bx + R * Math.sin(th), y: by - R * (1 - Math.cos(th)) };
      };
    }

    /* плавное «плавание» через верх экрана — hero */
    heroPath(size) {
      const { W, H } = this;
      const L = size * 16;
      const cross = 13, pause = 5;
      this.period = cross + pause; // время сцены зацикливается в frame()
      const span = W + L * 1.3 + 200;
      return (tau) => {
        const x = -100 + (tau / cross) * span;
        const y = H * 0.17 + Math.sin(tau * 0.9) * H * 0.045 + Math.sin(tau * 0.37 + 1) * H * 0.03;
        return { x, y };
      };
    }

    drawSky(ctx) {
      const { W, H } = this;
      if (this.opt.sky) {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#04060e');
        g.addColorStop(0.55, '#0d1430');
        g.addColorStop(1, '#2a1a26');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      const t = this.time;
      if (this.opt.stars !== false) for (const s of this.stars) {
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
        ctx.fillStyle = `rgba(255, 244, 214, ${a * 0.85})`;
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      if (this.opt.moon) {
        const mx = W * 0.8, my = H * 0.2, mr = Math.min(W, H) * 0.06;
        const mg = ctx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 5);
        mg.addColorStop(0, 'rgba(255, 226, 160, 0.35)');
        mg.addColorStop(1, 'rgba(255, 226, 160, 0)');
        ctx.fillStyle = mg;
        ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
        ctx.beginPath();
        ctx.arc(mx, my, mr, 0, TAU);
        ctx.fillStyle = '#ffeec4';
        ctx.fill();
      }
    }

    drawLanterns(ctx, dt) {
      const { H } = this;
      for (let i = 0; i < this.lanterns.length; i++) {
        const l = this.lanterns[i];
        l.y -= l.v * dt;
        l.x += Math.sin(this.time * 0.6 + l.ph) * 6 * dt;
        if (l.y < -30) { this.lanterns[i] = this.newLantern(false); continue; }
        const fade = clamp(l.y / (H * 0.25), 0, 1) * l.a;
        const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.s * 3.2);
        g.addColorStop(0, `rgba(255, 150, 60, ${0.45 * fade})`);
        g.addColorStop(1, 'rgba(255, 120, 40, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(l.x - l.s * 3.2, l.y - l.s * 3.2, l.s * 6.4, l.s * 6.4);
        ctx.fillStyle = `rgba(255, ${120 + (l.s * 6) | 0}, 70, ${fade})`;
        const w = l.s, h = l.s * 1.3;
        ctx.beginPath();
        ctx.moveTo(l.x - w * 0.5, l.y - h * 0.5);
        ctx.lineTo(l.x + w * 0.5, l.y - h * 0.5);
        ctx.lineTo(l.x + w * 0.38, l.y + h * 0.5);
        ctx.lineTo(l.x - w * 0.38, l.y + h * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawClouds(ctx, dt) {
      if (!this.opt.clouds) return;
      const { W } = this;
      for (const c of this.clouds) {
        c.x += c.sp * dt;
        if (c.x - c.r > W * 1.1) c.x = -c.r * 1.5;
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
        g.addColorStop(0, 'rgba(120, 100, 130, 0.32)');
        g.addColorStop(0.6, 'rgba(70, 60, 95, 0.16)');
        g.addColorStop(1, 'rgba(40, 40, 70, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
      }
    }

    render(dt) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawSky(ctx);
      this.drawLanterns(ctx, dt);
      this.dragon.draw(ctx, this.time);
      this.dragon.drawParticles(ctx, dt);
      this.drawClouds(ctx, dt);
    }

    frame(now) {
      if (!this.running) return;
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
      this.last = now;
      this.time += dt * (this.opt.speed || 1);
      if (this.period && this.time > this.period) this.time -= this.period;
      this.render(dt);
      if (this.opt.onFrame) this.opt.onFrame(this.time);
      requestAnimationFrame(this.frame);
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.last = 0;
      requestAnimationFrame(this.frame);
    }

    stop() { this.running = false; }

    destroy() {
      this.stop();
      global.removeEventListener('resize', this.resize);
    }

    /* для отладки: отрисовать кадр в момент t */
    renderAt(t) {
      this.time = t;
      this.dragon.sample(t);
      for (let k = 0; k < 30; k++) this.dragon.emit(t);
      this.render(1 / 60);
    }
  }

  global.SkyScene = SkyScene;
  global.Dragon = Dragon;
})(window);
