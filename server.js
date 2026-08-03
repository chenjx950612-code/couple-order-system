'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png'
};

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ rooms: {} }, null, 2));
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
      if (data.length > 1e6) req.destroy();
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    // ---------------- API ----------------
    if (p.startsWith('/api/')) {
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
          category: sanitize(b.category, 30),
          restaurant: sanitize(b.restaurant, 60),
          by: sanitize(b.by, 30),
          createdAt: new Date().toISOString()
        };
        room.dishes.push(dish);
        writeDb(db);
        return sendJson(res, 201, dish);
      }

      const dishDel = p.match(/^\/api\/rooms\/([A-Z0-9]{4})\/dishes\/(\w+)$/);
      if (dishDel && req.method === 'DELETE') {
        const code = dishDel[1];
        const db = readDb();
        const room = db.rooms[code];
        if (!room) return sendJson(res, 404, { error: '房间不存在' });
        const before = room.dishes.length;
        room.dishes = room.dishes.filter((d) => d.id !== dishDel[2]);
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
        const title = sanitize(b.title, 60) || '约饭';
        const reservation = {
          id: uid('r'),
          title,
          restaurant: sanitize(b.restaurant, 60),
          datetime: sanitize(b.datetime, 40),
          note: sanitize(b.note, 300),
          dishes: Array.isArray(b.dishes) ? b.dishes.map((x) => sanitize(x, 60)).filter(Boolean) : [],
          by: sanitize(b.by, 30),
          status: 'planned',
          createdAt: new Date().toISOString()
        };
        room.reservations.push(reservation);
        writeDb(db);
        return sendJson(res, 201, reservation);
      }

      const resvDone = p.match(/^\/api\/rooms\/([A-Z0-9]{4})\/reservations\/(\w+)\/complete$/);
      if (resvDone && req.method === 'POST') {
        const code = resvDone[1];
        const db = readDb();
        const room = db.rooms[code];
        if (!room) return sendJson(res, 404, { error: '房间不存在' });
        const r = room.reservations.find((x) => x.id === resvDone[2]);
        if (!r) return sendJson(res, 404, { error: '预约不存在' });
        r.status = 'done';
        writeDb(db);
        return sendJson(res, 200, r);
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

server.listen(PORT, () => {
  console.log(`情侣点菜系统已启动: http://localhost:${PORT}`);
});
