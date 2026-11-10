import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameState } from './gameState.js';
import { connectTikTok } from './tiktok.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const USERNAME = (process.env.TIKTOK_USERNAME || '').replace(/^@/, '');
// The simulator can rewrite game state, so it is off whenever a real stream is attached.
const SIM_ENABLED = process.env.ENABLE_SIM === '1' || !USERNAME;
const SIM_AUTO = process.env.SIM_AUTO === '1';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const game = new GameState();
let pending = [];
game.on('event', (e) => pending.push(e));

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function simulate(cmd) {
  switch (cmd.type) {
    case 'like': return game.onLike(cmd.count ?? 1, cmd.user ?? 'sim');
    case 'gift': return game.onGift({ coins: cmd.coins ?? 1, name: cmd.name ?? 'Gift', repeat: cmd.repeat ?? 1, user: cmd.user ?? 'sim' });
    case 'level': return game.debugSetBossLevel(Number(cmd.level) || 0);
    case 'reset': return game.reset();
    default: throw new Error(`unknown sim type: ${cmd.type}`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/api/state') return json(200, game.snapshot());

  if (url.pathname === '/api/sim') {
    if (!SIM_ENABLED) return json(403, { error: 'simulator disabled' });
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    try {
      simulate(await readJson(req));
      return json(200, game.snapshot());
    } catch (err) {
      return json(400, { error: err.message });
    }
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    json(404, { error: 'not found' });
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ t: 'sync', state: game.snapshot(), events: [], sim: SIM_ENABLED }));
});

// One loop drives the timers and batches events, so a like storm costs one
// small frame per 50 ms instead of one message per tap.
let lastStateAt = 0;
setInterval(() => {
  const now = Date.now();
  game.tick(now);
  if (!pending.length && now - lastStateAt < 500) return;
  const msg = JSON.stringify({ t: 'sync', state: game.snapshot(now), events: pending });
  pending = [];
  lastStateAt = now;
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
}, 50);

if (USERNAME) {
  connectTikTok(game, USERNAME, { signApiKey: process.env.EULER_API_KEY });
} else {
  console.log('[game] TIKTOK_USERNAME not set, running with the simulator only');
}

if (SIM_AUTO) {
  // Fake audience for demos and soak testing.
  setInterval(() => game.onLike(1 + Math.floor(Math.random() * 12)), 250);
  setInterval(() => {
    const r = Math.random();
    if (r < 0.3) game.onGift({ coins: 1, name: 'Rose' });
    else if (r < 0.7) game.onGift({ coins: 5 + Math.floor(Math.random() * 25), name: 'Gift' });
    else game.onGift({ coins: 99 + Math.floor(Math.random() * 400), name: 'Gift' });
  }, 7000);
}

server.listen(PORT, HOST, () => {
  console.log(`[game] overlay: http://${HOST}:${PORT}/${SIM_ENABLED ? '  (add ?debug=1 for the simulator panel)' : ''}`);
});
