const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
require('dotenv').config();
const express = require('express');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT) || 3000;
const PRODUCTION = process.env.NODE_ENV === 'production';
const PIN = process.env.MOD_PIN || (PRODUCTION ? '' : '2468');
const SECRET = process.env.SESSION_SECRET || (PRODUCTION ? '' : 'community-queue-local-secret-change-me');
if (PRODUCTION && (!PIN || !SECRET)) throw new Error('Set MOD_PIN and SESSION_SECRET in production.');

const dbPath = path.resolve(process.env.DB_PATH || './data/queue.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
function transaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
db.exec(`CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  joined_at TEXT NOT NULL,
  position INTEGER NOT NULL
)`);
const getAll = db.prepare('SELECT id, username, joined_at AS joinedAt, position FROM players ORDER BY position');

function sign(value) { return crypto.createHmac('sha256', SECRET).update(value).digest('base64url'); }
function makeToken() { const payload = `${Date.now() + 12 * 60 * 60 * 1000}`; return `${payload}.${sign(payload)}`; }
function validToken(req) {
  const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('cq_mod='))?.slice(7);
  if (!raw) return false;
  const [expires, mac] = raw.split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  const expected = Buffer.from(sign(expires)); const supplied = Buffer.from(mac);
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}
function requireMod(req, res, next) { if (!validToken(req)) return res.status(401).json({ error: 'Moderator session expired. Unlock the panel to continue.' }); next(); }
function normalizeUsername(input) {
  if (typeof input !== 'string') return null;
  const name = input.trim().replace(/^@+/, '');
  if (!/^[a-zA-Z0-9_]{1,25}$/.test(name)) return null;
  return { name, key: name.toLowerCase() };
}
function compact() { db.prepare('UPDATE players SET position = position - 1 WHERE position > ?').run(0); }
function state() { return { players: getAll.all() }; }
function broadcast() {
  const snapshot = state();
  io.emit('queue:state', snapshot);
  io.to('mods').emit('queue:mod-state', snapshot);
}
function sendError(res, status, error) { return res.status(status).json({ error }); }

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/queue', (_req, res) => res.json(state()));
app.get('/mod', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'mod.html')));
app.get('/display', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));

app.post('/api/join', (req, res) => {
  const user = normalizeUsername(req.body?.username);
  if (!user) return sendError(res, 400, 'Enter a Twitch username using letters, numbers, or underscores.');
  if (db.prepare('SELECT 1 FROM players WHERE username_key = ?').get(user.key)) return sendError(res, 409, `@${user.name} is already in the queue.`);
  const players = getAll.all();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO players (id, username, username_key, joined_at, position) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), user.name, user.key, now, players.length);
  broadcast();
  res.status(201).json({ ...state(), message: `@${user.name} joined the queue.` });
});

app.post('/api/mod/login', (req, res) => {
  const supplied = String(req.body?.pin || '');
  const a = Buffer.from(supplied); const b = Buffer.from(PIN);
  if (!PIN || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return sendError(res, 401, 'That PIN did not match.');
  res.setHeader('Set-Cookie', `cq_mod=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${PRODUCTION ? '; Secure' : ''}`);
  res.json({ ok: true, ...state() });
});
app.post('/api/mod/logout', requireMod, (_req, res) => {
  res.setHeader('Set-Cookie', `cq_mod=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${PRODUCTION ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.get('/api/mod/queue', requireMod, (_req, res) => res.json(state()));

app.post('/api/mod/finish', requireMod, (_req, res) => {
  db.prepare('DELETE FROM players WHERE position = 0').run(); compact();
  broadcast(); res.json(state());
});
app.post('/api/mod/remove/:id', requireMod, (req, res) => {
  const row = db.prepare('SELECT position FROM players WHERE id = ?').get(req.params.id);
  if (!row) return sendError(res, 404, 'That player is no longer in the queue.');
  db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  db.prepare('UPDATE players SET position = position - 1 WHERE position > ?').run(row.position);
  broadcast(); res.json(state());
});
app.post('/api/mod/move/:id/:direction', requireMod, (req, res) => {
  const row = db.prepare('SELECT position FROM players WHERE id = ?').get(req.params.id);
  if (!row) return sendError(res, 404, 'That player is no longer in the queue.');
  if (row.position === 0) return sendError(res, 400, 'The current player cannot be moved this way.');
  const delta = req.params.direction === 'up' ? -1 : req.params.direction === 'down' ? 1 : 0;
  if (!delta) return sendError(res, 400, 'Choose up or down.');
  const target = row.position + delta;
  if (target < 1 || target >= getAll.all().length) return sendError(res, 400, 'That player is already at the edge of the queue.');
  const swap = () => transaction(() => {
    db.prepare('UPDATE players SET position = -1 WHERE position = ?').run(row.position);
    db.prepare('UPDATE players SET position = ? WHERE position = ?').run(row.position, target);
    db.prepare('UPDATE players SET position = ? WHERE position = -1').run(target);
  });
  swap(); broadcast(); res.json(state());
});
app.post('/api/mod/current-to-end', requireMod, (_req, res) => {
  const players = getAll.all();
  if (players.length > 1) {
    const rotate = () => transaction(() => {
      db.prepare('UPDATE players SET position = -1 WHERE position = 0').run();
      db.prepare('UPDATE players SET position = position - 1 WHERE position > 0').run();
      db.prepare('UPDATE players SET position = ? WHERE position = -1').run(players.length - 1);
    });
    rotate();
  }
  broadcast(); res.json(state());
});
app.post('/api/mod/clear', requireMod, (_req, res) => {
  db.prepare('DELETE FROM players').run(); broadcast(); res.json(state());
});

io.use((socket, next) => {
  const fakeReq = { headers: { cookie: socket.handshake.headers.cookie || '' } };
  if (validToken(fakeReq)) socket.data.isMod = true;
  next();
});
io.on('connection', socket => {
  socket.emit('queue:state', state());
  if (socket.data.isMod) { socket.join('mods'); socket.emit('queue:mod-state', state()); }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Community Queue listening on ${PORT}`));
