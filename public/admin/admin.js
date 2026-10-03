/* CTGJ — админ-панель заявок */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const STATUS = {
    new: 'Новая',
    assigned: 'Назначена',
    work: 'В работе',
    done: 'Завершена',
    rejected: 'Отказ',
  };
  const SERVICE = {
    supply: 'Комплексное обеспечение',
    warehouse: 'Складская инфраструктура',
    procurement: 'Аутсорсинг закупок',
    logistics: 'Международная логистика',
    other: 'Другое',
  };
  const LANG = { ru: 'Русский', en: 'English', zh: '中文' };
  const SOURCE = { envelope: 'Конверт (боковая кнопка)', contacts: 'Форма в контактах' };

  let me = null;
  let users = [];
  let filter = { status: '', manager: '', q: '' };
  let currentId = null;
  let lastNew = null;
  const baseTitle = document.title;

  /* ---------- helpers ---------- */
  // безопасное создание элементов: текст всегда через textContent
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error(data.error || 'Требуется вход'); }
    if (!res.ok) throw new Error(data.error || 'Ошибка ' + res.status);
    return data;
  }

  // даты из SQLite приходят в UTC: «2026-10-01 12:00:00»
  function fmtDate(s, withTime = true) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T') + 'Z');
    return d.toLocaleString('ru-RU', withTime
      ? { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  const badge = (s) => h('span', { class: 'badge s-' + s }, STATUS[s] || s);
  const isAdmin = () => me && me.role === 'admin';
  const activeManagers = () => users.filter((u) => u.active);

  function managerSelect(value, onChange) {
    const sel = h('select', { onchange: (e) => onChange(e.target.value), onclick: (e) => e.stopPropagation() },
      h('option', { value: '' }, '— не назначен —'),
      activeManagers().map((u) => h('option', { value: u.id }, u.name + (u.role === 'admin' ? ' (админ)' : ''))));
    sel.value = value == null ? '' : String(value);
    return sel;
  }

  /* ---------- вход ---------- */
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#drawer').hidden = true;
    me = null;
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#login-err').textContent = '';
    try {
      me = await api('POST', '/api/login', { login: f.login.value, password: f.password.value });
      f.reset();
      start();
    } catch (err) {
      $('#login-err').textContent = err.message;
    }
  });

  $('#logout').addEventListener('click', async () => {
    await api('POST', '/api/logout').catch(() => {});
    showLogin();
  });

  /* ---------- запуск ---------- */
  async function start() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#me-name').textContent = me.name;
    $('#me-role').textContent = isAdmin() ? 'Администратор' : 'Менеджер';
    $$('[data-admin]').forEach((el) => { el.hidden = !isAdmin(); });
    buildChips();
    await loadUsers();
    await refresh();
  }

  async function boot() {
    try {
      me = await api('GET', '/api/me');
      start();
    } catch (e) {
      showLogin();
    }
  }

  /* ---------- навигация ---------- */
  $$('.side__link').forEach((b) => b.addEventListener('click', () => {
    $$('.side__link').forEach((x) => x.classList.toggle('is-active', x === b));
    $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + b.dataset.view; });
    if (b.dataset.view === 'users') renderUsers();
  }));

  /* ---------- фильтры ---------- */
  function buildChips() {
    const box = $('#status-chips');
    box.innerHTML = '';
    [['', 'Все'], ...Object.entries(STATUS)].forEach(([k, label]) => {
      box.appendChild(h('button', {
        class: 'chip' + (filter.status === k ? ' is-active' : ''),
        type: 'button',
        onclick: () => { filter.status = k; buildChips(); loadRequests(); },
      }, label));
    });
  }

  $('#f-manager').addEventListener('change', (e) => { filter.manager = e.target.value; loadRequests(); });
  let qTimer;
  $('#f-q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { filter.q = e.target.value.trim(); loadRequests(); }, 300);
  });
  $('#refresh').addEventListener('click', () => refresh().then(() => toast('Обновлено')));

  /* ---------- данные ---------- */
  async function loadUsers() {
    users = await api('GET', '/api/admin/users');
    const sel = $('#f-manager');
    $$('option[data-u]', sel).forEach((o) => o.remove());
    users.forEach((u) => sel.appendChild(h('option', { value: u.id, 'data-u': '1' }, u.name)));
    sel.value = filter.manager;
  }

  async function refresh() {
    await Promise.all([loadStats(), loadRequests()]);
  }

  async function loadStats() {
    const s = await api('GET', '/api/admin/stats');
    const box = $('#stats');
    box.innerHTML = '';
    const items = [['new', 'Новые'], ['assigned', 'Назначены'], ['work', 'В работе'], ['done', 'Завершены'], ['rejected', 'Отказ']];
    items.forEach(([k, label]) => {
      box.appendChild(h('button', {
        class: 'stat s-' + k + (filter.status === k ? ' is-active' : ''),
        type: 'button',
        onclick: () => { filter.status = filter.status === k ? '' : k; buildChips(); refresh(); },
      }, h('b', null, s[k] || 0), h('span', null, label)));
    });
    if (isAdmin()) {
      box.appendChild(h('button', {
        class: 'stat s-unassigned' + (filter.manager === 'none' ? ' is-active' : ''),
        type: 'button',
        onclick: () => { filter.manager = filter.manager === 'none' ? '' : 'none'; $('#f-manager').value = filter.manager; refresh(); },
      }, h('b', null, s.unassigned || 0), h('span', null, 'Без менеджера')));
    } else {
      box.appendChild(h('div', { class: 'stat s-total' }, h('b', null, s.total || 0), h('span', null, 'Всего моих')));
    }

    // уведомление о новых заявках
    const n = s.new || 0;
    const badgeEl = $('#badge-new');
    badgeEl.hidden = !n;
    badgeEl.textContent = n;
    document.title = n ? `(${n}) ${baseTitle}` : baseTitle;
    if (lastNew !== null && n > lastNew) toast('Новая заявка!');
    lastNew = n;
  }

  async function loadRequests() {
    const p = new URLSearchParams();
    if (filter.status) p.set('status', filter.status);
    if (filter.manager) p.set('manager', filter.manager);
    if (filter.q) p.set('q', filter.q);
    const rows = await api('GET', '/api/admin/requests?' + p);
    const tbody = $('#rows');
    tbody.innerHTML = '';
    $('#empty').hidden = rows.length > 0;
    rows.forEach((r) => {
      const mgrCell = isAdmin()
        ? managerSelect(r.manager_id, (v) => assign(r.id, v))
        : (r.manager_name || '—');
      tbody.appendChild(h('tr', { class: r.status === 'new' ? 'is-new' : '', onclick: () => openRequest(r.id) },
        h('td', null, h('b', null, '#' + r.id)),
        h('td', { class: 'date' }, fmtDate(r.created_at)),
        h('td', { class: 'client' }, h('b', null, r.name), r.company ? h('span', null, r.company) : null),
        h('td', { class: 'contacts' }, r.phone ? h('span', null, r.phone) : null, r.email ? h('span', null, r.email) : null),
        h('td', null, SERVICE[r.service] || r.service),
        h('td', null, badge(r.status), r.notes ? h('span', { class: 'muted', title: 'Заметки' }, '  ✎' + r.notes) : null),
        h('td', null, mgrCell)));
    });
  }

  async function assign(id, managerId) {
    try {
      await api('PATCH', '/api/admin/requests/' + id, { manager_id: managerId === '' ? null : Number(managerId) });
      const u = users.find((x) => String(x.id) === String(managerId));
      toast(u ? `Заявка #${id} → ${u.name}` : `С заявки #${id} снят менеджер`);
      await refresh();
      if (currentId === id) openRequest(id);
    } catch (e) { toast(e.message); }
  }

  /* ---------- карточка заявки ---------- */
  async function openRequest(id) {
    let r;
    try { r = await api('GET', '/api/admin/requests/' + id); } catch (e) { toast(e.message); return; }
    currentId = id;
    $('#d-id').textContent = 'Заявка #' + r.id;
    $('#d-title').textContent = r.name;
    $('#d-date').textContent = fmtDate(r.created_at);

    const st = $('#d-status');
    st.innerHTML = '';
    Object.entries(STATUS).forEach(([k, v]) => st.appendChild(h('option', { value: k }, v)));
    st.value = r.status;
    st.onchange = async () => {
      try {
        await api('PATCH', '/api/admin/requests/' + id, { status: st.value });
        toast('Статус: ' + STATUS[st.value]);
        await refresh();
        openRequest(id);
      } catch (e) { toast(e.message); }
    };

    if (isAdmin()) {
      const old = $('#d-manager');
      const sel = managerSelect(r.manager_id, (v) => assign(id, v));
      sel.id = 'd-manager';
      old.replaceWith(sel);
    }

    const info = $('#d-info');
    info.innerHTML = '';
    const row = (k, v) => { if (v) info.append(h('dt', null, k), h('dd', null, v)); };
    row('Компания', r.company);
    if (r.phone) info.append(h('dt', null, 'Телефон'), h('dd', null, h('a', { href: 'tel:' + r.phone.replace(/[^\d+]/g, '') }, r.phone)));
    if (r.email) info.append(h('dt', null, 'Email'), h('dd', null, h('a', { href: 'mailto:' + r.email }, r.email)));
    row('Услуга', SERVICE[r.service] || r.service);
    row('Язык сайта', LANG[r.lang] || r.lang);
    row('Откуда', SOURCE[r.source] || r.source);
    row('Менеджер', r.manager_name || (isAdmin() ? null : '—'));
    $('#d-message').textContent = r.message || '';

    const ev = $('#d-events');
    ev.innerHTML = '';
    r.events.forEach((e) => {
      let text;
      if (e.kind === 'status') text = 'Статус → ' + (STATUS[e.text] || e.text);
      else if (e.kind === 'note') text = null;
      else text = e.text;
      ev.appendChild(h('li', { class: e.kind },
        h('small', null, fmtDate(e.created_at) + (e.user_name ? ' · ' + e.user_name : '')),
        text ? h('div', null, text) : null,
        e.kind === 'note' ? h('div', { class: 'ev-note' }, e.text) : null));
    });

    $('#drawer').hidden = false;
  }

  function closeDrawer() {
    $('#drawer').hidden = true;
    currentId = null;
  }
  $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });

  $('#note-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text || !currentId) return;
    try {
      await api('POST', `/api/admin/requests/${currentId}/notes`, { text });
      e.target.reset();
      openRequest(currentId);
      loadRequests();
    } catch (err) { toast(err.message); }
  });

  $('#d-delete').addEventListener('click', async () => {
    if (!currentId || !confirm(`Удалить заявку #${currentId} безвозвратно?`)) return;
    try {
      await api('DELETE', '/api/admin/requests/' + currentId);
      closeDrawer();
      toast('Заявка удалена');
      refresh();
    } catch (e) { toast(e.message); }
  });

  /* ---------- менеджеры ---------- */
  async function renderUsers() {
    if (!isAdmin()) return;
    await loadUsers();
    const tb = $('#users-rows');
    tb.innerHTML = '';
    users.forEach((u) => {
      const self = u.id === me.id;
      tb.appendChild(h('tr', { class: u.active ? '' : 'user-off' },
        h('td', null, h('b', null, u.name), u.contact ? h('div', { class: 'muted' }, u.contact) : null),
        h('td', null, u.login),
        h('td', null, h('span', { class: 'role' + (u.role === 'admin' ? ' role--admin' : '') }, u.role === 'admin' ? 'Админ' : 'Менеджер')),
        h('td', null, u.open_count),
        h('td', null, u.total_count),
        h('td', null, h('div', { class: 'row-actions' },
          h('button', { class: 'link', type: 'button', onclick: () => resetPassword(u) }, 'Сменить пароль'),
          self ? null : h('button', { class: 'link', type: 'button', onclick: () => toggleUser(u) }, u.active ? 'Отключить' : 'Включить')))));
    });
  }

  async function resetPassword(u) {
    const pw = prompt(`Новый пароль для «${u.name}» (минимум 8 символов):`);
    if (!pw) return;
    try {
      await api('PATCH', '/api/admin/users/' + u.id, { password: pw });
      toast('Пароль изменён');
    } catch (e) { toast(e.message); }
  }

  async function toggleUser(u) {
    if (u.active && !confirm(`Отключить «${u.name}»? Он не сможет войти. Заявки останутся за ним — переназначьте их.`)) return;
    try {
      await api('PATCH', '/api/admin/users/' + u.id, { active: !u.active });
      renderUsers();
    } catch (e) { toast(e.message); }
  }

  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#user-err').textContent = '';
    try {
      await api('POST', '/api/admin/users', {
        name: f.name.value, login: f.login.value, password: f.password.value, contact: f.contact.value, role: f.role.value,
      });
      toast(`Добавлен: ${f.name.value}. Передайте ему логин и пароль.`);
      f.reset();
      renderUsers();
    } catch (err) {
      $('#user-err').textContent = err.message;
    }
  });

  /* ---------- профиль ---------- */
  $('#pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#pass-err').textContent = '';
    try {
      await api('POST', '/api/admin/password', { old: f.old.value, password: f.password.value });
      f.reset();
      toast('Пароль изменён');
    } catch (err) {
      $('#pass-err').textContent = err.message;
    }
  });

  /* ---------- автообновление ---------- */
  const autoRefresh = () => {
    if (me && !document.hidden && $('#drawer').hidden) refresh().catch(() => {});
  };
  setInterval(autoRefresh, 10000);
  // вернулись на вкладку — сразу подтягиваем свежие заявки
  document.addEventListener('visibilitychange', autoRefresh);
  window.addEventListener('focus', autoRefresh);

  boot();
})();
