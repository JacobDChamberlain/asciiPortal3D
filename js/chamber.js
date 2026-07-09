// chamber.js — asciiPortal3D
// A single test chamber: a cube BUTTON that opens the exit, a raised EXIT LEDGE
// you reach with portals, and an EXIT PAD you step on to win. Owns its level
// geometry and the solids the player/cube collide with.
//
// Intended solution:
//   1. Carry the cube (E) onto the floor button. The exit stays unlocked only
//      while the button is weighted, so leave the cube sitting on it.
//   2. Portal up onto the high ledge (e.g. blue low on a wall, orange on the
//      back wall above the ledge) and drop onto it.
//   3. Step on the glowing exit pad -> chamber complete.

import * as THREE from 'three';
import { makeBox } from './collision.js';

export class Chamber {
  constructor(scene, eyeHeight) {
    this.eyeHeight = eyeHeight;
    this.open = false;   // latched once the button is first pressed
    this.won = false;

    // ---- cube button (floor) ----
    this.btn = { x: -8, y: 0, z: 0, hx: 1.6, hz: 1.6, top: 0.5 };
    const btnBase = new THREE.Mesh(
      new THREE.BoxGeometry(this.btn.hx * 2, this.btn.top, this.btn.hz * 2),
      new THREE.MeshStandardMaterial({ color: 0x8892a0, roughness: 0.6, metalness: 0.4 })
    );
    btnBase.position.set(this.btn.x, this.btn.top / 2, this.btn.z);
    scene.add(btnBase);
    this.btnTop = new THREE.Mesh(
      new THREE.PlaneGeometry(this.btn.hx * 1.7, this.btn.hz * 1.7),
      new THREE.MeshBasicMaterial({ color: 0xff5a4a })
    );
    this.btnTop.rotation.x = -Math.PI / 2;
    this.btnTop.position.set(this.btn.x, this.btn.top + 0.01, this.btn.z);
    scene.add(this.btnTop);

    // ---- exit ledge (raised platform against the back wall) ----
    const L = { x: 0, top: 5, z: 13, hx: 6, hz: 2 };
    this.ledge = L;
    const ledgeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(L.hx * 2, L.top, L.hz * 2),
      new THREE.MeshStandardMaterial({ color: 0xa9b0bb, roughness: 0.8, metalness: 0.1 })
    );
    ledgeMesh.position.set(L.x, L.top / 2, L.z);
    scene.add(ledgeMesh);

    // ---- exit pad on top of the ledge ----
    this.exit = { x: 0, y: L.top, z: L.z + 0.5, hx: 2.5, hz: 2 };
    this.exitPad = new THREE.Mesh(
      new THREE.PlaneGeometry(this.exit.hx * 2, this.exit.hz * 2),
      new THREE.MeshBasicMaterial({ color: 0x9a3030 })   // dim until unlocked
    );
    this.exitPad.rotation.x = -Math.PI / 2;
    this.exitPad.position.set(this.exit.x, L.top + 0.02, this.exit.z);
    scene.add(this.exitPad);

    // ---- barrier (visual gate over the exit; lifts away when unlocked) ----
    this.barrierClosedY = L.top + 2.5;
    this.barrierOpenY = L.top + 8;
    this.barrier = new THREE.Mesh(
      new THREE.BoxGeometry(this.exit.hx * 2 + 1, 5, 0.4),
      new THREE.MeshStandardMaterial({
        color: 0x3fd0ff, emissive: 0x123a4a, emissiveIntensity: 0.8,
        transparent: true, opacity: 0.5, roughness: 0.3,
      })
    );
    this.barrier.position.set(this.exit.x, this.barrierClosedY, L.z - L.hz + 0.2);
    scene.add(this.barrier);

    // solids the player + cube collide with
    this.solids = [
      makeBox(L.x, L.top / 2, L.z, L.hx, L.top / 2, L.hz),                 // ledge
      makeBox(this.btn.x, this.btn.top / 2, this.btn.z, this.btn.hx, this.btn.top / 2, this.btn.hz), // button
    ];

    // meshes that block portal shots (you can't shoot a portal THROUGH them)
    this.blockers = [ledgeMesh, btnBase, this.barrier];
  }

  _cubeOnButton(cube) {
    if (cube.carried) return false;
    const b = this.btn;
    return Math.abs(cube.position.x - b.x) <= b.hx &&
           Math.abs(cube.position.z - b.z) <= b.hz &&
           (cube.position.y - cube.halfHeight) <= b.top + 0.4;
  }

  _playerOnButton(camera) {
    const b = this.btn;
    const feet = camera.position.y - this.eyeHeight;
    return Math.abs(camera.position.x - b.x) <= b.hx &&
           Math.abs(camera.position.z - b.z) <= b.hz &&
           feet <= b.top + 0.5;
  }

  _playerInExit(camera) {
    const e = this.exit;
    const feet = camera.position.y - this.eyeHeight;
    return Math.abs(camera.position.x - e.x) <= e.hx &&
           Math.abs(camera.position.z - e.z) <= e.hz &&
           feet >= e.y - 1.5 && feet <= e.y + 2.5;
  }

  update(dt, camera, cube) {
    // open only WHILE the button is weighted (by the cube or the player)
    const pressed = this._cubeOnButton(cube) || this._playerOnButton(camera);
    if (pressed !== this.open) {
      this.open = pressed;
      this.btnTop.material.color.set(pressed ? 0x5aff7a : 0xff5a4a);
      this.exitPad.material.color.set(pressed ? 0x35ff8a : 0x9a3030);
    }

    // animate the barrier up + fade (open) / down + solid (closed)
    const k = Math.min(1, dt * 6);
    const targetY = this.open ? this.barrierOpenY : this.barrierClosedY;
    this.barrier.position.y += (targetY - this.barrier.position.y) * k;
    const targetOp = this.open ? 0 : 0.5;
    this.barrier.material.opacity += (targetOp - this.barrier.material.opacity) * k;
    this.barrier.visible = this.barrier.material.opacity > 0.02;

    // winning latches even if the door later closes
    if (this.open && this._playerInExit(camera)) this.won = true;
    return this.won;
  }

  reset() {
    this.open = false;
    this.won = false;
    this.btnTop.material.color.set(0xff5a4a);
    this.exitPad.material.color.set(0x9a3030);
    this.barrier.position.y = this.barrierClosedY;
    this.barrier.material.opacity = 0.5;
    this.barrier.visible = true;
  }
}
