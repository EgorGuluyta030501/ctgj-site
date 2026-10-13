/* CTGJ — сервер сайта и админ-панели заявок.
   База данных — PostgreSQL (см. db.js). Требуется Node.js 22.13+.

   Запуск:            npm install, затем node server.js
   Сменить пароль:    node server.js set-password <логин> <новый_пароль>

   Переменные окружения:
     DATABASE_URL      — адрес PostgreSQL (на хостинге обязательно; без него
                         для разработки поднимается локальная база в data/pg)
     PORT              — порт (по умолчанию 3000)
     ADMIN_LOGIN       — логин первого администратора (по умолчанию admin)
     ADMIN_PASSWORD    — пароль первого администратора (иначе сгенерируется и выведется в консоль)
     TG_BOT_TOKEN, TG_CHAT_ID — уведомления о новых заявках в Telegram
*/
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');
const { buildPartners } = require('./scripts/partners');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 дней

const STATUSES = ['new', 'assigned', 'work', 'done', 'rejected'];
const SERVICES = ['supply', 'warehouse', 'procurement', 'logistics', 'other'];

/* ================= Пароли и сессии ================= */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// первый администратор
async function ensureAdmin() {
  const { n } = await db.one('SELECT count(*)::int AS n FROM users');
  if (n) return;
  const login = process.env.ADMIN_LOGIN || 'admin';
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  await db.run("INSERT INTO users (name, login, pass, role) VALUES ($1, $2, $3, 'admin')", ['Администратор', login, hashPassword(pw)]);
  console.log('\n  Создан администратор админ-панели:');
  console.log(`    логин:  ${login}`);
  console.log(`    пароль: ${pw}`);
  console.log('  Сохраните пароль. Сменить: node server.js set-password <логин> <пароль>\n');
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, userId, new Date(Date.now() + SESSION_TTL)]);
  return token;
}
async function getUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  return db.one(`
    SELECT u.id, u.name, u.login, u.role FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > now() AND u.active`, [token]);
}

/* ================= Утилиты HTTP ================= */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isHttps(req) {
  return req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}
function clientIp(req) {
  const remote = String(req.socket.remoteAddress || '');
  // X-Forwarded-For доверяем только от локального прокси (nginx на этом же сервере),
  // иначе клиент мог бы подделать IP и обойти лимит
  const fromProxy = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const fwd = fromProxy && req.headers['x-forwarded-for'];
  return String(fwd || remote).split(',')[0].trim();
}
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}
function readJson(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] || '').includes('application/json')) return reject(Object.assign(new Error('JSON expected'), { status: 415 }));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// простой лимит по IP: overLimit() только проверяет, hit() засчитывает событие
const buckets = new Map();
function overLimit(key, max, windowMs) {
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  buckets.set(key, recent);
  return recent.length >= max;
}
function hit(key) {
  const b = buckets.get(key) || [];
  b.push(Date.now());
  buckets.set(key, b);
}
const REQ_LIMIT = 10; // успешных заявок с одного IP за 10 минут
const LOGIN_LIMIT = 10; // неудачных входов с одного IP за 10 минут
const TEN_MIN = 10 * 60 * 1000;
setInterval(() => buckets.clear(), 3600 * 1000).unref();

/* ================= Telegram ================= */
const SERVICE_NAMES = {
  supply: 'Комплексное обеспечение', warehouse: 'Складская инфраструктура',
  procurement: 'Аутсорсинг закупок', logistics: 'Международная логистика', other: 'Другое',
};
function notifyTelegram(r) {
  const { TG_BOT_TOKEN, TG_CHAT_ID } = process.env;
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  const text = [
    `🐉 Новая заявка #${r.id}`,
    `Имя: ${r.name}`,
    r.company && `Компания: ${r.company}`,
    r.phone && `Телефон: ${r.phone}`,
    r.email && `Email: ${r.email}`,
    `Услуга: ${SERVICE_NAMES[r.service] || r.service}`,
    r.message && `Сообщение: ${r.message}`,
  ].filter(Boolean).join('\n');
  fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text }),
  }).catch((e) => console.error('Telegram:', e.message));
}

/* ================= API ================= */
function logEvent(q, requestId, userId, kind, text = '') {
  return q.run('INSERT INTO events (request_id, user_id, kind, text) VALUES ($1, $2, $3, $4)', [requestId, userId, kind, text]);
}
function canSee(user, r) {
  return user.role === 'admin' || r.manager_id === user.id;
}

const routes = [];
const route = (method, pattern, handler, auth) => routes.push({ method, pattern, handler, auth });

// --- публичная форма заявки ---
route('POST', /^\/api\/requests$/, async (req, res) => {
  const ip = clientIp(req);
  const reject = (status, code, error) => {
    console.log(`[заявка] отклонена (${code}) ip=${ip}`);
    send(res, status, { error, code });
  };
  // считаются только успешно сохранённые заявки, ошибки заполнения лимит не тратят
  if (overLimit('req:' + ip, REQ_LIMIT, TEN_MIN)) return reject(429, 'rate', 'Слишком много заявок, попробуйте через 10 минут');
  const b = await readJson(req);
  // ловушка для ботов: поле скрыто от людей и имеет имя, которое браузер не станет автозаполнять
  if (b.ctgj_trap) {
    console.log(`[заявка] отброшена как спам (заполнено скрытое поле) ip=${ip}`);
    return send(res, 200, { ok: true });
  }
  const r = {
    name: str(b.name, 120),
    phone: str(b.phone, 60),
    email: str(b.email, 120),
    company: str(b.company, 160),
    service: SERVICES.includes(b.service) ? b.service : 'other',
    message: str(b.message, 4000),
    lang: ['ru', 'en', 'zh'].includes(b.lang) ? b.lang : '',
    source: str(b.source, 30),
  };
  if (!r.name || (!r.phone && !r.email)) return reject(400, 'required', 'Укажите имя и телефон или email');
  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return reject(400, 'email', 'Некорректный email');
  // заявка и запись в историю — одной транзакцией
  r.id = await db.tx(async (t) => {
    const row = await t.one(`INSERT INTO requests (name, phone, email, company, service, message, lang, source, ip)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [r.name, r.phone, r.email, r.company, r.service, r.message, r.lang, r.source, ip]);
    await logEvent(t, row.id, null, 'created', 'Заявка с сайта');
    return row.id;
  });
  hit('req:' + ip);
  console.log(`[заявка] #${r.id} сохранена: ${r.name} (${r.source || 'сайт'}) ip=${ip}`);
  notifyTelegram(r);
  send(res, 201, { ok: true, id: r.id });
});

// --- вход / выход ---
route('POST', /^\/api\/login$/, async (req, res) => {
  const ip = clientIp(req);
  if (overLimit('login:' + ip, LOGIN_LIMIT, TEN_MIN)) return send(res, 429, { error: 'Слишком много попыток, подождите 10 минут' });
  const b = await readJson(req);
  const u = await db.one('SELECT * FROM users WHERE lower(login) = lower($1)', [str(b.login, 60)]);
  if (!u || !u.active || !checkPassword(String(b.password || ''), u.pass)) {
    hit('login:' + ip);
    return send(res, 401, { error: 'Неверный логин или пароль' });
  }
  const token = await createSession(u.id);
  const cookie = `sid=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${isHttps(req) ? '; Secure' : ''}`;
  send(res, 200, { id: u.id, name: u.name, login: u.login, role: u.role }, { 'Set-Cookie': cookie });
});

route('POST', /^\/api\/logout$/, async (req, res) => {
  const token = parseCookies(req).sid;
  if (token) await db.run('DELETE FROM sessions WHERE token = $1', [token]);
  send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0' });
});

route('GET', /^\/api\/me$/, async (req, res, user) => send(res, 200, user), 'any');

// --- заявки ---
route('GET', /^\/api\/admin\/requests$/, async (req, res, user, m, url) => {
  const where = [];
  const args = [];
  const arg = (v) => { args.push(v); return '$' + args.length; };
  if (user.role !== 'admin') where.push('r.manager_id = ' + arg(user.id));
  const status = url.searchParams.get('status');
  if (STATUSES.includes(status)) where.push('r.status = ' + arg(status));
  const manager = url.searchParams.get('manager');
  if (manager === 'none') where.push('r.manager_id IS NULL');
  else if (manager && /^\d+$/.test(manager)) where.push('r.manager_id = ' + arg(Number(manager)));
  const q = str(url.searchParams.get('q'), 100);
  if (q) {
    // символы % и _ в поиске — буквально, а не как шаблон
    const like = arg('%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
    const idq = arg(q.replace('#', ''));
    where.push(`(r.name ILIKE ${like} OR r.phone ILIKE ${like} OR r.email ILIKE ${like} OR r.company ILIKE ${like} OR r.message ILIKE ${like} OR r.id::text = ${idq})`);
  }
  const rows = await db.all(`
    SELECT r.*, u.name AS manager_name,
      (SELECT count(*)::int FROM events e WHERE e.request_id = r.id AND e.kind = 'note') AS notes
    FROM requests r LEFT JOIN users u ON u.id = r.manager_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (r.status = 'new') DESC, r.created_at DESC, r.id DESC
    LIMIT 500`, args);
  send(res, 200, rows);
}, 'any');

route('GET', /^\/api\/admin\/requests\/(\d+)$/, async (req, res, user, m) => {
  const r = await db.one('SELECT r.*, u.name AS manager_name FROM requests r LEFT JOIN users u ON u.id = r.manager_id WHERE r.id = $1', [Number(m[1])]);
  if (!r || !canSee(user, r)) return send(res, 404, { error: 'Не найдено' });
  r.events = await db.all(`SELECT e.*, u.name AS user_name FROM events e LEFT JOIN users u ON u.id = e.user_id
    WHERE e.request_id = $1 ORDER BY e.created_at, e.id`, [r.id]);
  send(res, 200, r);
}, 'any');

route('PATCH', /^\/api\/admin\/requests\/(\d+)$/, async (req, res, user, m) => {
  const id = Number(m[1]);
  const b = await readJson(req);
  if ('manager_id' in b && user.role !== 'admin') return send(res, 403, { error: 'Распределять заявки может только администратор' });
  if ('status' in b && !STATUSES.includes(b.status)) return send(res, 400, { error: 'Неизвестный статус' });

  // изменение и запись в историю — одной транзакцией; строка заявки блокируется на время правки,
  // чтобы два человека одновременно не перезаписали друг друга
  const error = await db.tx(async (t) => {
    const r = await t.one('SELECT * FROM requests WHERE id = $1 FOR UPDATE', [id]);
    if (!r || !canSee(user, r)) return [404, 'Не найдено'];

    if ('manager_id' in b) {
      const mid = b.manager_id === null || b.manager_id === '' ? null : Number(b.manager_id);
      let mgr = null;
      if (mid !== null) {
        mgr = await t.one('SELECT id, name FROM users WHERE id = $1 AND active', [mid]);
        if (!mgr) return [400, 'Менеджер не найден'];
      }
      if (mid !== r.manager_id) {
        const nextStatus = mid !== null && r.status === 'new' ? 'assigned' : (mid === null && r.status === 'assigned' ? 'new' : r.status);
        await t.run('UPDATE requests SET manager_id = $1, status = $2, updated_at = now() WHERE id = $3', [mid, nextStatus, id]);
        await logEvent(t, id, user.id, 'assign', mgr ? `Назначен менеджер: ${mgr.name}` : 'Менеджер снят');
        r.status = nextStatus;
      }
    }
    if ('status' in b && b.status !== r.status) {
      await t.run('UPDATE requests SET status = $1, updated_at = now() WHERE id = $2', [b.status, id]);
      await logEvent(t, id, user.id, 'status', b.status);
    }
    return null;
  });
  if (error) return send(res, error[0], { error: error[1] });
  send(res, 200, { ok: true });
}, 'any');

route('POST', /^\/api\/admin\/requests\/(\d+)\/notes$/, async (req, res, user, m) => {
  const id = Number(m[1]);
  const r = await db.one('SELECT id, manager_id FROM requests WHERE id = $1', [id]);
  if (!r || !canSee(user, r)) return send(res, 404, { error: 'Не найдено' });
  const b = await readJson(req);
  const text = str(b.text, 3000);
  if (!text) return send(res, 400, { error: 'Пустая заметка' });
  await db.tx(async (t) => {
    await logEvent(t, id, user.id, 'note', text);
    await t.run('UPDATE requests SET updated_at = now() WHERE id = $1', [id]);
  });
  send(res, 201, { ok: true });
}, 'any');

route('DELETE', /^\/api\/admin\/requests\/(\d+)$/, async (req, res, user, m) => {
  await db.run('DELETE FROM requests WHERE id = $1', [Number(m[1])]);
  send(res, 200, { ok: true });
}, 'admin');

route('GET', /^\/api\/admin\/stats$/, async (req, res, user) => {
  const isAdmin = user.role === 'admin';
  const rows = await db.all(
    `SELECT status, count(*)::int AS n FROM requests ${isAdmin ? '' : 'WHERE manager_id = $1'} GROUP BY status`,
    isAdmin ? [] : [user.id]);
  const out = { total: 0 };
  STATUSES.forEach((s) => { out[s] = 0; });
  rows.forEach((r) => { out[r.status] = r.n; out.total += r.n; });
  out.unassigned = isAdmin ? (await db.one('SELECT count(*)::int AS n FROM requests WHERE manager_id IS NULL')).n : 0;
  send(res, 200, out);
}, 'any');

route('GET', /^\/api\/admin\/export\.csv$/, async (req, res) => {
  const rows = await db.all(`SELECT r.id, to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS created_at,
      r.name, r.company, r.phone, r.email, r.service, r.message, r.status, u.name AS manager
    FROM requests r LEFT JOIN users u ON u.id = r.manager_id ORDER BY r.id DESC`);
  const head = ['ID', 'Дата (UTC)', 'Имя', 'Компания', 'Телефон', 'Email', 'Услуга', 'Сообщение', 'Статус', 'Менеджер'];
  const esc = (v) => {
    let s = String(v == null ? '' : v);
    // защита от формул в Excel (телефоны вида «+86 138…» не трогаем)
    if (/^[=@\t\r]/.test(s) || (/^[+\-]/.test(s) && !/^[+\-][\d\s()\-]*$/.test(s))) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = '﻿' + [head, ...rows.map((r) => [r.id, r.created_at, r.name, r.company, r.phone, r.email, SERVICE_NAMES[r.service] || r.service, r.message, r.status, r.manager])]
    .map((line) => line.map(esc).join(';')).join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="ctgj-requests.csv"',
    'Cache-Control': 'no-store',
  });
  res.end(csv);
}, 'admin');

// --- пользователи (менеджеры) ---
route('GET', /^\/api\/admin\/users$/, async (req, res, user) => {
  const rows = await db.all(`SELECT u.id, u.name, u.login, u.role, u.contact, u.active, u.created_at,
      (SELECT count(*)::int FROM requests r WHERE r.manager_id = u.id AND r.status IN ('assigned', 'work')) AS open_count,
      (SELECT count(*)::int FROM requests r WHERE r.manager_id = u.id) AS total_count
    FROM users u ORDER BY u.active DESC, u.role, u.name`);
  send(res, 200, user.role === 'admin' ? rows : rows.map(({ id, name, role, active }) => ({ id, name, role, active })));
}, 'any');

route('POST', /^\/api\/admin\/users$/, async (req, res) => {
  const b = await readJson(req);
  const name = str(b.name, 80), login = str(b.login, 40), pw = String(b.password || '');
  const role = b.role === 'admin' ? 'admin' : 'manager';
  if (!name || !/^[a-zA-Z0-9._-]{3,40}$/.test(login)) return send(res, 400, { error: 'Укажите имя и логин (латиница, цифры, . _ -, от 3 символов)' });
  if (pw.length < 8) return send(res, 400, { error: 'Пароль — минимум 8 символов' });
  try {
    const row = await db.one('INSERT INTO users (name, login, pass, role, contact) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, login, hashPassword(pw), role, str(b.contact, 120)]);
    send(res, 201, { id: row.id });
  } catch (e) {
    if (e.code === '23505') return send(res, 409, { error: 'Такой логин уже есть' }); // нарушение уникальности
    throw e;
  }
}, 'admin');

route('PATCH', /^\/api\/admin\/users\/(\d+)$/, async (req, res, user, m) => {
  const id = Number(m[1]);
  const b = await readJson(req);
  if (id === user.id && (b.active === false || b.role === 'manager')) return send(res, 400, { error: 'Нельзя отключить или понизить самого себя' });
  if (b.password && String(b.password).length < 8) return send(res, 400, { error: 'Пароль — минимум 8 символов' });
  const found = await db.tx(async (t) => {
    const u = await t.one('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!u) return false;
    if ('name' in b && str(b.name, 80)) await t.run('UPDATE users SET name = $1 WHERE id = $2', [str(b.name, 80), id]);
    if ('contact' in b) await t.run('UPDATE users SET contact = $1 WHERE id = $2', [str(b.contact, 120), id]);
    if ('role' in b && ['admin', 'manager'].includes(b.role)) await t.run('UPDATE users SET role = $1 WHERE id = $2', [b.role, id]);
    if ('active' in b) {
      await t.run('UPDATE users SET active = $1 WHERE id = $2', [!!b.active, id]);
      if (!b.active) await t.run('DELETE FROM sessions WHERE user_id = $1', [id]);
    }
    if (b.password) {
      await t.run('UPDATE users SET pass = $1 WHERE id = $2', [hashPassword(String(b.password)), id]);
      if (id !== user.id) await t.run('DELETE FROM sessions WHERE user_id = $1', [id]);
    }
    return true;
  });
  if (!found) return send(res, 404, { error: 'Не найдено' });
  send(res, 200, { ok: true });
}, 'admin');

route('POST', /^\/api\/admin\/password$/, async (req, res, user) => {
  const b = await readJson(req);
  const u = await db.one('SELECT pass FROM users WHERE id = $1', [user.id]);
  if (!checkPassword(String(b.old || ''), u.pass)) return send(res, 400, { error: 'Текущий пароль неверен' });
  if (String(b.password || '').length < 8) return send(res, 400, { error: 'Новый пароль — минимум 8 символов' });
  await db.run('UPDATE users SET pass = $1 WHERE id = $2', [hashPassword(String(b.password)), user.id]);
  send(res, 200, { ok: true });
}, 'any');

/* ================= Статика ================= */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
  // список логотипов партнёров собирается из папки на лету — новые файлы видны сразу
  if (rel === '/партнеры/partners.json') return send(res, 200, buildPartners());
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    // HTML, CSS и JS браузер перепроверяет при каждом открытии (после правок сразу видна новая версия);
    // картинки и видео кешируются на час
    const revalidate = ext === '.html' || ext === '.css' || ext === '.js';
    const lastModified = st.mtime.toUTCString();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
      'Last-Modified': lastModified,
      'Cache-Control': revalidate ? 'no-cache' : 'public, max-age=3600',
    };
    // файл не менялся с прошлого раза — отвечаем 304 без тела
    const since = Date.parse(req.headers['if-modified-since'] || '');
    if (since && Math.floor(st.mtimeMs / 1000) * 1000 <= since && !req.headers.range) {
      res.writeHead(304, { 'Last-Modified': lastModified, 'Cache-Control': headers['Cache-Control'] });
      return res.end();
    }
    if (rel.startsWith('/admin/')) { headers['X-Frame-Options'] = 'DENY'; headers['X-Robots-Tag'] = 'noindex'; }

    // отдача файла частями (Range) — без неё Safari не воспроизводит видео
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }

    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ================= Сервер ================= */
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.pattern);
        if (!m) continue;
        let user = null;
        if (r.auth) {
          user = await getUser(req);
          if (!user) return send(res, 401, { error: 'Требуется вход' });
          if (r.auth === 'admin' && user.role !== 'admin') return send(res, 403, { error: 'Только для администратора' });
        }
        return await r.handler(req, res, user, m, url);
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Ошибка сервера' });
    if (!e.status) console.error(e);
  }
});

/* ================= Запуск ================= */
async function main() {
  await db.connect();
  await db.migrate();
  await db.importSqliteIfNeeded();

  // CLI: смена пароля
  if (process.argv[2] === 'set-password') {
    const [, , , login, pw] = process.argv;
    if (!login || !pw || pw.length < 8) {
      console.error('Использование: node server.js set-password <логин> <пароль от 8 символов>');
    } else {
      const n = await db.run('UPDATE users SET pass = $1 WHERE lower(login) = lower($2)', [hashPassword(pw), login]);
      console.log(n ? `Пароль для «${login}» обновлён.` : `Пользователь «${login}» не найден.`);
    }
    await db.close();
    process.exit(0);
  }

  await ensureAdmin();
  setInterval(() => db.run('DELETE FROM sessions WHERE expires_at < now()').catch(() => {}), 3600 * 1000).unref();

  server.listen(PORT, () => {
    console.log(`CTGJ: сайт — http://localhost:${PORT}  |  админ-панель — http://localhost:${PORT}/admin/`);
  });
}

// аккуратное завершение: закрыть соединения и локальную базу
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(async (e) => {
  console.error('Не удалось запустить сервер:', e.message || e);
  await db.close();
  process.exit(1);
});
