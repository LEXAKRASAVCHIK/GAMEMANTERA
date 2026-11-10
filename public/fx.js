// Short-lived combat effects: particles, slashes, lightning, rings, fireworks, damage text.
const MAX_PARTICLES = 1400;
const rand = (a, b) => a + Math.random() * (b - a);

export class Fx {
  constructor() {
    this.particles = [];
    this.slashes = [];
    this.bolts = [];
    this.rings = [];
    this.texts = [];
    this.rockets = [];
    this.pillars = [];
    this.shake = 0;
    this.flash = 0;
  }

  burst(x, y, o = {}) {
    const n = o.n ?? 12;
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = o.angle != null ? o.angle + rand(-1, 1) * (o.spread ?? 0.5) : rand(0, Math.PI * 2);
      const v = rand(0.3, 1) * (o.speed ?? 200);
      const life = rand(0.5, 1) * (o.life ?? 0.6);
      this.particles.push({
        x: x + rand(-1, 1) * (o.radius ?? 0), y: y + rand(-1, 1) * (o.radius ?? 0),
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.lift ?? 0),
        g: o.g ?? 300, drag: o.drag ?? 1.5, life, max: life,
        size: rand(0.5, 1) * (o.size ?? 4),
        hue: (o.hue ?? 45) + rand(-1, 1) * (o.hueVar ?? 12), sat: o.sat ?? 100, lit: o.lit ?? 65,
      });
    }
  }

  slash(x, y, size, color, width = 6) {
    this.slashes.push({ x, y, size, color, width, rot: rand(-0.5, 0.5), t: 0, dur: 0.16 });
  }

  ring(x, y, radius, color, dur = 0.45, width = 6) {
    this.rings.push({ x, y, radius, color, width, t: 0, dur });
  }

  bolt(x, y0, y1, hue = 200, width = 5) {
    this.bolts.push({ x, y0, y1, hue, width, t: 0, dur: 0.28 });
  }

  text(x, y, str, color = '#fff', size = 28) {
    this.texts.push({ x: x + rand(-20, 20), y, str, color, size, t: 0, dur: 1 });
    if (this.texts.length > 40) this.texts.shift();
  }

  explosion(x, y, r, hue = 30) {
    this.ring(x, y, r * 1.6, `hsl(${hue},100%,75%)`, 0.4, r * 0.12);
    this.burst(x, y, { n: Math.min(60, 10 + r * 0.4), speed: r * 5, size: r * 0.09, hue, hueVar: 25, life: 0.7, g: 150 });
    this.burst(x, y, { n: 8, speed: r * 2, size: r * 0.2, hue: 50, lit: 85, life: 0.25, g: 0 });
  }

  rocket(x, y, targetY, hue) {
    this.rockets.push({ x, y, targetY, hue, vy: -(y - targetY) * 1.6 });
  }

  pillar(x, y, width, hue = 50) {
    this.pillars.push({ x, y, width, hue, t: 0, dur: 1.6 });
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2.5);

    for (const p of this.particles) {
      p.life -= dt;
      p.vx -= p.vx * p.drag * dt;
      p.vy += (p.g - p.vy * p.drag) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const list of [this.slashes, this.bolts, this.rings, this.texts, this.pillars]) {
      for (const e of list) e.t += dt;
    }
    this.slashes = this.slashes.filter((e) => e.t < e.dur);
    this.bolts = this.bolts.filter((e) => e.t < e.dur);
    this.rings = this.rings.filter((e) => e.t < e.dur);
    this.texts = this.texts.filter((e) => e.t < e.dur);
    this.pillars = this.pillars.filter((e) => e.t < e.dur);

    for (const r of this.rockets) {
      r.y += r.vy * dt;
      this.burst(r.x, r.y, { n: 1, speed: 30, size: 3, hue: r.hue, life: 0.3, g: 60 });
      if (r.y <= r.targetY) {
        r.done = true;
        this.burst(r.x, r.y, { n: 70, speed: 380, size: 4.5, hue: r.hue, hueVar: 20, life: 1.3, g: 140, drag: 2.2 });
        this.burst(r.x, r.y, { n: 20, speed: 200, size: 3, hue: 50, lit: 90, life: 0.9, g: 140, drag: 2.2 });
        this.ring(r.x, r.y, 90, `hsl(${r.hue},100%,80%)`, 0.5, 3);
      }
    }
    this.rockets = this.rockets.filter((r) => !r.done);
  }

  draw(ctx, w, h) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const pl of this.pillars) {
      const p = pl.t / pl.dur;
      const a = Math.sin(Math.min(1, p * 4) * Math.PI / 2) * (1 - p);
      const half = pl.width * (0.6 + 0.4 * p);
      const g = ctx.createLinearGradient(pl.x - half, 0, pl.x + half, 0);
      g.addColorStop(0, `hsla(${pl.hue},100%,70%,0)`);
      g.addColorStop(0.5, `hsla(${pl.hue},100%,88%,${a})`);
      g.addColorStop(1, `hsla(${pl.hue},100%,70%,0)`);
      ctx.fillStyle = g;
      ctx.fillRect(pl.x - half, 0, half * 2, pl.y);
    }

    for (const p of this.particles) {
      const a = Math.min(1, (p.life / p.max) * 1.6);
      ctx.fillStyle = `hsla(${p.hue},${p.sat}%,${p.lit}%,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * (p.life / p.max)), 0, Math.PI * 2);
      ctx.fill();
    }

    for (const s of this.slashes) {
      const p = s.t / s.dur;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot - 0.6);
      ctx.globalAlpha = 1 - p * p;
      ctx.strokeStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 18;
      ctx.lineCap = 'round';
      ctx.lineWidth = s.width * (1 - p * 0.6);
      ctx.beginPath();
      ctx.arc(-s.size * 0.6, 0, s.size, -0.9 + p * 0.5, 0.2 + p * 0.9);
      ctx.stroke();
      ctx.restore();
    }

    for (const b of this.bolts) {
      const a = 1 - b.t / b.dur;
      const segs = 12;
      ctx.beginPath();
      ctx.moveTo(b.x + rand(-40, 40), b.y0);
      for (let i = 1; i <= segs; i++) {
        const jitter = i === segs ? 0 : rand(-1, 1) * 38;
        ctx.lineTo(b.x + jitter, b.y0 + ((b.y1 - b.y0) * i) / segs);
      }
      ctx.lineJoin = 'round';
      ctx.shadowColor = `hsl(${b.hue},100%,65%)`;
      ctx.shadowBlur = 30;
      ctx.strokeStyle = `hsla(${b.hue},100%,70%,${a})`;
      ctx.lineWidth = b.width * 2.4;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = b.width;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    for (const r of this.rings) {
      const p = r.t / r.dur;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, r.width * (1 - p));
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * (0.15 + 0.85 * Math.sqrt(p)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, this.flash)})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const p = t.t / t.dur;
      const pop = 1 + 0.5 * Math.max(0, 1 - p * 6);
      ctx.globalAlpha = Math.min(1, (1 - p) * 2);
      ctx.font = `900 ${Math.round(t.size * pop)}px "Trebuchet MS", system-ui, sans-serif`;
      ctx.lineWidth = Math.max(3, t.size * 0.18);
      ctx.strokeStyle = 'rgba(10,6,30,0.85)';
      const y = t.y - p * 70;
      ctx.strokeText(t.str, t.x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, y);
    }
    ctx.restore();
  }
}
