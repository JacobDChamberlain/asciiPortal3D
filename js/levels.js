// levels.js — asciiPortal3D
// Data-driven chambers. Each level is built into its own group so it can be
// disposed on transition. A Level exposes solids (for player/cube collision),
// blockers (meshes the portal gun can't shoot through), and update() which
// returns true when the player has completed the chamber (reached an active exit).
//
// Feature types: platforms (solid ledges), buttons (weighted pads), doors
// (barriers that open when their button is pressed), a gun pedestal (pickup),
// and an exit (gated by gun / a held button / nothing).

import * as THREE from 'three';
import { makeBox } from './collision.js';

const EYE = 3.0;

export const LEVELS = [
  {
    name: 'CHAMBER 00 — MANUAL OVERRIDE',
    spawn: [0, EYE, -12],
    cube: [0, 1, -9],
    platforms: [],
    buttons: [{ id: 'A', x: 0, z: -4, hw: 1.7, hz: 1.7, top: 0.5 }],
    doors: [{ id: 'A', x: 0, y: 3.5, z: 0, hw: 15, hh: 3.5, hd: 0.4, openBy: 'A', latch: false }],
    pedestal: { x: 0, z: 5 },
    exit: { x: 0, y: 2.6, z: 13.4, hw: 3, hh: 2.6, hd: 1.2, gate: { type: 'gun' } },
    hint: 'No gun yet. Carry the cube (E) onto the pad to open the door.',
  },
  {
    name: 'CHAMBER 01 — THE ASCENT',
    spawn: [0, EYE, -12],
    cube: [-8, 1, -8],
    platforms: [{ x: 0, y: 2.5, z: 13, hw: 6, hh: 2.5, hd: 2 }],   // exit ledge (top y=5)
    buttons: [{ id: 'P', x: -8, z: 0, hw: 1.6, hz: 1.6, top: 0.5 }],
    doors: [],
    pedestal: null,
    exit: { x: 0, y: 6.6, z: 13.3, hw: 2.5, hh: 1.6, hd: 2, gate: { type: 'button', button: 'P' } },  // sill at the ledge top (y=5), not sunk into it
    hint: 'Weigh the pad with the cube, then portal up to the exit ledge.',
  },
  {
    name: 'CHAMBER 02 — THE FLING',
    spawn: [-9, 15, -12],        // on the corner start ledge (top y=12), flush to the back & left walls
    cube: [-6, 13.5, -12],       // sits on the ledge — carry it onto the pad
    platforms: [
      // start ledge: flush to the back (-Z) AND left (-X) walls, so there is NO
      // gap behind you to fall into when you fling off the back wall. Tall, so
      // the drop into a floor portal builds real speed for the fling.
      { x: -9, y: 6, z: -12, hw: 6, hh: 6, hd: 3 },      // top y=12
      // full-width barrier you cannot walk or jump over — you must fling across it
      { x: 0, y: 2.5, z: -3, hw: 15, hh: 2.5, hd: 0.4 }, // top y=5
      // exit platform beyond the barrier
      { x: 0, y: 1, z: 8, hw: 5, hh: 1, hd: 3 },          // top y=2
    ],
    buttons: [{ id: 'F', x: -12, z: -11, hw: 1.6, hz: 1.6, top: 0.5, y: 12 }],  // pad ON the start ledge
    doors: [],
    pedestal: null,
    exit: { x: 0, y: 3.6, z: 8, hw: 2.5, hh: 1.5, hd: 2.5, gate: { type: 'button', button: 'F' } },
    hint: 'Set the cube on the ledge pad to unlock the exit. Then portal the floor + high on the back wall, drop in, and FLING over the barrier.',
  },
];

const MAT = {
  platform: () => new THREE.MeshStandardMaterial({ color: 0xa9b0bb, roughness: 0.8, metalness: 0.1 }),
  door: () => new THREE.MeshStandardMaterial({ color: 0x6b7079, roughness: 0.5, metalness: 0.6 }),
  buttonBase: () => new THREE.MeshStandardMaterial({ color: 0x8892a0, roughness: 0.6, metalness: 0.4 }),
  pedestal: () => new THREE.MeshStandardMaterial({ color: 0x7c828c, roughness: 0.6, metalness: 0.4 }),
};

export class Level {
  constructor(scene, def) {
    this.scene = scene;
    this.def = def;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.solids = [];       // AABBs (player + cube collision)
    this.blockers = [];     // meshes (portal raycast obstruction)
    this.pressed = {};      // button id -> pressed now
    this.doorOpen = {};     // door id -> latched open
    this._doors = {};       // door id -> { mesh, aabb, closedY }
    this.gunPicked = false;

    this._buildPlatforms();
    this._buildDoors();
    this._buildButtons();
    this._buildPedestal();
    this._buildExit();
  }

  get spawn() { return this.def.spawn; }
  get cubeSpawn() { return this.def.cube; }
  get hint() { return this.def.hint || ''; }

  _addSolidMesh(x, y, z, hw, hh, hd, mat, blocker = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, hh * 2, hd * 2), mat);
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    const aabb = makeBox(x, y, z, hw, hh, hd);
    this.solids.push(aabb);
    if (blocker) this.blockers.push(mesh);
    return { mesh, aabb };
  }

  _buildPlatforms() {
    for (const p of this.def.platforms) {
      this._addSolidMesh(p.x, p.y, p.z, p.hw, p.hh, p.hd, MAT.platform());
    }
  }

  _buildDoors() {
    for (const d of this.def.doors) {
      const { mesh, aabb } = this._addSolidMesh(d.x, d.y, d.z, d.hw, d.hh, d.hd, MAT.door());
      this._doors[d.id] = { mesh, aabb, closedY: d.y, openY: d.y - d.hh * 2 - 0.2 };
      this.doorOpen[d.id] = false;
    }
  }

  _buildButtons() {
    this.buttons = this.def.buttons.map((b) => {
      const by = b.y ?? 0;   // base elevation (0 = floor; >0 sits on a platform/ledge)
      const base = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2, b.top, b.hz * 2), MAT.buttonBase());
      base.position.set(b.x, by + b.top / 2, b.z);
      this.root.add(base);
      const top = new THREE.Mesh(
        new THREE.PlaneGeometry(b.hw * 1.7, b.hz * 1.7),
        new THREE.MeshBasicMaterial({ color: 0xff5a4a })
      );
      top.rotation.x = -Math.PI / 2;
      top.position.set(b.x, by + b.top + 0.01, b.z);
      this.root.add(top);
      this.solids.push(makeBox(b.x, by + b.top / 2, b.z, b.hw, b.top / 2, b.hz));
      this.pressed[b.id] = false;
      return { ...b, topMesh: top };
    });
  }

  _buildPedestal() {
    this.pedGun = null;
    if (!this.def.pedestal) return;
    const p = this.def.pedestal;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.4, 16), MAT.pedestal());
    base.position.set(p.x, 0.7, p.z);
    this.root.add(base);
    this.blockers.push(base);

    this.pedGun = buildGunMesh();
    this.pedGunY = 2.1;
    this.pedGun.position.set(p.x, this.pedGunY, p.z);
    this.pedGun.traverse((o) => o.layers.set(0)); // seen by the main camera on the pedestal
    this.root.add(this.pedGun);
  }

  _buildExit() {
    const e = this.def.exit;
    // frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.8, metalness: 0.3 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(e.hw * 2 + 0.6, e.hh * 2 + 0.6, 0.3), frameMat);
    frame.position.set(e.x, e.y, e.z + e.hd);
    this.root.add(frame);
    // pad (dim until the exit is active)
    this.exitPad = new THREE.Mesh(
      new THREE.PlaneGeometry(e.hw * 2, e.hh * 2),
      new THREE.MeshBasicMaterial({ color: 0x9a3030, side: THREE.DoubleSide })
    );
    this.exitPad.position.set(e.x, e.y, e.z + e.hd - 0.02);
    this.root.add(this.exitPad);
    // barrier that lifts when the exit unlocks
    this.exitBarrier = new THREE.Mesh(
      new THREE.BoxGeometry(e.hw * 2, e.hh * 2, 0.35),
      new THREE.MeshStandardMaterial({
        color: 0x3fd0ff, emissive: 0x123a4a, emissiveIntensity: 0.8,
        transparent: true, opacity: 0.5,
      })
    );
    this.exitBarrierClosedY = e.y;
    this.exitBarrierOpenY = e.y + e.hh * 2 + 3;
    this.exitBarrier.position.set(e.x, this.exitBarrierClosedY, e.z);
    this.root.add(this.exitBarrier);
  }

  _pressed(b, camera, cube, eyeHeight) {
    const by = b.y ?? 0;   // account for buttons that sit on a raised ledge
    if (cube && !cube.carried &&
        Math.abs(cube.position.x - b.x) <= b.hw &&
        Math.abs(cube.position.z - b.z) <= b.hz &&
        (cube.position.y - cube.halfHeight) <= by + b.top + 0.4 &&
        (cube.position.y - cube.halfHeight) >= by - 0.6) return true;
    const feet = camera.position.y - eyeHeight;
    return Math.abs(camera.position.x - b.x) <= b.hw &&
           Math.abs(camera.position.z - b.z) <= b.hz &&
           feet <= by + b.top + 0.5 && feet >= by - 0.6;
  }

  _setDoor(d, open) {
    if (this.doorOpen[d.id] === open) return;
    this.doorOpen[d.id] = open;
    const rec = this._doors[d.id];
    if (open) {   // remove collision so you can pass
      const i = this.solids.indexOf(rec.aabb); if (i >= 0) this.solids.splice(i, 1);
      const j = this.blockers.indexOf(rec.mesh); if (j >= 0) this.blockers.splice(j, 1);
    } else {      // closing: restore collision
      if (!this.solids.includes(rec.aabb)) this.solids.push(rec.aabb);
      if (!this.blockers.includes(rec.mesh)) this.blockers.push(rec.mesh);
    }
  }

  _gateOpen(ctx) {
    const g = this.def.exit.gate;
    if (g.type === 'gun') return ctx.hasGun;
    if (g.type === 'button') return !!this.pressed[g.button];
    return true;
  }

  // returns true when the player has reached an ACTIVE exit
  update(dt, camera, cube, ctx) {
    for (const b of this.buttons) {
      const on = this._pressed(b, camera, cube, ctx.eyeHeight);
      this.pressed[b.id] = on;
      b.topMesh.material.color.set(on ? 0x5aff7a : 0xff5a4a);
    }
    for (const d of this.def.doors) {
      const open = d.latch === false
        ? this.pressed[d.openBy]                             // held: closes when unweighted
        : (this.doorOpen[d.id] || this.pressed[d.openBy]);   // latch: opens once, stays open
      this._setDoor(d, open);
      const rec = this._doors[d.id];
      const targetY = this.doorOpen[d.id] ? rec.openY : rec.closedY;
      rec.mesh.position.y += (targetY - rec.mesh.position.y) * Math.min(1, dt * 4);
    }

    // gun pedestal pickup
    if (this.pedGun && !this.gunPicked && !ctx.hasGun) {
      const dx = camera.position.x - this.def.pedestal.x;
      const dz = camera.position.z - this.def.pedestal.z;
      if (Math.hypot(dx, dz) < 2.5) {
        this.gunPicked = true;
        this.pedGun.visible = false;
        ctx.grantGun();
      }
    }
    if (this.pedGun && this.pedGun.visible) {
      this.pedGun.rotation.y += dt * 1.6;
      this.pedGun.position.y = this.pedGunY + Math.sin(performance.now() * 0.002) * 0.12;
    }

    // exit gate + visuals
    const open = this._gateOpen(ctx);
    const k = Math.min(1, dt * 6);
    this.exitBarrier.position.y += ((open ? this.exitBarrierOpenY : this.exitBarrierClosedY) - this.exitBarrier.position.y) * k;
    this.exitBarrier.material.opacity += ((open ? 0 : 0.5) - this.exitBarrier.material.opacity) * k;
    this.exitBarrier.visible = this.exitBarrier.material.opacity > 0.02;
    this.exitPad.material.color.set(open ? 0x35ff8a : 0x9a3030);

    const e = this.def.exit;
    const feet = camera.position.y - ctx.eyeHeight;
    const inExit = Math.abs(camera.position.x - e.x) <= e.hw &&
                   Math.abs(camera.position.z - e.z) <= e.hd + 0.5 &&
                   feet >= e.y - e.hh - 1 && feet <= e.y + e.hh + 1;
    return open && inExit;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this.scene.remove(this.root);
  }
}

// a small ASHPD-ish gun mesh (used on the pickup pedestal)
export function buildGunMesh() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.4, metalness: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x3fb7ff });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 1.1), body));
  for (const s of [-1, 1]) {
    const prong = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.8), body);
    prong.position.set(s * 0.3, s * 0.3, 0.85);
    g.add(prong);
  }
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), glow);
  tip.position.set(0, 0, 0.6);
  g.add(tip);
  return g;
}
