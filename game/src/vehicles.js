// Solara City — vehicles: box-built cars, arcade driving physics, and
// enter/exit with E. Day 2 adds parked cars to steal, a shared car factory
// (buildCarMesh / spawnCar) that traffic and police build on, and theft
// tracking: taking a car that is not the player's own Solara GT is a crime
// the wanted system hears about.

const CAR_RADIUS = 1.7;
const MAX_SPEED = 32; // ~115 km/h
const MAX_REVERSE = 9;
const ENGINE = 11;
const BRAKE = 20;
const DRAG = 3.2;
const WHEEL_BASE = 2.9;

export function buildCarMesh(color) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x18222e, metalness: 0.7, roughness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.9 });
  const lightFront = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 0.9 });
  const lightRear = new THREE.MeshStandardMaterial({ color: 0xaa1111, emissive: 0xcc2222, emissiveIntensity: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.4), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.3), glass);
  cabin.position.set(0, 1.18, -0.25);
  cabin.castShadow = true;
  group.add(cabin);

  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.22, 0.3), dark);
  bumperF.position.set(0, 0.42, 2.2);
  group.add(bumperF);
  const bumperR = bumperF.clone();
  bumperR.position.z = -2.2;
  group.add(bumperR);

  for (const sx of [-0.62, 0.62]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), lightFront);
    head.position.set(sx, 0.74, 2.21);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), lightRear);
    tail.position.set(sx, 0.74, -2.21);
    group.add(tail);
  }

  // Wheels: steer pivot -> spin group -> cylinder, so steering and rolling
  // never fight over one rotation.
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
  const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.32, 10);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ac, metalness: 0.7, roughness: 0.35 });
  for (const [sx, sz, front] of [[-0.88, 1.45, true], [0.88, 1.45, true], [-0.88, -1.45, false], [0.88, -1.45, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 0.36, sz);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    spin.add(tire, hub);
    pivot.add(spin);
    group.add(pivot);
    wheels.push({ pivot, spin, front });
  }
  return { group, wheels };
}

export function createVehicleManager(scene, city) {
  const cars = [];

  const state = {
    cars,
    driven: null,
    speed: 0,
    steer: 0,
    // Set on the frame the player enters a car they do not own; main.js
    // reads it to raise the wanted level, then clears it.
    lastTheft: null,
    // Build a car, put it in the world and register it. opts: kind
    // ('player' | 'parked' | 'traffic' | 'police'), stealable, driver
    // ('parked' | 'traffic' | 'police' | 'player'), lift (y offset, for
    // cars parked on the raised sidewalk slabs).
    spawnCar(color, x, z, heading, opts = {}) {
      const car = buildCarMesh(color);
      car.group.position.set(x, opts.lift || 0, z);
      car.group.rotation.y = heading;
      car.kind = opts.kind || 'parked';
      car.stealable = opts.stealable !== undefined ? opts.stealable : true;
      car.driver = opts.driver || 'parked';
      car.stolen = false;
      scene.add(car.group);
      cars.push(car);
      return car;
    },
  };

  // The player's own car: a sunset-orange "Solara GT" on the road by the
  // spawn. Taking it is not a crime.
  state.spawnCar(0xff7a1a, 12, 30, Math.PI / 2, { kind: 'player', stealable: false });

  // Parked cars worth stealing: curbside spots the city offers, filtered
  // so none overlaps a building or sits on top of the player's own car.
  const parkedColors = [0x3f6fb5, 0xb8b0a0, 0x7a4a3a, 0x4a7a5a, 0x8a8f96, 0xc9a15a];
  const parkedSpots = city.parkedSpots().filter((s) => {
    if (Math.hypot(s.x - 12, s.z - 30) <= 10) return false;
    // The car is long and thin: check three small circles along its
    // length instead of one big one, so a building beside it does not
    // disqualify the spot.
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    for (const along of [-1.8, 0, 1.8]) {
      if (city.collideCircle(s.x + fx * along, s.z + fz * along, 1.3).hit) return false;
    }
    return true;
  });
  for (let i = 0; i < Math.min(6, parkedSpots.length); i++) {
    const s = parkedSpots[i];
    state.spawnCar(parkedColors[i % parkedColors.length], s.x, s.z, s.heading, {
      kind: 'parked',
      stealable: true,
      driver: 'parked',
      lift: 0.18,
    });
  }

  Object.assign(state, {
    // True when the driven car is within `radius` of (x, z) — day 3:
    // a mission delivery that only counts when the player drives in.
    isDrivingAt(x, z, radius = 5) {
      const c = state.driven;
      if (!c) return false;
      return Math.hypot(c.group.position.x - x, c.group.position.z - z) < radius;
    },
    // Nearest car within reach of the player, or null.
    nearestCar(playerPos, maxDist = 3.6) {
      let best = null;
      let bestD = maxDist;
      for (const c of cars) {
        const d = Math.hypot(c.group.position.x - playerPos.x, c.group.position.z - playerPos.z);
        if (d < bestD) {
          best = c;
          bestD = d;
        }
      }
      return best;
    },
    // E pressed this frame: enter the nearest car, or step out of the one
    // being driven. Returns true when the driving state changed.
    tryEnterExit(player, interactPressed) {
      if (!interactPressed) return false;
      if (state.driven) {
        const c = state.driven;
        // Step out on the car's right side, clear of the road centre.
        const sideX = Math.cos(c.group.rotation.y);
        const sideZ = -Math.sin(c.group.rotation.y);
        player.group.position.set(
          c.group.position.x + sideX * 2.4,
          0,
          c.group.position.z + sideZ * 2.4,
        );
        player.heading = c.group.rotation.y;
        player.group.rotation.y = player.heading;
        c.driver = 'parked'; // a stolen car stays where it is left
        state.driven = null;
        state.speed = 0;
        state.steer = 0;
        return true;
      }
      const near = state.nearestCar(player.group.position);
      if (near) {
        // A car parked on a sidewalk slab sits 0.18 up; drop it to the road.
        near.group.position.y = 0;
        near.driver = 'player';
        if (near.stealable && near.kind !== 'player' && !near.stolen) {
          near.stolen = true;
          state.lastTheft = near;
        }
        state.driven = near;
        state.speed = 0;
        state.steer = 0;
        return true;
      }
      return false;
    },
    update(dt, input, player) {
      const c = state.driven;
      if (!c) return;
      // Throttle / brake / reverse.
      if (input.f) state.speed += ENGINE * dt;
      else if (input.b) {
        state.speed += state.speed > 0.5 ? -BRAKE * dt : -ENGINE * 0.55 * dt;
      } else {
        const drag = DRAG * dt * (state.speed >= 0 ? 1 : -1);
        state.speed -= drag;
        if (Math.abs(state.speed) < 0.3 && !input.f && !input.b) state.speed = 0;
      }
      state.speed = Math.max(-MAX_REVERSE, Math.min(MAX_SPEED, state.speed));
      // Steering follows the speed: full lock only when slow.
      const steerTarget = ((input.l ? -1 : 0) + (input.r ? 1 : 0)) * 0.55 * Math.min(1, 0.35 + 5 / (Math.abs(state.speed) + 4));
      state.steer += (steerTarget - state.steer) * Math.min(1, 7 * dt);
      const yawRate = (state.speed / WHEEL_BASE) * Math.tan(state.steer);
      c.group.rotation.y += yawRate * dt;
      const fx = Math.sin(c.group.rotation.y);
      const fz = Math.cos(c.group.rotation.y);
      let nx = c.group.position.x + fx * state.speed * dt;
      let nz = c.group.position.z + fz * state.speed * dt;
      const fixed = city.collideCircle(nx, nz, CAR_RADIUS);
      if (fixed.hit) state.speed *= 0.35;
      nx = Math.max(city.bounds.min, Math.min(city.bounds.max, fixed.x));
      nz = Math.max(city.bounds.min, Math.min(city.bounds.max, fixed.z));
      c.group.position.x = nx;
      c.group.position.z = nz;
      // Wheels: fronts steer, all roll.
      for (const w of c.wheels) {
        if (w.front) w.pivot.rotation.y = state.steer;
        w.spin.rotation.x += (state.speed * dt) / 0.36;
      }
      // Keep the hidden player riding along, so exiting is always sane.
      player.group.position.set(c.group.position.x, 0, c.group.position.z);
      player.heading = c.group.rotation.y;
    },
  });
  return state;
}
