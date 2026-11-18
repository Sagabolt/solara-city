// Solara City — procedural open-world city: road grid, buildings, palms,
// streetlights, warm sun and a hazy sky. Everything is generated here from
// code; the game loads no external assets and makes no network requests.
//
// Layout: 5 x 5 blocks on a 60 m pitch. Block centres sit at -120, -60, 0,
// 60, 120 on both axes; roads are the 12 m gaps between blocks plus an
// outer ring, so the drivable city spans -150 .. 150 on x and z.

const BLOCK_PITCH = 60;
const BLOCK_SIZE = 48;
const GRID = 5;
const HALF = (GRID * BLOCK_PITCH) / 2; // 150
const ROAD_CENTERS = [-144, -90, -30, 30, 90, 144];
const ROAD_HALF = 6;
const ROAD_WIDTH = ROAD_HALF * 2;

// Warm daylight palette: sun-bleached sand, terracotta, cream, muted teal.
const FACADE_BASES = ['#d9b48f', '#c98f6b', '#e8dcc3', '#9db8a6', '#c9a15a', '#b98d7e'];
const ROOF_COLOR = 0x5a5148;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One shared canvas per facade variant: a window grid with some windows
// lit warm. Buildings clone the texture and set their own repeat so the
// windows stay roughly 3 m wide whatever the building's size.
function makeFacadeTexture(base, litRatio, rand) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 512);
  // Subtle vertical shading so flat faces read as concrete panels.
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let x = 0; x < 256; x += 64) ctx.fillRect(x, 0, 2, 512);
  const cols = 6;
  const rows = 12;
  const cellW = 256 / cols;
  const cellH = 512 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = rand() < litRatio;
      ctx.fillStyle = lit ? '#ffd98a' : '#2c3542';
      ctx.fillRect(c * cellW + 7, r * cellH + 8, cellW - 14, cellH - 16);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(c * cellW + 7, r * cellH + 8, cellW - 14, 4);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function box(w, h, d, material, x, y, z, shadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

export function createCity(scene) {
  const rand = mulberry32(20261118);
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];

  // Sky dome: warm haze at the horizon rising to a clear blue.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x5f9fd0) },
      mid: { value: new THREE.Color(0xbfd9e8) },
      low: { value: new THREE.Color(0xf7cf9a) },
    },
    vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vPos; uniform vec3 top; uniform vec3 mid; uniform vec3 low; void main(){ float h = normalize(vPos).y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.65, h)) : mix(low, mid, smoothstep(-0.08, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(650, 24, 16), skyMat);
  sky.renderOrder = -1;
  group.add(sky);

  // Sun + sky fill, warm afternoon light.
  const sun = new THREE.DirectionalLight(0xffe3b3, 2.8);
  sun.position.set(140, 200, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -170;
  sun.shadow.camera.right = 170;
  sun.shadow.camera.top = 170;
  sun.shadow.camera.bottom = -170;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 520;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x9a7f57, 0.85));
  scene.fog = new THREE.Fog(0xe8d9b8, 200, 480);

  // Ground: warm sandy concrete under everything.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 220, HALF * 2 + 220),
    new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Roads: dark asphalt strips, verticals a touch lower than horizontals
  // so their crossing faces never z-fight.
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x33363d, roughness: 0.95 });
  for (const c of ROAD_CENTERS) {
    group.add(box(ROAD_WIDTH, 0.04, HALF * 2, asphalt, c, 0.02, 0, false));
    group.add(box(HALF * 2, 0.04, ROAD_WIDTH, asphalt, 0, 0.035, c, false));
  }

  // Centre dashes, one instanced mesh for all roads.
  const dashGeo = new THREE.BoxGeometry(0.3, 0.02, 3);
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xe8d44d, roughness: 0.8 });
  const dashSpots = [];
  for (const c of ROAD_CENTERS) {
    for (let t = -HALF + 8; t < HALF - 4; t += 8) {
      dashSpots.push([c, t, 0]);
      dashSpots.push([t, c, 1]);
    }
  }
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashSpots.length);
  const m4 = new THREE.Matrix4();
  dashSpots.forEach(([a, b, vertical], i) => {
    m4.makeRotationY(vertical ? Math.PI / 2 : 0);
    m4.setPosition(vertical ? a : b, 0.06, vertical ? b : a);
    dashes.setMatrixAt(i, m4);
  });
  dashes.receiveShadow = true;
  group.add(dashes);

  // Facade texture variants, shared across buildings.
  const facades = FACADE_BASES.map((base) => makeFacadeTexture(base, 0.22, rand));
  const roofMat = new THREE.MeshStandardMaterial({ color: ROOF_COLOR, roughness: 1 });

  // Buildings: each block splits into 2 x 2 lots. The centre block is a
  // park instead of buildings, so the spawn view opens onto green.
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 1 });
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x6f9a52, roughness: 1 });
  for (let bi = 0; bi < GRID; bi++) {
    for (let bj = 0; bj < GRID; bj++) {
      const cx = (bi - (GRID - 1) / 2) * BLOCK_PITCH;
      const cz = (bj - (GRID - 1) / 2) * BLOCK_PITCH;
      // Sidewalk slab, slightly raised.
      group.add(box(BLOCK_SIZE, 0.18, BLOCK_SIZE, sidewalkMat, cx, 0.09, cz, false));
      if (bi === 2 && bj === 2) {
        // Central park: lawn slab over the sidewalk.
        const lawn = box(BLOCK_SIZE - 4, 0.1, BLOCK_SIZE - 4, parkMat, cx, 0.22, cz, false);
        group.add(lawn);
        continue;
      }
      for (let li = 0; li < 2; li++) {
        for (let lj = 0; lj < 2; lj++) {
          if (rand() < 0.12) continue; // empty lot: breathing room
          const w = 15 + rand() * 6;
          const d = 15 + rand() * 6;
          const h = 9 + Math.pow(rand(), 1.6) * 36;
          const lx = cx + (li - 0.5) * (BLOCK_SIZE / 2);
          const lz = cz + (lj - 0.5) * (BLOCK_SIZE / 2);
          const facade = facades[Math.floor(rand() * facades.length)].clone();
          facade.needsUpdate = true;
          facade.repeat.set(Math.max(1, Math.round(w / 15)), Math.max(1, Math.round(h / 30)));
          const side = new THREE.MeshStandardMaterial({ map: facade, roughness: 0.9 });
          const building = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            [side, side, roofMat, roofMat, side, side],
          );
          building.position.set(lx, h / 2 + 0.18, lz);
          building.castShadow = true;
          building.receiveShadow = true;
          group.add(building);
          colliders.push({ minX: lx - w / 2, maxX: lx + w / 2, minZ: lz - d / 2, maxZ: lz + d / 2 });
          // Rooftop AC box on some roofs, for a livelier skyline.
          if (rand() < 0.4) {
            const ac = box(2.2, 1.1, 1.6, roofMat, lx + (rand() - 0.5) * w * 0.4, h + 0.18 + 0.55, lz + (rand() - 0.5) * d * 0.4);
            group.add(ac);
          }
        }
      }
    }
  }

  // Palm trees: instanced trunks and canopies along sidewalks and in the park.
  const palmSpots = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const cx = (i - (GRID - 1) / 2) * BLOCK_PITCH;
      const cz = (j - (GRID - 1) / 2) * BLOCK_PITCH;
      if (i === 2 && j === 2) {
        for (let k = 0; k < 9; k++) {
          palmSpots.push([cx + (rand() - 0.5) * 36, cz + (rand() - 0.5) * 36]);
        }
      } else if (rand() < 0.7) {
        palmSpots.push([cx + BLOCK_SIZE / 2 - 1.5, cz + (rand() - 0.5) * 30]);
        palmSpots.push([cx - BLOCK_SIZE / 2 + 1.5, cz + (rand() - 0.5) * 30]);
      }
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 4.6, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const canopyGeo = new THREE.SphereGeometry(1.9, 8, 6);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x4d8a3f, roughness: 1 });
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, palmSpots.length);
  palmSpots.forEach(([x, z], i) => {
    m4.makeTranslation(x, 2.3 + 0.18, z);
    trunks.setMatrixAt(i, m4);
    m4.makeScale(1, 0.55, 1);
    m4.setPosition(x, 4.9 + 0.18, z);
    canopies.setMatrixAt(i, m4);
    trunks.castShadow = true;
    canopies.castShadow = true;
    colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35 });
  });
  group.add(trunks);
  group.add(canopies);

  // Streetlights at intersections.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6.2, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6, metalness: 0.5 });
  const lampSpots = [];
  for (const x of [-90, -30, 30, 90]) {
    for (const z of [-90, -30, 30, 90]) {
      lampSpots.push([x + 7, z + 7]);
      lampSpots.push([x - 7, z - 7]);
    }
  }
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
  const headGeo = new THREE.BoxGeometry(1.1, 0.18, 0.3);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x444444, emissive: 0xffe9a8, emissiveIntensity: 0.7 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
  lampSpots.forEach(([x, z], i) => {
    m4.makeTranslation(x, 3.1 + 0.18, z);
    poles.setMatrixAt(i, m4);
    m4.makeRotationY(Math.PI / 4);
    m4.setPosition(x, 6.2 + 0.18, z);
    heads.setMatrixAt(i, m4);
  });
  group.add(poles);
  group.add(heads);

  return {
    group,
    colliders,
    bounds: { min: -HALF + 2, max: HALF - 2 },
    // Push a circle (x, z, radius) out of every building/palm box it
    // overlaps. Returns the corrected position and whether it hit anything.
    collideCircle(x, z, r) {
      let hit = false;
      for (const b of colliders) {
        const cx = Math.max(b.minX, Math.min(x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
        let dx = x - cx;
        let dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (r - d) / d;
          x += dx * push;
          z += dz * push;
        } else {
          // Centre inside the box: shove out along the shallowest axis.
          const px = Math.min(x - b.minX, b.maxX - x);
          const pz = Math.min(z - b.minZ, b.maxZ - z);
          if (px < pz) x = (x - b.minX < b.maxX - x) ? b.minX - r : b.maxX + r;
          else z = (z - b.minZ < b.maxZ - z) ? b.minZ - r : b.maxZ + r;
        }
      }
      return { x, z, hit };
    },
    // True when the point is on a road strip (used by traffic on day 2).
    isOnRoad(x, z) {
      const onStrip = (v) => {
        for (const c of ROAD_CENTERS) {
          if (v >= c - ROAD_HALF && v <= c + ROAD_HALF) return true;
        }
        return false;
      };
      return onStrip(x) || onStrip(z);
    },
    // The road centre lines, for traffic lanes and police spawns.
    getRoadCenters() {
      return [...ROAD_CENTERS];
    },
    // Curbside parking candidates: 6.5 m off a road centre, on the
    // sidewalk edge just clear of the asphalt (road half is 6 m) and of
    // the buildings and palms, which reach 22.5 m from a block centre.
    // Callers must still filter with collideCircle. Heading 0 faces +z,
    // PI/2 faces +x. Spots verified clear against the seeded city.
    parkedSpots() {
      return [
        { x: -137.5, z: -110, heading: 0 },
        { x: -96.5, z: -50, heading: Math.PI },
        { x: -23.5, z: -50, heading: 0 },
        { x: 36.5, z: -110, heading: 0 },
        { x: 96.5, z: 10, heading: 0 },
        { x: -110, z: 83.5, heading: -Math.PI / 2 },
        { x: 10, z: 96.5, heading: Math.PI / 2 },
        { x: 120, z: 36.5, heading: Math.PI / 2 },
      ];
    },
    // Mission landmarks (day 3): named spots the story sends the player
    // to. All sit on roads or the central park, never inside a building.
    landmarks() {
      return {
        // Bang Dar waits at the park's south-west corner, near the spawn.
        fixer: { x: -20, z: 20, label: 'Taman Solara — Bang Dar' },
        // East docks: the intersection at road 90 / road -90.
        docks: { x: 90, z: -90, label: 'Dermaga Timur' },
        // The package waits at the -90 / -90 intersection.
        packageSpot: { x: -90, z: -90, label: 'Paket' },
        // The delivery corner on the outer ring road, east end.
        delivery: { x: 144, z: 90, label: 'Ujung Timur' },
        // The hideout: the middle of the central park lawn.
        hideout: { x: 0, z: 0, label: 'Taman Tengah' },
      };
    },
    update() { /* day 1: the city is static; motion arrives with traffic */ },
  };
}
