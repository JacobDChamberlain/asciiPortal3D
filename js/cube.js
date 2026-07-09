// cube.js — asciiPortal3D
// A weighted storage cube: carry it (E), drop it (E), throw it (T). It has its
// own world-space physics (gravity, floor/wall collision) and travels through
// portals via PortalSystem.teleportObject — so you can fling it too.

import * as THREE from 'three';
import { resolveBox } from './collision.js';

const GRAB_REACH  = 7;     // how close you must be to pick it up
const CARRY_DIST  = 3.2;   // how far in front of the camera it floats when held
const THROW_SPEED = 12;
const GRAVITY     = 32;
const MAX_FALL    = 55;
const FRICTION    = 0.86;  // ground friction per frame-ish so it settles

export class WeightedCube {
  constructor(scene, portals, roomHalf, wallHeight, opts = {}) {
    this.portals = portals;
    this.roomHalf = roomHalf;
    this.wallHeight = wallHeight;

    this.size = opts.size ?? 2;
    this.halfHeight = this.size / 2;
    this.spawn = new THREE.Vector3(...(opts.spawn ?? [0, this.halfHeight, 0]));

    this.position = this.spawn.clone();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.carried = false;

    // fields consumed by PortalSystem.teleportObject
    this.clearance = this.halfHeight + 0.3;
    this._prev = null;
    this._cool = 0;

    this._tmp = new THREE.Vector3();

    // ---- mesh: a lit box with bright edges + a heart accent (companion-ish) ----
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(this.size, this.size, this.size),
      new THREE.MeshStandardMaterial({
        color: 0xcbb489, roughness: 0.5, metalness: 0.35,
        emissive: 0x1a1206, emissiveIntensity: 0.5,
      })
    );
    this.mesh.add(body);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({ color: 0xffe0b0 })
    );
    this.mesh.add(edges);
    // a glowing accent on each face so it reads clearly in ASCII
    const accentMat = new THREE.MeshBasicMaterial({ color: 0xff6a8a });
    const s = this.size * 0.28;
    const faces = [
      [0, 0, this.halfHeight + 0.01, 0, 0, 0],
      [0, 0, -this.halfHeight - 0.01, 0, Math.PI, 0],
      [this.halfHeight + 0.01, 0, 0, 0, Math.PI / 2, 0],
      [-this.halfHeight - 0.01, 0, 0, 0, -Math.PI / 2, 0],
      [0, this.halfHeight + 0.01, 0, -Math.PI / 2, 0, 0],
      [0, -this.halfHeight - 0.01, 0, Math.PI / 2, 0, 0],
    ];
    for (const [px, py, pz, rx, ry, rz] of faces) {
      const accent = new THREE.Mesh(new THREE.PlaneGeometry(s, s), accentMat);
      accent.position.set(px, py, pz);
      accent.rotation.set(rx, ry, rz);
      this.mesh.add(accent);
    }

    scene.add(this.mesh);
    this._sync();
  }

  _sync() {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);
  }

  reset() {
    this.position.copy(this.spawn);
    this.velocity.set(0, 0, 0);
    this.quaternion.identity();
    this.carried = false;
    this._prev = null;
    this._cool = 0;
    this._sync();
  }

  // E: grab if close enough, or drop what you're holding
  toggleGrab(camera) {
    if (this.carried) { this.drop(); return true; }
    const dist = this._tmp.copy(this.position).sub(camera.position).length();
    if (dist <= GRAB_REACH) { this.carried = true; return true; }
    return false;
  }

  drop() {
    this.carried = false;
    this.velocity.set(0, 0, 0);
    this._prev = null;
  }

  // T: throw it along the camera's aim
  throw(camera) {
    if (!this.carried) return false;
    this.carried = false;
    this._tmp.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    this.velocity.copy(this._tmp).multiplyScalar(THROW_SPEED);
    this.velocity.y += 2;
    this._prev = null;
    return true;
  }

  update(dt, camera, solids = []) {
    if (this.carried) {
      // float in front of the camera; teleporting the camera carries it along
      this._tmp.set(0, 0, -1).applyQuaternion(camera.quaternion);
      this.position.copy(camera.position).addScaledVector(this._tmp, CARRY_DIST);
      this.position.y -= 0.4;
      this.velocity.set(0, 0, 0);
      this._prev = null;         // don't self-teleport while held
      this._sync();
      return;
    }

    // gravity
    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -MAX_FALL) this.velocity.y = -MAX_FALL;
    this.position.addScaledVector(this.velocity, dt);

    // collide with level geometry (platforms, button) and settle friction on top
    const h = this.halfHeight;
    if (resolveBox(this.position, { x: h, y: h, z: h }, this.velocity, solids)) {
      this.velocity.x *= FRICTION;
      this.velocity.z *= FRICTION;
    }

    // floor: rest at halfHeight unless over a floor-portal opening
    if (this.position.y < this.halfHeight && !this.portals.overFloorOpening(this.position)) {
      this.position.y = this.halfHeight;
      this.velocity.y = 0;
      this.velocity.x *= FRICTION;
      this.velocity.z *= FRICTION;
      if (Math.abs(this.velocity.x) < 0.05) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < 0.05) this.velocity.z = 0;
    }

    // portals + room bounds
    this.portals.teleportObject(this, dt);
    this.portals.clampToRoom(this.position);

    if (this.position.y < -40) this.reset();

    this._sync();
  }
}
