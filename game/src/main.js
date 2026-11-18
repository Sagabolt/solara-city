// Solara City — bootstrap and the one loop: renderer, third-person
// mouse-orbit camera, keyboard input, HUD, and the frame update. Day 2
// wires in traffic, pedestrians and the police wanted system: stealing a
// car or hitting a pedestrian raises the wanted level, cruisers chase the
// player, and hiding cools the heat off. The game runs fully offline: the
// only scripts are the vendored three.min.js and these local ES modules.

import { createCity } from './city.js';
import { createPlayer } from './player.js';
import { createVehicleManager } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';
import { createPolice } from './police.js';
import { createMissions, MISSION_NAMES } from './missions.js';
import { createDialog } from './story.js';
import { createCombat } from './combat.js';
import { createHUD } from './hud.js';
import { createSave } from './save.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const pauseOverlay = document.getElementById('pause-overlay');
const helpOverlay = document.getElementById('help-overlay');
const btnContinue = document.getElementById('btn-continue');
const btnNew = document.getElementById('btn-new');
const btnResume = document.getElementById('btn-resume');
const btnQuit = document.getElementById('btn-quit');
const btnHelpClose = document.getElementById('btn-help-close');
const speedEl = document.getElementById('speed');
const promptEl = document.getElementById('prompt');
const objectiveEl = document.getElementById('objective');
const missionTrackerEl = document.getElementById('mission-tracker');
const wantedEl = document.getElementById('wanted');
const noticeEl = document.getElementById('notice');
const cashEl = document.getElementById('cash');
const healthFillEl = document.getElementById('health-fill');
const healthNumEl = document.getElementById('health-num');
const dialogEl = document.getElementById('dialog');
const dialogSpeakerEl = document.getElementById('dialog-speaker');
const dialogTextEl = document.getElementById('dialog-text');
const minimapEl = document.getElementById('minimap');
const compassEl = document.getElementById('compass');
const compassDistEl = document.getElementById('compass-dist');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);

const city = createCity(scene);
const player = createPlayer(scene);
player.group.position.set(-4, 0, 30);
const vehicles = createVehicleManager(scene, city);
const traffic = createTraffic(scene, city, vehicles);
const pedestrians = createPedestrians(scene, city);
// Missions are assigned below; the busted handler reads them through
// this binding, so it must exist before the police are created.
let missions = null;
const police = createPolice(scene, city, vehicles, {
  // Caught: back to the spawn, wanted cleared, cruisers gone.
  onBusted: () => {
    audio.busted();
    showNotice('BUSTED! The Solara PD hauled you in — wanted cleared.');
    player.group.position.set(-4, 0, 30);
    player.heading = Math.PI;
    player.group.rotation.y = Math.PI;
    player.velX = 0;
    player.velZ = 0;
    police.clearWanted();
    // A delivery or an escape in progress restarts from its first step.
    if (missions) missions.onBusted();
  },
});

// Day 3: story dialog, the chained missions, and melee combat.
const dialog = createDialog(dialogEl, dialogSpeakerEl, dialogTextEl);
missions = createMissions(scene, city, {
  police,
  isDialogOpen: () => dialog.isOpen,
  onDialog: (lines, onDone) => dialog.show(lines, onDone),
  onNotice: (text) => showNotice(text),
  onReward: (amount, total) => showNotice(`Mission complete! +$${amount} (total $${total})`),
  // Day 4: a finished mission auto-saves and plays the jingle.
  onMissionComplete: () => {
    saveGame();
    audio.missionComplete();
  },
});
const combat = createCombat({
  player,
  pedestrians,
  onNotice: (text) => showNotice(text),
  onPlayerDown: () => {
    audio.busted();
    player.group.position.set(-4, 0, 30);
    player.heading = Math.PI;
    player.group.rotation.y = Math.PI;
    player.velX = 0;
    player.velZ = 0;
  },
});

// Day 4: save / load, procedural audio, HUD + minimap. The save slot is
// read here so the start screen can offer Continue; audio starts muted
// only when the player muted it before (settings survive a New Game).
const save = createSave();
const audio = createAudio({
  muted: save.loadSettings().muted,
  onMuteChange: (m) => save.saveSettings({ muted: m }),
});
const hud = createHUD(
  {
    minimap: minimapEl,
    compass: compassEl,
    compassDist: compassDistEl,
    notice: noticeEl,
    cash: cashEl,
    healthFill: healthFillEl,
    healthNum: healthNumEl,
    speed: speedEl,
    wanted: wantedEl,
    objective: objectiveEl,
    missionTracker: missionTrackerEl,
    prompt: promptEl,
  },
  { city, player, vehicles, traffic, pedestrians, police, missions, combat, camera },
);

// A transient banner under the objective ("Car stolen!", "BUSTED!", ...).
// The HUD owns the element and its timer; this is the one call site name
// the older systems (missions, combat, police) already use.
function showNotice(text, seconds = 3.5) {
  hud.showNotice(text, seconds);
}

// Snapshot of the run for the save slot (day 4).
function saveGame() {
  save.save({
    ...missions.saveData(),
    wanted: police.wanted,
    player: { x: player.group.position.x, z: player.group.position.z },
    heading: player.heading,
    enteredCarOnce,
  });
}

// Restore a save slot into the live world: story, spot, heat, health.
function applySave(data) {
  player.group.position.set(data.player?.x ?? -4, 0, data.player?.z ?? 30);
  player.heading = data.heading ?? Math.PI;
  player.group.rotation.y = player.heading;
  player.velX = 0;
  player.velZ = 0;
  missions.loadState(data);
  police.setWanted(data.wanted || 0);
  combat.restore();
  enteredCarOnce = !!data.enteredCarOnce;
}

// Debug hook for day-5 playtesting and screenshot staging.
window.__solara = {
  player, vehicles, city, camera, traffic, pedestrians, police, missions,
  combat, dialog, hud, audio, save, saveGame, applySave,
  pause: (p, mode) => setPaused(p, mode),
};

// --- input ---------------------------------------------------------------
const keys = {};
let interactQueued = false;
let attackQueued = false;
let cameraYaw = Math.PI; // behind the player, looking down the road (-z)
let cameraPitch = 0.32;
let started = false;
let paused = false;
let pauseMode = 'pause'; // 'pause' | 'help'
let enteredCarOnce = false;

// Pointer lock can reject (no gesture, iframe rules): never let that
// rejection surface as an uncaught error.
function lockPointer() {
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch (err) { /* playing without a locked mouse still works */ }
}

function startPlaying() {
  overlay.style.display = 'none';
  pauseOverlay.style.display = 'none';
  helpOverlay.style.display = 'none';
  started = true;
  paused = false;
  audio.init();
  audio.resume();
  audio.click();
  lockPointer();
}

// Pause freezes the loop (frame() returns early) and frees the mouse so
// the menu buttons can be clicked. mode picks which overlay shows.
function setPaused(p, mode = 'pause') {
  if (!started) return;
  paused = p;
  pauseMode = mode;
  pauseOverlay.style.display = p && mode === 'pause' ? 'flex' : 'none';
  helpOverlay.style.display = p && mode === 'help' ? 'flex' : 'none';
  if (p) {
    if (document.exitPointerLock) document.exitPointerLock();
    audio.suspend();
  } else {
    audio.resume();
    lockPointer();
  }
}

// The Continue button shows the saved run at a glance.
const existingSave = save.load();
if (existingSave) {
  const label = existingSave.done
    ? 'Story complete'
    : `Mission ${Math.min(3, (existingSave.missionIndex || 0) + 1)}/3 — ${MISSION_NAMES[Math.min(2, existingSave.missionIndex || 0)]}`;
  btnContinue.textContent = `Continue — $${existingSave.cash || 0} · ${label}`;
  btnContinue.style.display = 'block';
}
btnContinue.addEventListener('click', () => {
  const data = save.load();
  if (data) applySave(data);
  startPlaying();
});
btnNew.addEventListener('click', () => {
  // A fresh run from a clean page: the save is cleared and the page
  // reloads, so no mid-run state (police, traffic, story) can leak in.
  // The flag below auto-starts the game after the reload: without it
  // New Game would loop back to this title screen forever, and a
  // first-time player could never get past it.
  save.clear();
  try { sessionStorage.setItem('solara-autostart', '1'); } catch (err) { /* private mode */ }
  location.reload();
});
btnResume.addEventListener('click', () => {
  audio.click();
  setPaused(false);
});
btnQuit.addEventListener('click', () => {
  saveGame();
  location.reload();
});
btnHelpClose.addEventListener('click', () => {
  audio.click();
  setPaused(false);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && !keys.KeyE) {
    // While a story line is up, E turns the page instead of entering a car.
    if (dialog.isOpen) dialog.advance();
    else interactQueued = true;
  }
  if (e.code === 'KeyF' && !keys.KeyF) attackQueued = true;
  // P pauses / resumes; H opens the help sheet (which also pauses);
  // M toggles the procedural sound, persisted as a setting.
  if (e.code === 'KeyP' && !keys.KeyP && started) {
    setPaused(!paused, 'pause');
  }
  if (e.code === 'KeyH' && !keys.KeyH && started) {
    if (paused && pauseMode === 'help') setPaused(false);
    else setPaused(true, 'help');
  }
  if (e.code === 'KeyM' && !keys.KeyM) audio.setMuted(!audio.muted);
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  cameraYaw -= e.movementX * 0.0026;
  // Mouse up lowers the camera (look up), like a third-person console game.
  cameraPitch += e.movementY * 0.0026;
  cameraPitch = Math.max(0.08, Math.min(1.0, cameraPitch));
});
// Esc (or Alt-Tab, or clicking away) drops the pointer lock: treat that
// as a pause, so the player never gets busted while reading the menu.
document.addEventListener('pointerlockchange', () => {
  if (started && !paused && document.pointerLockElement !== canvas) {
    setPaused(true, 'pause');
  }
});
canvas.addEventListener('click', () => {
  if (started && document.pointerLockElement !== canvas) lockPointer();
});
// Click while locked in: throw a punch.
canvas.addEventListener('mousedown', () => {
  if (started && document.pointerLockElement === canvas) attackQueued = true;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function readInput() {
  return {
    f: !!(keys.KeyW || keys.ArrowUp),
    b: !!(keys.KeyS || keys.ArrowDown),
    l: !!(keys.KeyA || keys.ArrowLeft),
    r: !!(keys.KeyD || keys.ArrowRight),
    run: !!(keys.ShiftLeft || keys.ShiftRight),
  };
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// --- loop ----------------------------------------------------------------
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(-4, 5, 38);
let firstFrame = true;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  // Paused: the world freezes (no updates, no render). The clock is still
  // drained above so resuming does not jump a huge dt.
  if (paused) return;
  const input = readInput();

  if (vehicles.tryEnterExit(player, interactQueued)) {
    enteredCarOnce = enteredCarOnce || !!vehicles.driven;
    if (vehicles.lastTheft) {
      police.raiseWanted(2);
      showNotice('Car stolen! The Solara PD is on its way.');
      audio.steal();
      vehicles.lastTheft = null;
    }
  }
  interactQueued = false;

  player.update(dt, input, cameraYaw, city, !!vehicles.driven);
  vehicles.update(dt, input, player);
  if (traffic.update(dt, player, vehicles)) {
    police.raiseWanted(1);
    showNotice('You crashed into traffic!');
    audio.crash();
  }
  pedestrians.update(dt, player, {
    // An angry pedestrian's swing lands on the player.
    onPedAttack: (dmg) => {
      combat.damage(dmg);
      audio.punch();
    },
  });
  if (pedestrians.checkPlayerHit(player.group.position, !!vehicles.driven, vehicles.speed)) {
    police.raiseWanted(2);
    showNotice('You hit a pedestrian! Wanted level up.');
    audio.punch();
  }
  if (attackQueued) {
    attackQueued = false;
    if (!vehicles.driven && combat.punch()) {
      police.raiseWanted(1);
      showNotice('You punched a pedestrian!');
      audio.punch();
    }
  }
  police.update(dt, player, vehicles);
  missions.update(dt, {
    playerPos: player.group.position,
    vehicles,
    wanted: police.wanted,
  });
  combat.update(dt);
  dialog.update(dt);
  city.update();

  // Camera: orbit behind the player on foot; swing behind the car while driving.
  const driving = !!vehicles.driven;
  const focus = driving ? vehicles.driven.group.position : player.group.position;
  if (driving) {
    cameraYaw = lerpAngle(cameraYaw, vehicles.driven.group.rotation.y + Math.PI, 1 - Math.exp(-2.5 * dt));
  }
  const dist = driving ? 9.5 : 7.5;
  camTarget.set(focus.x, focus.y + 1.7, focus.z);
  const cx = camTarget.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * dist;
  const cy = camTarget.y + Math.sin(cameraPitch) * dist;
  const cz = camTarget.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * dist;
  const smooth = firstFrame ? 1 : 1 - Math.exp(-9 * dt);
  camPos.x += (cx - camPos.x) * smooth;
  camPos.y += (Math.max(0.6, cy) - camPos.y) * smooth;
  camPos.z += (cz - camPos.z) * smooth;
  firstFrame = false;
  camera.position.copy(camPos);
  camera.lookAt(camTarget);

  // HUD + minimap + compass, and the procedural sound following speed and
  // wanted level. The prompt is computed here (it needs the nearest car).
  // `driving` is already declared above, in the camera section.
  const kmh = Math.round((driving ? Math.abs(vehicles.speed) : player.speed) * 3.6);
  let promptText = '';
  if (driving) {
    promptText = 'E — Exit car';
  } else {
    const near = vehicles.nearestCar(player.group.position);
    if (near) {
      if (near.kind === 'player') promptText = 'E — Enter car';
      else if (near.kind === 'police') promptText = 'E — Steal police car!';
      else promptText = 'E — Steal car';
    }
  }
  hud.update(dt, {
    kmh,
    driving,
    cash: missions.cash,
    hp: combat.hp,
    maxHp: combat.maxHp,
    wanted: police.wanted,
    objectiveText: missions.active
      ? missions.objectiveText
      : police.wanted > 0
        ? `Lose the cops! Wanted level ${police.wanted} — stay out of sight`
        : enteredCarOnce
          ? 'Drive around Solara City'
          : 'Explore Solara City — find a car',
    missionLabel: missions.active
      ? `MISSION ${missions.missionIndex + 1}/3 — ${missions.currentMission.name.toUpperCase()} · $${missions.currentMission.reward}`
      : 'ALL MISSIONS COMPLETE',
    promptText,
  });
  audio.update(dt, {
    speed01: driving ? Math.min(1, Math.abs(vehicles.speed) / 32) : Math.min(1, player.speed / 9.5),
    driving,
    wanted: police.wanted,
  });

  renderer.render(scene, camera);
}

// New Game reloads for a clean state: auto-start when the reload was
// ours (the flag is cleared here, so a plain refresh still shows the
// title screen). startPlaying is hoisted, and every const it needs
// (audio, save, the buttons) is initialised above this line.
let autostart = false;
try {
  autostart = sessionStorage.getItem('solara-autostart') === '1';
  sessionStorage.removeItem('solara-autostart');
} catch (err) { /* private mode: no auto-start */ }
if (autostart) startPlaying();

requestAnimationFrame(frame);
