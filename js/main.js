// main.js — asciiPortal3D
// Step 1 + 2 of the build order: a first-person 3D room (Three.js) whose every
// rendered frame is piped through asciify's AsciiRenderer and shown as ASCII.
//
// Pipeline:  Three.WebGLRenderer -> gameCanvas -> AsciiRenderer.render() -> #ascii
// The Three canvas is NEVER shown; it only exists as a drawImage source.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { AsciiRenderer } from './asciiRenderer.js';
import { PortalSystem } from './portals.js';
import { WeightedCube } from './cube.js';

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */
const asciiCanvas = document.getElementById('ascii');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');

/* ------------------------------------------------------------------ *
 * Renderers
 * ------------------------------------------------------------------ */
// Offscreen 3D render target. Kept small-ish: the ASCII pass downsamples it to
// ~160 columns anyway, so there's no point rendering at full retina res.
const RENDER_W = 960;
let renderH = 540;

const gameRenderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
gameRenderer.setPixelRatio(1);
gameRenderer.setSize(RENDER_W, renderH, false);
const gameCanvas = gameRenderer.domElement; // never appended to the DOM

const ascii = new AsciiRenderer(asciiCanvas);
ascii.setColumns(200);
ascii.setRamp('standard');
ascii.setColor(false);   // mono green terminal look (fast: one fillText per row)

/* ------------------------------------------------------------------ *
 * Scene, camera, lights
 * ------------------------------------------------------------------ */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);
scene.fog = new THREE.Fog(0x05070c, 12, 42);

const camera = new THREE.PerspectiveCamera(72, RENDER_W / renderH, 0.1, 200);
const EYE_HEIGHT = 3.0;
camera.position.set(0, EYE_HEIGHT, 8);

scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x20160c, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.15);
sun.position.set(8, 16, 6);
scene.add(sun);
const fill = new THREE.PointLight(0x88bbff, 0.6, 60);
fill.position.set(-6, 8, -6);
scene.add(fill);

/* ------------------------------------------------------------------ *
 * The room  (a plain test chamber — walls, floor, ceiling, a few props)
 * ------------------------------------------------------------------ */
const ROOM = 20;          // interior side length
const WALL_H = 12;
const HALF = ROOM / 2;

// walls the portal gun can shoot onto (populated by makeRoom)
const portalableSurfaces = [];

function makeRoom() {
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.85, metalness: 0.05 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x6f7681, roughness: 0.7, metalness: 0.1 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9, metalness: 0.0 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a5cff, roughness: 0.4, metalness: 0.2, emissive: 0x0a1a4a, emissiveIntensity: 0.6 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.userData.portalNormal = new THREE.Vector3(0, 1, 0);
  portalableSurfaces.push(floor);
  scene.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  ceil.userData.portalNormal = new THREE.Vector3(0, -1, 0);
  portalableSurfaces.push(ceil);
  scene.add(ceil);

  const wallGeo = new THREE.PlaneGeometry(ROOM, WALL_H);
  const walls = [
    { pos: [0, WALL_H / 2, -HALF], rot: [0, 0, 0], n: [0, 0, 1] },
    { pos: [0, WALL_H / 2, HALF], rot: [0, Math.PI, 0], n: [0, 0, -1] },
    { pos: [-HALF, WALL_H / 2, 0], rot: [0, Math.PI / 2, 0], n: [1, 0, 0] },
    { pos: [HALF, WALL_H / 2, 0], rot: [0, -Math.PI / 2, 0], n: [-1, 0, 0] },
  ];
  for (const w of walls) {
    const m = new THREE.Mesh(wallGeo, wallMat);
    m.position.set(...w.pos);
    m.rotation.set(...w.rot);
    // tag as a portalable surface with its (reliable, axis-aligned) inward normal
    m.userData.portalNormal = new THREE.Vector3(...w.n);
    portalableSurfaces.push(m);
    scene.add(m);
    // a glowing trim strip so surfaces read with contrast in ASCII
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, 0.35), trimMat);
    strip.position.set(w.pos[0], 1.2, w.pos[2]);
    strip.rotation.set(...w.rot);
    // nudge off the wall to avoid z-fighting
    strip.position.x += Math.sin(w.rot[1]) * 0.02;
    strip.position.z += Math.cos(w.rot[1]) * 0.02;
    scene.add(strip);
  }
}

// A few props so depth + parallax read clearly when you move and look around.
function makeProps() {
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.8 });
  for (const [x, z] of [[6, -6], [-6, 5], [5, 5]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, WALL_H, 16), pillarMat);
    p.position.set(x, WALL_H / 2, z);
    scene.add(p);
  }

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.3, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xff5a5a, roughness: 0.3, metalness: 0.1, emissive: 0x330808 })
  );
  sphere.position.set(3, 1.3, -5);
  scene.add(sphere);
  return { sphere };
}

makeRoom();
const props = makeProps();

/* ------------------------------------------------------------------ *
 * Portals — one fixed blue/orange pair (left wall <-> back wall)
 * ------------------------------------------------------------------ */
const portals = new PortalSystem(gameRenderer, scene, HALF, WALL_H, EYE_HEIGHT);
portals.addPair(
  { // BLUE, on the left wall, facing +X into the room
    center: new THREE.Vector3(-HALF + 0.08, EYE_HEIGHT, -3),
    normal: new THREE.Vector3(1, 0, 0),
    halfW: 1.6, halfH: 2.6, color: 0x3fb7ff,
  },
  { // ORANGE, on the back wall, facing +Z into the room
    center: new THREE.Vector3(3, EYE_HEIGHT, -HALF + 0.08),
    normal: new THREE.Vector3(0, 0, 1),
    halfW: 1.6, halfH: 2.6, color: 0xff9a3c,
  }
);
portals.setSize(RENDER_W, renderH);

/* ------------------------------------------------------------------ *
 * Weighted cube — carry (E), drop (E), throw (T); flings through portals
 * ------------------------------------------------------------------ */
const cube = new WeightedCube(scene, portals, HALF, WALL_H, { size: 2, spawn: [-4, 1, -3] });

/* ------------------------------------------------------------------ *
 * First-person controls  (pointer lock + WASD + jump)
 * ------------------------------------------------------------------ */
const controls = new PointerLockControls(camera, document.body);

overlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => { overlay.classList.add('hidden'); });
controls.addEventListener('unlock', () => { overlay.classList.remove('hidden'); });

const keys = { forward: false, back: false, left: false, right: false };
let canJump = false;
let onGround = false;
const velocity = new THREE.Vector3();     // WORLD-space: walking, gravity, flings
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();

const MOVE_SPD = 12;        // ground run speed
const GROUND_CONTROL = 12;  // how quickly ground velocity eases toward input
const AIR_ACCEL = 14;       // gentle steering while airborne (momentum preserved)
const GRAVITY = 32;
const JUMP_SPEED = 12;
const MAX_FALL = 55;        // terminal fall speed (keeps portal loops stable)

const SPAWN = new THREE.Vector3(0, EYE_HEIGHT, 8);
function respawn() {
  camera.position.copy(SPAWN);
  velocity.set(0, 0, 0);
  portals.prev = null;   // reset the crossing tracker so we don't insta-teleport
}

window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.forward = true; break;
    case 'KeyS': case 'ArrowDown': keys.back = true; break;
    case 'KeyA': case 'ArrowLeft': keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'Space': if (canJump) { velocity.y = JUMP_SPEED; canJump = false; } break;
    case 'KeyQ': fireGun(0); break;   // blue portal at the crosshair
    case 'KeyF': fireGun(1); break;   // orange portal at the crosshair
    case 'KeyE': cube.toggleGrab(camera); break;  // grab / drop the cube
    case 'KeyT': cube.throw(camera); break;       // throw the cube
    case 'BracketLeft':  ascii.setColumns(Math.max(60, ascii.columns - 20)); updateHud(); break;
    case 'BracketRight': ascii.setColumns(Math.min(320, ascii.columns + 20)); updateHud(); break;
    case 'KeyC': ascii.setColor(!ascii.color); updateHud(); break;
    case 'KeyV': cycleRamp(); break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.forward = false; break;
    case 'KeyS': case 'ArrowDown': keys.back = false; break;
    case 'KeyA': case 'ArrowLeft': keys.left = false; break;
    case 'KeyD': case 'ArrowRight': keys.right = false; break;
  }
});

const RAMPS = ['standard', 'detailed', 'blocks', 'alphanumeric', 'numbers', 'letters'];
let rampIdx = 0;
function cycleRamp() { rampIdx = (rampIdx + 1) % RAMPS.length; ascii.setRamp(RAMPS[rampIdx]); updateHud(); }

/* ------------------------------------------------------------------ *
 * Portal gun — raycast from the crosshair onto a wall, move a portal there
 * ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const SCREEN_CENTER = new THREE.Vector2(0, 0); // crosshair = center of view

function fireGun(which) {          // 0 = blue, 1 = orange
  if (!controls.isLocked) return;
  raycaster.setFromCamera(SCREEN_CENTER, camera);
  const hits = raycaster.intersectObjects(portalableSurfaces, false);
  if (!hits.length) return;
  portals.place(which, hits[0].point, hits[0].object.userData.portalNormal);
}

document.addEventListener('mousedown', (e) => {
  if (!controls.isLocked) return;
  // right-click OR shift-click = orange; plain left-click = blue
  fireGun(e.button === 2 || e.shiftKey ? 1 : 0);
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ------------------------------------------------------------------ *
 * Layout / sizing — match the 3D aspect to the window, fit the ASCII output
 * ------------------------------------------------------------------ */
function fit() {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  renderH = Math.round(RENDER_W / aspect);
  gameRenderer.setSize(RENDER_W, renderH, false);
  portals.setSize(RENDER_W, renderH);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  // Output width in CSS px: fill the window width, capped for perf.
  ascii.setOutputWidth(Math.min(1600, window.innerWidth));
}
window.addEventListener('resize', fit);
fit();

/* ------------------------------------------------------------------ *
 * HUD
 * ------------------------------------------------------------------ */
function updateHud() {
  hud.innerHTML =
    `cols <b>${ascii.columns}</b> &nbsp; ramp <b>${RAMPS[rampIdx]}</b> &nbsp; ` +
    `mode <b>${ascii.color ? 'color' : 'mono'}</b><br>` +
    `<span class="dim">WASD move · mouse look · space jump · click/Q blue · shift-click/F orange · E grab/drop · T throw · [ ] res · V charset · C color</span>`;
}
updateHud();

/* ------------------------------------------------------------------ *
 * Main loop
 * ------------------------------------------------------------------ */
let last = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  let dt = (now - last) / 1000;
  if (dt > 0.1) dt = 0.1;
  last = now;

  if (controls.isLocked) {
    // horizontal input direction in WORLD space (from where the camera faces)
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion); _fwd.y = 0; _fwd.normalize();
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion); _right.y = 0; _right.normalize();
    _wish.set(0, 0, 0);
    if (keys.forward) _wish.add(_fwd);
    if (keys.back) _wish.sub(_fwd);
    if (keys.right) _wish.add(_right);
    if (keys.left) _wish.sub(_right);
    if (_wish.lengthSq() > 0) _wish.normalize();

    if (onGround) {
      // responsive ground control: ease horizontal velocity toward the target
      const t = 1 - Math.exp(-GROUND_CONTROL * dt);
      velocity.x += (_wish.x * MOVE_SPD - velocity.x) * t;
      velocity.z += (_wish.z * MOVE_SPD - velocity.z) * t;
    } else {
      // airborne: preserve momentum (the fling), allow only gentle steering
      velocity.x += _wish.x * AIR_ACCEL * dt;
      velocity.z += _wish.z * AIR_ACCEL * dt;
    }

    velocity.y -= GRAVITY * dt;
    if (velocity.y < -MAX_FALL) velocity.y = -MAX_FALL;

    camera.position.addScaledVector(velocity, dt);

    // the floor catches you at eye height UNLESS you're over a floor-portal
    // opening, in which case you drop through (and get teleported)
    onGround = false;
    if (camera.position.y < EYE_HEIGHT && !portals.overFloorOpening(camera.position)) {
      camera.position.y = EYE_HEIGHT;
      velocity.y = 0;
      onGround = true;
      canJump = true;
    }

    // portals: teleport if we crossed a mouth, then clamp to the room (with
    // gaps left open at each portal so we can actually walk through)
    portals.postMove(camera, velocity, dt);
    portals.clampToRoom(camera.position);

    // safety net: if we somehow fall out of the world, respawn
    if (camera.position.y < -40 || camera.position.y > WALL_H + 60) respawn();

    // the weighted cube: physics, carry/throw, and its own portal travel
    cube.update(dt, camera);
  }

  // gentle prop motion so the scene is alive even while standing still
  props.sphere.position.y = 1.6 + Math.sin(now * 0.0015) * 0.5;

  // 1) render each portal's through-view into its target, then the real frame
  portals.update(camera);
  gameRenderer.render(scene, camera);
  // 2) convert that frame to ASCII on the visible canvas
  ascii.render(gameCanvas, gameCanvas.width, gameCanvas.height);
}
requestAnimationFrame(animate);
