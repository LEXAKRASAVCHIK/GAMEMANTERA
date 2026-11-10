import { EventEmitter } from 'node:events';
import { CONFIG } from './config.js';

export function stageForLevel(level, cfg = CONFIG) {
  let stage = 1;
  for (const s of cfg.stages) if (level >= s.minLevel) stage = s.stage;
  return stage;
}

export function bossMaxHp(level, cfg = CONFIG) {
  return Math.round(cfg.boss.baseHp * cfg.boss.hpGrowth ** level);
}

// Super-linear in coin value: 5 coins = 50, 10 = 120, 100 = 1864, 1000 = 25288.
export function giftDamage(coins, cfg = CONFIG) {
  if (coins < cfg.gift.burstMinCoins) return Math.round(coins * cfg.gift.minorDamagePerCoin);
  return Math.round(10 * coins * (1 + 0.2 * Math.log2(coins / 5)));
}

export function giftTier(coins, cfg = CONFIG) {
  if (coins < cfg.gift.burstMinCoins) return 'minor';
  if (coins < 20) return 'lightning';
  if (coins < 100) return 'explosion';
  return 'nova';
}

/**
 * Authoritative game state. Time is always passed in (ms) so the engine is
 * deterministic and testable; the server drives it with Date.now().
 * Emits 'event' with { type, ... } for everything the renderer animates.
 */
export class GameState extends EventEmitter {
  constructor(cfg = CONFIG, now = Date.now()) {
    super();
    this.cfg = cfg;
    this.reset(now);
  }

  reset(now = Date.now()) {
    const maxHp = this.cfg.player.maxHpByStage[0];
    this.state = {
      boss_level: 0,
      boss_hp: bossMaxHp(0, this.cfg),
      boss_max_hp: bossMaxHp(0, this.cfg),
      player_hp: maxHp,
      player_max_hp: maxHp,
      player_stage: 1,
      buff_expires_at: 0,
      player_down_until: 0,
      next_boss_attack_at: now + this.cfg.boss.attackIntervalMs,
      totals: { likes: 0, gifts: 0, coins: 0 },
    };
  }

  #emit(type, data = {}) {
    this.emit('event', { type, ...data });
  }

  isBuffActive(now) {
    return now < this.state.buff_expires_at;
  }

  likeDamage(now) {
    return this.isBuffActive(now) ? this.cfg.buff.likeDamage : this.cfg.like.damage;
  }

  onLike(count, user = 'viewer', now = Date.now()) {
    const s = this.state;
    const hits = Math.min(Math.max(Math.floor(Number(count)) || 1, 1), this.cfg.like.maxPerEvent);
    s.totals.likes += hits;
    if (s.player_down_until) return; // a knocked-out hero can't swing
    const buffed = this.isBuffActive(now);
    const damage = hits * this.likeDamage(now);
    this.#emit('attack', { kind: 'like', hits, damage, buffed, stage: s.player_stage, user });
    this.#damageBoss(damage, now);
  }

  onGift({ coins, name = 'Gift', repeat = 1, user = 'viewer' }, now = Date.now()) {
    const s = this.state;
    const g = this.cfg.gift;
    const unit = Math.max(0, Math.floor(Number(coins)) || 0);
    const total = unit * Math.max(1, Math.floor(Number(repeat)) || 1);
    if (total <= 0) return;
    s.totals.gifts += 1;
    s.totals.coins += total;

    if (this.#isBuffTrigger(name, unit)) {
      // Re-sending the trigger gift refreshes the timer rather than stacking it.
      s.buff_expires_at = now + this.cfg.buff.durationMs;
      this.#emit('buff', { name: this.cfg.buff.name, duration_ms: this.cfg.buff.durationMs, user });
    }

    if (total >= g.healMinCoins) {
      if (s.player_down_until) this.#revive(now);
      const before = s.player_hp;
      const heal = Math.ceil(s.player_max_hp * g.healPctPerCoin * total);
      s.player_hp = Math.min(s.player_max_hp, s.player_hp + heal);
      this.#emit('heal', { amount: s.player_hp - before, user });
    }

    const damage = giftDamage(total, this.cfg);
    this.#emit('attack', {
      kind: 'gift', tier: giftTier(total, this.cfg), coins: total, gift: name, damage,
      stage: s.player_stage, user,
    });
    this.#damageBoss(damage, now);
  }

  /** Advance timers: boss auto-attack, buff expiry, revive. Call ~10x per second. */
  tick(now = Date.now()) {
    const s = this.state;
    if (s.buff_expires_at && now >= s.buff_expires_at) {
      s.buff_expires_at = 0;
      this.#emit('buffEnd');
    }
    if (s.player_down_until) {
      if (now >= s.player_down_until) this.#revive(now);
      return;
    }
    const interval = this.cfg.boss.attackIntervalMs;
    while (now >= s.next_boss_attack_at && !s.player_down_until) {
      s.next_boss_attack_at += interval;
      // After a long stall (e.g. a paused process) don't replay a backlog of attacks.
      if (s.next_boss_attack_at < now) s.next_boss_attack_at = now + interval;
      this.#bossAttack(now);
    }
  }

  snapshot(now = Date.now()) {
    const s = this.state;
    return {
      boss_level: s.boss_level,
      boss_hp: s.boss_hp,
      boss_max_hp: s.boss_max_hp,
      player_hp: s.player_hp,
      player_max_hp: s.player_max_hp,
      player_stage: s.player_stage,
      stage_name: this.cfg.stages[s.player_stage - 1].name,
      like_damage: this.likeDamage(now),
      buff_active: this.isBuffActive(now),
      buff_remaining_ms: Math.max(0, s.buff_expires_at - now),
      buff_duration_ms: this.cfg.buff.durationMs,
      buff_name: this.cfg.buff.name,
      player_down: s.player_down_until > 0,
      revive_in_ms: Math.max(0, s.player_down_until - now),
      totals: { ...s.totals },
    };
  }

  /** Dev helper used by the simulator to jump straight to a boss level. */
  debugSetBossLevel(level, now = Date.now()) {
    const s = this.state;
    s.boss_level = Math.max(0, Math.floor(level) - 1);
    s.boss_hp = s.boss_max_hp = bossMaxHp(s.boss_level, this.cfg);
    this.#damageBoss(s.boss_hp, now);
  }

  #isBuffTrigger(name, unitCoins) {
    const b = this.cfg.buff;
    const n = String(name).trim().toLowerCase();
    return b.giftNames.some((g) => g.toLowerCase() === n) || b.coinValues.includes(unitCoins);
  }

  #damageBoss(damage, now) {
    const s = this.state;
    let remaining = damage;
    let kills = 0;
    // Overkill carries into the next boss so a big gift is never wasted.
    while (remaining >= s.boss_hp && kills < this.cfg.boss.maxKillsPerHit) {
      remaining -= s.boss_hp;
      this.#defeatBoss(now);
      kills++;
    }
    s.boss_hp = Math.max(1, s.boss_hp - remaining);
  }

  #defeatBoss(now) {
    const s = this.state;
    s.boss_level += 1;
    s.boss_max_hp = bossMaxHp(s.boss_level, this.cfg);
    s.boss_hp = s.boss_max_hp;
    s.next_boss_attack_at = now + this.cfg.boss.attackIntervalMs;
    this.#emit('bossDefeated', { boss_level: s.boss_level, boss_max_hp: s.boss_max_hp });

    const stage = stageForLevel(s.boss_level, this.cfg);
    if (stage > s.player_stage) {
      const from = s.player_stage;
      s.player_stage = stage;
      s.player_max_hp = this.cfg.player.maxHpByStage[stage - 1];
      s.player_hp = s.player_max_hp;
      this.#emit('evolved', { from, stage, name: this.cfg.stages[stage - 1].name });
    }
  }

  #bossAttack(now) {
    const s = this.state;
    const b = this.cfg.boss;
    const damage = Math.round(b.baseDamage * (1 + b.damageGrowthPerLevel * s.boss_level));
    s.player_hp = Math.max(0, s.player_hp - damage);
    this.#emit('bossAttack', { damage });
    if (s.player_hp === 0) {
      // Losing costs the progress on the current boss, never the boss level.
      s.player_down_until = now + this.cfg.player.reviveMs;
      s.boss_hp = s.boss_max_hp;
      this.#emit('playerDown', { revive_ms: this.cfg.player.reviveMs });
    }
  }

  #revive(now) {
    const s = this.state;
    s.player_down_until = 0;
    s.player_hp = s.player_max_hp;
    s.next_boss_attack_at = now + this.cfg.boss.attackIntervalMs;
    this.#emit('revived');
  }
}
