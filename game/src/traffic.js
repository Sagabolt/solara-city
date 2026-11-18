// Solara City — traffic: cars that drive the road grid on their own.
// Each car runs one road in one direction, keeps its lane, follows the car
// ahead, stops at busy intersections and yields to the player. Traffic
// cars are built through the vehicle manager, so the player can steal one
// with E — and the wanted system notices.

const TRAFFIC_COLORS = [0x3f6fb5, 0xb8b0a0, 0x7a4a3a, 0x4a7a5a, 0x8a8f96, 0xc9a15a, 0x5a4a7a, 0x2e4a5a];
const COUNT = 14;
const LANE = 2.8; // right-hand lane offset from the road centre
const CAR_GAP_STOP = 5;
const CAR_GAP_FOLLOW = 14;
const CITY_EDGE = 146;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Heading for a car driving along `axis` in direction `dir`.
function headingFor(axis, dir) {
  if (axis === 'x') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

// Right-hand lane offset: driving +x keeps right at -z, driving +z at +x.
function laneOffset(axis, dir) {
  return (axis === 'x' ? -dir : dir) * LANE;
}

export function createTraffic(scene, city, vehicles) {
  const rand = mulberry32(20261119);
  const centers = city.getRoadCenters();
  const entries = [];

  // Spread the cars over the grid, clear of the spawn and the player's car.
  let guard = 0;
  while (entries.length < COUNT && guard++ < 400) {
    const axis = rand() < 0.5 ? 'x' : 'z';
    const road = centers[Math.floor(rand() * centers.length)];
    const dir = rand() < 0.5 ? 1 : -1;
    const s = -140 + rand() * 280;
    const x = axis === 'x' ? s : road + laneOffset(axis, dir);
    const z = axis === 'x' ? road + laneOffset(axis, dir) : s;
    if (Math.hypot(x - 12, z - 30) < 16) continue; // the Solara GT
    if (Math.hypot(x + 4, z - 30) < 12) continue; // the spawn
    let crowded = false;
    for (const e of entries) {
      if (Math.hypot(e.x - x, e.z - z) < 14) { crowded = true; break; }
    }
    if (crowded) continue;
    const color = TRAFFIC_COLORS[Math.floor(rand() * TRAFFIC_COLORS.length)];
    const car = vehicles.spawnCar(color, x, z, headingFor(axis, dir), {
      kind: 'traffic',
      stealable: true,
      driver: 'traffic',
    });
    entries.push({
      car,
      axis,
      road,
      dir,
      s,
      speed: 0,
      cruise: 8 + rand() * 6,
      x,
      z,
    });
  }

  const state = {
    entries,
    crashCooldown: 0,
    // Drive every traffic car one frame. Returns true when the player's
    // car has just hit a traffic car hard (a fresh crash this frame).
    update(dt, player, vehicles) {
      let crashed = false;
      state.crashCooldown = Math.max(0, state.crashCooldown - dt);
      const driven = vehicles.driven;
      const playerPos = player.group.position;

      for (const e of entries) {
        if (e.car.driver !== 'traffic') continue; // stolen or parked now
        // World position follows the lane geometry exactly.
        e.x = e.axis === 'x' ? e.s : e.road + laneOffset(e.axis, e.dir);
        e.z = e.axis === 'x' ? e.road + laneOffset(e.axis, e.dir) : e.s;

        let target = e.cruise;

        // Car-following: match or stop behind the car ahead in our lane.
        for (const o of entries) {
          if (o === e || o.car.driver !== 'traffic') continue;
          if (o.axis !== e.axis || o.road !== e.road || o.dir !== e.dir) continue;
          const gap = (o.s - e.s) * e.dir;
          if (gap > 0 && gap < CAR_GAP_FOLLOW) {
            target = gap < CAR_GAP_STOP ? 0 : Math.min(target, o.speed);
          }
        }

        // Intersections: stop before a crossing that is busy right now.
        for (const c of centers) {
          const d = (c - e.s) * e.dir;
          if (d <= 0 || d >= 16) continue;
          let busy = false;
          for (const o of entries) {
            if (o === e || o.car.driver !== 'traffic') continue;
            const ox = o.axis === 'x' ? o.s : o.road + laneOffset(o.axis, o.dir);
            const oz = o.axis === 'x' ? o.road + laneOffset(o.axis, o.dir) : o.s;
            const ix = e.axis === 'x' ? c : e.road;
            const iz = e.axis === 'x' ? e.road : c;
            if (Math.abs(ox - ix) < 8 && Math.abs(oz - iz) < 8) { busy = true; break; }
          }
          if (busy) target = d < 9.5 ? 0 : Math.min(target, 5);
        }

        // Yield to the player: stop for their car ahead, or for them on foot.
        if (driven) {
          const px = driven.group.position.x;
          const pz = driven.group.position.z;
          const along = e.axis === 'x' ? (px - e.s) * e.dir : (pz - e.s) * e.dir;
          const across = e.axis === 'x' ? Math.abs(pz - e.z) : Math.abs(px - e.x);
          if (along > 0 && along < CAR_GAP_FOLLOW && across < 3) {
            target = along < CAR_GAP_STOP ? 0 : Math.min(target, Math.max(0, vehicles.speed));
          }
        } else {
          const along = e.axis === 'x' ? (playerPos.x - e.s) * e.dir : (playerPos.z - e.s) * e.dir;
          const across = e.axis === 'x' ? Math.abs(playerPos.z - e.z) : Math.abs(playerPos.x - e.x);
          if (along > 0 && along < 8 && across < 2.5) target = 0;
        }

        // Ease toward the target speed, then roll along the road.
        const rate = target < e.speed ? 16 : 6;
        e.speed += Math.max(-rate * dt, Math.min(rate * dt, target - e.speed));
        e.s += e.dir * e.speed * dt;
        if (Math.abs(e.s) > CITY_EDGE) e.dir *= -1; // U-turn at the edge
        e.x = e.axis === 'x' ? e.s : e.road + laneOffset(e.axis, e.dir);
        e.z = e.axis === 'x' ? e.road + laneOffset(e.axis, e.dir) : e.s;
        e.car.group.position.set(e.x, 0, e.z);
        e.car.group.rotation.y = headingFor(e.axis, e.dir);
        for (const w of e.car.wheels) w.spin.rotation.x += (e.speed * dt) / 0.36;

        // The player hit this car: a hard hit is a crime, and it shoves us.
        if (driven) {
          const d = Math.hypot(driven.group.position.x - e.x, driven.group.position.z - e.z);
          if (d < 3.4 && Math.abs(vehicles.speed) > 6 && state.crashCooldown <= 0) {
            state.crashCooldown = 1.5;
            e.speed *= 0.3;
            crashed = true;
          }
        } else {
          // A traffic car that reaches the player on foot stops and shoves
          // them aside instead of driving through them.
          const d = Math.hypot(playerPos.x - e.x, playerPos.z - e.z);
          if (d < 1.9 && e.speed > 3) {
            player.shove(playerPos.x - e.x, playerPos.z - e.z, 1.6, city);
            e.speed = 0;
          }
        }
      }
      return crashed;
    },
  };
  return state;
}
