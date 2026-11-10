// Procedural character art. Both sprites are drawn in a local space where the
// feet sit at y = 0 and 100 units equal one layout unit `u`.
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);

export const STAGES = [
  null,
  { scale: 1.0, armor: '#8a5a33', dark: '#5a3920', trim: '#b98a55', blade: '#8d7868', bladeLen: 70, bladeW: 7 },
  { scale: 1.08, armor: '#c5cfdb', dark: '#7f8b9c', trim: '#f4f8ff', blade: '#e6f6ff', glow: '#9fdcff', bladeLen: 86, bladeW: 8, cape: '#b3202f', helmet: true },
  { scale: 1.16, armor: '#262232', dark: '#12101a', trim: '#f0c040', neon: '#3ff0ff', blade: '#9ff8ff', glow: '#3ff0ff', bladeLen: 100, bladeW: 9, cape: '#3b1a66', helmet: true, aura: '70,220,255' },
  { scale: 1.3, armor: '#ecd9a0', dark: '#8f6f28', trim: '#ffd75e', neon: '#ffb02e', blade: '#fff6d0', glow: '#ffa21f', bladeLen: 138, bladeW: 16, helmet: true, wings: true, eyes: true, aura: '255,190,80' },
];

// Swing keyframes: [progress, sword angle, arm angle]. Angles: sword 0 = straight up,
// positive tilts forward; arm 0 = hanging down, PI = straight up.
const SWING = [
  [0, 0.55, 0.9],
  [0.3, -1.3, 3.2],
  [0.6, 2.0, 1.1],
  [1, 0.55, 0.9],
];

function swingPose(p) {
  for (let i = 1; i < SWING.length; i++) {
    if (p <= SWING[i][0]) {
      const a = SWING[i - 1];
      const b = SWING[i];
      const k = smooth((p - a[0]) / (b[0] - a[0]));
      return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
    }
  }
  return [0.55, 0.9];
}

/**
 * o: { x, y, u, stage, t, swing, cast, hurt, buffed, alpha, down }
 * swing/cast are 0..1 progress or -1 when idle.
 * Returns world positions of the sword hand, sword tip and body centre.
 */
export function drawPlayer(ctx, o) {
  const st = STAGES[o.stage];
  const s = (o.u / 100) * st.scale;
  const t = o.t;
  const bob = o.down ? 0 : Math.sin(t * 2.4) * 2;

  let [ang, arm] = [0.55 + Math.sin(t * 2.4) * 0.05, 0.9];
  let lunge = 0;
  if (o.swing >= 0) {
    [ang, arm] = swingPose(o.swing);
    lunge = Math.sin(o.swing * Math.PI) * 24;
  } else if (o.cast >= 0) {
    const k = Math.sin(o.cast * Math.PI);
    ang = lerp(ang, -0.1, k);
    arm = lerp(arm, 2.9, k);
  }
  lunge -= o.hurt * 10;

  const bladeLen = st.bladeLen * (o.buffed ? 1.35 : 1);
  const bladeW = st.bladeW * (o.buffed ? 1.7 : 1);
  const shoulder = { x: 12, y: -136 + bob };
  const hand = { x: shoulder.x + Math.sin(arm) * 36, y: shoulder.y + Math.cos(arm) * 36 };
  const tip = { x: hand.x + Math.sin(ang) * bladeLen, y: hand.y - Math.cos(ang) * bladeLen };

  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(s, s);
  ctx.globalAlpha = o.alpha ?? 1;
  if (o.down) {
    ctx.rotate(-1.35);
    ctx.globalAlpha *= 0.65;
  }
  ctx.translate(lunge, 0);

  if (st.aura) {
    const pulse = 0.75 + 0.25 * Math.sin(t * 3);
    const g = ctx.createRadialGradient(0, -100, 10, 0, -100, 150);
    g.addColorStop(0, `rgba(${st.aura},${0.2 * pulse})`);
    g.addColorStop(1, `rgba(${st.aura},0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -100, 110, 150, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (st.wings) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const a = side * (0.7 + i * 0.26) + Math.sin(t * 2.2 + i * 0.6) * 0.06 * side;
        const len = (165 - i * 20) * (side < 0 ? 1 : 0.72) * (1 + 0.06 * Math.sin(t * 9 + i * 1.7));
        const dx = Math.sin(a);
        const dy = -Math.cos(a);
        const bx = -8;
        const by = -128 + bob;
        const g = ctx.createLinearGradient(bx, by, bx + dx * len, by + dy * len);
        g.addColorStop(0, 'rgba(255,240,190,0.5)');
        g.addColorStop(0.45, 'rgba(255,150,40,0.38)');
        g.addColorStop(1, 'rgba(255,70,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + dx * len * 0.5 - dy * 20, by + dy * len * 0.5 + dx * 20, bx + dx * len, by + dy * len);
        ctx.quadraticCurveTo(bx + dx * len * 0.5 + dy * 20, by + dy * len * 0.5 - dx * 20, bx, by);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  if (st.cape) {
    const sway = Math.sin(t * 2.6) * 6 + lunge * 0.9;
    ctx.fillStyle = st.cape;
    ctx.beginPath();
    ctx.moveTo(-10, -148 + bob);
    ctx.lineTo(-24, -146 + bob);
    ctx.bezierCurveTo(-40 - sway * 0.5, -110, -52 - sway, -80, -62 - sway * 1.4, -36);
    ctx.quadraticCurveTo(-44 - sway, -28, -26 - sway * 0.6, -40);
    ctx.bezierCurveTo(-22, -80, -14, -110, -10, -148 + bob);
    ctx.fill();
  }

  // Legs and boots.
  ctx.fillStyle = st.dark;
  ctx.beginPath();
  ctx.roundRect(-20, -82, 15, 72, 4);
  ctx.roundRect(4, -82, 15, 72, 4);
  ctx.fill();
  ctx.fillStyle = o.stage === 1 ? '#3b2616' : st.trim;
  ctx.beginPath();
  ctx.roundRect(-22, -14, 21, 14, 4);
  ctx.roundRect(2, -14, 23, 14, 4);
  ctx.fill();

  // Torso.
  ctx.fillStyle = st.armor;
  ctx.beginPath();
  ctx.roundRect(-24, -150 + bob, 46, 74, 10);
  ctx.fill();
  if (o.stage >= 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.roundRect(-14, -144 + bob, 14, 44, 6);
    ctx.fill();
  }
  ctx.fillStyle = st.trim;
  ctx.fillRect(-24, -86 + bob, 46, 8);
  if (st.neon) {
    ctx.save();
    ctx.strokeStyle = st.neon;
    ctx.shadowColor = st.neon;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-18, -142 + bob);
    ctx.lineTo(-2, -112 + bob);
    ctx.lineTo(14, -142 + bob);
    ctx.moveTo(-2, -112 + bob);
    ctx.lineTo(-2, -90 + bob);
    ctx.stroke();
    ctx.restore();
  }

  // Head or helmet.
  const hx = 2;
  const hy = -170 + bob;
  if (st.helmet) {
    ctx.fillStyle = st.armor;
    ctx.beginPath();
    ctx.arc(hx, hy, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = st.trim;
    ctx.beginPath();
    if (o.stage === 4) {
      // Winged crest.
      ctx.moveTo(hx - 16, hy - 12);
      ctx.lineTo(hx - 34, hy - 44);
      ctx.lineTo(hx - 4, hy - 20);
      ctx.lineTo(hx + 2, hy - 46);
      ctx.lineTo(hx + 10, hy - 19);
    } else {
      ctx.moveTo(hx - 12, hy - 17);
      ctx.quadraticCurveTo(hx - 30, hy - 46, hx + 6, hy - 34);
      ctx.lineTo(hx + 8, hy - 19);
    }
    ctx.fill();
    ctx.fillStyle = '#0d0b16';
    ctx.beginPath();
    ctx.roundRect(hx + 1, hy - 6, 20, 7, 2);
    ctx.fill();
    if (st.eyes) {
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#ffd75e';
      ctx.shadowBlur = 16 + 6 * Math.sin(t * 8);
      ctx.beginPath();
      ctx.arc(hx + 8, hy - 2.5, 2.6, 0, Math.PI * 2);
      ctx.arc(hx + 16, hy - 2.5, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fill();
      ctx.restore();
    }
  } else {
    ctx.fillStyle = '#e6b98f';
    ctx.beginPath();
    ctx.arc(hx, hy, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a2f1b';
    ctx.beginPath();
    ctx.arc(hx - 2, hy - 4, 20, Math.PI * 0.95, Math.PI * 1.9);
    ctx.fill();
    ctx.fillStyle = '#1b1320';
    ctx.beginPath();
    ctx.arc(hx + 10, hy - 1, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sword arm.
  ctx.strokeStyle = st.armor;
  ctx.lineCap = 'round';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(hand.x, hand.y);
  ctx.stroke();
  if (o.stage >= 2) {
    ctx.fillStyle = st.trim;
    ctx.beginPath();
    ctx.arc(shoulder.x, shoulder.y, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sword.
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(ang);
  ctx.fillStyle = '#3a2a1c';
  ctx.fillRect(-2.5, -2, 5, 16);
  ctx.fillStyle = o.stage === 1 ? '#6f6258' : st.trim;
  ctx.fillRect(-bladeW - 4, -5, bladeW * 2 + 8, 6);
  if (o.buffed) {
    const g = ctx.createLinearGradient(0, 0, 0, -bladeLen);
    g.addColorStop(0, '#fff7c2');
    g.addColorStop(0.5, '#ffb02e');
    g.addColorStop(1, '#ff4a1a');
    ctx.fillStyle = g;
    ctx.shadowColor = '#ff6a00';
    ctx.shadowBlur = 30;
  } else {
    ctx.fillStyle = st.blade;
    if (st.glow) {
      ctx.shadowColor = st.glow;
      ctx.shadowBlur = 14 + o.stage * 4;
    }
  }
  ctx.beginPath();
  ctx.moveTo(-bladeW / 2, -5);
  ctx.lineTo(-bladeW / 2, -bladeLen + bladeW);
  ctx.lineTo(0, -bladeLen);
  ctx.lineTo(bladeW / 2, -bladeLen + bladeW);
  ctx.lineTo(bladeW / 2, -5);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (o.stage === 1 && !o.buffed) {
    // Rust patches.
    ctx.fillStyle = 'rgba(122,62,30,0.75)';
    ctx.fillRect(-bladeW / 2, -30, bladeW * 0.6, 8);
    ctx.fillRect(0, -52, bladeW / 2, 10);
  }
  if (o.buffed) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const fy = -8 - (i / 6) * (bladeLen - 10);
      const fr = bladeW * (1 + 0.45 * Math.sin(t * 13 + i * 1.9));
      ctx.fillStyle = `rgba(255,${120 + i * 12},20,0.3)`;
      ctx.beginPath();
      ctx.ellipse(Math.sin(t * 9 + i) * 3, fy, fr, fr * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (o.stage === 4) {
    // Lightning crawling along the blade.
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.shadowColor = '#9fdcff';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    for (let i = 1; i <= 8; i++) ctx.lineTo((Math.random() - 0.5) * bladeW * 2.4, -6 - (i / 8) * (bladeLen - 8));
    ctx.stroke();
  }
  ctx.restore();

  if (o.hurt > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, -100, 0, 0, -100, 120);
    g.addColorStop(0, `rgba(255,40,40,${0.55 * o.hurt})`);
    g.addColorStop(1, 'rgba(255,40,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-120, -220, 240, 240);
  }
  ctx.restore();

  const world = (p) => ({ x: o.x + (p.x + lunge) * s, y: o.y + p.y * s });
  return { hand: world(hand), tip: world(tip), center: world({ x: 0, y: -100 }) };
}

export function bossHue(level) {
  return (265 + level * 47) % 360;
}

/**
 * o: { x, y, u, level, t, hit, attack, spawn }
 * hit 0..1 flash, attack 0..1 progress or -1, spawn 0..1 scale-in.
 * Returns world positions of the body centre and attacking hand.
 */
export function drawBoss(ctx, o) {
  const level = o.level;
  const hue = bossHue(level);
  const s = (o.u / 100) * (1 + Math.min(level, 30) * 0.004) * o.spawn;
  const t = o.t;
  const breath = Math.sin(t * 1.6) * 3;
  const atk = o.attack >= 0 ? Math.sin(o.attack * Math.PI) : 0;
  const lunge = -atk * 45 + o.hit * 10 + (o.hit > 0 ? (Math.random() - 0.5) * 8 * o.hit : 0);
  const boost = o.hit * 38;
  const body = `hsl(${hue},55%,${27 + boost}%)`;
  const dark = `hsl(${hue},60%,${15 + boost}%)`;
  const light = `hsl(${hue},65%,${43 + boost}%)`;
  const glowHue = (hue + 150) % 360;
  const glow = `hsl(${glowHue},100%,62%)`;

  const hand = { x: lerp(-128, -200, atk), y: lerp(-92, -165, atk) };

  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(s, s);
  ctx.translate(lunge, 0);

  if (level >= 10) {
    const k = Math.min(1, level / 40);
    const g = ctx.createRadialGradient(0, -160, 30, 0, -160, 260);
    g.addColorStop(0, `hsla(${glowHue},100%,60%,${(0.22 + 0.25 * k) * (0.8 + 0.2 * Math.sin(t * 2.5))})`);
    g.addColorStop(1, `hsla(${glowHue},100%,60%,0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(-270, -430, 540, 540);
    ctx.restore();
  }

  ctx.lineCap = 'round';
  // Back arm.
  ctx.strokeStyle = dark;
  ctx.lineWidth = 44;
  ctx.beginPath();
  ctx.moveTo(60, -200 + breath);
  ctx.lineTo(98, -112);
  ctx.stroke();

  // Legs.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.roundRect(-72, -92, 58, 92, 14);
  ctx.roundRect(16, -92, 58, 92, 14);
  ctx.fill();
  ctx.fillStyle = '#e9e2cf';
  for (const fx of [-72, 16]) {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(fx + 4 + i * 18, -6);
      ctx.lineTo(fx - 6 + i * 18, 2);
      ctx.lineTo(fx + 14 + i * 18, 0);
      ctx.fill();
    }
  }

  // Shoulder spikes grow in number with level.
  const spikes = Math.min(1 + Math.floor(level / 4), 5);
  ctx.fillStyle = light;
  for (const side of [-1, 1]) {
    for (let i = 0; i < spikes; i++) {
      const a = -Math.PI / 2 + side * (0.55 + i * 0.2);
      const bx = Math.cos(a) * 96;
      const by = -150 + breath + Math.sin(a) * 100;
      const len = 46 - i * 5;
      ctx.beginPath();
      ctx.moveTo(bx - Math.sin(a) * 13, by + Math.cos(a) * 13);
      ctx.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
      ctx.lineTo(bx + Math.sin(a) * 13, by - Math.cos(a) * 13);
      ctx.fill();
    }
  }

  // Body with belly plates.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, -150 + breath, 102, 106, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 5;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(-10, -150 + breath + i * 26, 58 - i * 6, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();
  }

  // Glowing core.
  ctx.save();
  ctx.fillStyle = glow;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.arc(-18, -168 + breath, 20 + Math.sin(t * 4) * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(-18, -168 + breath, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Horns: two to start, more at higher levels.
  const horns = Math.min(2 + Math.floor(level / 5), 6);
  const hx = -32;
  const hy = -264 + breath;
  ctx.fillStyle = '#e9e2cf';
  for (let i = 0; i < horns; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const rank = Math.floor(i / 2);
    const bx = hx + side * (30 - rank * 12);
    const by = hy - 26 - rank * 8;
    const len = 62 - rank * 12;
    ctx.beginPath();
    ctx.moveTo(bx - 10, by + 6);
    ctx.quadraticCurveTo(bx + side * len * 0.7, by - len * 0.3, bx + side * len * 0.55, by - len);
    ctx.quadraticCurveTo(bx + side * len * 0.2, by - len * 0.3, bx + 10, by + 6);
    ctx.fill();
  }

  // Head, jaw, eyes and teeth.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(hx, hy, 52, 45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(hx - 4, hy + 22, 44, 22, 0, 0, Math.PI);
  ctx.fill();
  ctx.save();
  ctx.fillStyle = glow;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 18;
  for (const ex of [-30, 8]) {
    ctx.beginPath();
    ctx.moveTo(hx + ex - 12, hy - 14);
    ctx.lineTo(hx + ex + 12, hy - 4);
    ctx.lineTo(hx + ex - 8, hy + 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#f4efe0';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const tx = hx - 40 + i * 12;
    ctx.moveTo(tx, hy + 18);
    ctx.lineTo(tx + 6, hy + 32 + (i % 2) * 4);
    ctx.lineTo(tx + 12, hy + 18);
  }
  ctx.fill();

  // Floating crown of shards for late bosses.
  if (level >= 20) {
    ctx.save();
    ctx.fillStyle = glow;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 16;
    for (let i = 0; i < 7; i++) {
      const a = t * 0.8 + (i / 7) * Math.PI * 2;
      const cx = hx + Math.cos(a) * 62;
      const cy = hy - 78 + Math.sin(a) * 10;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 16);
      ctx.lineTo(cx + 6, cy);
      ctx.lineTo(cx, cy + 10);
      ctx.lineTo(cx - 6, cy);
      ctx.fill();
    }
    ctx.restore();
  }

  // Front arm and clawed fist.
  ctx.strokeStyle = body;
  ctx.lineWidth = 46;
  ctx.beginPath();
  ctx.moveTo(-78, -204 + breath);
  ctx.quadraticCurveTo(-130, lerp(-150, -200, atk), hand.x, hand.y);
  ctx.stroke();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e9e2cf';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(hand.x - 22, hand.y + i * 16 - 7);
    ctx.lineTo(hand.x - 56, hand.y + i * 20 + 6);
    ctx.lineTo(hand.x - 22, hand.y + i * 16 + 7);
    ctx.fill();
  }
  ctx.restore();

  const world = (p) => ({ x: o.x + (p.x + lunge) * s, y: o.y + p.y * s });
  return { center: world({ x: -10, y: -160 }), hand: world(hand), hue };
}
