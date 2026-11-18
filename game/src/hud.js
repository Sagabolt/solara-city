// Solara City — HUD and minimap. The minimap is a small 2D canvas drawn
// top-down every frame: the road grid, building blocks, the central park,
// traffic dots, flashing police dots, the player arrow and a pulsing
// beacon on the active mission target, with N at the top. A compass edge
// marker points at the mission target while it is off-screen, with the
// distance in metres. This module also owns the notice banner and the
// per-frame HUD text (cash, health, speed, wanted stars, objective,
// mission tracker, prompt), so main.js stays a loop, not a DOM juggler.

const MAP_SIZE = 180; // logical px; the canvas is 2x for retina
const WORLD_HALF = 150; // the city spans -150 .. 150 on x and z
const MAP_SCALE = MAP_SIZE / (WORLD_HALF * 2);
const BLOCK_CENTERS = [-120, -60, 0, 60, 120]; // city.js: 5x5, pitch 60
const BLOCK_SIZE = 48;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function createHUD(els, world) {
  const ctx = els.minimap.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0); // draw in logical px on a 2x canvas
  const roadCenters = world.city.getRoadCenters();
  let noticeTimer = 0;
  let time = 0;
  let last = {};

  function toMap(x, z) {
    return [(x + WORLD_HALF) * MAP_SCALE, (z + WORLD_HALF) * MAP_SCALE];
  }

  function setText(el, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      el.textContent = value;
    }
  }

  function setHtml(el, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      el.innerHTML = value;
    }
  }

  function drawMinimap() {
    // Panel: dark slate, roads slightly lighter, blocks concrete grey.
    ctx.fillStyle = '#0d1520';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.fillStyle = '#2f353e';
    for (const c of roadCenters) {
      const p = (c - 6 + WORLD_HALF) * MAP_SCALE;
      const w = 12 * MAP_SCALE;
      ctx.fillRect(p, 0, w, MAP_SIZE);
      ctx.fillRect(0, p, MAP_SIZE, w);
    }
    for (const bx of BLOCK_CENTERS) {
      for (const bz of BLOCK_CENTERS) {
        const [mx, my] = toMap(bx - BLOCK_SIZE / 2, bz - BLOCK_SIZE / 2);
        ctx.fillStyle = bx === 0 && bz === 0 ? '#4d8a3f' : '#5c6355';
        ctx.fillRect(mx, my, BLOCK_SIZE * MAP_SCALE, BLOCK_SIZE * MAP_SCALE);
      }
    }

    // Traffic: small pale dots, only cars still driving their route.
    ctx.fillStyle = '#d7dde3';
    for (const e of world.traffic.entries) {
      if (e.car.driver !== 'traffic') continue;
      const [mx, my] = toMap(e.x, e.z);
      ctx.beginPath();
      ctx.arc(mx, my, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Police: bigger dots, flashing red / blue.
    const flashRed = Math.floor(time * 2.8) % 2 === 0;
    ctx.fillStyle = flashRed ? '#ff4444' : '#4488ff';
    for (const entry of world.police.policeCars) {
      const p = entry.car.group.position;
      const [mx, my] = toMap(p.x, p.z);
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mission beacon: a pulsing amber diamond on the target.
    const target = world.missions.targetPos();
    if (target) {
      const [mx, my] = toMap(target.x, target.z);
      const pulse = 5 + 2 * Math.sin(time * 3);
      ctx.strokeStyle = 'rgba(255, 179, 64, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx, my, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffb340';
      ctx.beginPath();
      ctx.moveTo(mx, my - 5);
      ctx.lineTo(mx + 4, my);
      ctx.lineTo(mx, my + 5);
      ctx.lineTo(mx - 4, my);
      ctx.closePath();
      ctx.fill();
    }

    // Player arrow: white triangle, rotated by the heading. Heading 0
    // faces +z (down on the map, south), PI/2 faces +x (right, east).
    const pp = world.player.group.position;
    const [px, py] = toMap(pp.x, pp.z);
    const h = world.player.heading;
    const angle = Math.atan2(Math.sin(h), -Math.cos(h));
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North indicator.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', MAP_SIZE / 2, 3);
  }

  function updateCompass() {
    const target = world.missions.targetPos();
    if (!target || !world.missions.active) {
      if (last.compass !== 'hidden') {
        last.compass = 'hidden';
        els.compass.style.display = 'none';
        els.compassDist.style.display = 'none';
      }
      return;
    }
    const v = new THREE.Vector3(target.x, 2, target.z).project(world.camera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    let sx = (v.x * 0.5 + 0.5) * w;
    let sy = (-v.y * 0.5 + 0.5) * h;
    // Behind the camera: the projection mirrors, so mirror it back.
    if (v.z > 1) {
      sx = w - sx;
      sy = h - sy;
    }
    const margin = 70;
    const onScreen = v.z <= 1
      && sx > margin && sx < w - margin
      && sy > margin && sy < h - margin;
    if (onScreen) {
      if (last.compass !== 'hidden') {
        last.compass = 'hidden';
        els.compass.style.display = 'none';
        els.compassDist.style.display = 'none';
      }
      return;
    }
    // Clamp to the screen edge and point the arrow at the target.
    const cx = clamp(sx, margin, w - margin);
    const cy = clamp(sy, margin, h - margin);
    const dx = sx - w / 2;
    const dy = sy - h / 2;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    const pp = world.player.group.position;
    const dist = Math.round(Math.hypot(target.x - pp.x, target.z - pp.z));
    last.compass = 'shown';
    els.compass.style.display = 'block';
    els.compass.style.left = `${cx}px`;
    els.compass.style.top = `${cy}px`;
    els.compass.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
    els.compassDist.style.display = 'block';
    els.compassDist.style.left = `${cx}px`;
    els.compassDist.style.top = `${cy + 16}px`;
    setText(els.compassDist, 'compassDist', `${dist}m`);
  }

  return {
    showNotice(text, seconds = 3.5) {
      els.notice.textContent = text;
      els.notice.style.opacity = '1';
      noticeTimer = seconds;
    },

    // One call per frame from main.js: HUD text, minimap, compass, notice.
    update(dt, snap) {
      time += dt;
      setText(els.cash, 'cash', `$${snap.cash}`);
      setText(els.healthNum, 'hp', `${snap.hp}`);
      els.healthFill.style.width = `${Math.round((snap.hp / snap.maxHp) * 100)}%`;
      setHtml(
        els.speed,
        'speed',
        `${snap.kmh}<small>km/h · ${snap.driving ? 'driving' : 'on foot'}</small>`,
      );
      setHtml(
        els.wanted,
        'wanted',
        '★'.repeat(snap.wanted) + '<span class="off">' + '★'.repeat(5 - snap.wanted) + '</span>',
      );
      setText(els.objective, 'objective', snap.objectiveText);
      setText(els.missionTracker, 'tracker', snap.missionLabel);
      setText(els.prompt, 'prompt', snap.promptText);

      if (noticeTimer > 0) {
        noticeTimer -= dt;
        if (noticeTimer <= 0) els.notice.style.opacity = '0';
      }

      drawMinimap();
      updateCompass();
    },
  };
}
