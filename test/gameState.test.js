import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameState, giftDamage, stageForLevel, bossMaxHp } from '../server/gameState.js';
import { normalizeGift } from '../server/tiktok.js';

const T0 = 1_000_000;
function setup() {
  const game = new GameState(undefined, T0);
  const events = [];
  game.on('event', (e) => events.push(e));
  return { game, events, s: game.state };
}

test('initial state', () => {
  const { s } = setup();
  assert.deepEqual(
    [s.boss_level, s.boss_hp, s.player_hp, s.player_stage],
    [0, 1000, 100, 1],
  );
});

test('likes deal 1 damage each with the basic attack', () => {
  const { game, events, s } = setup();
  game.onLike(7, 'a', T0);
  assert.equal(s.boss_hp, 993);
  assert.deepEqual(events[0], { type: 'attack', kind: 'like', hits: 7, damage: 7, buffed: false, stage: 1, user: 'a' });
});

test('gift damage scales with coin value', () => {
  assert.equal(giftDamage(5), 50);
  assert.equal(giftDamage(10), 120);
  assert.ok(giftDamage(100) > 10 * giftDamage(10));
});

test('boss respawns with +1 level and +50% max HP, overkill carries over', () => {
  const { game, events, s } = setup();
  game.onLike(50, 'a', T0);
  game.onGift({ coins: 50, name: 'Gift' }, T0); // 832 damage -> 118 left
  game.onGift({ coins: 10, name: 'Gift' }, T0); // 120 damage -> kill, 2 carried
  assert.equal(s.boss_level, 1);
  assert.equal(s.boss_max_hp, 1500);
  assert.equal(s.boss_hp, 1498);
  assert.ok(events.some((e) => e.type === 'bossDefeated' && e.boss_level === 1));
  assert.equal(bossMaxHp(2), 2250);
});

test('buff gift doubles like damage for exactly 30 seconds', () => {
  const { game, events, s } = setup();
  game.onGift({ coins: 1, name: 'Rose' }, T0);
  assert.equal(s.boss_hp, 995); // minor gift damage
  game.onLike(3, 'a', T0 + 29_999);
  assert.equal(s.boss_hp, 989);
  assert.equal(events.at(-1).buffed, true);
  game.tick(T0 + 30_000);
  assert.ok(events.some((e) => e.type === 'buffEnd'));
  game.onLike(3, 'a', T0 + 30_000);
  assert.equal(s.boss_hp, 986);
  assert.equal(events.at(-1).buffed, false);
});

test('re-sending the buff gift refreshes the timer', () => {
  const { game } = setup();
  game.onGift({ coins: 1, name: 'rose' }, T0);
  game.onGift({ coins: 1, name: 'Rose' }, T0 + 20_000);
  assert.equal(game.snapshot(T0 + 20_000).buff_remaining_ms, 30_000);
  assert.equal(game.snapshot(T0 + 45_000).like_damage, 2);
  assert.equal(game.snapshot(T0 + 50_000).like_damage, 1);
});

test('boss attacks every 3 seconds; 10+ coin gifts heal, smaller ones do not', () => {
  const { game, s } = setup();
  game.tick(T0 + 2_999);
  assert.equal(s.player_hp, 100);
  game.tick(T0 + 3_000);
  assert.equal(s.player_hp, 92);
  game.tick(T0 + 6_000);
  assert.equal(s.player_hp, 84);
  game.onGift({ coins: 5, name: 'Gift' }, T0 + 6_100);
  assert.equal(s.player_hp, 84);
  game.onGift({ coins: 10, name: 'Gift' }, T0 + 6_200);
  assert.equal(s.player_hp, 100);
});

test('player knockout resets boss HP, then revives by timer or healing gift', () => {
  const { game, events, s } = setup();
  game.onLike(40, 'a', T0);
  for (let t = 3_000; t <= 39_000; t += 3_000) game.tick(T0 + t);
  assert.equal(s.player_hp, 0);
  assert.equal(s.boss_hp, 1000);
  assert.ok(events.some((e) => e.type === 'playerDown'));
  game.onLike(5, 'a', T0 + 40_000);
  assert.equal(s.boss_hp, 1000);
  game.onGift({ coins: 10, name: 'Gift' }, T0 + 40_500);
  assert.equal(game.snapshot(T0 + 40_500).player_down, false);
  assert.equal(s.player_hp, 100);
});

test('evolution stages follow boss level milestones', () => {
  assert.deepEqual([0, 5, 6, 15, 16, 30, 31, 99].map((l) => stageForLevel(l)), [1, 1, 2, 2, 3, 3, 4, 4]);
  const { game, events, s } = setup();
  game.debugSetBossLevel(5, T0);
  assert.equal(s.player_stage, 1);
  game.onGift({ coins: 1_000_000, name: 'Gift' }, T0);
  assert.ok(s.boss_level >= 6);
  assert.equal(s.player_stage, 2);
  assert.equal(s.player_hp, 180);
  assert.deepEqual(events.find((e) => e.type === 'evolved'), { type: 'evolved', from: 1, stage: 2, name: 'Arena Knight' });
});

test('gift streaks are only counted once, when the streak ends', () => {
  const base = { giftId: 5655, giftDetails: { giftType: 1, giftName: 'Rose', diamondCount: 1 }, user: { uniqueId: 'bob' } };
  assert.equal(normalizeGift({ ...base, repeatCount: 3, repeatEnd: 0 }), null);
  assert.deepEqual(normalizeGift({ ...base, repeatCount: 5, repeatEnd: 1 }), { coins: 1, name: 'Rose', repeat: 5, user: 'bob' });
});
