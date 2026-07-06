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
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vClip = clip;
    gl_Position = clip;
  }
`;

// Sample the render target by the fragment's on-screen position, so the
// through-view lines up with where the quad actually sits in the main view.
const PORTAL_FRAG = /* glsl */`
  uniform sampler2D uTex;
  uniform vec3 uEdge;
  varying vec4 vClip;
  // The render target holds LINEAR light; our shader writes straight to the
  // canvas without the renderer's usual sRGB output step, so encode it here to
  // match the brightness of the rest of the frame.
  vec3 lin2srgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(hi, lo, step(c, vec3(0.0031308)));
  }
  void main() {
    vec2 uv = (vClip.xy / vClip.w) * 0.5 + 0.5;
    vec3 col = lin2srgb(texture2D(uTex, uv).rgb);
    // subtle edge tint so the mouth reads as blue/orange even in the view
    gl_FragColor = vec4(mix(col, uEdge, 0.06), 1.0);
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

    // bright frame behind the mouth so the portal reads as a ring
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2 + 0.5, halfH * 2 + 0.5),
      new THREE.MeshBasicMaterial({ color })
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

export class PortalSystem {
  constructor(renderer, scene, roomHalf, wallHeight) {
    this.renderer = renderer;
    this.scene = scene;
    this.roomHalf = roomHalf;
    this.wallHeight = wallHeight;
    this.portals = [];

    this.vcam = new THREE.PerspectiveCamera();
    this.vcam.matrixAutoUpdate = false;
    this.clip = new THREE.Plane();

    this.prev = null;       // camera position last frame
    this.cooldown = 0;
    this._tmp = new THREE.Vector3();
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
    if (Math.abs(normal.x) > 0.5) {           // left / right wall
      c.x = -Math.sign(normal.x) * R;
      c.z = clamp(c.z, -R + hw, R - hw);
    } else {                                   // front / back wall
      c.z = -Math.sign(normal.z) * R;
      c.x = clamp(c.x, -R + hw, R - hw);
    }
    c.y = clamp(c.y, hh, this.wallHeight - hh);
    p.setPose(c, normal.clone().normalize());
    this.relink();
  }

  setSize(w, h) {
    for (const p of this.portals) p.rt.setSize(w, h);
  }

  _setGroupsVisible(v) {
    for (const p of this.portals) p.group.visible = v;
  }

  // Render each portal's through-view into its target from a virtual camera.
  update(cam) {
    if (this.portals.length < 2) return;
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
    if (this.cooldown > 0) this.cooldown -= dt;
    const now = cam.position;
    if (!this.prev) { this.prev = now.clone(); return; }

    if (this.cooldown <= 0) {
      for (const p of this.portals) {
        const dPrev = this._tmp.copy(this.prev).sub(p.center).dot(p.normal);
        const dNow = this._tmp.copy(now).sub(p.center).dot(p.normal);
        if (dPrev > 0 && dNow <= 0) {
          const rel = this._tmp.copy(now).sub(p.center);
          const along = rel.dot(p.right), vert = rel.dot(p.up);
          if (Math.abs(along) <= p.halfW && Math.abs(vert) <= p.halfH) {
            now.applyMatrix4(p.T);
            now.addScaledVector(p.dest.normal, 0.3);   // nudge clear of the exit
            cam.quaternion.premultiply(p.quatT);
            velocity.applyQuaternion(p.quatT);
            this.cooldown = 0.25;
            break;
          }
        }
      }
    }
    this.prev.copy(now);
  }

  // Clamp the player to the room, but leave a gap at each portal opening so
  // they can actually walk through the plane (where postMove teleports them).
  clampToRoom(pos) {
    const inset = this.roomHalf - 0.5;
    let minX = -inset, maxX = inset, minZ = -inset, maxZ = inset;
    const OPEN = this.roomHalf + 1;
    for (const p of this.portals) {
      const n = p.normal;
      if (Math.abs(n.x) > 0.5) {
        if (Math.abs(pos.z - p.center.z) <= p.halfW + 0.3 &&
            Math.abs(pos.y - p.center.y) <= p.halfH + 0.3) {
          if (n.x > 0) minX = -OPEN; else maxX = OPEN;
        }
      } else if (Math.abs(n.z) > 0.5) {
        if (Math.abs(pos.x - p.center.x) <= p.halfW + 0.3 &&
            Math.abs(pos.y - p.center.y) <= p.halfH + 0.3) {
          if (n.z > 0) minZ = -OPEN; else maxZ = OPEN;
        }
      }
    }
    pos.x = Math.max(minX, Math.min(maxX, pos.x));
    pos.z = Math.max(minZ, Math.min(maxZ, pos.z));
  }
}
