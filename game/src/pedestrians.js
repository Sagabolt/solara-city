// Solara City — pedestrians: people walking the sidewalks. Each one
// strolls a curb line, turns at the city edge, sometimes crosses at an
// intersection, and keeps out of buildings. Knock one down and they fall,
// get up, and run — and the wanted system hears about it.

const COUNT = 16;
const CURB = 8.5; // sidewalk edge, just off the road
const CITY_EDGE = 142;

const SHIRTS = [0xd95f4b, 0x4b7ad9, 0xe8c84d, 0x7a4bd9, 0x4bd98a, 0xd94b9e, 0xe8e8e8, 0x2e3440];
const PANTS = [0x2e3440, 0x5a4632, 0x3a4a5a, 0x6a6a6a];
const SKINS = [0xc98d64, 0x8a5a3a, 0xe8b88a, 0x5a3a22];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function headingFor(axis, dir) {
  if (axis === 'x') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

function limb(material, w, h, d, x, y) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.y = -h / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

function buildPedMesh(shirtColor, pantsColor, skinColor) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), shirt);
  torso.position.y = 1.12;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = 1.6;
  head.castShadow = true;
  group.add(head);
  const legL = limb(pants, 0.2, 0.76, 0.22, -0.14, 0.8);
  const legR = limb(pants, 0.2, 0.76, 0.22, 0.14, 0.8);
  const armL = limb(shirt, 0.15, 0.58, 0.18, -0.35, 1.4);
  const armR = limb(shirt, 0.15, 0.58, 0.18, 0.35, 1.4);
  group.add(legL, legR, armL, armR);
  return { group, legL, legR, armL, armR };
}

export function createPedestrians(scene, city) {
  const rand = mulberry32(20261119);
  const centers = city.getRoadCenters();
  const peds = [];

  for (let i = 0; i < COUNT; i++) {
    const axis = rand() < 0.5 ? 'x' : 'z';
    const road = centers[Math.floor(rand() * centers.length)];
    const dir = rand() < 0.5 ? 1 : -1;
    const s = -140 + rand() * 280;
    const side = rand() < 0.5 ? 1 : -1;
    const mesh = buildPedMesh(
      SHIRTS[Math.floor(rand() * SHIRTS.length)],
      PANTS[Math.floor(rand() * PANTS.length)],
      SKINS[Math.floor(rand() * SKINS.length)],
    );
    scene.add(mesh.group);
    peds.push({
      ...mesh,
      axis,
      road,
      dir,
      s,
      side,
      lat: side * CURB,
      speed: 1.1 + rand() * 0.9,
      walkPhase: rand() * Math.PI * 2,
      state: 'walk', // 'walk' | 'down' | 'flee' | 'angry'
      timer: 0,
      switchCooldown: 0,
      // Day 3: a punched pedestrian may get up angry and come swinging.
      willBeAngry: false,
      attackCooldown: 0,
    });
  }

  const state = {
    peds,
    // Knock one pedestrian down (day 3: a punch, or the player running
    // into them). Returns the pedestrian, for callers that mark them.
    knockDown(ped) {
      if (ped.state === 'down') return ped;
      ped.state = 'down';
      ped.timer = 3;
      ped.group.rotation.x = -Math.PI / 2; // flat on their back
      return ped;
    },
    update(dt, player, hooks = {}) {
      const pp = player.group.position;
      for (const p of peds) {
        p.switchCooldown = Math.max(0, p.switchCooldown - dt);

        if (p.state === 'down') {
          p.timer -= dt;
          if (p.timer <= 0) {
            // Up again — angry ones come back swinging, the rest run.
            if (p.willBeAngry) {
              p.willBeAngry = false;
              p.state = 'angry';
              p.timer = 8;
            } else {
              p.state = 'flee';
              p.timer = 4;
            }
            p.group.rotation.x = 0;
          }
          continue;
        }

        if (p.state === 'angry') {
          p.timer -= dt;
          p.attackCooldown = Math.max(0, p.attackCooldown - dt);
          // Chase the player across the sidewalk and swing at them.
          const dx = pp.x - p.group.position.x;
          const dz = pp.z - p.group.position.z;
          const d = Math.hypot(dx, dz) || 1;
          p.group.rotation.y = Math.atan2(dx, dz);
          if (d > 1.2) {
            let nx = p.group.position.x + (dx / d) * 4.2 * dt;
            let nz = p.group.position.z + (dz / d) * 4.2 * dt;
            const fixed = city.collideCircle(nx, nz, 0.5);
            nx = fixed.x;
            nz = fixed.z;
            p.group.position.set(nx, 0, nz);
            p.s = p.axis === 'x' ? nx : nz;
            p.walkPhase += 4.2 * dt * 1.7;
            const swing = Math.sin(p.walkPhase) * 0.5;
            p.legL.rotation.x = swing;
            p.legR.rotation.x = -swing;
            p.armL.rotation.x = -swing * 0.8;
            p.armR.rotation.x = swing * 0.8;
          } else if (p.attackCooldown <= 0) {
            p.attackCooldown = 1;
            p.armR.rotation.x = -2.0; // a wild swing at the player
            player.shove(pp.x - p.group.position.x, pp.z - p.group.position.z, 1.2, city);
            if (hooks.onPedAttack) hooks.onPedAttack(12);
          }
          if (p.timer <= 0) {
            p.state = 'flee';
            p.timer = 4;
          }
          continue;
        }

        const speed = p.state === 'flee' ? 7 : p.speed;
        if (p.state === 'flee') {
          p.timer -= dt;
          // Run away from the player along the current road.
          const along = p.axis === 'x' ? pp.x : pp.z;
          p.dir = p.s >= along ? 1 : -1;
          if (p.timer <= 0) p.state = 'walk';
        } else if (p.switchCooldown <= 0) {
          // At an intersection, sometimes cross onto the other road.
          for (const c of centers) {
            if (Math.abs(p.s - c) < 2) {
              p.switchCooldown = 3;
              if (rand() < 0.3) {
                const newRoad = c;
                const newS = p.road + p.lat;
                p.axis = p.axis === 'x' ? 'z' : 'x';
                p.road = newRoad;
                p.s = newS;
                p.dir = rand() < 0.5 ? 1 : -1;
                p.side = rand() < 0.5 ? 1 : -1;
                p.lat = p.side * CURB;
              }
              break;
            }
          }
        }

        p.s += p.dir * speed * dt;
        if (Math.abs(p.s) > CITY_EDGE) p.dir *= -1;

        // Drift back to the curb line, then stay out of buildings.
        p.lat += (p.side * CURB - p.lat) * Math.min(1, 1.5 * dt);
        let x = p.axis === 'x' ? p.s : p.road + p.lat;
        let z = p.axis === 'x' ? p.road + p.lat : p.s;
        const fixed = city.collideCircle(x, z, 0.5);
        x = fixed.x;
        z = fixed.z;
        p.s = p.axis === 'x' ? x : z;
        p.lat = (p.axis === 'x' ? z : x) - p.road;

        p.group.position.set(x, 0, z);
        p.group.rotation.y = headingFor(p.axis, p.dir);
        p.walkPhase += speed * dt * 1.7;
        const swing = Math.sin(p.walkPhase) * 0.5 * Math.min(1, speed / 2);
        p.legL.rotation.x = swing;
        p.legR.rotation.x = -swing;
        p.armL.rotation.x = -swing * 0.8;
        p.armR.rotation.x = swing * 0.8;
      }
    },
    // True when the player has just knocked a pedestrian down this frame.
    // A car needs speed to do it; on foot any touch counts.
    checkPlayerHit(playerPos, driving, playerSpeed) {
      for (const p of peds) {
        if (p.state !== 'walk') continue;
        const d = Math.hypot(p.group.position.x - playerPos.x, p.group.position.z - playerPos.z);
        const reach = driving ? 2.2 : 1.1;
        if (d < reach && (!driving || Math.abs(playerSpeed) > 3)) {
          state.knockDown(p);
          return true;
        }
      }
      return false;
    },
  };
  return state;
}
