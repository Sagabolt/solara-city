// Solara City — missions and story progression. Three chained jobs from
// the fixer Bang Dar, unlocked in order: (1) Kenalan — meet him at the
// park and drive him to the east docks; (2) Antar Paket — pick up a
// package while the heat is up and deliver it across town; (3) Kabur —
// lose a 3-star wanted level, then reach the hideout in the central park.
// The active objective has a glowing beacon and ground ring in the world
// (there is no minimap yet), cash rewards land in state.cash, and getting
// busted mid-delivery or mid-escape resets that mission to its start.

import { DIALOGS } from './story.js';

const MISSIONS = [
  {
    id: 'm1',
    name: 'Kenalan',
    reward: 150,
    steps: [
      {
        at: 'fixer',
        radius: 4,
        drive: false,
        objective: 'Meet Bang Dar at the park corner',
        dialog: 'm1_meet',
      },
      {
        at: 'docks',
        radius: 6,
        drive: true,
        objective: 'Drive Bang Dar to the east docks (in a car)',
        dialog: 'm1_done',
      },
    ],
  },
  {
    id: 'm2',
    name: 'Antar Paket',
    reward: 250,
    steps: [
      {
        at: 'packageSpot',
        radius: 4,
        drive: false,
        objective: 'Pick up the package at -90 / -90',
        dialog: 'm2_pickup',
      },
      {
        at: 'delivery',
        radius: 6,
        drive: false,
        objective: 'Deliver the package to the east end (144 / 90)',
        dialog: 'm2_done',
      },
    ],
  },
  {
    id: 'm3',
    name: 'Kabur',
    reward: 500,
    steps: [
      {
        at: null,
        radius: 0,
        drive: false,
        objective: 'Lose the cops! Wanted level 3 — stay out of sight',
        dialog: 'm3_lost',
      },
      {
        at: 'hideout',
        radius: 5,
        drive: false,
        objective: 'Reach the hideout in the central park',
        dialog: 'm3_done',
      },
    ],
  },
];

export const MISSION_NAMES = MISSIONS.map((m) => m.name);

function buildFixerMesh() {
  // Bang Dar: purple jacket, dark cap, standing at the park corner.
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0x6a4a9a, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.8 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.95 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.34), jacket);
  torso.position.y = 1.15;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  group.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.36), capMat);
  cap.position.y = 1.88;
  group.add(cap);
  for (const sx of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), pants);
    leg.position.set(sx, 0.4, 0);
    leg.castShadow = true;
    group.add(leg);
  }
  return group;
}

export function createMissions(scene, city, opts = {}) {
  const police = opts.police;
  const onDialog = opts.onDialog || (() => {});
  const onNotice = opts.onNotice || (() => {});
  const onReward = opts.onReward || (() => {});
  // Day 4: fires once a mission is fully complete (auto-save + jingle).
  const onMissionComplete = opts.onMissionComplete || (() => {});
  const isDialogOpen = opts.isDialogOpen || (() => false);
  const L = city.landmarks();

  // Objective marker: a tall glowing beacon and a ground ring.
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xffb340, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 30, 16, 1, true), beaconMat);
  beacon.position.y = 15;
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffb340, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.0, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  const marker = new THREE.Group();
  marker.add(beacon, ring);
  scene.add(marker);

  // Bang Dar, waiting at the park corner until the first job is done.
  const fixer = buildFixerMesh();
  fixer.position.set(L.fixer.x, 0, L.fixer.z);
  fixer.rotation.y = Math.PI * 0.75;
  scene.add(fixer);

  // The package, sitting at its pickup corner while mission 2 waits.
  const packageMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.5, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x9a6b3a, roughness: 0.9 }),
  );
  packageMesh.position.set(L.packageSpot.x, 0.45, L.packageSpot.z);
  packageMesh.castShadow = true;
  packageMesh.visible = false;
  scene.add(packageMesh);

  const state = {
    cash: 0,
    missionIndex: 0,
    step: 0,
    done: false,
    time: 0,
    objectiveText: MISSIONS[0].steps[0].objective,

    get active() {
      return !state.done;
    },

    get currentMission() {
      return MISSIONS[state.missionIndex];
    },

    // The active objective's world spot for the minimap beacon and the
    // compass edge marker, or null when the objective is a state (losing
    // the cops) instead of a place, or the story is done.
    targetPos() {
      if (state.done) return null;
      const step = state.currentMission.steps[state.step];
      if (!step.at) return null;
      const spot = L[step.at];
      return { x: spot.x, z: spot.z, label: spot.label || step.objective };
    },

    // Snapshot for the save file (day 4).
    saveData() {
      return {
        cash: state.cash,
        missionIndex: state.missionIndex,
        step: state.step,
        done: state.done,
      };
    },

    // Restore from a save file: puts the story back where it was, with
    // the marker on the right spot. Dialogs are not replayed.
    loadState(data) {
      state.cash = data.cash || 0;
      state.missionIndex = Math.max(0, Math.min(MISSIONS.length - 1, data.missionIndex || 0));
      state.step = data.step || 0;
      state.done = !!data.done;
      if (state.done) {
        state.objectiveText = `Story complete — you own Solara City. Cash: $${state.cash}`;
        marker.visible = false;
      } else {
        const mission = state.currentMission;
        state.step = Math.max(0, Math.min(mission.steps.length - 1, state.step));
        state.objectiveText = mission.steps[state.step].objective;
        state.placeMarker();
      }
    },

    // The marker sits on the current objective, or hides when the
    // objective is a state (losing the cops) instead of a place.
    placeMarker() {
      const step = state.currentMission.steps[state.step];
      if (state.done || !step.at) {
        marker.visible = false;
        return;
      }
      const spot = L[step.at];
      marker.position.set(spot.x, 0, spot.z);
      marker.visible = true;
    },

    // Finish the current mission: pay out, open the next one.
    completeMission() {
      const mission = state.currentMission;
      state.cash += mission.reward;
      onReward(mission.reward, state.cash);
      state.missionIndex++;
      state.step = 0;
      if (state.missionIndex >= MISSIONS.length) {
        state.done = true;
        state.objectiveText = `Story complete — you own Solara City. Cash: $${state.cash}`;
        marker.visible = false;
        onNotice(`All missions complete! Total cash: $${state.cash}`);
        onMissionComplete(mission, state.cash);
        return;
      }
      if (state.missionIndex === 2) {
        // Kabur opens hot: three stars on the player at once.
        state.objectiveText = MISSIONS[2].steps[0].objective;
        onDialog(DIALOGS.m3_start, () => {
          if (police) police.setWanted(3);
          state.placeMarker();
        });
        onMissionComplete(mission, state.cash);
        return;
      }
      state.objectiveText = state.currentMission.steps[0].objective;
      state.placeMarker();
      onMissionComplete(mission, state.cash);
    },

    // Busted mid-delivery or mid-escape: the mission restarts from its
    // first step. Returns true when a mission was reset.
    onBusted() {
      if (state.done) return false;
      if (state.missionIndex === 1 && state.step === 1) {
        state.step = 0;
        state.objectiveText = state.currentMission.steps[0].objective;
        state.placeMarker();
        onNotice('Busted! The package is lost — pick it up again.');
        return true;
      }
      if (state.missionIndex === 2) {
        state.step = 0;
        state.objectiveText = state.currentMission.steps[0].objective;
        if (police) police.setWanted(3);
        state.placeMarker();
        onNotice('Busted mid-escape! The heat is back on.');
        return true;
      }
      return false;
    },

    update(dt, ctx) {
      state.time += dt;
      // The beacon breathes; the ring slowly spins.
      beaconMat.opacity = 0.32 + 0.18 * Math.sin(state.time * 3);
      ring.rotation.z += dt * 0.6;
      fixer.visible = state.missionIndex === 0;
      packageMesh.visible = state.missionIndex === 1 && state.step === 0;
      if (state.done || isDialogOpen()) return;

      const mission = state.currentMission;
      const step = mission.steps[state.step];
      const px = ctx.playerPos.x;
      const pz = ctx.playerPos.z;

      // Mission 3, step 0: the objective is a state, not a place.
      if (mission.id === 'm3' && state.step === 0) {
        if (ctx.wanted === 0) {
          onDialog(DIALOGS.m3_lost, () => {
            state.step = 1;
            state.objectiveText = mission.steps[1].objective;
            state.placeMarker();
          });
        }
        return;
      }

      const spot = L[step.at];
      const dist = Math.hypot(px - spot.x, pz - spot.z);
      const arrived = step.drive
        ? (ctx.vehicles && ctx.vehicles.isDrivingAt(spot.x, spot.z, step.radius))
        : dist < step.radius;
      if (!arrived) return;

      // Mission 2 pickup turns the heat up the moment the package is taken.
      if (mission.id === 'm2' && state.step === 0 && police) {
        police.raiseWanted(2);
        onNotice('Police heat is up — deliver fast!');
      }
      onDialog(DIALOGS[step.dialog], () => {
        if (state.step === mission.steps.length - 1) {
          state.completeMission();
        } else {
          state.step++;
          state.objectiveText = mission.steps[state.step].objective;
          state.placeMarker();
        }
      });
    },
  };

  state.placeMarker();
  return state;
}
