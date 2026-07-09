// collision.js — asciiPortal3D
// Minimal axis-aligned box collision. A "solid" is { min:Vector3, max:Vector3 }.
// resolveBox pushes a moving box out of any solids it overlaps along the axis of
// least penetration (so you land on tops and get blocked by sides), and reports
// whether it ended up resting on something (onGround).

import * as THREE from 'three';

export function makeBox(cx, cy, cz, hx, hy, hz) {
  return {
    min: new THREE.Vector3(cx - hx, cy - hy, cz - hz),
    max: new THREE.Vector3(cx + hx, cy + hy, cz + hz),
  };
}

// center: Vector3 (mutated), half: {x,y,z}, velocity: Vector3 (mutated).
export function resolveBox(center, half, velocity, solids) {
  let onGround = false;
  for (const s of solids) {
    const oX = Math.min(center.x + half.x, s.max.x) - Math.max(center.x - half.x, s.min.x);
    if (oX <= 0) continue;
    const oY = Math.min(center.y + half.y, s.max.y) - Math.max(center.y - half.y, s.min.y);
    if (oY <= 0) continue;
    const oZ = Math.min(center.z + half.z, s.max.z) - Math.max(center.z - half.z, s.min.z);
    if (oZ <= 0) continue;

    // resolve along the axis of least penetration
    if (oY <= oX && oY <= oZ) {
      const sCy = (s.min.y + s.max.y) / 2;
      if (center.y > sCy) { center.y += oY; if (velocity.y < 0) velocity.y = 0; onGround = true; }
      else { center.y -= oY; if (velocity.y > 0) velocity.y = 0; }
    } else if (oX <= oZ) {
      const sCx = (s.min.x + s.max.x) / 2;
      center.x += center.x > sCx ? oX : -oX;
      velocity.x = 0;
    } else {
      const sCz = (s.min.z + s.max.z) / 2;
      center.z += center.z > sCz ? oZ : -oZ;
      velocity.z = 0;
    }
  }
  return onGround;
}
