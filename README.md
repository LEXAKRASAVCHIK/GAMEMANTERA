# Celestial Colosseum — TikTok Live Boss Battle

Viewers of a TikTok Live fight a boss together: every **like** is a sword slash, every **gift** is a
heavy magic attack, a **Rose** ignites the Flame Greatsword for 30 seconds, and the hero evolves
through four forms as bosses fall.

All art is drawn procedurally on an HTML5 canvas (no asset files), so the template runs as-is.

## Quick start

```bash
npm install
npm run demo                       # fake audience, open http://127.0.0.1:3000
npm start                          # simulator only, open http://127.0.0.1:3000/?debug=1
TIKTOK_USERNAME=yourname npm start # real stream (you must be live)
npm test
```

Add `http://127.0.0.1:3000/` as a **Browser Source** in OBS / TikTok Live Studio. The layout adapts
to landscape (1920x1080) and portrait (1080x1920) sources.

| Variable | Purpose |
| --- | --- |
| `TIKTOK_USERNAME` | Creator `@uniqueId` to listen to. Unset = simulator only. |
| `EULER_API_KEY` | Optional Euler Stream sign-server key (higher rate limits). |
| `PORT`, `HOST` | Defaults `3000`, `127.0.0.1`. |
| `ENABLE_SIM=1` | Keep the simulator API on while connected to a real stream. |
| `SIM_AUTO=1` | Generate random likes and gifts (what `npm run demo` sets). |

## 1. Tech stack

**Node.js + `tiktok-live-connector` v2 + WebSocket + HTML5 Canvas 2D.**

- `tiktok-live-connector` is the most complete TikTok Live wrapper and emits `like` and `gift`
  events in the same process as the game logic, with no extra bridge.
- A browser canvas drops straight into OBS / Live Studio as a Browser Source at 60 fps. Pygame would
  need window capture and cannot be layered as an overlay.
- The server is authoritative, so the overlay can be reloaded mid-stream without losing progress,
  and several overlays (stream scene and a monitor) stay in sync.

```
TikTok Live ──▶ server/tiktok.js ──▶ server/gameState.js ──▶ WebSocket (50 ms batches) ──▶ public/main.js
 likes, gifts    normalise events     rules, timers, state     { state, events[] }          arena, sprites, fx
```

| File | Role |
| --- | --- |
| `server/config.js` | Every balance number (HP, damage, buff gift, stage thresholds). |
| `server/gameState.js` | State machine: `boss_level`, `boss_hp`, `player_hp`, `player_stage`, buff and attack timers. |
| `server/tiktok.js` | Live connection, gift-streak handling, reconnect with backoff. |
| `server/index.js` | Static files, WebSocket broadcast, simulator API. |
| `public/main.js` | Event → animation mapping, HUD, banners, simulator panel. |
| `public/arena.js` | Sky, mountains, clouds, floating platforms, runes, light wave, ambient particles. |
| `public/sprites.js` | Hero (4 stages) and boss (tint and ornaments by level). |
| `public/fx.js` | Particles, slashes, lightning, explosions, fireworks, damage numbers. |

## 2. State

`GameState` holds the whole game. Time is passed in, so the rules are deterministic and unit tested
(`test/gameState.test.js`).

```js
{ boss_level: 0, boss_hp: 1000, boss_max_hp: 1000,
  player_hp: 100, player_max_hp: 100, player_stage: 1,
  buff_expires_at: 0, player_down_until: 0, next_boss_attack_at }
```

- Boss death: `boss_level += 1`, `boss_max_hp = 1000 * 1.5^level`, instant respawn with a new hue
  (`265 + 47 * level`) plus more horns and spikes, an aura from level 10 and a crown from level 20.
  Overkill damage carries into the next boss.
- Boss attack: every 3 s for `8 * (1 + 0.15 * level)` damage.
- Hero at 0 HP: knocked out for 5 s (or until a 10+ coin gift), and the current boss heals to full.
  Boss level is never lost.

## 3. Likes and gifts

| Event | Damage | Animation |
| --- | --- | --- |
| Like | 1 per like (2 while buffed) | Sword slash, style depends on stage and buff |
| Gift under 5 coins | 5 per coin | Strong slash |
| Gift 5+ coins | `10 * coins * (1 + 0.2 * log2(coins / 5))` → 5 = 50, 10 = 120, 100 = 1864 | Lightning (5–19), explosion (20–99), nova (100+), plus the arena light wave |
| Gift 10+ coins | also heals 2% max HP per coin, revives a downed hero | Green heal burst |

Likes arrive batched (`likeCount`), so one event plays as a short combo while the full damage is
applied at once. Each like also charges the floor runes, which brighten and shift from cyan to
magenta under spam and fade when it stops.

Streakable gifts fire repeatedly while the viewer keeps tapping; `normalizeGift` counts them once,
when the streak ends, using `diamondCount * repeatCount`.

## 4. 30-second attack modifier

Configured in `CONFIG.buff` (default: a gift named `Rose`; `coinValues` matches an exact price
instead). The server stores one timestamp and derives everything from it:

```js
s.buff_expires_at = now + 30000;             // on the trigger gift; resending refreshes the timer
isBuffActive(now) { return now < s.buff_expires_at; }
likeDamage(now)   { return this.isBuffActive(now) ? 2 : 1; }
```

`tick()` emits `buffEnd` on expiry. Each like event carries `buffed`, which swaps the hero's blade
for the Flame Greatsword and the slash for a fire slash; the HUD shows a draining countdown bar.

## 5. Evolution

| Stage | Boss level | Look | Like attack |
| --- | --- | --- | --- |
| 1 Novice | 0–5 | Leather, rusty sword | No VFX |
| 2 Arena Knight | 6–15 | Steel plate, cape, glowing blade | White light trail |
| 3 Mystic Warrior | 16–30 | Dark and gold armour, neon trim, aura | Trail plus sparks |
| 4 Divine Champion | 31+ | Fire wings, shining eyes, giant lightning sword | Micro-explosion on every hit |

When a kill crosses a threshold the server raises `player_stage`, refills HP at the new maximum and
emits `evolved`. The client cross-fades the old form into the new one inside a pillar of light,
shows `CHARACTER EVOLVED TO STAGE N!` and launches 16 firework rockets.

## Balance note

`+50%` HP per level is exponential: level 16 has about 657K HP and level 31 about 288M. Reaching
the later stages therefore depends on gifts. To make them reachable on likes alone, lower
`boss.hpGrowth` or the `minLevel` thresholds in `server/config.js`.
