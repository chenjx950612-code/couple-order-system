'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const MAX_IMG = 4 * 1024 * 1024; // 解码后最大 4MB
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
const ADMIN_PASS = process.env.ADMIN_PASS || '061204';
const ICON_FILE = path.join(UPLOAD_DIR, 'app-icon.png');
const DEFAULT_ICON = path.join(PUBLIC_DIR, 'default-icon.png');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ rooms: {} }, null, 2));
}
function ensureUploads() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
// 把 base64 图片解码落盘，返回可访问的相对路径；失败返回 null
function saveImage(dataUrl, code, dishId) {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const ext = IMG_EXT[m[1]];
  if (!ext) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMG) return null;
  ensureUploads();
  const fname = `${code}_${dishId}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
  return '/uploads/' + fname;
}
function removeImageFile(rel) {
  if (!rel) return;
  try { fs.unlinkSync(path.join(PUBLIC_DIR, rel.replace(/^\//, ''))); } catch (e) { /* ignore */ }
}
function readDb() {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { rooms: {} };
  }
}
function writeDb(db) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 8e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function sanitize(s, max) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, max || 200);
}

// 保存 APP 图标（用于“添加到主屏幕”），覆盖式写入 public/uploads/app-icon.png
function saveIcon(dataUrl) {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return false;
  const ext = IMG_EXT[m[1]];
  if (!ext) return false;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMG) return false;
  ensureUploads();
  fs.writeFileSync(ICON_FILE, buf);
  return true;
}
// 优先返回用户上传的图标，否则返回默认图标
function serveIcon(res) {
  const f = fs.existsSync(ICON_FILE) ? ICON_FILE : DEFAULT_ICON;
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}
// 动态返回 PWA manifest（图标指向 /icon.png，可随上传更新）
function serveManifest(res) {
  const m = {
    name: '我们的点菜空间',
    short_name: '情侣点菜',
    description: '约饭、点菜、点评，两个人一起',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fff5f6',
    theme_color: '#ff6b81',
    icons: [
      { src: '/icon.png', sizes: 'any', type: 'image/png', purpose: 'any' },
      { src: '/icon.png', sizes: 'any', type: 'image/png', purpose: 'maskable' }
    ]
  };
  res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
  res.end(JSON.stringify(m));
}
// 读取当前版本信息（git commit）
function gitVersion() {
  try {
    const commit = execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: __dirname }).toString().trim();
    return { commit, branch };
  } catch (e) {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    // ---------------- API ----------------
    if (p.startsWith('/api/')) {
      // 当前版本信息
      if (p === '/api/version' && req.method === 'GET') {
        const v = gitVersion();
        return sendJson(res, 200, { ...v, time: new Date().toISOString() });
      }

      // 管理员：一键更新（git pull 后重启容器）
      if (p === '/api/admin/update' && req.method === 'POST') {
        const b = await readBody(req);
        if (b.password !== ADMIN_PASS) return sendJson(res, 403, { error: '管理口令不正确' });
        try {
          execSync('git config --global --add safe.directory /app', { cwd: __dirname });
          const out = execSync('git pull origin main', { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
          const updated = !/Already up to date/i.test(out);
          if (updated) {
            sendJson(res, 200, { ok: true, updated: true, message: '已拉取最新代码，系统将在 2 秒后重启更新', output: out.slice(0, 600) });
            setTimeout(() => process.exit(0), 2000); // 依赖 docker restart: unless-stopped 自动重启
            return;
          }
          return sendJson(res, 200, { ok: true, updated: false, message: '已经是最新版本', output: out.slice(0, 600) });
        } catch (e) {
          const detail = e && e.stderr ? e.stderr.toString() : String(e && e.message || e);
          return sendJson(res, 500, { error: '更新失败：' + detail.slice(0, 400) });
        }
      }

      // 管理员：上传 APP 图标
      if (p === '/api/admin/icon' && req.method === 'POST') {
        const b = await readBody(req);
        if (b.password !== ADMIN_PASS) return sendJson(res, 403, { error: '管理口令不正确' });
        if (!b.image) return sendJson(res, 400, { error: '请先选择图片' });
        if (!saveIcon(b.image)) return sendJson(res, 400, { error: '图片格式不支持或过大（≤4MB）' });
        return sendJson(res, 200, { ok: true });
      }

      // 创建房间
      if (p === '/api/rooms' && req.method === 'POST') {
        const b = await readBody(req);
        const db = readDb();
        let code = genCode();
        while (db.rooms[code]) code = genCode();
        const room = {
          code,
          name: sanitize(b.name, 40) || '我们的点菜空间',
          createdAt: new Date().toISOString(),
          dishes: [],
          reservations: [],
          ratings: []
        };
        db.rooms[code] = room;
        writeDb(db);
        return sendJson(res, 201, room);
      }

      const roomMatch = p.match(/^\/api\/rooms\/([A-Z0-9]{4})$/);
      if (roomMatch) {
        const code = roomMatch[1];
        const db = readDb();
        const room = db.rooms[code];
        if (!room) return sendJson(res, 404, { error: '房间不存在，请检查房间码' });
        if (req.method === 'GET') return sendJson(res, 200, room);
        if (req.method === 'DELETE') {
          delete db.rooms[code];
          writeDb(db);
          return sendJson(res, 200, { ok: true });
        }
      }

      const dishMatch = p.match(/^\/api\/rooms\/([A-Z0-9]{4})\/dishes$/);
      if (dishMatch && req.method === 'POST') {
        const code = dishMatch[1];
        const db = readDb();
        const room = db.rooms[code];
        if (!room) return sendJson(res, 404, { error: '房间不存在' });
        const b = await readBody(req);
        const name = sanitize(b.name, 60);
        if (!name) return sendJson(res, 400, { error: '菜名不能为空' });
        const dish = {
          id: uid('d'),
          name,
          category: sanitize(b.category, 30) || '其他',
          by: sanitize(b.by, 30),
          createdAt: new Date().toISOString()
        };
        if (b.image) {
          const rel = saveImage(b.image, code, dish.id);
          if (rel) dish.image = rel;
        }
        room.dishes.push(dish);
        writeDb(db);
        return sendJson(res, 201, dish);
      }

      const dishImg = p.match(/^\/api\/rooms\/([A-Z0-9]{4})\/dishes\/(\w+)\/image$/);
      if (dishImg && req.method === 'POST') {
        const code = dishImg[1];
        const db = readDb();
        const room = db.rooms[code];
        if (!room) return sendJson(res, 404, { error: '房间不存在' });
        const dish = room.dishes.find((d) => d.id === dishImg[2]);
        if (!dish) return sendJson(res, 404, { error: '菜品不存在' });
        const b = await readBody(req);
        if (b.image) {
          const rel = saveImage(b.image, code, dish.id);
          if (!rel) return sendJson(res, 400, { error: '图片格式不支持或过大（≤4MB）' });
          if (dish.image && dish.image !== rel) removeImageFile(dish.image);
          dish.image = rel;
        } else {
          removeImageFile(dish.image);
          delete dish.image;
        }
        writeDb(db);
        return sendJson(res, 200, dish);
      }

      const dishDel = p.match(/^\/api\/rooms\/([A-Z0-9]{4})\/dishes\/(\w+)$/);
      if (dishDel && req.method === 'DELETE') {
        const code = dishDel[1];
        const db = readDb();
        const room = db.rooms[code];
        if (!room) return sendJson(res, 404, { error: '房间不存在' });
        const before = room.dishes.length;
        room.dishes = room.dishes.filter((d) => {
          if (d.id !== dishDel[2]) return true;
          if (d.image) removeImageFile(d.image);
          return false;
        });
        writeDb(db);
        return sendJson(res, 200, { ok: before !== room.dishes.length });
      }

      const resvMatch = p.match(/^\/api\/rooms\/([A-Z0-9]{4})\/reservations$/);
      if (resvMatch && req.method === 'POST') {
        const code = resvMatch[1];
        const db = readDb();
        const room = db.rooms[code];
        if (!room) return sendJson(res, 404, { error: '房间不存在' });
        const b = await readBody(req);
        const title = sanitize(b.title, 60) || '';
        const reservation = {
          id: uid('r'),
          title,
          date: sanitize(b.date, 20),
          meal: sanitize(b.meal, 4),
          note: sanitize(b.note, 300),
          dishes: Array.isArray(b.dishes) ? b.dishes.map((x) => sanitize(x, 60)).filter(Boolean) : [],
          by: sanitize(b.by, 30),
          createdAt: new Date().toISOString()
        };
        room.reservations.push(reservation);
        writeDb(db);
        return sendJson(res, 201, reservation);
      }

      // 预约的饭后点评
      const resvReview = p.match(/^\/api\/rooms\/([A-Z0-9]{4})\/reservations\/(\w+)\/review$/);
      if (resvReview && req.method === 'POST') {
        const code = resvReview[1];
        const db = readDb();
        const room = db.rooms[code];
        if (!room) return sendJson(res, 404, { error: '房间不存在' });
        const r = room.reservations.find((x) => x.id === resvReview[2]);
        if (!r) return sendJson(res, 404, { error: '预约不存在' });
        const b = await readBody(req);
        const review = { by: sanitize(b.by, 30), at: new Date().toISOString() };
        if (b.text != null) review.text = sanitize(b.text, 300);
        if (b.image !== undefined) {
          if (b.image === '') {
            removeImageFile(r.review && r.review.image);
          } else {
            const rel = saveImage(b.image, code, 'r' + r.id);
            if (!rel) return sendJson(res, 400, { error: '图片格式不支持或过大（≤4MB）' });
            removeImageFile(r.review && r.review.image);
            review.image = rel;
          }
        } else if (r.review && r.review.image) {
          review.image = r.review.image;
        }
        r.review = review;
        writeDb(db);
        return sendJson(res, 200, r);
      }

      // 删除点菜记录（含其点评与图片）
      const resvDel = p.match(/^\/api\/rooms\/([A-Z0-9]{4})\/reservations\/(\w+)$/);
      if (resvDel && req.method === 'DELETE') {
        const code = resvDel[1];
        const db = readDb();
        const room = db.rooms[code];
        if (!room) return sendJson(res, 404, { error: '房间不存在' });
        const r = room.reservations.find((x) => x.id === resvDel[2]);
        if (!r) return sendJson(res, 404, { error: '点菜记录不存在' });
        if (r.review && r.review.image) removeImageFile(r.review.image);
        room.reservations = room.reservations.filter((x) => x.id !== resvDel[2]);
        writeDb(db);
        return sendJson(res, 200, { ok: true });
      }

      const rateMatch = p.match(/^\/api\/rooms\/([A-Z0-9]{4})\/ratings$/);
      if (rateMatch && req.method === 'POST') {
        const code = rateMatch[1];
        const db = readDb();
        const room = db.rooms[code];
        if (!room) return sendJson(res, 404, { error: '房间不存在' });
        const b = await readBody(req);
        const score = Number(b.score);
        if (!(score >= 1 && score <= 5)) return sendJson(res, 400, { error: '评分需在 1-5 之间' });
        const dish = room.dishes.find((d) => d.id === b.dishId);
        if (!dish) return sendJson(res, 404, { error: '菜品不存在' });
        const rating = {
          id: uid('s'),
          dishId: b.dishId,
          score,
          note: sanitize(b.note, 200),
          by: sanitize(b.by, 30),
          at: new Date().toISOString()
        };
        room.ratings.push(rating);
        writeDb(db);
        return sendJson(res, 201, rating);
      }

      return sendJson(res, 404, { error: '接口不存在' });
    }

    // ---------------- PWA：图标 & manifest（需在静态文件之前） ----------------
    if (p === '/icon.png') return serveIcon(res);
    if (p === '/manifest.webmanifest') return serveManifest(res);

    // ---------------- 静态文件 ----------------
    let filePath = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
    filePath = path.normalize(filePath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403); return res.end('Forbidden');
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // 单页应用兜底
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    sendJson(res, 500, { error: '服务器错误', detail: String(e && e.message || e) });
  }
});

ensureUploads();
server.listen(PORT, () => {
  console.log(`情侣点菜系统已启动: http://localhost:${PORT}`);
});
