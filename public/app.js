'use strict';

const API = '';
let nick = localStorage.getItem('coupon_nick') || '';
let roomCode = localStorage.getItem('coupon_room') || '';
let room = null;
let resvSelected = new Set();

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
async function api(path, method = 'GET', body) {
  const opt = { method, headers: {} };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(API + path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ---------------- 认证 ----------------
function initAuth() {
  let mode = 'join';
  $$('.tab-switch').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    $$('.tab-switch').forEach((x) => x.classList.toggle('active', x === b));
    $('#create-fields').style.display = mode === 'create' ? '' : 'none';
    $('#join-fields').style.display = mode === 'join' ? '' : 'none';
    $('#auth-submit').textContent = mode === 'create' ? '创建并进入' : '进入空间';
  }));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = $('#nick').value.trim();
    if (!n) return toast('请填写昵称');
    nick = n;
    localStorage.setItem('coupon_nick', nick);
    $('#auth-submit').disabled = true;
    try {
      if (mode === 'create') {
        const name = $('#room-name').value.trim();
        room = await api('/api/rooms', 'POST', { name, by: nick });
      } else {
        const code = $('#room-code').value.trim().toUpperCase();
        if (code.length !== 4) return toast('房间码为 4 位');
        room = await api('/api/rooms/' + code, 'GET');
      }
      roomCode = room.code;
      localStorage.setItem('coupon_room', roomCode);
      enterApp();
    } catch (err) {
      $('#auth-hint').textContent = err.message;
      toast(err.message);
    } finally {
      $('#auth-submit').disabled = false;
    }
  });

  // 已登录过则尝试直接进
  if (nick && roomCode) {
    $('#nick').value = nick;
    api('/api/rooms/' + roomCode, 'GET').then((r) => { room = r; enterApp(); })
      .catch(() => { /* 需重新加入 */ });
  }
}

function enterApp() {
  $('#auth-screen').style.display = 'none';
  $('#main-screen').style.display = 'flex';
  $('#top-room-name').textContent = room.name;
  $('#top-room-code').textContent = '房间码：' + room.code;
  $('#nick').value = nick;
  renderAll();
}

$('#leave-btn').addEventListener('click', () => {
  roomCode = ''; room = null;
  localStorage.removeItem('coupon_room');
  $('#main-screen').style.display = 'none';
  $('#auth-screen').style.display = 'flex';
  $('#auth-hint').textContent = '';
});

// ---------------- Tab 切换 ----------------
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + t.dataset.tab));
  if (t.dataset.tab === 'overview') renderOverview();
}));

// ---------------- 数据加载 ----------------
async function reload() {
  room = await api('/api/rooms/' + roomCode, 'GET');
  renderAll();
}
function renderAll() {
  renderDishes();
  renderResvForm();
  renderReservations();
  renderRate();
}

// ---------------- 菜名库 ----------------
function starHtml(score) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<span class="s ${i <= score ? 'on' : ''}">★</span>`;
  return s;
}
function avgOf(dishId) {
  const rs = room.ratings.filter((r) => r.dishId === dishId);
  if (!rs.length) return null;
  return rs.reduce((a, b) => a + b.score, 0) / rs.length;
}
function renderDishes() {
  const list = $('#dish-list');
  if (!room.dishes.length) { list.innerHTML = '<div class="empty">还没有菜名，加一道喜欢的菜吧 🍲</div>'; return; }
  list.innerHTML = room.dishes.map((d) => {
    const a = avgOf(d.id);
    return `<div class="card">
      <div class="row1">
        <div>
          <div class="title">${esc(d.name)}${d.category ? `<span class="tag">${esc(d.category)}</span>` : ''}</div>
          <div class="meta">${d.restaurant ? '📍' + esc(d.restaurant) + ' · ' : ''}由 ${esc(d.by || '神秘人')} 添加</div>
        </div>
        <button class="del" data-del="${d.id}" title="删除">✕</button>
      </div>
      ${a != null ? `<div class="meta">平均分 <b style="color:var(--pink-deep)">${a.toFixed(1)}</b> · ${room.ratings.filter(r=>r.dishId===d.id).length} 人评分</div>` : ''}
    </div>`;
  }).join('');
  $$('#dish-list .del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('确定删除这道菜？')) return;
    await api(`/api/rooms/${roomCode}/dishes/${b.dataset.del}`, 'DELETE');
    await reload(); toast('已删除');
  }));
}
$('#dish-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#dish-name').value.trim();
  if (!name) return;
  await api(`/api/rooms/${roomCode}/dishes`, 'POST', {
    name, category: $('#dish-cat').value.trim(), restaurant: $('#dish-rest').value.trim(), by: nick
  });
  $('#dish-name').value = $('#dish-cat').value = $('#dish-rest').value = '';
  await reload(); toast('已添加到菜名库 🍽️');
});

// ---------------- 预约 ----------------
function renderResvForm() {
  const box = $('#resv-dishes');
  if (!room.dishes.length) { box.innerHTML = '<div class="meta">先在「菜名库」加菜，才能预约时点菜哦</div>'; return; }
  box.innerHTML = room.dishes.map((d) =>
    `<span class="chip ${resvSelected.has(d.id) ? 'on' : ''}" data-id="${d.id}">${esc(d.name)}</span>`).join('');
  $$('#resv-dishes .chip').forEach((c) => c.addEventListener('click', () => {
    const id = c.dataset.id;
    if (resvSelected.has(id)) { resvSelected.delete(id); c.classList.remove('on'); }
    else { resvSelected.add(id); c.classList.add('on'); }
  }));
}
$('#resv-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dishes = room.dishes.filter((d) => resvSelected.has(d.id)).map((d) => d.name);
  await api(`/api/rooms/${roomCode}/reservations`, 'POST', {
    title: $('#resv-title').value.trim(),
    restaurant: $('#resv-rest').value.trim(),
    datetime: $('#resv-time').value,
    note: $('#resv-note').value.trim(),
    dishes, by: nick
  });
  $('#resv-title').value = $('#resv-rest').value = $('#resv-note').value = '';
  $('#resv-time').value = '';
  resvSelected.clear();
  await reload(); toast('预约已创建 📅');
  switchTab('reserve');
});
function renderReservations() {
  const list = $('#resv-list');
  const sorted = [...room.reservations].sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''));
  if (!sorted.length) { list.innerHTML = '<div class="empty">还没有预约，约一顿饭吧 💕</div>'; return; }
  list.innerHTML = sorted.map((r) => {
    const dishes = r.dishes.length ? r.dishes.map((d) => `<span class="tag">${esc(d)}</span>`).join(' ') : '<span class="meta">未选菜</span>';
    const time = r.datetime ? '🕒' + new Date(r.datetime).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="card">
      <div class="row1">
        <div class="title">${esc(r.title)}</div>
        <span class="${r.status === 'done' ? 'status-done' : 'status-planned'}">${r.status === 'done' ? '已赴约' : '待赴约'}</span>
      </div>
      <div class="meta">${r.restaurant ? '📍' + esc(r.restaurant) + ' · ' : ''}${time} · 由 ${esc(r.by || '神秘人')}</div>
      <div style="margin-top:8px">${dishes}</div>
      ${r.note ? `<div class="meta" style="margin-top:8px">💬 ${esc(r.note)}</div>` : ''}
      ${r.status !== 'done' ? `<button class="complete-btn" data-done="${r.id}">标记已赴约 🍴</button>` : ''}
    </div>`;
  }).join('');
  $$('#resv-list .complete-btn').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/rooms/${roomCode}/reservations/${b.dataset.done}/complete`, 'POST');
    await reload(); toast('已记录，下次评分回味一下 😋');
  }));
}

// ---------------- 评分 ----------------
function renderRate() {
  const list = $('#rate-list');
  if (!room.dishes.length) { list.innerHTML = '<div class="empty">还没菜可评，去加菜吧</div>'; return; }
  list.innerHTML = room.dishes.map((d) => {
    const a = avgOf(d.id);
    return `<div class="card" data-dish="${d.id}">
      <div class="row1">
        <div class="title">${esc(d.name)}</div>
        <span class="avg">${a != null ? '平均 ' + a.toFixed(1) : '未评分'}</span>
      </div>
      <div class="rate-box">
        <div class="stars" data-dish="${d.id}">${starHtml(0)}</div>
      </div>
      <input class="rate-note" type="text" placeholder="写句点评（可选）" maxlength="200" data-note="${d.id}" />
    </div>`;
  }).join('');
  $$('#rate-list .stars').forEach((st) => {
    const dishId = st.dataset.dish;
    const stars = $$('span', st);
    stars.forEach((s, i) => {
      s.addEventListener('mouseenter', () => paint(st, i + 1));
      s.addEventListener('click', async () => {
        const score = i + 1;
        const note = $(`[data-note="${dishId}"]`).value.trim();
        await api(`/api/rooms/${roomCode}/ratings`, 'POST', { dishId, score, note, by: nick });
        await reload(); toast('评分成功 ⭐');
      });
    });
    st.addEventListener('mouseleave', () => paint(st, 0));
  });
}
function paint(starsEl, n) {
  $$('span', starsEl).forEach((s, i) => s.classList.toggle('on', i < n));
}

// ---------------- 概览 ----------------
function renderOverview() {
  const dishN = room.dishes.length;
  const resvN = room.reservations.length;
  const doneN = room.reservations.filter((r) => r.status === 'done').length;
  const rated = room.dishes.map((d) => ({ d, a: avgOf(d.id) })).filter((x) => x.a != null)
    .sort((x, y) => y.a - x.a);
  $('#stats').innerHTML = `
    <div class="stat"><div class="num">${dishN}</div><div class="lbl">菜名</div></div>
    <div class="stat"><div class="num">${resvN}</div><div class="lbl">预约</div></div>
    <div class="stat"><div class="num">${doneN}</div><div class="lbl">已赴约</div></div>`;
  let html = '<h3 style="margin:6px 4px 10px;font-size:15px">⭐ 评分排行</h3>';
  if (!rated.length) html += '<div class="empty">还没有评分，去「评分」页打个分</div>';
  else html += rated.map((x) =>
    `<div class="card"><div class="row1"><div class="title">${esc(x.d.name)}</div><div class="avg">${x.a.toFixed(1)}</div></div>
     <div class="stars" style="margin-top:6px;pointer-events:none">${starHtml(Math.round(x.a))}</div></div>`).join('');
  $('#overview-list').innerHTML = html;
}

// ---------------- 工具 ----------------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function switchTab(name) {
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
}

initAuth();
