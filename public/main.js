// Overlay client: receives authoritative state + events over WebSocket and animates them.
import { Arena } from './arena.js';
import { Fx } from './fx.js';
import { drawPlayer, drawBoss } from './sprites.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const arena = new Arena();
const fx = new Fx();
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (k) => k * k * (3 - 2 * k);
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (n) => (n >= 10000 ? compact.format(n) : String(Math.round(n)));
const FONT = '"Trebuchet MS", system-ui, sans-serif';

let S = null; // latest server snapshot
let connected = false;
let dpr = 1;

// View state: everything here is presentation only and can be rebuilt from S.
const V = {
  t: 0,
  swings: [], // queued like attacks, each entry = buffed flag
  swing: -1, swingBuffed: false, swingHit: false, swingDur: 0.2, swingId: 0,
  cast: -1, hurt: 0,
  bossHit: 0, bossAttack: -1, bossSpawn: 1,
  evolve: -1, evolveFrom: 1,
  hpPlayer: 1, hpBoss: 1, ghostPlayer: 1, ghostBoss: 1,
  buffEndAt: 0,
  trail: [],
  timers: [],
  banner: null,
  playerPose: null, bossPose: null,
};

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

// Works for both landscape (OBS 1920x1080) and portrait (1080x1920) scenes.
function layout() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  return { w, h, u: Math.min(w / 6.5, h / 6.2), floorY: h * 0.74, px: w * 0.27, bx: w * 0.72 };
}

const after = (delay, fn) => V.timers.push({ at: V.t + delay, fn });
const buffActive = () => performance.now() < V.buffEndAt;

function showBanner(text, sub, dur, big) {
  if (V.banner?.big && !big && V.banner.t < V.banner.dur) return; // never cover an evolution
  V.banner = { text, sub, dur, big, t: 0 };
}

// ---------------------------------------------------------------- events

function onLikeImpact(buffed) {
  const L = layout();
  const c = V.bossPose?.center ?? { x: L.bx, y: L.floorY - L.u * 1.5 };
  const x = c.x + rand(-0.5, 0.3) * L.u;
  const y = c.y + rand(-0.6, 0.6) * L.u;
  const stage = S.player_stage;
  V.bossHit = Math.max(V.bossHit, 0.45);

  if (buffed) {
    fx.slash(x, y, L.u * 0.75, '#ff9a2e', L.u * 0.07);
    fx.burst(x, y, { n: 10, speed: L.u * 2.2, size: L.u * 0.03, hue: 25, hueVar: 18, life: 0.5 });
  } else if (stage >= 2) {
    // Stage 1 deliberately has no hit VFX at all.
    fx.slash(x, y, L.u * 0.55, ['', '', '#ffffff', '#8ff6ff', '#ffe08a'][stage], L.u * 0.045);
  }
  if (stage >= 3) fx.burst(x, y, { n: 9, speed: L.u * 2.6, size: L.u * 0.018, hue: stage === 3 ? 185 : 48, lit: 80, life: 0.35, g: 500 });
  if (stage >= 4) fx.explosion(x, y, L.u * 0.28, buffed ? 20 : 42);
}

function onGiftStrike(e) {
  const L = layout();
  const c = V.bossPose?.center ?? { x: L.bx, y: L.floorY - L.u * 1.5 };
  V.bossHit = 1;
  if (e.tier === 'lightning') {
    fx.bolt(c.x, 0, c.y, 200, L.u * 0.03);
    fx.explosion(c.x, c.y, L.u * 0.55, 200);
    fx.shake = 8;
  } else if (e.tier === 'explosion') {
    fx.bolt(c.x, 0, c.y, 40, L.u * 0.04);
    fx.explosion(c.x, c.y, L.u * 1.0, 25);
    fx.shake = 14;
    fx.flash = 0.25;
  } else {
    for (let i = 0; i < 4; i++) {
      after(i * 0.09, () => {
        const x = c.x + rand(-0.8, 0.8) * L.u;
        fx.bolt(x, 0, c.y + rand(-0.4, 0.6) * L.u, 285, L.u * 0.045);
        fx.explosion(x, c.y + rand(-0.4, 0.4) * L.u, L.u * 0.7, 285);
      });
    }
    fx.explosion(c.x, c.y, L.u * 1.7, 300);
    fx.shake = 22;
    fx.flash = 0.6;
  }
  fx.text(c.x, c.y - L.u * 1.2, `-${fmt(e.damage)}`, '#ffe066', L.u * 0.34);
  fx.text(c.x, c.y - L.u * 1.75, `${e.user}: ${e.gift}`, '#ffffff', L.u * 0.15);
}

const handlers = {
  attack(e, L) {
    const boss = V.bossPose?.center ?? { x: L.bx, y: L.floorY - L.u * 1.5 };
    if (e.kind === 'like') {
      // A batch of taps plays as a short combo, not one swing per tap.
      for (let i = 0; i < Math.min(e.hits, 5) && V.swings.length < 10; i++) V.swings.push(e.buffed);
      arena.addEnergy(e.hits);
      fx.text(boss.x, boss.y - L.u * 0.7, `-${fmt(e.damage)}`, e.buffed ? '#ffae42' : '#ffffff', L.u * (e.buffed ? 0.2 : 0.16));
    } else if (e.tier === 'minor') {
      V.swings.push(buffActive());
      fx.text(boss.x, boss.y - L.u, `-${fmt(e.damage)}`, '#ffe066', L.u * 0.22);
    } else {
      V.cast = 0;
      arena.wave(e.tier === 'nova' ? 1 : e.tier === 'explosion' ? 0.7 : 0.45);
      after(0.25, () => onGiftStrike(e));
    }
  },
  heal(e, L) {
    const c = V.playerPose?.center ?? { x: L.px, y: L.floorY - L.u };
    fx.burst(c.x, c.y + L.u * 0.5, { n: 26, speed: L.u * 0.8, radius: L.u * 0.4, size: L.u * 0.03, hue: 130, lit: 70, life: 1.1, g: -L.u * 1.4 });
    fx.ring(c.x, c.y, L.u * 0.9, '#7dffa0', 0.6, 5);
    if (e.amount > 0) fx.text(c.x, c.y - L.u * 1.1, `+${fmt(e.amount)} HP`, '#7dffa0', L.u * 0.2);
  },
  buff(e, L) {
    const c = V.playerPose?.center ?? { x: L.px, y: L.floorY - L.u };
    fx.pillar(c.x, L.floorY, L.u * 0.9, 25);
    fx.burst(c.x, c.y, { n: 40, speed: L.u * 2.4, size: L.u * 0.035, hue: 25, hueVar: 20, life: 0.9, g: -L.u });
    showBanner(`${e.name}!`, `LIKES DEAL x2 DAMAGE FOR ${Math.round(e.duration_ms / 1000)}s`, 2.2, false);
  },
  bossAttack(e, L) {
    V.bossAttack = 0;
    after(0.25, () => {
      const c = V.playerPose?.center ?? { x: L.px, y: L.floorY - L.u };
      V.hurt = 1;
      fx.shake = Math.max(fx.shake, 6);
      fx.slash(c.x, c.y, L.u * 0.6, '#ff4d4d', L.u * 0.06);
      fx.burst(c.x, c.y, { n: 12, speed: L.u * 1.8, size: L.u * 0.025, hue: 0, life: 0.45 });
      fx.text(c.x, c.y - L.u * 1.1, `-${fmt(e.damage)}`, '#ff6b6b', L.u * 0.2);
    });
  },
  bossDefeated(e, L) {
    const p = V.bossPose ?? { center: { x: L.bx, y: L.floorY - L.u * 1.5 }, hue: 265 };
    fx.explosion(p.center.x, p.center.y, L.u * 1.8, p.hue);
    fx.burst(p.center.x, p.center.y, { n: 60, speed: L.u * 4, size: L.u * 0.05, hue: p.hue, hueVar: 30, life: 1.2, g: L.u * 2 });
    fx.shake = Math.max(fx.shake, 16);
    fx.flash = Math.max(fx.flash, 0.3);
    V.bossSpawn = 0;
    V.ghostBoss = 0;
    showBanner('BOSS DEFEATED!', `BOSS LEVEL ${e.boss_level} RISES`, 1.8, false);
  },
  evolved(e, L) {
    V.evolve = 0;
    V.evolveFrom = e.from;
    fx.pillar(L.px, L.floorY, L.u * 1.4, 48);
    fx.flash = 0.5;
    showBanner(`CHARACTER EVOLVED TO STAGE ${e.stage}!`, e.name.toUpperCase(), 4.6, true);
    for (let i = 0; i < 16; i++) {
      after(0.2 + i * 0.26, () => fx.rocket(rand(0.08, 0.92) * L.w, L.h, rand(0.14, 0.45) * L.h, rand(0, 360)));
    }
  },
  playerDown() {
    fx.shake = 18;
  },
  revived(e, L) {
    fx.pillar(L.px, L.floorY, L.u, 130);
  },
};

function onSync(msg) {
  const first = !S;
  S = msg.state;
  V.buffEndAt = S.buff_active ? performance.now() + S.buff_remaining_ms : 0;
  if (first) {
    V.hpPlayer = V.ghostPlayer = S.player_hp / S.player_max_hp;
    V.hpBoss = V.ghostBoss = S.boss_hp / S.boss_max_hp;
  }
  const L = layout();
  for (const e of msg.events) handlers[e.type]?.(e, L);
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => (connected = true);
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.t === 'sync') onSync(msg);
  };
  ws.onclose = () => {
    connected = false;
    setTimeout(connect, 1500);
  };
}
connect();

// ---------------------------------------------------------------- update

function update(dt) {
  V.t += dt;
  arena.update(dt);
  fx.update(dt);

  const due = V.timers.filter((tm) => tm.at <= V.t);
  V.timers = V.timers.filter((tm) => tm.at > V.t);
  for (const tm of due) tm.fn();

  if (!S) return;
  const L = layout();

  if (V.swing < 0 && V.swings.length && !S.player_down) {
    V.swing = 0;
    V.swingId++;
    V.swingBuffed = V.swings.shift();
    V.swingHit = false;
    V.swingDur = V.swings.length > 3 ? 0.12 : 0.2; // speed up to drain a like storm
  }
  if (V.swing >= 0) {
    V.swing += dt / V.swingDur;
    if (!V.swingHit && V.swing >= 0.5) {
      V.swingHit = true;
      onLikeImpact(V.swingBuffed);
    }
    if (V.swing >= 1) V.swing = -1;
  }
  if (V.cast >= 0 && (V.cast += dt / 0.6) >= 1) V.cast = -1;
  if (V.bossAttack >= 0 && (V.bossAttack += dt / 0.5) >= 1) V.bossAttack = -1;
  if (V.evolve >= 0 && (V.evolve += dt / 1.6) >= 1) V.evolve = -1;
  V.hurt = Math.max(0, V.hurt - dt * 3.5);
  V.bossHit = Math.max(0, V.bossHit - dt * 5);
  V.bossSpawn = Math.min(1, V.bossSpawn + dt * 2.5);

  // HP bars ease toward the real value; the "ghost" chunk shows recent damage.
  const tp = S.player_hp / S.player_max_hp;
  const tb = S.boss_hp / S.boss_max_hp;
  V.hpPlayer += (tp - V.hpPlayer) * Math.min(1, dt * 12);
  V.hpBoss += (tb - V.hpBoss) * Math.min(1, dt * 12);
  V.ghostPlayer = V.ghostPlayer > tp ? Math.max(tp, V.ghostPlayer - dt * 0.35) : tp;
  V.ghostBoss = V.ghostBoss > tb ? Math.max(tb, V.ghostBoss - dt * 0.35) : tb;

  if (V.banner && (V.banner.t += dt) >= V.banner.dur) V.banner = null;

  // Sword trail (stage 2+ or buffed) and continuous aura particles.
  for (const p of V.trail) p.age += dt;
  V.trail = V.trail.filter((p) => p.age < 0.2);
  const pose = V.playerPose;
  const buffed = buffActive();
  if (pose && !S.player_down) {
    if (V.swing >= 0 && (S.player_stage >= 2 || V.swingBuffed)) V.trail.push({ ...pose.tip, age: 0, buffed: V.swingBuffed, id: V.swingId });
    if (buffed && Math.random() < 0.7) {
      const k = Math.random();
      fx.burst(pose.hand.x + (pose.tip.x - pose.hand.x) * k, pose.hand.y + (pose.tip.y - pose.hand.y) * k,
        { n: 1, speed: L.u * 0.3, size: L.u * 0.03, hue: 25, hueVar: 18, life: 0.5, g: -L.u * 1.5 });
    }
    if (S.player_stage === 3 && Math.random() < 0.15) {
      fx.burst(pose.center.x, pose.center.y, { n: 1, radius: L.u * 0.6, speed: L.u * 0.3, size: L.u * 0.015, hue: 185, lit: 80, life: 0.6, g: -L.u * 0.5 });
    }
    if (S.player_stage === 4 && Math.random() < 0.5) {
      fx.burst(pose.center.x - L.u * 0.3, pose.center.y - L.u * 0.5, { n: 1, radius: L.u * 0.9, speed: L.u * 0.4, size: L.u * 0.022, hue: 38, hueVar: 14, life: 0.9, g: -L.u * 1.2 });
    }
  }
}

// ---------------------------------------------------------------- draw

function drawTrail(L) {
  if (V.trail.length < 2) return;
  const color = ['', '255,255,255', '255,255,255', '120,245,255', '255,215,110'][S.player_stage];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 1; i < V.trail.length; i++) {
    const a = V.trail[i - 1];
    const b = V.trail[i];
    if (a.id !== b.id) continue; // never bridge two separate swings
    const k = 1 - b.age / 0.2;
    ctx.strokeStyle = `rgba(${b.buffed ? '255,140,40' : color},${0.6 * k})`;
    ctx.lineWidth = L.u * (b.buffed ? 0.13 : 0.09) * k;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function bar(x, y, w, h, value, ghost, colors, mirrored) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,6,26,0.78)';
  ctx.beginPath();
  ctx.roundRect(x - 3, y - 3, w + 6, h + 6, h / 2 + 3);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.clip();
  const fill = (v, style) => {
    ctx.fillStyle = style;
    const fw = w * Math.max(0, Math.min(1, v));
    ctx.fillRect(mirrored ? x + w - fw : x, y, fw, h);
  };
  fill(ghost, 'rgba(255,255,255,0.75)');
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  fill(value, g);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x, y, w, h * 0.35);
  ctx.restore();
}

function label(text, x, y, size, align, color = '#fff') {
  ctx.font = `800 ${Math.round(size)}px ${FONT}`;
  ctx.textAlign = align;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.22);
  ctx.strokeStyle = 'rgba(8,6,26,0.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawHud(L) {
  const { w, u } = L;
  const pad = u * 0.2;
  const centerW = u * 1.5;
  const barW = (w - pad * 2 - centerW) / 2 - pad * 0.5;
  const barH = u * 0.2;
  const y = pad + u * 0.26;
  const small = u * 0.15;

  label(`STAGE ${S.player_stage} · ${S.stage_name.toUpperCase()}`, pad, y - u * 0.08, small, 'left', '#bfe8ff');
  bar(pad, y, barW, barH, V.hpPlayer, V.ghostPlayer, ['#6dff9a', '#12a150'], false);
  label(`${fmt(S.player_hp)} / ${fmt(S.player_max_hp)}`, pad + barW / 2, y + barH * 0.78, barH * 0.72, 'center');

  const bx = w - pad - barW;
  label('BOSS', w - pad, y - u * 0.08, small, 'right', '#ffc2c2');
  bar(bx, y, barW, barH, V.hpBoss, V.ghostBoss, ['#ff7a7a', '#c21a3a'], true);
  label(`${fmt(S.boss_hp)} / ${fmt(S.boss_max_hp)}`, bx + barW / 2, y + barH * 0.78, barH * 0.72, 'center');

  label('BOSS LEVEL', w / 2, pad + u * 0.14, small * 0.9, 'center', '#ffe9a8');
  label(String(S.boss_level), w / 2, pad + u * 0.56, u * 0.42, 'center', '#ffd75e');

  const remaining = (V.buffEndAt - performance.now()) / 1000;
  if (remaining > 0) {
    const bw = Math.min(w - pad * 2, u * 3.6);
    const by = y + barH + u * 0.36;
    bar(w / 2 - bw / 2, by, bw, u * 0.1, remaining / (S.buff_duration_ms / 1000), 0, ['#ffd166', '#ff5a1f'], false);
    label(`${S.buff_name} · LIKES x${S.like_damage} · ${Math.ceil(remaining)}s`, w / 2, by - u * 0.07, small, 'center', '#ffb347');
  }
}

function drawBanner(L) {
  const b = V.banner;
  if (!b) return;
  const { w, h, u } = L;
  const k = Math.min(1, b.t / 0.35);
  const scale = 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2; // ease-out-back pop
  const alpha = Math.min(1, (b.dur - b.t) / 0.5);
  let size = u * (b.big ? 0.5 : 0.34);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(w / 2, h * (b.big ? 0.36 : 0.3));
  ctx.scale(scale, scale);
  ctx.font = `900 ${size}px ${FONT}`;
  const tw = ctx.measureText(b.text).width;
  if (tw > w * 0.9) size *= (w * 0.9) / tw;
  if (b.big) {
    const band = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    band.addColorStop(0, 'rgba(10,6,40,0)');
    band.addColorStop(0.5, 'rgba(10,6,40,0.72)');
    band.addColorStop(1, 'rgba(10,6,40,0)');
    ctx.fillStyle = band;
    ctx.fillRect(-w / 2, -size * 1.25, w, size * 2.6);
  }
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = '#1a0f3d';
  ctx.strokeText(b.text, 0, 0);
  const g = ctx.createLinearGradient(0, -size, 0, size * 0.2);
  g.addColorStop(0, '#fffbe0');
  g.addColorStop(1, b.big ? '#ffb92e' : '#ff8a3d');
  ctx.fillStyle = g;
  ctx.shadowColor = b.big ? '#ffcf5e' : '#ff7a2e';
  ctx.shadowBlur = 30;
  ctx.fillText(b.text, 0, 0);
  ctx.shadowBlur = 0;
  if (b.sub) label(b.sub, 0, size * 0.85, size * 0.5, 'center', '#bff3ff');
  ctx.restore();
}

function draw() {
  const L = layout();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.save();
  if (fx.shake > 0) ctx.translate(rand(-1, 1) * fx.shake, rand(-1, 1) * fx.shake);

  arena.drawBack(ctx, L);

  if (S) {
    V.bossPose = drawBoss(ctx, {
      x: L.bx, y: L.floorY, u: L.u, level: S.boss_level, t: V.t,
      hit: V.bossHit, attack: V.bossAttack, spawn: 0.2 + 0.8 * smooth(V.bossSpawn),
    });

    const base = {
      x: L.px, y: L.floorY, u: L.u, t: V.t, swing: V.swing, cast: V.cast, hurt: V.hurt,
      buffed: V.swing >= 0 ? V.swingBuffed : buffActive(), down: S.player_down,
    };
    drawTrail(L);
    if (V.evolve >= 0) {
      // Cross-fade the old form into the new one inside the light pillar.
      const k = smooth(Math.min(1, V.evolve * 1.6));
      if (k < 1) drawPlayer(ctx, { ...base, stage: V.evolveFrom, alpha: 1 - k });
      V.playerPose = drawPlayer(ctx, { ...base, stage: S.player_stage, alpha: k });
    } else {
      V.playerPose = drawPlayer(ctx, { ...base, stage: S.player_stage });
    }
  }

  fx.draw(ctx, L.w, L.h);
  arena.drawFront(ctx, L);
  ctx.restore();

  if (S) {
    drawHud(L);
    if (S.player_down) {
      ctx.fillStyle = 'rgba(30,0,10,0.45)';
      ctx.fillRect(0, 0, L.w, L.h);
      label('HERO DOWN', L.w / 2, L.h * 0.42, L.u * 0.5, 'center', '#ff6b6b');
      label(`REVIVING IN ${Math.ceil(S.revive_in_ms / 1000)}s · SEND A 10+ COIN GIFT TO REVIVE NOW`, L.w / 2, L.h * 0.42 + L.u * 0.3,
        Math.min(L.u * 0.17, L.w * 0.026), 'center');
    }
    drawBanner(L);
  }
  if (!connected) label('connecting…', L.u * 0.2, L.h - L.u * 0.2, L.u * 0.14, 'left', '#aaa');
}

let last = performance.now();
function frame(ms) {
  const dt = Math.min(0.05, (ms - last) / 1000);
  last = ms;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- simulator panel (?debug=1)

if (new URLSearchParams(location.search).has('debug')) {
  const panel = document.getElementById('debug');
  panel.style.display = 'flex';
  const send = (body) => fetch('/api/sim', { method: 'POST', body: JSON.stringify(body) });
  let spam = null;
  panel.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.dataset.sim) return send(JSON.parse(btn.dataset.sim));
    if (spam) {
      clearInterval(spam);
      spam = null;
    } else {
      spam = setInterval(() => send({ type: 'like', count: 3 + Math.floor(Math.random() * 10) }), 150);
    }
    btn.textContent = `Like spam: ${spam ? 'on' : 'off'}`;
  });
}
