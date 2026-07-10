// avatar.js — asciiPortal3D
// "Max", the player's Aperture test-subject body. You never see Max in your own
// first-person view, but you DO see Max through a portal (holding the cube, or
// holding the portal gun aimed forward). The trick: Max lives on render LAYER 1,
// which the main camera does not render but the portals' virtual cameras do.

import * as THREE from 'three';

export const AVATAR_LAYER = 1;

export class Avatar {
  constructor(scene, eyeHeight) {
    this.eyeHeight = eyeHeight;
    this.group = new THREE.Group();

    const suit = new THREE.MeshStandardMaterial({ color: 0xd9772b, roughness: 0.7, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24252b, roughness: 0.6, metalness: 0.3 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a06a, roughness: 0.8 });

    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      this.group.add(m);
      return m;
    };

    // legs (long-fall boots), torso (jumpsuit), head
    add(new THREE.BoxGeometry(0.42, 1.5, 0.5), dark, -0.3, 0.75, 0);
    add(new THREE.BoxGeometry(0.42, 1.5, 0.5), dark, 0.3, 0.75, 0);
    add(new THREE.BoxGeometry(1.2, 1.5, 0.62), suit, 0, 2.15, 0);
    add(new THREE.SphereGeometry(0.42, 18, 14), skin, 0, 3.15, 0.02);

    // arms reaching forward (so a held cube in front reads as "carried")
    this.armL = add(new THREE.BoxGeometry(0.34, 1.15, 0.34), suit, -0.82, 2.25, 0.35, -Math.PI / 2.3);
    this.armR = add(new THREE.BoxGeometry(0.34, 1.15, 0.34), suit, 0.82, 2.25, 0.35, -Math.PI / 2.3);

    // portal gun in the hands (shown once acquired), aimed forward (+Z)
    this.gun = this._buildGun();
    this.gun.position.set(0, 2.0, 1.05);
    this.gun.visible = false;
    this.group.add(this.gun);

    // put the whole avatar (and its children) on the portals-only layer
    this.group.traverse((o) => o.layers.set(AVATAR_LAYER));

    scene.add(this.group);
  }

  _buildGun() {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.4, metalness: 0.4 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x3fb7ff });
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.0), body);
    g.add(core);
    // two prongs at the muzzle
    for (const s of [-1, 1]) {
      const prong = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.7), body);
      prong.position.set(s * 0.28, s * 0.28, 0.75);
      g.add(prong);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), glow);
    tip.position.set(0, 0, 0.55);
    g.add(tip);
    return g;
  }

  setHasGun(on) { this.gun.visible = !!on; }

  // Each frame: stand Max under the camera, facing the camera's heading.
  update(camera) {
    const p = camera.position;
    this.group.position.set(p.x, p.y - this.eyeHeight, p.z);
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion); // look direction
    this.group.rotation.y = Math.atan2(_fwd.x, _fwd.z);    // Max built facing +Z
  }
}

const _fwd = new THREE.Vector3();
