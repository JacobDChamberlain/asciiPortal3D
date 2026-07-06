// main.js — asciiPortal3D
// Step 1 + 2 of the build order: a first-person 3D room (Three.js) whose every
// rendered frame is piped through asciify's AsciiRenderer and shown as ASCII.
//
// Pipeline:  Three.WebGLRenderer -> gameCanvas -> AsciiRenderer.render() -> #ascii
// The Three canvas is NEVER shown; it only exists as a drawImage source.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { AsciiRenderer } from './asciiRenderer.js';

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
const MARGIN = 0.8;       // how close the player can get to a wall

function makeRoom() {
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.85, metalness: 0.05 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x6f7681, roughness: 0.7, metalness: 0.1 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9, metalness: 0.0 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a5cff, roughness: 0.4, metalness: 0.2, emissive: 0x0a1a4a, emissiveIntensity: 0.6 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  scene.add(ceil);

  const wallGeo = new THREE.PlaneGeometry(ROOM, WALL_H);
  const walls = [
    { pos: [0, WALL_H / 2, -HALF], rot: [0, 0, 0] },
    { pos: [0, WALL_H / 2, HALF], rot: [0, Math.PI, 0] },
    { pos: [-HALF, WALL_H / 2, 0], rot: [0, Math.PI / 2, 0] },
    { pos: [HALF, WALL_H / 2, 0], rot: [0, -Math.PI / 2, 0] },
  ];
  for (const w of walls) {
    const m = new THREE.Mesh(wallGeo, wallMat);
    m.position.set(...w.pos);
    m.rotation.set(...w.rot);
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
  const cubeMat = new THREE.MeshStandardMaterial({ color: 0xd8b45a, roughness: 0.5, metalness: 0.3 });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), cubeMat);
  cube.position.set(-4, 1, -3);
  scene.add(cube);

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
  return { cube, sphere };
}

makeRoom();
const props = makeProps();

/* ------------------------------------------------------------------ *
 * First-person controls  (pointer lock + WASD + jump)
 * ------------------------------------------------------------------ */
const controls = new PointerLockControls(camera, document.body);

overlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => { overlay.classList.add('hidden'); });
controls.addEventListener('unlock', () => { overlay.classList.remove('hidden'); });

const keys = { forward: false, back: false, left: false, right: false };
let canJump = false;
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

const MOVE_ACCEL = 90;
const DAMPING = 9;
const GRAVITY = 32;
const JUMP_SPEED = 11;

window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.forward = true; break;
    case 'KeyS': case 'ArrowDown': keys.back = true; break;
    case 'KeyA': case 'ArrowLeft': keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'Space': if (canJump) { velocity.y = JUMP_SPEED; canJump = false; } break;
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

const RAMPS = ['standard', 'detailed', 'blocks'];
let rampIdx = 0;
function cycleRamp() { rampIdx = (rampIdx + 1) % RAMPS.length; ascii.setRamp(RAMPS[rampIdx]); updateHud(); }

/* ------------------------------------------------------------------ *
 * Layout / sizing — match the 3D aspect to the window, fit the ASCII output
 * ------------------------------------------------------------------ */
function fit() {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  renderH = Math.round(RENDER_W / aspect);
  gameRenderer.setSize(RENDER_W, renderH, false);
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
    `<span class="dim">WASD move · mouse look · space jump · [ ] resolution · V charset · C color</span>`;
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
    // horizontal movement with damping (classic pointer-lock pattern)
    velocity.x -= velocity.x * DAMPING * dt;
    velocity.z -= velocity.z * DAMPING * dt;

    direction.z = Number(keys.forward) - Number(keys.back);
    direction.x = Number(keys.right) - Number(keys.left);
    direction.normalize();

    if (keys.forward || keys.back) velocity.z -= direction.z * MOVE_ACCEL * dt;
    if (keys.left || keys.right) velocity.x -= direction.x * MOVE_ACCEL * dt;

    controls.moveRight(-velocity.x * dt);
    controls.moveForward(-velocity.z * dt);

    // gravity + floor
    velocity.y -= GRAVITY * dt;
    camera.position.y += velocity.y * dt;
    if (camera.position.y < EYE_HEIGHT) {
      camera.position.y = EYE_HEIGHT;
      velocity.y = 0;
      canJump = true;
    }

    // keep the player inside the room
    const lim = HALF - MARGIN;
    camera.position.x = Math.max(-lim, Math.min(lim, camera.position.x));
    camera.position.z = Math.max(-lim, Math.min(lim, camera.position.z));
  }

  // gentle prop motion so the scene is alive even while standing still
  props.cube.rotation.y += dt * 0.6;
  props.sphere.position.y = 1.6 + Math.sin(now * 0.0015) * 0.5;

  // 1) render the real 3D frame to the offscreen canvas
  gameRenderer.render(scene, camera);
  // 2) convert that frame to ASCII on the visible canvas
  ascii.render(gameCanvas, gameCanvas.width, gameCanvas.height);
}
requestAnimationFrame(animate);
