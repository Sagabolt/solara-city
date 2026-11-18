// Solara City — the player on foot: a box-built third-person character
// with WASD movement relative to the camera, run on Shift, and a simple
// leg/arm swing while walking. Collides with the city as a circle.

const WALK_SPEED = 5.5;
const RUN_SPEED = 9.5;
const ACCEL = 34;
const RADIUS = 0.55;

function limb(material, w, h, d, x, y) {
  // A limb hangs from a pivot group at its top so rotation swings it.
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.y = -h / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

export function createPlayer(scene) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x1f8a70, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.95 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.68, 0.32), shirt);
  torso.position.y = 1.16;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  group.add(head);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.34), hairMat);
  hair.position.y = 1.87;
  group.add(hair);

  // Face direction is +z: nose and cap brim point the way the player faces.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), skin);
  nose.position.set(0, 1.66, 0.2);
  group.add(nose);

  const legL = limb(pants, 0.22, 0.8, 0.24, -0.16, 0.82);
  const legR = limb(pants, 0.22, 0.8, 0.24, 0.16, 0.82);
  const armL = limb(shirt, 0.17, 0.62, 0.2, -0.39, 1.46);
  const armR = limb(shirt, 0.17, 0.62, 0.2, 0.39, 1.46);
  group.add(legL, legR, armL, armR);
  scene.add(group);

  const state = {
    group,
    heading: Math.PI, // facing -z, down the road at spawn
    speed: 0,
    walkPhase: 0,
    velX: 0,
    velZ: 0,
    radius: RADIUS,
    // Melee swing timer (day 3, set by combat): while it runs the right
    // arm throws the punch instead of following the walk swing.
    punchAnim: 0,
    // Shove the player away from (dx, dz) — a traffic car or a police
    // cruiser that ran into them on foot. Collides like a normal step.
    shove(dx, dz, amount, city) {
      const len = Math.hypot(dx, dz) || 1;
      const nx = group.position.x + (dx / len) * amount;
      const nz = group.position.z + (dz / len) * amount;
      const fixed = city.collideCircle(nx, nz, RADIUS);
      group.position.x = Math.max(city.bounds.min, Math.min(city.bounds.max, fixed.x));
      group.position.z = Math.max(city.bounds.min, Math.min(city.bounds.max, fixed.z));
      state.velX = (dx / len) * amount * 2;
      state.velZ = (dz / len) * amount * 2;
    },
    // Move the player for one frame. input: { f, b, l, r, run } booleans.
    // cameraYaw steers WASD relative to the camera. driving hides the mesh.
    update(dt, input, cameraYaw, city, driving) {
      if (driving) {
        group.visible = false;
        state.speed = 0;
        state.velX = 0;
        state.velZ = 0;
        return;
      }
      group.visible = true;
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      // Camera looks toward (-sin, 0, -cos); W walks that way.
      const fwdX = -sin;
      const fwdZ = -cos;
      const rightX = cos;
      const rightZ = -sin;
      let mx = fwdX * ((input.f ? 1 : 0) - (input.b ? 1 : 0)) + rightX * ((input.r ? 1 : 0) - (input.l ? 1 : 0));
      let mz = fwdZ * ((input.f ? 1 : 0) - (input.b ? 1 : 0)) + rightZ * ((input.r ? 1 : 0) - (input.l ? 1 : 0));
      const len = Math.hypot(mx, mz);
      if (len > 0) {
        mx /= len;
        mz /= len;
      }
      const target = input.run ? RUN_SPEED : WALK_SPEED;
      const tx = mx * target;
      const tz = mz * target;
      const k = Math.min(1, (ACCEL * dt) / Math.max(1, target));
      state.velX += (tx - state.velX) * k;
      state.velZ += (tz - state.velZ) * k;
      let nx = group.position.x + state.velX * dt;
      let nz = group.position.z + state.velZ * dt;
      const fixed = city.collideCircle(nx, nz, RADIUS);
      if (fixed.hit) {
        state.velX *= 0.4;
        state.velZ *= 0.4;
      }
      nx = Math.max(city.bounds.min, Math.min(city.bounds.max, fixed.x));
      nz = Math.max(city.bounds.min, Math.min(city.bounds.max, fixed.z));
      group.position.x = nx;
      group.position.z = nz;
      state.speed = Math.hypot(state.velX, state.velZ);
      if (state.speed > 0.4) {
        const targetHeading = Math.atan2(state.velX, state.velZ);
        let diff = targetHeading - state.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        state.heading += diff * Math.min(1, 12 * dt);
        group.rotation.y = state.heading;
        state.walkPhase += state.speed * dt * 1.7;
      }
      const swing = Math.sin(state.walkPhase) * 0.55 * Math.min(1, state.speed / WALK_SPEED);
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.8;
      armR.rotation.x = swing * 0.8;
      // Punch swing overrides the walk swing while it runs.
      if (state.punchAnim > 0) {
        state.punchAnim = Math.max(0, state.punchAnim - dt);
        const progress = 1 - state.punchAnim / 0.35;
        armR.rotation.x = -2.2 * Math.sin(progress * Math.PI);
      }
    },
  };
  return state;
}
