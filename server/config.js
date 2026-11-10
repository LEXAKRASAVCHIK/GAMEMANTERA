// All gameplay tuning lives here so balance changes never touch engine code.
export const CONFIG = {
  boss: {
    baseHp: 1000,
    hpGrowth: 1.5, // +50% max HP per level
    attackIntervalMs: 3000,
    baseDamage: 8,
    damageGrowthPerLevel: 0.15,
    // A single huge gift can chain-kill at most this many bosses.
    maxKillsPerHit: 5,
  },
  player: {
    maxHpByStage: [100, 180, 320, 600],
    reviveMs: 5000,
  },
  like: {
    damage: 1,
    maxPerEvent: 50,
  },
  gift: {
    burstMinCoins: 5,
    healMinCoins: 10,
    healPctPerCoin: 0.02, // 10 coins = 20% max HP, 50 coins = full heal
    minorDamagePerCoin: 5, // gifts under burstMinCoins
  },
  buff: {
    name: 'FLAME GREATSWORD',
    giftNames: ['Rose'], // case-insensitive match on gift name
    coinValues: [], // or trigger on an exact coin value, e.g. [30]
    durationMs: 30000,
    likeDamage: 2,
  },
  stages: [
    { stage: 1, name: 'Novice', minLevel: 0 },
    { stage: 2, name: 'Arena Knight', minLevel: 6 },
    { stage: 3, name: 'Mystic Warrior', minLevel: 16 },
    { stage: 4, name: 'Divine Champion', minLevel: 31 },
  ],
};
