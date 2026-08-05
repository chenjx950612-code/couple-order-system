'use strict';

const API = '';
let nick = localStorage.getItem('coupon_nick') || '';
let roomCode = localStorage.getItem('coupon_room') || '';
let room = null;
let resvSelected = new Set();
let resvMeal = '';

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
  initSeen();
  startPolling();
}

$('#leave-btn').addEventListener('click', () => {
  stopPolling();
  const nb = document.getElementById('order-notice'); if (nb) nb.remove();
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
  if (t.dataset.tab === 'menu') renderMenu();
}));

// ---------------- 数据加载 ----------------
async function reload() {
  room = await api('/api/rooms/' + roomCode, 'GET');
  renderAll();
}
function renderAll() {
  renderDishes();
  renderMenu();
  renderResvForm();
  renderReservations();
}

// ---------------- 菜名库 ----------------
let pendingDishImage = null;
const CATS = ['荤菜', '蔬菜', '主食', '汤', '甜点', '其他'];
const CAT_ICONS = { 荤菜: '🥩', 蔬菜: '🥬', 主食: '🍚', 汤: '🍲', 甜点: '🍰', 其他: '🍽️' };
let dishSearch = '', menuSearch = '', dishCat = '全部', menuCat = '全部';
let menuSelected = new Set();
let resvDishSearch = '';
let overviewDate = '';
let overviewReviewFilter = '';
let overviewHighlightRid = '';
let seenResvIds = new Set();
let pollTimer = null;

function thumb(d) {
  if (d.image) return `<img class="thumb" src="${esc(d.image)}" alt="" />`;
  return `<div class="thumb none">🍲</div>`;
}
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function pickImage() {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => res(inp.files[0] || null);
    inp.click();
  });
}
function countByCat() {
  const c = { 全部: room.dishes.length };
  CATS.forEach((cat) => c[cat] = 0);
  room.dishes.forEach((d) => { const cat = d.category || '其他'; c[cat] = (c[cat] || 0) + 1; });
  return c;
}
function renderCatTabs(containerId, activeCat, onClick) {
  const box = $(containerId);
  const counts = countByCat();
  box.innerHTML = Object.keys(counts).map((cat) => {
    const icon = cat === '全部' ? '📋' : (CAT_ICONS[cat] || '🍽️');
    return `<button class="cat-tab ${cat === activeCat ? 'active' : ''}" data-cat="${esc(cat)}">${icon} ${esc(cat)} <span class="cat-num">${counts[cat]}</span></button>`;
  }).join('');
  $$(containerId + ' .cat-tab').forEach((b) => b.addEventListener('click', () => onClick(b.dataset.cat)));
}
function filterDishes() {
  return room.dishes.filter((d) => {
    const hitCat = dishCat === '全部' || (d.category || '其他') === dishCat;
    const kw = dishSearch.trim();
    const hitName = !kw || d.name.toLowerCase().includes(kw.toLowerCase());
    return hitCat && hitName;
  });
}
function galleryCard(d, opts = {}) {
  return `<div class="g-card" data-id="${esc(d.id)}">
    <div class="g-img">${d.image ? `<img src="${esc(d.image)}" alt="" />` : `<div class="g-placeholder">${CAT_ICONS[d.category || '其他'] || '🍲'}</div>`}</div>
    <div class="g-info">
      <div class="g-title">${esc(d.name)}</div>
      ${opts.by ? `<div class="g-meta">由 ${esc(d.by || '神秘人')} 添加</div>` : ''}
    </div>
    ${opts.check ? `<div class="g-check ${menuSelected.has(d.id) ? 'on' : ''}"><span>✓</span></div>` : ''}
    ${opts.manage ? `<div class="g-manage">
      <button class="img-btn" data-img="${d.id}" title="换图">📷</button>
      ${d.image ? `<button class="img-remove" data-imgrm="${d.id}" title="移除图片">🗑</button>` : ''}
      <button class="del" data-del="${d.id}" title="删除">✕</button>
    </div>` : ''}
  </div>`;
}
function renderDishes() {
  const list = $('#dish-list');
  renderCatTabs('#dish-cat-tabs', dishCat, (cat) => { dishCat = cat; renderDishes(); });
  const items = filterDishes();
  if (!items.length) { list.innerHTML = '<div class="empty">没有找到菜品，换个分类或搜索词试试 🍲</div>'; return; }
  list.innerHTML = items.map((d) => galleryCard(d, { by: true, manage: true })).join('');
  $$('#dish-list .del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('确定删除这道菜？')) return;
    await api(`/api/rooms/${roomCode}/dishes/${b.dataset.del}`, 'DELETE');
    await reload(); toast('已删除');
  }));
  $$('#dish-list .img-btn').forEach((b) => b.addEventListener('click', async () => {
    const f = await pickImage();
    if (!f) return;
    try {
      const dataUrl = await fileToBase64(f);
      await api(`/api/rooms/${roomCode}/dishes/${b.dataset.img}/image`, 'POST', { image: dataUrl });
      await reload(); toast('图片已更新 📷');
    } catch (e) { toast('图片上传失败'); }
  }));
  $$('#dish-list .img-remove').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('移除这道菜的图片？')) return;
    await api(`/api/rooms/${roomCode}/dishes/${b.dataset.imgrm}/image`, 'POST', { image: '' });
    await reload(); toast('已移除图片');
  }));
}
$('#dish-img-btn').addEventListener('click', async () => {
  const f = await pickImage();
  if (!f) return;
  try {
    pendingDishImage = await fileToBase64(f);
    const pv = $('#dish-preview');
    pv.src = pendingDishImage; pv.hidden = false;
    $('#dish-img-btn').textContent = '📷 已选';
  } catch (e) { toast('图片读取失败'); }
});
$('#dish-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#dish-name').value.trim();
  if (!name) return;
  const body = { name, category: $('#dish-cat').value, by: nick };
  if (pendingDishImage) body.image = pendingDishImage;
  await api(`/api/rooms/${roomCode}/dishes`, 'POST', body);
  $('#dish-name').value = '';
  $('#dish-cat').selectedIndex = 0;
  $('#dish-preview').hidden = true; $('#dish-preview').src = '';
  pendingDishImage = null;
  $('#dish-img-btn').textContent = '📷 图片';
  await reload(); toast('已添加到菜名库 🍽️');
});
$('#dish-search').addEventListener('input', (e) => { dishSearch = e.target.value; renderDishes(); });

// ---------------- 菜单列表（点菜） ----------------
function filterMenu() {
  return room.dishes.filter((d) => {
    const hitCat = menuCat === '全部' || (d.category || '其他') === menuCat;
    const kw = menuSearch.trim();
    const hitName = !kw || d.name.toLowerCase().includes(kw.toLowerCase());
    return hitCat && hitName;
  });
}
function updateMenuBar() {
  const n = menuSelected.size;
  $('#menu-count').textContent = n ? `已选 ${n} 道菜` : '请选择菜品';
  $('#menu-order-btn').disabled = n === 0;
}
function renderMenu() {
  const list = $('#menu-list');
  renderCatTabs('#menu-cat-tabs', menuCat, (cat) => { menuCat = cat; renderMenu(); });
  const items = filterMenu();
  if (!room.dishes.length) { list.innerHTML = '<div class="empty">还没有菜，去「菜名库」加菜吧 🍲</div>'; updateMenuBar(); return; }
  if (!items.length) { list.innerHTML = '<div class="empty">没有找到菜品，换个分类或搜索词试试 🍲</div>'; updateMenuBar(); return; }
  list.innerHTML = items.map((d) => galleryCard(d, { check: true })).join('');
  $$('#menu-list .g-card').forEach((c) => c.addEventListener('click', () => {
    const id = c.dataset.id;
    if (menuSelected.has(id)) menuSelected.delete(id);
    else menuSelected.add(id);
    const chk = c.querySelector('.g-check');
    if (chk) chk.classList.toggle('on', menuSelected.has(id));
    updateMenuBar();
  }));
  updateMenuBar();
}
$('#menu-search').addEventListener('input', (e) => { menuSearch = e.target.value; renderMenu(); });
$('#menu-order-btn').addEventListener('click', () => {
  if (!menuSelected.size) return;
  switchTab('reserve');
  // 把菜单里选的菜同步到预约选菜
  resvSelected = new Set(menuSelected);
  menuSelected.clear();
  renderMenu();
  renderResvForm();
  toast(`已选 ${resvSelected.size} 道菜，完善日期和餐次后创建点菜`);
});

// ---------------- 预约 ----------------
function updateResvDishTrigger() {
  const n = resvSelected.size;
  $('#resv-dish-trigger').textContent = n ? `已选 ${n} 道菜` : '请选择菜品';
}
function renderResvDishBody() {
  const body = $('#resv-dish-body');
  const kw = resvDishSearch.trim().toLowerCase();
  const groups = {};
  room.dishes.forEach((d) => {
    if (kw && !d.name.toLowerCase().includes(kw)) return;
    const cat = d.category || '其他';
    (groups[cat] = groups[cat] || []).push(d);
  });
  const cats = Object.keys(groups).sort((a, b) => CATS.indexOf(a) - CATS.indexOf(b));
  if (!cats.length) { body.innerHTML = '<div class="empty">没有找到菜品</div>'; return; }
  body.innerHTML = cats.map((cat) => {
    const items = groups[cat].map((d) => `
      <label class="multi-item">
        <input type="checkbox" data-id="${esc(d.id)}" ${resvSelected.has(d.id) ? 'checked' : ''} />
        <span class="multi-name">${thumbMini(d)} ${esc(d.name)}</span>
      </label>`).join('');
    return `<div class="multi-group"><h4>${CAT_ICONS[cat] || '🍽️'} ${esc(cat)}</h4>${items}</div>`;
  }).join('');
  $$('#resv-dish-body input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.id;
    if (cb.checked) resvSelected.add(id);
    else resvSelected.delete(id);
    $('#resv-dish-count').textContent = `已选 ${resvSelected.size} 道`;
  }));
}
function thumbMini(d) {
  if (d.image) return `<img class="multi-thumb" src="${esc(d.image)}" alt="" />`;
  return `<span class="multi-thumb none">${CAT_ICONS[d.category || '其他'] || '🍲'}</span>`;
}
function openResvDishPop() {
  if (!room.dishes.length) return toast('先去「菜名库」加菜');
  resvDishSearch = '';
  $('#resv-dish-search').value = '';
  $('#resv-dish-pop').classList.add('show');
  $('#resv-dish-count').textContent = `已选 ${resvSelected.size} 道`;
  renderResvDishBody();
}
function closeResvDishPop() {
  $('#resv-dish-pop').classList.remove('show');
  updateResvDishTrigger();
}
function renderResvForm() {
  updateResvDishTrigger();
}
$('#resv-dish-trigger').addEventListener('click', openResvDishPop);
$('#resv-dish-close').addEventListener('click', closeResvDishPop);
$('#resv-dish-ok').addEventListener('click', closeResvDishPop);
$('#resv-dish-search').addEventListener('input', (e) => { resvDishSearch = e.target.value; renderResvDishBody(); });

// 餐次选择（早/中/晚）
$$('#resv-meal .meal-opt').forEach((b) => b.addEventListener('click', () => {
  resvMeal = b.dataset.meal;
  $$('#resv-meal .meal-opt').forEach((x) => x.classList.toggle('on', x === b));
}));
$('#resv-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = $('#resv-date').value;
  if (!date) return toast('请选择日期');
  if (!resvMeal) return toast('请选择餐次（早 / 中 / 晚）');
  const dishes = room.dishes.filter((d) => resvSelected.has(d.id)).map((d) => d.name);
  await api(`/api/rooms/${roomCode}/reservations`, 'POST', {
    date, meal: resvMeal,
    note: $('#resv-note').value.trim(),
    dishes, by: nick
  });
  $('#resv-note').value = '';
  $('#resv-date').value = '';
  resvSelected.clear();
  resvMeal = '';
  $$('#resv-meal .meal-opt').forEach((x) => x.classList.remove('on'));
  await reload(); toast('点菜已创建 🍽️');
  switchTab('overview');
});
function fmtDate(s) {
  if (!s) return '';
  const p = String(s).split('-');
  if (p.length < 3) return s;
  return `${+p[1]}月${+p[2]}日`;
}
function calendarIcon(dateStr) {
  const p = String(dateStr || '').split('-');
  const day = p.length >= 3 ? +p[2] : '--';
  return `<svg class="cal-icon" viewBox="0 0 40 48" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="6" width="36" height="40" rx="6" fill="#fff" stroke="#ff6b81" stroke-width="2.5"/>
    <rect x="2" y="6" width="36" height="14" rx="6" fill="#ff6b81"/>
    <text x="20" y="39" text-anchor="middle" font-size="16" font-weight="bold" fill="#ff6b81">${day}</text>
  </svg>`;
}
function renderReservations() {
  const list = $('#resv-list');
  list.innerHTML = '<div class="empty">点菜记录已移到「概览」页查看 💕</div>';
}

// ---------------- 工具 ----------------
// ---------------- 概览（预约记录 + 饭后点评） ----------------
const editingReviews = new Set();
const reviewDraft = {};
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderOverview() {
  const dishN = room.dishes.length;
  const resvN = room.reservations.length;
  const reviewN = room.reservations.filter((r) => r.review).length;
  $('#stats').innerHTML = `
    <div class="stat"><div class="num">${dishN}</div><div class="lbl">菜名</div></div>
    <div class="stat"><div class="num">${resvN}</div><div class="lbl">点菜</div></div>
    <div class="stat"><div class="num">${reviewN}</div><div class="lbl">点评</div></div>`;
  if (!room.reservations.length) {
    $('#overview-list').innerHTML = '<div class="empty">还没有点菜，去「点菜」页约一顿饭吧 💕</div>';
    $('#overview-filter').innerHTML = '';
    return;
  }
  const mealRank = { 早: 0, 中: 1, 晚: 2 };
  const sorted = [...room.reservations].sort((a, b) => {
    const d = (b.date || '').localeCompare(a.date || '');
    if (d !== 0) return d;
    return ((mealRank[b.meal] ?? 9) - (mealRank[a.meal] ?? 9));
  });
  // 组合筛选：日期 + 点评状态
  const filtered = sorted.filter((r) => {
    if (overviewDate && r.date !== overviewDate) return false;
    if (overviewReviewFilter === 'done' && !r.review) return false;
    if (overviewReviewFilter === 'none' && r.review) return false;
    return true;
  });
  // 日期筛选 + 点评筛选 UI
  $('#overview-filter').innerHTML = `
    <div class="overview-filter">
      <span class="of-label">选择</span>
      <input type="date" id="overview-date" value="${esc(overviewDate)}" />
      <span id="overview-count" class="overview-count">${filtered.length} 条</span>
      <button type="button" class="text-btn" id="overview-clear-date">全部日期</button>
    </div>
    <div class="overview-subfilter">
      <button type="button" class="of-btn ${overviewReviewFilter === '' ? 'on' : ''}" data-rf="">全部</button>
      <button type="button" class="of-btn ${overviewReviewFilter === 'done' ? 'on' : ''}" data-rf="done">已点评</button>
      <button type="button" class="of-btn ${overviewReviewFilter === 'none' ? 'on' : ''}" data-rf="none">未点评</button>
    </div>`;
  if (!filtered.length) {
    $('#overview-list').innerHTML = `<div class="empty">${overviewDate || overviewReviewFilter ? '没有符合条件的点菜记录' : '还没有点菜，去「点菜」页约一顿饭吧 💕'}</div>`;
  } else {
    $('#overview-list').innerHTML = filtered.map((r) => reservationCard(r)).join('');
    bindReviewUI();
  }
  $('#overview-date').addEventListener('change', (e) => {
    overviewDate = e.target.value;
    overviewHighlightRid = '';
    renderOverview();
  });
  $('#overview-clear-date').addEventListener('click', () => {
    overviewDate = '';
    overviewHighlightRid = '';
    renderOverview();
  });
  $$('.of-btn').forEach((b) => b.addEventListener('click', () => {
    overviewReviewFilter = b.dataset.rf || '';
    overviewHighlightRid = '';
    renderOverview();
  }));
  // 高亮定位
  if (overviewHighlightRid) {
    const el = $(`#overview-list .resv-card[data-rid="${overviewHighlightRid}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        overviewHighlightRid = '';
        el.classList.remove('highlight');
      }, 2500);
    } else {
      overviewHighlightRid = '';
    }
  }
}
function reservationCard(r) {
  const mealMap = { 早: '早餐', 中: '午餐', 晚: '晚餐' };
  const dateStr = r.date ? fmtDate(r.date) : '未定日期';
  const mealStr = r.meal ? (mealMap[r.meal] || r.meal) : '';
  const dishes = r.dishes.length ? r.dishes.map((d) => `<span class="tag">${esc(d)}</span>`).join(' ') : '<span class="meta">未选菜</span>';
  let reviewHtml;
  if (editingReviews.has(r.id)) {
    // 保证 draft 始终存在且是最新数据，避免移动端状态丢失
    if (!reviewDraft[r.id]) {
      reviewDraft[r.id] = {
        text: (r.review && r.review.text) || '',
        image: (r.review && r.review.image) || null,
        changed: false,
        removed: false,
      };
    }
    const d = reviewDraft[r.id];
    reviewHtml = `<div class="review-form">
      <textarea class="review-text" data-rid="${r.id}" placeholder="写下这顿饭的感受…" maxlength="300">${esc(d.text)}</textarea>
      <div class="review-img-row">
        <button type="button" class="img-pick review-img-btn" data-rid="${r.id}">📷 图片</button>
        <img class="review-preview" data-rid="${r.id}" ${d.image ? `src="${esc(d.image)}"` : 'hidden'} />
        ${d.image ? `<button type="button" class="text-btn review-img-del" data-rid="${r.id}">移除图</button>` : ''}
      </div>
      <div class="review-actions">
        <button type="button" class="primary-btn sm review-save" data-rid="${r.id}">保存点评</button>
        <button type="button" class="text-btn review-cancel" data-rid="${r.id}">取消</button>
      </div>
    </div>`;
  } else if (r.review) {
    const rv = r.review;
    reviewHtml = `<div class="review-done">
      ${rv.text ? `<div class="meta">${esc(rv.text)}</div>` : ''}
      ${rv.image ? `<img class="review-img" src="${esc(rv.image)}" alt="" />` : ''}
      <div class="meta">由 ${esc(rv.by || '神秘人')} 点评${rv.at ? ' · ' + fmtTime(rv.at) : ''}</div>
    </div>`;
  } else {
    reviewHtml = `<div class="review-empty">暂未点评</div>`;
  }
  // 卡片底部分两行：第一行 primary 按钮（写点评/编辑点评），第二行删除
  let primaryBtn = '';
  if (editingReviews.has(r.id)) {
    // 编辑态按钮留在 review-form 内部，此处不显示
  } else if (r.review) {
    primaryBtn = `<button type="button" class="text-btn review-edit" data-rid="${r.id}">✏️ 编辑点评</button>`;
  } else {
    primaryBtn = `<button type="button" class="text-btn review-add" data-rid="${r.id}">✍️ 写饭后点评</button>`;
  }
  return `<div class="card resv-card ${r.id === overviewHighlightRid ? 'highlight' : ''}" data-rid="${r.id}">
    <div class="row1"><div class="title">${esc(r.title || (mealStr || '点菜'))}</div></div>
    <div class="meta cal-meta">${calendarIcon(r.date)}<span>${esc(dateStr)}${mealStr ? ' · ' + esc(mealStr) : ''} · 由 ${esc(r.by || '神秘人')}</span></div>
    <div style="margin-top:8px">${dishes}</div>
    ${r.note ? `<div class="meta" style="margin-top:8px">💬 ${esc(r.note)}</div>` : ''}
    <div class="review-area">${reviewHtml || ''}</div>
    <div class="card-actions">
      ${primaryBtn ? `<div class="card-primary">${primaryBtn}</div>` : ''}
      <div class="card-del"><button type="button" class="text-btn resv-del" data-rid="${esc(r.id)}">🗑 删除这顿</button></div>
    </div>
  </div>`;
}
function bindReviewUI() {
  $$('#overview-list .review-add, #overview-list .review-edit').forEach((b) => b.addEventListener('click', () => {
    const rid = b.dataset.rid;
    const r = room.reservations.find((x) => x.id === rid);
    reviewDraft[rid] = {
      text: (r.review && r.review.text) || '',
      image: (r.review && r.review.image) || null,
      changed: false,
      removed: false
    };
    editingReviews.add(rid);
    renderOverview();
  }));
  $$('#overview-list .review-cancel').forEach((b) => b.addEventListener('click', () => {
    const rid = b.dataset.rid;
    editingReviews.delete(rid);
    delete reviewDraft[rid];
    renderOverview();
  }));
  $$('#overview-list .resv-del').forEach((b) => b.addEventListener('click', async () => {
    const rid = b.dataset.rid;
    if (!confirm('确定删除这顿点菜记录吗？删除后不可恢复（含点评）')) return;
    try {
      await api(`/api/rooms/${roomCode}/reservations/${rid}`, 'DELETE');
      const idx = room.reservations.findIndex((x) => x.id === rid);
      if (idx >= 0) room.reservations.splice(idx, 1);
      editingReviews.delete(rid);
      delete reviewDraft[rid];
      renderOverview();
      toast('已删除 🗑');
    } catch (e) { toast('删除失败'); }
  }));
  // 移动端稳妥做法：textarea 输入实时同步到 draft，避免保存时 DOM 取值不可靠
  $$('#overview-list .review-text').forEach((ta) => ta.addEventListener('input', () => {
    const rid = ta.dataset.rid;
    if (reviewDraft[rid]) reviewDraft[rid].text = ta.value;
  }));
  $$('#overview-list .review-img-btn').forEach((b) => b.addEventListener('click', async () => {
    const rid = b.dataset.rid;
    const f = await pickImage();
    if (!f) return;
    try {
      const dataUrl = await fileToBase64(f);
      reviewDraft[rid].image = dataUrl;
      reviewDraft[rid].changed = true;
      reviewDraft[rid].removed = false;
      renderOverview();
    } catch (e) { toast('图片读取失败'); }
  }));
  $$('#overview-list .review-img-del').forEach((b) => b.addEventListener('click', () => {
    const rid = b.dataset.rid;
    reviewDraft[rid].image = null;
    reviewDraft[rid].changed = true;
    reviewDraft[rid].removed = true;
    renderOverview();
  }));
  $$('#overview-list .review-save').forEach((b) => b.addEventListener('click', async () => {
    const rid = b.dataset.rid;
    const d = reviewDraft[rid] || {};
    // 文字兜底再读一次 DOM
    const ta = $(`.review-text[data-rid="${rid}"]`);
    if (ta && reviewDraft[rid]) reviewDraft[rid].text = ta.value;
    const body = { by: nick, text: (d.text || '').trim() };
    if (d.changed) body.image = d.removed ? '' : (d.image || '');
    try {
      const updated = await api(`/api/rooms/${roomCode}/reservations/${rid}/review`, 'POST', body);
      editingReviews.delete(rid);
      delete reviewDraft[rid];
      // 用服务端返回的最新记录直接覆盖本地，避免全量 reload 的竞态导致不刷新
      const idx = room.reservations.findIndex((x) => x.id === rid);
      if (idx >= 0) room.reservations[idx] = updated;
      else room.reservations.push(updated);
      renderOverview();
      toast('点评已保存 🍽️');
    } catch (e) { toast('保存失败'); }
  }));
}

// ---------------- 工具 ----------------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function switchTab(name) {
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'overview') renderOverview();
  if (name === 'menu') renderMenu();
}

// ---------------- 跨设备实时提示（轮询） ----------------
function initSeen() {
  seenResvIds = new Set();
  if (room && room.reservations) room.reservations.forEach((r) => seenResvIds.add(r.id));
}
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const r = await api('/api/rooms/' + roomCode, 'GET');
      room = r;
      const news = (r.reservations || []).filter((x) => x.by !== nick && !seenResvIds.has(x.id));
      news.forEach((x) => seenResvIds.add(x.id));
      if (news.length) {
        const latest = news[news.length - 1];
        showOrderNotice(latest, news.length);
        if ($('.tab.active') && $('.tab.active').dataset.tab === 'overview') renderOverview();
      }
    } catch (e) { /* 网络抖动忽略 */ }
  }, 5000);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
function showOrderNotice(d, count) {
  let bar = document.getElementById('order-notice');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'order-notice';
    bar.className = 'order-notice';
    document.body.appendChild(bar);
  }
  const verb = count > 1 ? `刚点了 ${count} 顿饭` : '刚点了一顿饭';
  bar.textContent = `💕 ${d.by} ${verb}，点此查看 →`;
  bar.style.display = 'block';
  bar.onclick = () => {
    overviewDate = d.date || '';
    overviewReviewFilter = '';
    overviewHighlightRid = d.id;
    switchTab('overview');
    bar.style.display = 'none';
  };
  clearTimeout(bar._t);
  bar._t = setTimeout(() => { bar.style.display = 'none'; }, 12000);
}

// ---------------- 系统管理（更新 + APP 图标） ----------------
function openAdmin() {
  $('#admin-modal').classList.remove('hidden');
  $('#admin-msg').textContent = '';
  api('/api/version').then((v) => {
    const short = (v.commit && v.commit !== 'unknown') ? v.commit.slice(0, 8) : '未知';
    $('#admin-version').textContent = `当前版本：${short}（${new Date(v.time).toLocaleString('zh-CN')}）`;
  }).catch(() => { $('#admin-version').textContent = '版本信息获取失败'; });
}
function closeAdmin() { $('#admin-modal').classList.add('hidden'); }

$('#admin-btn').addEventListener('click', openAdmin);
$('#admin-close').addEventListener('click', closeAdmin);
$('#admin-mask').addEventListener('click', closeAdmin);

let pendingIcon = null;
$('#icon-pick').addEventListener('click', () => $('#icon-file').click());
$('#icon-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    pendingIcon = await fileToBase64(f);
    $('#admin-icon-prev').src = pendingIcon;
    $('#admin-msg').textContent = '已选择图片，点击“上传图标”生效';
  } catch (err) { toast('图片读取失败'); }
});
$('#admin-icon').addEventListener('click', async () => {
  const pass = $('#admin-pass').value;
  if (!pass) return toast('请先输入管理口令');
  if (!pendingIcon) return toast('请先选择图片');
  try {
    await api('/api/admin/icon', 'POST', { password: pass, image: pendingIcon });
    $('#admin-msg').textContent = '图标已更新 ✅';
    $('#admin-icon-prev').src = '/icon.png?t=' + Date.now();
    toast('图标已更新 🎨');
  } catch (err) { $('#admin-msg').textContent = err.message; toast(err.message); }
});

let updating = false;
$('#admin-update').addEventListener('click', async () => {
  if (updating) return;
  const pass = $('#admin-pass').value;
  if (!pass) return toast('请先输入管理口令');
  updating = true;
  $('#admin-update').disabled = true;
  $('#admin-msg').textContent = '正在检查更新…';
  try {
    const r = await api('/api/admin/update', 'POST', { password: pass });
    if (r.updated) {
      $('#admin-msg').textContent = '已拉取最新代码，系统正在重启…';
      const waitBack = setInterval(async () => {
        try {
          await api('/api/version');
          clearInterval(waitBack);
          location.reload();
        } catch (e) { /* 还在重启 */ }
      }, 2000);
    } else {
      $('#admin-msg').textContent = '已经是最新版本 ✅';
    }
  } catch (err) {
    $('#admin-msg').textContent = err.message;
    toast(err.message);
  } finally {
    updating = false;
    $('#admin-update').disabled = false;
  }
});

// ---------------- 图片放大查看（lightbox） ----------------
function openLightbox(src) {
  const lb = $('#img-lightbox');
  lb.querySelector('.lightbox-img').src = src;
  lb.hidden = false;
}
function closeLightbox() {
  const lb = $('#img-lightbox');
  lb.hidden = true;
  lb.querySelector('.lightbox-img').src = '';
}
$('#img-lightbox').querySelector('.lightbox-mask').addEventListener('click', closeLightbox);
$('#img-lightbox').querySelector('.lightbox-close').addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
// 点击任意点评/菜品图片放大查看（事件委托，兼容动态重渲染）
document.addEventListener('click', (e) => {
  const img = e.target.closest('.review-img, .review-preview, .g-img img, .dish-preview');
  if (img && img.src) openLightbox(img.src);
});

initAuth();
