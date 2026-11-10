// Celestial Colosseum: sky, mountains, clouds, floating stone platforms, runes, ambient motes.
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A rune is a few strokes between points of a 3x3 grid.
function makeGlyph(r) {
  const segs = [];
  let p = Math.floor(r() * 9);
  for (let i = 0; i < 5; i++) {
    let q = Math.floor(r() * 9);
    if (q === p) q = (q + 4) % 9;
    segs.push([p % 3, Math.floor(p / 3), q % 3, Math.floor(q / 3)]);
    p = q;
  }
  return segs;
}

function strokeGlyph(ctx, glyph, size) {
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of glyph) {
    ctx.moveTo((x1 - 1) * size, (y1 - 1) * size);
    ctx.lineTo((x2 - 1) * size, (y2 - 1) * size);
  }
  ctx.stroke();
}

// Clouds are pre-rendered once; drawing soft gradients per frame is too slow.
function makeCloudSprite(r) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 200;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const x = 80 + r() * 352;
    const y = 85 + r() * 55;
    const rad = 40 + r() * 45;
    const grad = g.createRadialGradient(x, y - rad * 0.2, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,250,255,0.55)');
    grad.addColorStop(0.6, 'rgba(235,215,250,0.22)');
    grad.addColorStop(1, 'rgba(220,200,250,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, rad * 1.5, rad, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export class Arena {
  constructor() {
    const r = rng(7);
    this.t = 0;
    this.energy = 0; // 0..1, pumped by likes, decays over time
    this.waves = [];
    this.stars = Array.from({ length: 110 }, () => ({ x: r(), y: r() * 0.55, s: 0.5 + r() * 1.5, p: r() * 6.28 }));
    this.cloudSprites = Array.from({ length: 4 }, () => makeCloudSprite(r));
    this.clouds = Array.from({ length: 9 }, (_, i) => ({
      x: r(), y: 0.12 + r() * 0.42, scale: 0.6 + r() * 0.9, speed: 0.004 + r() * 0.006, sprite: i % 4, alpha: 0.35 + r() * 0.4,
    }));
    this.seaClouds = Array.from({ length: 10 }, (_, i) => ({
      x: r(), y: 0.9 + r() * 0.1, scale: 1.2 + r() * 1.1, speed: 0.008 + r() * 0.01, sprite: i % 4, alpha: 0.6 + r() * 0.35,
    }));
    this.mountains = [
      { base: 0.7, amp: 0.46, color: '#7d66b3', f: [2.1, 5.3, 11.7], p: [r() * 9, r() * 9, r() * 9] },
      { base: 0.76, amp: 0.36, color: '#57448f', f: [3.2, 7.1, 15.3], p: [r() * 9, r() * 9, r() * 9] },
      { base: 0.84, amp: 0.26, color: '#372a69', f: [4.3, 9.7, 19.1], p: [r() * 9, r() * 9, r() * 9] },
    ];
    this.jags = Array.from({ length: 25 }, () => r());
    this.floorGlyphs = Array.from({ length: 14 }, () => makeGlyph(r));
    this.columnGlyphs = Array.from({ length: 10 }, () => makeGlyph(r));
    this.brokenBays = Array.from({ length: 9 }, () => r() < 0.4);
    this.islands = [
      { x: 0.07, y: 0.46, s: 0.55, column: true },
      { x: 0.94, y: 0.4, s: 0.62, column: true },
      { x: 0.2, y: 0.24, s: 0.3, column: false },
      { x: 0.81, y: 0.2, s: 0.34, column: true },
    ].map((isl) => ({ ...isl, phase: r() * 6.28, glyph: makeGlyph(r), jags: Array.from({ length: 9 }, () => r()) }));
    this.motes = Array.from({ length: 80 }, () => ({
      a: r() * 6.28, radius: 0.35 + r() * 0.65, speed: (0.08 + r() * 0.22) * (r() < 0.5 ? -1 : 1),
      height: r(), bob: r() * 6.28, size: 1 + r() * 2.2, hue: r() < 0.7 ? 185 + r() * 40 : 280 + r() * 50,
    }));
  }

  addEnergy(likes) {
    this.energy = Math.min(1, this.energy + likes * 0.045);
  }

  wave(power = 1) {
    this.waves.push({ t: 0, dur: 1.3, power });
  }

  update(dt) {
    this.t += dt;
    this.energy *= Math.exp(-dt * 0.8);
    for (const w of this.waves) w.t += dt;
    this.waves = this.waves.filter((w) => w.t < w.dur);
    for (const m of this.motes) m.a += m.speed * dt * (1 + this.energy * 2);
    for (const c of this.clouds) c.x = (c.x + c.speed * dt) % 1.4;
    for (const c of this.seaClouds) c.x = (c.x + c.speed * dt) % 1.4;
  }

  // Wave passing boosts rune glow on top of like energy.
  #glow() {
    let boost = 0;
    for (const w of this.waves) boost = Math.max(boost, (1 - w.t / w.dur) * w.power);
    return Math.min(1, this.energy + boost * 0.8);
  }

  #runeStyle(ctx, glow, scale) {
    ctx.strokeStyle = `hsla(${185 + 110 * glow},100%,${58 + 27 * glow}%,${0.4 + 0.6 * glow})`;
    ctx.shadowColor = `hsl(${185 + 110 * glow},100%,60%)`;
    ctx.shadowBlur = (5 + 34 * glow) * scale;
    ctx.lineCap = 'round';
  }

  #rock(ctx, cx, top, halfW, depth, jags) {
    const n = jags.length - 1;
    ctx.beginPath();
    ctx.moveTo(cx - halfW, top);
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const d = Math.sin(k * Math.PI) ** 0.75 * depth * (0.55 + 0.45 * jags[i]);
      ctx.lineTo(cx - halfW + 2 * halfW * k, top + d);
    }
    ctx.lineTo(cx + halfW, top);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, top, 0, top + depth);
    g.addColorStop(0, '#5d5578');
    g.addColorStop(1, '#1d1933');
    ctx.fillStyle = g;
    ctx.fill();
  }

  #clouds(ctx, list, w, h) {
    for (const c of list) {
      const sprite = this.cloudSprites[c.sprite];
      const cw = sprite.width * c.scale * (w / 1400 + 0.35);
      const ch = sprite.height * c.scale * (w / 1400 + 0.35);
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(sprite, (c.x - 0.2) * w - cw / 2, c.y * h - ch / 2, cw, ch);
    }
    ctx.globalAlpha = 1;
  }

  #motes(ctx, L, front) {
    const { w, u } = L;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const depth = Math.sin(m.a);
      if (depth >= 0 !== front) continue;
      const x = w / 2 + Math.cos(m.a) * m.radius * w * 0.5;
      const y = L.floorY - m.height * u * 3.4 + depth * u * 0.35 + Math.sin(this.t * 0.9 + m.bob) * u * 0.12;
      const size = m.size * (1 + depth * 0.35) * (u / 260 + 0.3);
      const a = (0.3 + 0.2 * depth + 0.25 * Math.sin(this.t * 2 + m.bob)) * (0.7 + this.energy * 0.6);
      ctx.fillStyle = `hsla(${m.hue},100%,75%,${Math.max(0.05, a)})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${m.hue},100%,70%,${Math.max(0.02, a * 0.18)})`;
      ctx.beginPath();
      ctx.arc(x, y, size * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawBack(ctx, L) {
    const { w, h, u, floorY } = L;
    const t = this.t;
    const glow = this.#glow();

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#07061f');
    sky.addColorStop(0.35, '#2a1f6b');
    sky.addColorStop(0.62, '#8a4f9f');
    sky.addColorStop(0.8, '#f09aa8');
    sky.addColorStop(1, '#ffd9a8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    for (const s of this.stars) {
      ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(t * 0.8 + s.p));
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x * w, s.y * h, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // Celestial orb with a halo ring.
    const ox = w * 0.5;
    const oy = h * 0.27;
    const or = u * 0.75;
    const halo = ctx.createRadialGradient(ox, oy, or * 0.3, ox, oy, or * 3.2);
    halo.addColorStop(0, 'rgba(255,240,220,0.9)');
    halo.addColorStop(0.25, 'rgba(255,200,230,0.35)');
    halo.addColorStop(1, 'rgba(180,140,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(ox - or * 3.2, oy - or * 3.2, or * 6.4, or * 6.4);
    ctx.strokeStyle = 'rgba(255,235,255,0.35)';
    ctx.lineWidth = Math.max(1, u * 0.012);
    ctx.beginPath();
    ctx.ellipse(ox, oy, or * 1.9, or * 0.5, -0.25, 0, Math.PI * 2);
    ctx.stroke();

    for (const m of this.mountains) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let px = 0; px <= w + 8; px += 8) {
        const k = px / w;
        const ridge =
          (1 - Math.abs(Math.sin(k * m.f[0] + m.p[0]))) * 0.55 +
          (1 - Math.abs(Math.sin(k * m.f[1] + m.p[1]))) * 0.3 +
          (1 - Math.abs(Math.sin(k * m.f[2] + m.p[2]))) * 0.15;
        ctx.lineTo(px, h * (m.base - m.amp * ridge));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = m.color;
      ctx.fill();
    }
    // Horizon haze so the mountains read as distant silhouettes.
    const haze = ctx.createLinearGradient(0, h * 0.5, 0, h);
    haze.addColorStop(0, 'rgba(255,170,190,0)');
    haze.addColorStop(1, 'rgba(255,200,190,0.5)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);

    this.#clouds(ctx, this.clouds, w, h);

    for (const isl of this.islands) {
      const ix = isl.x * w;
      const iy = isl.y * h + Math.sin(t * 0.6 + isl.phase) * u * 0.08;
      const hw = u * isl.s;
      this.#rock(ctx, ix, iy, hw, hw * 1.5, isl.jags);
      ctx.fillStyle = '#857da3';
      ctx.fillRect(ix - hw, iy - hw * 0.08, hw * 2, hw * 0.16);
      if (isl.column) {
        ctx.fillStyle = '#6b6488';
        ctx.fillRect(ix - hw * 0.16, iy - hw * 1.2, hw * 0.32, hw * 1.14);
        ctx.fillRect(ix - hw * 0.24, iy - hw * 1.28, hw * 0.48, hw * 0.12);
      }
      ctx.save();
      this.#runeStyle(ctx, glow, 0.6);
      ctx.lineWidth = Math.max(1.5, hw * 0.035);
      ctx.translate(ix, iy + hw * 0.4);
      strokeGlyph(ctx, isl.glyph, hw * 0.16);
      ctx.restore();
    }

    // Colosseum arcade behind the fighting platform.
    const rx = w * 0.47;
    const ry = u * 0.42;
    const cy = floorY + ry * 0.25;
    const bays = this.brokenBays.length;
    const span = w * 0.74;
    const bayW = span / bays;
    const baseY = cy - ry * 0.75;
    const tier = u * 1.25;
    const colW = bayW * 0.2;
    ctx.fillStyle = 'rgba(58,48,104,0.82)';
    ctx.strokeStyle = 'rgba(58,48,104,0.82)';
    ctx.lineWidth = colW * 0.8;
    for (let i = 0; i <= bays; i++) {
      const x = w / 2 - span / 2 + i * bayW;
      const broken = this.brokenBays[i % bays];
      const top = broken ? tier * 1.15 : tier * 2;
      ctx.fillRect(x - colW / 2, baseY - top, colW, top);
      if (i === bays) break;
      // Lower arch, then the upper one where the wall has not collapsed.
      ctx.fillRect(x, baseY - tier - colW * 0.6, bayW, colW * 0.6);
      ctx.beginPath();
      ctx.arc(x + bayW / 2, baseY - tier * 0.62, (bayW - colW) / 2, Math.PI, 0);
      ctx.stroke();
      if (!broken && !this.brokenBays[(i + 1) % bays]) {
        ctx.fillRect(x, baseY - tier * 2 - colW * 0.5, bayW, colW * 0.6);
        ctx.beginPath();
        ctx.arc(x + bayW / 2, baseY - tier * 1.62, (bayW - colW) / 2, Math.PI, 0);
        ctx.stroke();
      }
    }
    ctx.save();
    this.#runeStyle(ctx, glow, 0.7);
    ctx.lineWidth = Math.max(1.5, u * 0.014);
    for (let i = 0; i <= bays; i++) {
      ctx.save();
      ctx.translate(w / 2 - span / 2 + i * bayW, baseY - tier * 0.55);
      strokeGlyph(ctx, this.columnGlyphs[i], colW * 0.28);
      ctx.restore();
    }
    ctx.restore();

    // Main platform: rocky underside, rim, then the top surface.
    this.#rock(ctx, w / 2, cy, rx * 0.98, u * 1.9, this.jags);
    ctx.fillStyle = '#3b3557';
    ctx.beginPath();
    ctx.ellipse(w / 2, cy + u * 0.1, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    const top = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
    top.addColorStop(0, '#6f678f');
    top.addColorStop(1, '#a79fc4');
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.ellipse(w / 2, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(40,32,70,0.35)';
    ctx.lineWidth = Math.max(1, u * 0.01);
    for (const k of [0.5, 0.9]) {
      ctx.beginPath();
      ctx.ellipse(w / 2, cy, rx * k, ry * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.moveTo(w / 2 + Math.cos(a) * rx * 0.5, cy + Math.sin(a) * ry * 0.5);
      ctx.lineTo(w / 2 + Math.cos(a) * rx * 0.9, cy + Math.sin(a) * ry * 0.9);
    }
    ctx.stroke();

    // Floor runes: brightness and colour follow like energy.
    ctx.save();
    if (glow > 0.05) {
      const pool = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, rx);
      pool.addColorStop(0, `hsla(${185 + 110 * glow},100%,70%,${0.4 * glow})`);
      pool.addColorStop(1, 'hsla(200,100%,70%,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.ellipse(w / 2, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    this.#runeStyle(ctx, glow, 1);
    ctx.lineWidth = Math.max(2, u * 0.022);
    ctx.beginPath();
    ctx.ellipse(w / 2, cy, rx * 0.7, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.stroke();
    const n = this.floorGlyphs.length;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * 0.05;
      ctx.save();
      ctx.translate(w / 2 + Math.cos(a) * rx * 0.8, cy + Math.sin(a) * ry * 0.8);
      ctx.scale(1, 0.42);
      strokeGlyph(ctx, this.floorGlyphs[i], u * 0.1);
      ctx.restore();
    }
    ctx.restore();

    this.#motes(ctx, L, false);
  }

  drawFront(ctx, L) {
    const { w, h, u, floorY } = L;
    this.#motes(ctx, L, true);
    this.#clouds(ctx, this.seaClouds, w, h);

    // Gift shockwave: a ring of light racing across the floor plus a sky flash.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const wv of this.waves) {
      const p = wv.t / wv.dur;
      const a = (1 - p) * Math.min(1, 0.5 + wv.power * 0.5);
      const r = w * (0.05 + 0.9 * (1 - (1 - p) ** 2));
      ctx.strokeStyle = `rgba(190,240,255,${a})`;
      ctx.shadowColor = '#7fe9ff';
      ctx.shadowBlur = 40;
      ctx.lineWidth = u * 0.16 * (1 - p) + 2;
      ctx.beginPath();
      ctx.ellipse(w / 2, floorY + u * 0.1, r, r * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      const sweep = ctx.createRadialGradient(w / 2, floorY, 0, w / 2, floorY, r * 1.1);
      sweep.addColorStop(0, 'rgba(160,230,255,0)');
      sweep.addColorStop(0.8, `rgba(160,230,255,${a * 0.22})`);
      sweep.addColorStop(1, 'rgba(160,230,255,0)');
      ctx.fillStyle = sweep;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }
}
