// Solara City — melee combat. F (or click) throws a punch: a short
// swing on foot that knocks down the pedestrian in front of the player.
// A punched pedestrian sometimes gets up angry and comes back swinging —
// their hits hurt, and at zero health the player wakes up back at the
// park spawn. Arcade-simple: no guns on day 3, fists are enough.

const PUNCH_RANGE = 2.3;
const PUNCH_COOLDOWN = 0.45;
const ANGRY_CHANCE = 0.35;

export function createCombat(opts = {}) {
  const player = opts.player;
  const pedestrians = opts.pedestrians;
  const onNotice = opts.onNotice || (() => {});
  const onPlayerDown = opts.onPlayerDown || (() => {});

  const state = {
    hp: 100,
    maxHp: 100,
    cooldown: 0,

    // One swing. Returns the pedestrian hit, or null on a whiff.
    punch() {
      if (state.cooldown > 0 || !player || !pedestrians) return null;
      state.cooldown = PUNCH_COOLDOWN;
      player.punchAnim = 0.35;
      const pp = player.group.position;
      const fx = Math.sin(player.heading);
      const fz = Math.cos(player.heading);
      let best = null;
      let bestD = PUNCH_RANGE;
      for (const p of pedestrians.peds) {
        if (p.state !== 'walk' && p.state !== 'angry') continue;
        const dx = p.group.position.x - pp.x;
        const dz = p.group.position.z - pp.z;
        const d = Math.hypot(dx, dz);
        if (d >= bestD) continue;
        // Only the pedestrian in front of the player, not behind them.
        if (d > 0.01 && (dx * fx + dz * fz) / d < 0.2) continue;
        best = p;
        bestD = d;
      }
      if (!best) return null;
      pedestrians.knockDown(best);
      if (Math.random() < ANGRY_CHANCE) best.willBeAngry = true;
      return best;
    },

    // A hit from an angry pedestrian.
    damage(amount) {
      if (state.hp <= 0) return;
      state.hp = Math.max(0, state.hp - amount);
      if (state.hp <= 0) {
        onNotice('You got beaten up! Woke up back at the park.');
        state.hp = state.maxHp;
        onPlayerDown();
      }
    },

    restore() {
      state.hp = state.maxHp;
    },

    update(dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
    },
  };
  return state;
}
