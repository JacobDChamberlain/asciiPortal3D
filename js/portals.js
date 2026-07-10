// portals.js — asciiPortal3D
// Two fixed portals with render-through (Tier 1) + teleport (Tier 2).
//
// Render-through: for each portal P (showing destination D), place a virtual
// camera at  T = M_D · flip180 · M_P⁻¹  applied to the main camera, render the
// scene from there into P's render target, and sample that target in SCREEN
// space on P's quad — so looking at P shows D's world, perfectly aligned.
// A global clipping plane at D discards anything behind the destination wall.
//
// Teleport: when the camera crosses P's plane (inside the opening), apply that
// same T to position, orientation, and velocity — momentum preserved.
//
// Non-recursive: both portal groups are hidden while rendering a target, so a
// through-view shows just the room (no infinite tunnel). The ASCII downsample
// hides the seams this would otherwise leave.

import * as THREE from 'three';

const FLIP = new THREE.Matrix4().makeRotationY(Math.PI);

const PORTAL_VERT = /* glsl */`
  varying vec4 vClip;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vClip = clip;
    gl_Position = clip;
  }
`;

// Sample the render target by the fragment's on-screen position, so the
// through-view lines up with where the quad actually sits in the main view.
// The quad is masked to an ellipse so the mouth reads as an oval.
const PORTAL_FRAG = /* glsl */`
  uniform sampler2D uTex;
  uniform vec3 uEdge;
  varying vec4 vClip;
  varying vec2 vUv;
  // The render target holds LINEAR light; our shader writes straight to the
  // canvas without the renderer's usual sRGB output step, so encode it here to
  // match the brightness of the rest of the frame.
  vec3 lin2srgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(hi, lo, step(c, vec3(0.0031308)));
  }
  void main() {
    vec2 d = (vUv - 0.5) / 0.5;         // -1..1 across the quad
    if (dot(d, d) > 1.0) discard;       // oval mouth
    vec2 uv = (vClip.xy / vClip.w) * 0.5 + 0.5;
    vec3 col = lin2srgb(texture2D(uTex, uv).rgb);
    // subtle edge tint so the mouth reads as blue/orange even in the view
    gl_FragColor = vec4(mix(col, uEdge, 0.06), 1.0);
  }
`;

// Flat oval used for the bright portal rim behind the mouth.
const FRAME_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAME_FRAG = /* glsl */`
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 d = (vUv - 0.5) / 0.5;
    if (dot(d, d) > 1.0) discard;
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

const UNIT_Z = new THREE.Vector3(0, 0, 1);

class Portal {
  constructor(scene, { halfW, halfH, color }) {
    this.halfW = halfW;
    this.halfH = halfH;
    this.center = new THREE.Vector3();
    this.color = new THREE.Color(color);

    this.group = new THREE.Group();
    scene.add(this.group);

    // bright oval rim behind the mouth so the portal reads as a ring
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2 + 0.5, halfH * 2 + 0.5),
      new THREE.ShaderMaterial({
        vertexShader: FRAME_VERT,
        fragmentShader: FRAME_FRAG,
        uniforms: { uColor: { value: new THREE.Color(color) } },
      })
    );
    frame.position.z = -0.01;
    this.group.add(frame);

    // the see-through surface
    this.rt = new THREE.WebGLRenderTarget(1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: PORTAL_VERT,
      fragmentShader: PORTAL_FRAG,
      uniforms: { uTex: { value: this.rt.texture }, uEdge: { value: this.color } },
    });
    this.display = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfH * 2), this.material);
    this.display.position.z = 0.02;
    this.group.add(this.display);

    // cached world-space frame vectors (refreshed by setPose)
    this.normal = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);

    this.dest = null;   // set by PortalSystem.link
    this.T = new THREE.Matrix4();     // this -> dest transform
    this.quatT = new THREE.Quaternion();
  }

  // Place the portal flat on a surface: mouth centered at `center`, facing
  // along `normal` (its outward direction, into the room).
  setPose(center, normal) {
    this.center.copy(center);
    this.group.position.copy(center).addScaledVector(normal, 0.08); // off the wall
    this.group.quaternion.setFromUnitVectors(UNIT_Z, normal);
    this.group.updateMatrixWorld(true);
    this.normal.copy(normal);
    this.right.set(1, 0, 0).applyQuaternion(this.group.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.group.quaternion);
  }

  link(dest) {
    this.dest = dest;
    // T = M_dest · flip · M_this⁻¹
    this.T.copy(dest.group.matrixWorld)
      .multiply(FLIP)
      .multiply(new THREE.Matrix4().copy(this.group.matrixWorld).invert());
    this.quatT.setFromRotationMatrix(this.T);
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// shared temporaries (avoid per-frame allocation)
const _rel = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _probePrev = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _lookM = new THREE.Matrix4();
const _ZERO = new THREE.Vector3(0, 0, 0);
const _WORLD_UP = new THREE.Vector3(0, 1, 0);

export class PortalSystem {
  constructor(renderer, scene, roomHalf, wallHeight, eyeHeight) {
    this.renderer = renderer;
    this.scene = scene;
    this.roomHalf = roomHalf;
    this.wallHeight = wallHeight;
    this.eyeHeight = eyeHeight;
    this.portals = [];

    this.vcam = new THREE.PerspectiveCamera();
    this.vcam.matrixAutoUpdate = false;
    this.vcam.layers.enable(1);   // render the player avatar (layer 1) THROUGH portals
    this.clip = new THREE.Plane();

    this.prev = null;       // camera position last frame
    this.cooldown = 0;
    this._tmp = new THREE.Vector3();
    this.obstacles = [];    // solid AABBs a portal mouth must not clip into
    this.active = true;     // false = no gun yet: portals hidden + inert
  }

  /** Create the blue/orange pair, place them, and link both ways. */
  addPair(defA, defB) {
    const a = new Portal(this.scene, defA);
    const b = new Portal(this.scene, defB);
    a.setPose(defA.center, defA.normal.clone().normalize());
    b.setPose(defB.center, defB.normal.clone().normalize());
    this.portals = [a, b];
    this.relink();
    return this;
  }

  relink() {
    const [a, b] = this.portals;
    a.link(b);
    b.link(a);
  }

  /**
   * Move portal `index` (0 = blue, 1 = orange) onto a vertical wall at a ray
   * hit. Snaps to the wall plane and clamps the mouth so it fits fully on the
   * wall, then relinks the pair. `normal` is the wall's inward (into-room) dir.
   */
  place(index, hitPoint, normal) {
    const p = this.portals[index];
    if (!p) return;
    const R = this.roomHalf;
    const hw = p.halfW + 0.3, hh = p.halfH + 0.3;
    const c = hitPoint.clone();
    if (Math.abs(normal.y) > 0.5) {            // floor / ceiling
      c.y = normal.y > 0 ? 0 : this.wallHeight;
      const r = Math.max(hw, hh);             // in-plane orientation is free; keep clear
      c.x = clamp(c.x, -R + r, R - r);
      c.z = clamp(c.z, -R + r, R - r);
    } else if (Math.abs(normal.x) > 0.5) {     // left / right wall
      c.x = -Math.sign(normal.x) * R;
      c.z = clamp(c.z, -R + hw, R - hw);
      c.y = clamp(c.y, hh, this.wallHeight - hh);
    } else {                                   // front / back wall
      c.z = -Math.sign(normal.z) * R;
      c.x = clamp(c.x, -R + hw, R - hw);
      c.y = clamp(c.y, hh, this.wallHeight - hh);
    }
    // slide the mouth to the nearest spot where the FULL oval fits clear of
    // obstacles (e.g. the ledge) and doesn't overlap the other portal. If there
    // is genuinely no room on this surface, the shot is dropped.
    if (!this._fitCenter(c, normal, p)) return false;
    p.setPose(c, normal.clone().normalize());
    this.relink();
    return true;
  }

  // Nudge the portal center (in the wall's 2D plane) out of any forbidden zones
  // — obstacle footprints and the other portal's mouth, each grown by the mouth
  // half-size — while staying within the surface bounds. Mutates c; returns
  // false if no valid position exists.
  _fitCenter(c, normal, p) {
    const hw = p.halfW, hh = p.halfH, R = this.roomHalf, WH = this.wallHeight;
    let uAxis, vAxis, nAxis;
    if (Math.abs(normal.x) > 0.5)      { uAxis = 'z'; vAxis = 'y'; nAxis = 'x'; }
    else if (Math.abs(normal.z) > 0.5) { uAxis = 'x'; vAxis = 'y'; nAxis = 'z'; }
    else                               { uAxis = 'x'; vAxis = 'z'; nAxis = 'y'; }

    const uLo = -R + hw, uHi = R - hw;
    const vLo = (vAxis === 'y') ? hh : -R + hh;
    const vHi = (vAxis === 'y') ? WH - hh : R - hh;
    const wallCoord = c[nAxis];

    // forbidden rectangles for the CENTER (footprint grown by the mouth half)
    const forb = [];
    for (const s of this.obstacles) {
      if (s.min[nAxis] - 0.2 <= wallCoord && wallCoord <= s.max[nAxis] + 0.2) {
        forb.push({
          uMin: s.min[uAxis] - hw, uMax: s.max[uAxis] + hw,
          vMin: s.min[vAxis] - hh, vMax: s.max[vAxis] + hh,
        });
      }
    }
    const other = this.portals.find((x) => x !== p);
    if (other && Math.abs(other.normal[nAxis]) > 0.5 &&
        Math.abs(other.center[nAxis] - wallCoord) < 0.5) {
      forb.push({
        uMin: other.center[uAxis] - 2 * hw, uMax: other.center[uAxis] + 2 * hw,
        vMin: other.center[vAxis] - 2 * hh, vMax: other.center[vAxis] + 2 * hh,
      });
    }

    let cu = clamp(c[uAxis], uLo, uHi), cv = clamp(c[vAxis], vLo, vHi);
    const E = 0.01;
    for (let iter = 0; iter < 16; iter++) {
      let moved = false;
      for (const f of forb) {
        if (cu > f.uMin && cu < f.uMax && cv > f.vMin && cv < f.vMax) {
          const cands = [];
          if (f.uMin - E >= uLo) cands.push({ du: f.uMin - E - cu, dv: 0 });
          if (f.uMax + E <= uHi) cands.push({ du: f.uMax + E - cu, dv: 0 });
          if (f.vMin - E >= vLo) cands.push({ du: 0, dv: f.vMin - E - cv });
          if (f.vMax + E <= vHi) cands.push({ du: 0, dv: f.vMax + E - cv });
          if (!cands.length) return false;   // boxed in with no exit
          cands.sort((a, b) => Math.abs(a.du) + Math.abs(a.dv) - Math.abs(b.du) - Math.abs(b.dv));
          cu = clamp(cu + cands[0].du, uLo, uHi);
          cv = clamp(cv + cands[0].dv, vLo, vHi);
          moved = true;
        }
      }
      if (!moved) break;
    }
    for (const f of forb) {
      if (cu > f.uMin && cu < f.uMax && cv > f.vMin && cv < f.vMax) return false;
    }
    c[uAxis] = cu; c[vAxis] = cv;
    return true;
  }

  // Project a world point onto a portal's in-plane axes and test the opening.
  _inOpening(p, point, pad = 0) {
    _rel.copy(point).sub(p.center);
    const along = _rel.dot(p.right), vert = _rel.dot(p.up);
    return Math.abs(along) <= p.halfW + pad && Math.abs(vert) <= p.halfH + pad;
  }

  // True if the player is standing over a floor-portal opening (so the floor
  // collision should let them drop through instead of catching them).
  overFloorOpening(pos) {
    if (!this.active) return false;
    for (const p of this.portals) {
      if (p.normal.y > 0.5 && this._inOpening(p, pos, 0.1)) return true;
    }
    return false;
  }

  setSize(w, h) {
    for (const p of this.portals) p.rt.setSize(w, h);
  }

  _setGroupsVisible(v) {
    for (const p of this.portals) p.group.visible = v;
  }

  // Render each portal's through-view into its target from a virtual camera.
  update(cam) {
    if (!this.active || this.portals.length < 2) { this._setGroupsVisible(false); return; }
    this._setGroupsVisible(false);
    const prevPlanes = this.renderer.clippingPlanes;
    for (const p of this.portals) {
      const vc = this.vcam;
      vc.matrixWorld.multiplyMatrices(p.T, cam.matrixWorld);
      vc.matrixWorldInverse.copy(vc.matrixWorld).invert();
      vc.projectionMatrix.copy(cam.projectionMatrix);
      vc.projectionMatrixInverse.copy(cam.projectionMatrixInverse);

      // clip everything behind the destination portal
      const n = p.dest.normal;
      this.clip.setFromNormalAndCoplanarPoint(
        n, this._tmp.copy(p.dest.center).addScaledVector(n, -0.05)
      );
      this.renderer.clippingPlanes = [this.clip];

      this.renderer.setRenderTarget(p.rt);
      this.renderer.render(this.scene, vc);
    }
    this.renderer.setRenderTarget(null);
    this.renderer.clippingPlanes = prevPlanes;
    this._setGroupsVisible(true);
  }

  // Called after movement each frame. Teleports the camera if it crossed a
  // portal plane inside the opening; keeps velocity/orientation consistent.
  postMove(cam, velocity, dt) {
    if (!this.active) return;
    if (this.cooldown > 0) this.cooldown -= dt;
    const now = cam.position;
    if (!this.prev) { this.prev = now.clone(); return; }

    if (this.cooldown <= 0) {
      for (const p of this.portals) {
        // probe with the feet for horizontal (floor/ceiling) portals so you
        // teleport as you step onto them, not after sinking eye-deep
        const drop = (Math.abs(p.normal.y) > 0.5) ? this.eyeHeight : 0;
        _probe.set(now.x, now.y - drop, now.z);
        _probePrev.set(this.prev.x, this.prev.y - drop, this.prev.z);
        const dPrev = _probePrev.sub(p.center).dot(p.normal);
        const dNow = _rel.copy(_probe).sub(p.center).dot(p.normal);

        // Wall portals: cross from the front through the plane. Floor/ceiling
        // portals are coplanar with the floor, so instead fire when you're
        // at/through the plane AND moving into it (velocity opposes the normal).
        const horizontal = Math.abs(p.normal.y) > 0.5;
        const crossed = horizontal
          ? (dNow <= 0.05 && velocity.dot(p.normal) < -0.01)
          : (dPrev > 0 && dNow <= 0);

        if (crossed && this._inOpening(p, _probe, 0)) {
          // position: map the camera through the portal, then nudge clear
          now.applyMatrix4(p.T);
          now.addScaledVector(p.dest.normal, 0.3);
          // velocity: full transform -> momentum is preserved (the fling)
          velocity.applyQuaternion(p.quatT);
          // orientation: transform the look direction, then rebuild it UPRIGHT
          // (roll-free) so PointerLockControls' yaw/pitch model stays valid
          _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion).applyQuaternion(p.quatT);
          _fwd.normalize();
          _fwd.y = clamp(_fwd.y, -0.98, 0.98);   // avoid straight up/down gimbal
          _fwd.normalize();
          _lookM.lookAt(_ZERO, _fwd, _WORLD_UP);
          cam.quaternion.setFromRotationMatrix(_lookM);
          this.cooldown = 0.08;
          break;
        }
      }
    }
    this.prev.copy(now);
  }

  // Generic body teleport (e.g. the weighted cube). `body` needs: position,
  // velocity (both Vector3), optional quaternion, halfHeight (probe offset for
  // floor/ceiling), clearance (exit nudge), and mutable _prev / _cool fields.
  // Returns true if it teleported this call.
  teleportObject(body, dt) {
    if (!this.active) return false;
    if (body._cool > 0) body._cool -= dt;
    const now = body.position;
    if (!body._prev) { body._prev = now.clone(); return false; }
    let didTp = false;

    if (body._cool <= 0) {
      for (const p of this.portals) {
        const drop = (Math.abs(p.normal.y) > 0.5) ? body.halfHeight : 0;
        _probe.set(now.x, now.y - drop, now.z);
        _probePrev.set(body._prev.x, body._prev.y - drop, body._prev.z);
        const dPrev = _probePrev.sub(p.center).dot(p.normal);
        const dNow = _rel.copy(_probe).sub(p.center).dot(p.normal);

        const horizontal = Math.abs(p.normal.y) > 0.5;
        const crossed = horizontal
          ? (dNow <= 0.05 && body.velocity.dot(p.normal) < -0.01)
          : (dPrev > 0 && dNow <= 0);

        if (crossed && this._inOpening(p, _probe, 0)) {
          now.applyMatrix4(p.T);
          now.addScaledVector(p.dest.normal, body.clearance ?? 0.3);
          body.velocity.applyQuaternion(p.quatT);
          if (body.quaternion) body.quaternion.premultiply(p.quatT);
          body._cool = 0.08;
          didTp = true;
          break;
        }
      }
    }
    body._prev.copy(now);
    return didTp;
  }

  // Clamp the player to the room, but leave a gap at each portal opening so
  // they can actually walk through the plane (where postMove teleports them).
  clampToRoom(pos) {
    const inset = this.roomHalf - 0.5;
    let minX = -inset, maxX = inset, minZ = -inset, maxZ = inset;
    const OPEN = this.roomHalf + 1;
    if (this.active) {
      for (const p of this.portals) {
        const n = p.normal;
        if (Math.abs(n.y) > 0.5) continue;          // floor/ceiling: no wall gap
        if (!this._inOpening(p, pos, 0.3)) continue;
        if (Math.abs(n.x) > 0.5) { if (n.x > 0) minX = -OPEN; else maxX = OPEN; }
        else { if (n.z > 0) minZ = -OPEN; else maxZ = OPEN; }
      }
    }
    pos.x = clamp(pos.x, minX, maxX);
    pos.z = clamp(pos.z, minZ, maxZ);
  }
}
