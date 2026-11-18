// Solara City — police and the wanted system. Crimes add heat; heat sets
// the star level; stars decide how many Solara PD cruisers hunt the
// player. Hide long enough and the heat cools off; get caught standing
// still next to a cruiser and it is over — busted.

const HEAT_FOR_STAR = [0, 1, 3, 6, 10, 15]; // heat needed for 0..5 stars
const POLICE_TOP_SPEED = [0, 26, 28, 31, 33, 35];
const WHEEL_BASE = 2.9;
const BUSTED_HOLD = 2.5; // seconds a cruiser must sit on the player

function starsFromHeat(heat) {
  let stars = 0;
  for (let i = 0; i < HEAT_FOR_STAR.length; i++) {
    if (heat >= HEAT_FOR_STAR[i]) stars = i;
  }
  return stars;
}

export function createPolice(scene, city, vehicles, opts = {}) {
  const state = {
    heat: 0,
    wanted: 0, // stars, 0..5
    time: 0,
    lastCrimeAt: -999,
    escapeTimer: 0,
    bustedTimer: 0,
    policeCars: [], // { car, speed, steer, stuckTimer, ramCooldown, lightL, lightR }
    onBusted: opts.onBusted || (() => {}),

    raiseWanted(amount) {
      state.heat += amount;
      state.lastCrimeAt = state.time;
      state.escapeTimer = 0;
      state.wanted = starsFromHeat(state.heat);
    },

    // Set the wanted level directly (day 3: a mission opens at 3 stars).
    setWanted(stars) {
      const level = Math.max(0, Math.min(5, stars));
      state.heat = HEAT_FOR_STAR[level];
      state.wanted = level;
      state.lastCrimeAt = state.time;
      state.escapeTimer = 0;
      state.bustedTimer = 0;
    },

    clearWanted() {
      state.heat = 0;
      state.wanted = 0;
      state.escapeTimer = 0;
      state.bustedTimer = 0;
      for (const entry of state.policeCars) {
        scene.remove(entry.car.group);
        const i = vehicles.cars.indexOf(entry.car);
        if (i !== -1) vehicles.cars.splice(i, 1);
      }
      state.policeCars = [];
    },

    update(dt, player, vehicles) {
      state.time += dt;
      const playerPos = player.group.position;
      const driving = !!vehicles.driven;
      const playerSpeed = driving ? Math.abs(vehicles.speed) : player.speed;

      // Heat cools when the player keeps their nose clean for a while.
      if (state.time - state.lastCrimeAt > 12 && state.heat > 0) {
        state.heat = Math.max(0, state.heat - 0.12 * dt);
        state.wanted = starsFromHeat(state.heat);
      }

      // Hiding: no cruiser close for a while sheds heat fast.
      let nearest = Infinity;
      for (const e of state.policeCars) {
        nearest = Math.min(nearest, Math.hypot(
          e.car.group.position.x - playerPos.x,
          e.car.group.position.z - playerPos.z,
        ));
      }
      if (state.wanted > 0) {
        if (nearest > 45) {
          state.escapeTimer += dt;
          if (state.escapeTimer > 6) {
            state.heat = Math.max(0, state.heat - 1.5 * dt);
            state.wanted = starsFromHeat(state.heat);
          }
        } else {
          state.escapeTimer = 0;
        }
      }

      // Keep the cruiser count matched to the wanted level.
      const desired = state.wanted === 0 ? 0 : state.wanted >= 3 ? 3 : state.wanted;
      while (state.policeCars.length < desired) state.spawnPoliceCar(playerPos);
      while (state.policeCars.length > desired) {
        const entry = state.policeCars.pop();
        scene.remove(entry.car.group);
        const i = vehicles.cars.indexOf(entry.car);
        if (i !== -1) vehicles.cars.splice(i, 1);
      }

      let nearestChase = Infinity;
      for (const entry of [...state.policeCars]) {
        const car = entry.car;
        const cx = car.group.position.x;
        const cz = car.group.position.z;
        const dx = playerPos.x - cx;
        const dz = playerPos.z - cz;
        const dist = Math.hypot(dx, dz);
        nearestChase = Math.min(nearestChase, dist);

        // Chase the player, leading them a little.
        const lead = 0.4;
        const leadX = driving
          ? Math.sin(vehicles.driven.group.rotation.y) * vehicles.speed * lead
          : player.velX * lead;
        const leadZ = driving
          ? Math.cos(vehicles.driven.group.rotation.y) * vehicles.speed * lead
          : player.velZ * lead;
        const tx = playerPos.x + leadX;
        const tz = playerPos.z + leadZ;
        let wantHeading = Math.atan2(tx - cx, tz - cz);
        let diff = wantHeading - car.group.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const steerTarget = Math.max(-0.55, Math.min(0.55, diff * 1.6));
        entry.steer += (steerTarget - entry.steer) * Math.min(1, 6 * dt);

        const top = POLICE_TOP_SPEED[state.wanted] || 26;
        // Approach profile: slow down as we close in, and stop on the
        // player — a cruiser that screams past at full speed can never
        // make the arrest, it just orbits.
        let targetSpeed;
        if (dist < 2.5) targetSpeed = 0;
        else if (dist < 30) targetSpeed = Math.min(top, Math.max(playerSpeed, dist * 0.6));
        else targetSpeed = top;
        if (dist < 7) targetSpeed = Math.min(targetSpeed, playerSpeed + 3);
        const rate = targetSpeed < entry.speed ? 30 : 10;
        entry.speed += Math.max(-rate * dt, Math.min(rate * dt, targetSpeed - entry.speed));
        car.group.rotation.y += (entry.speed / WHEEL_BASE) * Math.tan(entry.steer) * dt;
        const fx = Math.sin(car.group.rotation.y);
        const fz = Math.cos(car.group.rotation.y);
        let nx = cx + fx * entry.speed * dt;
        let nz = cz + fz * entry.speed * dt;
        const fixed = city.collideCircle(nx, nz, 1.7);
        if (fixed.hit) entry.speed *= 0.4;
        nx = Math.max(city.bounds.min, Math.min(city.bounds.max, fixed.x));
        nz = Math.max(city.bounds.min, Math.min(city.bounds.max, fixed.z));
        car.group.position.x = nx;
        car.group.position.z = nz;
        for (const w of car.wheels) {
          w.spin.rotation.x += (entry.speed * dt) / 0.36;
        }

        // Stuck against a building: respawn on a road near the player.
        if (entry.speed < 1.5 && dist > 12) {
          entry.stuckTimer += dt;
          if (entry.stuckTimer > 2.5) {
            const spot = pickSpawnSpot(playerPos, city);
            car.group.position.set(spot.x, 0, spot.z);
            car.group.rotation.y = Math.atan2(playerPos.x - spot.x, playerPos.z - spot.z);
            entry.speed = 0;
            entry.stuckTimer = 0;
          }
        } else {
          entry.stuckTimer = 0;
        }

        // Flashing light bar: red and blue take turns.
        const phase = Math.sin(state.time * 10 + state.policeCars.indexOf(entry) * 2.1);
        entry.lightL.material.emissiveIntensity = phase > 0 ? 2.4 : 0.15;
        entry.lightR.material.emissiveIntensity = phase > 0 ? 0.15 : 2.4;

        // Ram the player's car, or shove them on foot.
        entry.ramCooldown = Math.max(0, entry.ramCooldown - dt);
        if (driving && dist < 3.4 && entry.ramCooldown <= 0) {
          entry.ramCooldown = 0.6;
          vehicles.speed *= 0.7;
          const push = 0.7;
          vehicles.driven.group.position.x += (dx / Math.max(0.1, dist)) * -push;
          vehicles.driven.group.position.z += (dz / Math.max(0.1, dist)) * -push;
        } else if (!driving && dist < 1.7) {
          player.shove(playerPos.x - cx, playerPos.z - cz, 1.4, city);
        }
      }

      // Caught: any cruiser sitting on a slow player ends the run. This is
      // decided once per frame, not per cruiser — a far cruiser must not
      // cancel the one that has the player cornered.
      if (nearestChase < 3.5 && playerSpeed < 3) {
        state.bustedTimer += dt;
        if (state.bustedTimer > BUSTED_HOLD) {
          state.bustedTimer = 0;
          state.onBusted();
          return;
        }
      } else {
        state.bustedTimer = Math.max(0, state.bustedTimer - dt * 2);
      }
    },

    spawnPoliceCar(playerPos) {
      const spot = pickSpawnSpot(playerPos, city);
      const heading = Math.atan2(playerPos.x - spot.x, playerPos.z - spot.z);
      const car = vehicles.spawnCar(0x14161c, spot.x, spot.z, heading, {
        kind: 'police',
        stealable: true,
        driver: 'police',
      });
      // Black-and-white cruiser: a white door band and a red/blue light bar.
      const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.3 });
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.3, 1.6), white);
      band.position.set(0, 0.62, 0.4);
      car.group.add(band);
      const lightLMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, emissive: 0xff2222, emissiveIntensity: 2 });
      const lightRMat = new THREE.MeshStandardMaterial({ color: 0x2244cc, emissive: 0x2244ff, emissiveIntensity: 2 });
      const lightGeo = new THREE.BoxGeometry(0.62, 0.14, 0.34);
      const lightL = new THREE.Mesh(lightGeo, lightLMat);
      lightL.position.set(-0.36, 1.52, -0.25);
      const lightR = new THREE.Mesh(lightGeo, lightRMat);
      lightR.position.set(0.36, 1.52, -0.25);
      car.group.add(lightL, lightR);
      state.policeCars.push({
        car,
        speed: 0,
        steer: 0,
        stuckTimer: 0,
        ramCooldown: 0,
        lightL,
        lightR,
      });
    },
  };
  return state;
}

// A road point 35–70 m from the player, closest to 50 m.
function pickSpawnSpot(playerPos, city) {
  const centers = city.getRoadCenters();
  let best = { x: playerPos.x + 50, z: playerPos.z };
  let bestScore = Infinity;
  for (let i = 0; i < 10; i++) {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const road = centers[Math.floor(Math.random() * centers.length)];
    const s = -140 + Math.random() * 280;
    const x = axis === 'x' ? s : road;
    const z = axis === 'x' ? road : s;
    const d = Math.hypot(x - playerPos.x, z - playerPos.z);
    const score = Math.abs(d - 50) + (d < 35 || d > 70 ? 100 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { x, z };
    }
  }
  return best;
}
