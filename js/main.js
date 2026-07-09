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
import { Chamber } from './chamber.js';
import { resolveBox } from './collision.js';

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */
const asciiCanvas = document.getElementById('ascii');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const banner = document.getElementById('banner');
const bannerBig = banner.querySelector('.big');
const bannerSub = banner.querySelector('.sub');
function showBanner(big, sub = 'press R to reset') {
  bannerBig.textContent = big;
  bannerSub.textContent = sub;
  banner.classList.add('show');
}
const hideBanner = () => banner.classList.remove('show');

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
ascii.setRamp('alphanumeric');
ascii.setColor(true);   // color default (per-glyph tint); toggle to mono with C

/* ------------------------------------------------------------------ *
 * Scene, camera, lights
 * ------------------------------------------------------------------ */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);
scene.fog = new THREE.Fog(0x05070c, 12, 42);

const camera = new THREE.PerspectiveCamera(72, RENDER_W / renderH, 0.1, 200);
const EYE_HEIGHT = 3.0;
camera.position.set(0, EYE_HEIGHT, -12);

scene.add(new THREE.HemisphereLight(0xcdd8ff, 0x384048, 0.85));
scene.add(new THREE.AmbientLight(0x4a5460, 0.45));
const sun = new THREE.DirectionalLight(0xffffff, 1.25);
sun.position.set(8, 16, 6);
scene.add(sun);
const fill = new THREE.PointLight(0x9fc4ff, 0.7, 80);
fill.position.set(-6, 9, -6);
scene.add(fill);
const ledgeLight = new THREE.PointLight(0xbfe0ff, 0.8, 60);  // lights the exit ledge
ledgeLight.position.set(0, 10, 9);
scene.add(ledgeLight);

/* ------------------------------------------------------------------ *
 * The room  (walls, floor, ceiling — the shell the chamber sits inside)
 * ------------------------------------------------------------------ */
const ROOM = 30;          // interior side length
const WALL_H = 14;
const HALF = ROOM / 2;

// walls the portal gun can shoot onto (populated by makeRoom)
const portalableSurfaces = [];

// dark metal frame grid over a wall panel (Portal-style framed panels). Added
// as children of the wall mesh so it inherits the wall's transform.
function addWallFrame(wall) {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x40464e, roughness: 0.45, metalness: 0.75 });
  const t = 0.22, d = 0.16, z = 0.06;   // bar thickness, depth, offset toward room
  const halfW = ROOM / 2, halfH = WALL_H / 2, cols = 5, rows = 3;
  for (let i = 0; i <= cols; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(t, WALL_H, d), frameMat);
    bar.position.set(-halfW + (ROOM / cols) * i, 0, z);
    wall.add(bar);
  }
  for (let j = 0; j <= rows; j++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(ROOM, t, d), frameMat);
    bar.position.set(0, -halfH + (WALL_H / rows) * j, z);
    wall.add(bar);
  }
}

function makeRoom() {
  // bright opaque panels with dark metal frames, like the real test chambers
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd6dbe2, roughness: 0.55, metalness: 0.05, emissive: 0x20242b, emissiveIntensity: 0.5 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.7, metalness: 0.1, emissive: 0x141820, emissiveIntensity: 0.35 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x767c85, roughness: 0.85, metalness: 0.0, emissive: 0x121820, emissiveIntensity: 0.35 });
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
    addWallFrame(m);
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

makeRoom();

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
const cube = new WeightedCube(scene, portals, HALF, WALL_H, { size: 2, spawn: [-8, 1, -8] });

/* ------------------------------------------------------------------ *
 * The test chamber — cube button opens the exit; portal up to the ledge
 * ------------------------------------------------------------------ */
const chamber = new Chamber(scene, EYE_HEIGHT);
portals.obstacles = chamber.solids;   // portals won't clip into the ledge/button

// Player (a box) vs the chamber's solid geometry: stand on ledges, be blocked.
const _pc = new THREE.Vector3();
const PLAYER_HALF_Y = (EYE_HEIGHT + 0.2) / 2;
function resolvePlayerSolids() {
  _pc.set(camera.position.x, camera.position.y + 0.2 - PLAYER_HALF_Y, camera.position.z);
  const grounded = resolveBox(
    _pc, { x: PLAYER_RADIUS, y: PLAYER_HALF_Y, z: PLAYER_RADIUS }, velocity, chamber.solids
  );
  camera.position.x = _pc.x;
  camera.position.z = _pc.z;
  camera.position.y = _pc.y + PLAYER_HALF_Y - 0.2;   // back to eye height
  if (grounded) { onGround = true; canJump = true; }
}

function resetChamber() {
  chamber.reset();
  cube.reset();
  respawn();
  won = false;
  oob = false;
  hideBanner();
}

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
let won = false;
let oob = false;   // player is currently outside the map
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
const PLAYER_RADIUS = 0.6;  // horizontal half-width for cube collision

const SPAWN = new THREE.Vector3(0, EYE_HEIGHT, -12);
function respawn() {
  camera.position.copy(SPAWN);
  velocity.set(0, 0, 0);
  portals.prev = null;   // reset the crossing tracker so we don't insta-teleport
}

// Resolve the player (a vertical box: PLAYER_RADIUS wide, feet..head tall)
// against the cube via minimal-translation AABB, so you can stand on it and
// can't walk through it. Skipped while the cube is carried.
function resolvePlayerCube() {
  if (cube.carried) return;
  const ph = PLAYER_RADIUS, ch = cube.halfHeight, c = cube.position;
  const px = camera.position.x, pz = camera.position.z;
  const feetY = camera.position.y - EYE_HEIGHT, headY = camera.position.y + 0.2;

  const oX = Math.min(px + ph, c.x + ch) - Math.max(px - ph, c.x - ch);
  const oZ = Math.min(pz + ph, c.z + ch) - Math.max(pz - ph, c.z - ch);
  const oY = Math.min(headY, c.y + ch) - Math.max(feetY, c.y - ch);
  if (oX <= 0 || oZ <= 0 || oY <= 0) return;   // not overlapping

  // push out along the axis of least penetration
  if (oY <= oX && oY <= oZ) {
    if (camera.position.y > c.y) {             // land on top of the cube
      camera.position.y = c.y + ch + EYE_HEIGHT;
      if (velocity.y < 0) velocity.y = 0;
      onGround = true; canJump = true;
    } else {                                    // bonk head on the underside
      camera.position.y = c.y - ch - 0.2;
      if (velocity.y > 0) velocity.y = 0;
    }
  } else if (oX <= oZ) {
    camera.position.x += px >= c.x ? oX : -oX;
    velocity.x = 0;
  } else {
    camera.position.z += pz >= c.z ? oZ : -oZ;
    velocity.z = 0;
  }
}

window.addEventListener('keydown', (e) => {
  // Paused / on the title (pointer unlocked): ignore keys — click to enter.
  // Mid-game, Esc is handled by the browser (exits pointer lock -> pause menu).
  if (!controls.isLocked) return;
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
    case 'KeyR': resetChamber(); break;           // reset the chamber
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
let rampIdx = RAMPS.indexOf('alphanumeric');
function cycleRamp() { rampIdx = (rampIdx + 1) % RAMPS.length; ascii.setRamp(RAMPS[rampIdx]); updateHud(); }

/* ------------------------------------------------------------------ *
 * Portal gun — raycast from the crosshair onto a wall, move a portal there
 * ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const SCREEN_CENTER = new THREE.Vector2(0, 0); // crosshair = center of view

function fireGun(which) {          // 0 = blue, 1 = orange
  if (!controls.isLocked) return;
  raycaster.setFromCamera(SCREEN_CENTER, camera);
  // test walls AND blockers together; take the nearest hit. If a blocker
  // (ledge, button, barrier) is closer, the shot is absorbed — no portal.
  const hits = raycaster.intersectObjects([...portalableSurfaces, ...chamber.blockers], false);
  if (!hits.length) return;
  const normal = hits[0].object.userData.portalNormal;
  if (!normal) return;            // nearest surface isn't portalable
  portals.place(which, hits[0].point, normal);
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
 * In-game HUD — a short status readout (controls live on the title screen)
 * ------------------------------------------------------------------ */
function updateHud() {
  hud.innerHTML =
    `<span class="dim">charset</span> <b>${RAMPS[rampIdx]}</b> &nbsp; ` +
    `<span class="dim">mode</span> <b>${ascii.color ? 'color' : 'mono'}</b> &nbsp; ` +
    `<span class="dim">cols</span> <b>${ascii.columns}</b>`;
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

    // out of the map? (fell out top/bottom, or shoved past the walls). Show a
    // message + log it once — recovery is left to R, so the break is visible.
    // The margin clears the ~HALF+1 the portal openings allow during a crossing.
    const OUT = HALF + 2.5;
    const p = camera.position;
    const outNow = p.y < -40 || p.y > WALL_H + 60 || Math.abs(p.x) > OUT || Math.abs(p.z) > OUT;
    if (outNow && !oob) {
      oob = true;
      console.warn(`[out of map] player escaped at x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} z=${p.z.toFixed(1)}`);
      showBanner("LOOK WHAT YOU'VE DONE");
    }

    // player vs level geometry (ledges, button), then the cube, then the box
    resolvePlayerSolids();
    cube.update(dt, camera, chamber.solids);
    resolvePlayerCube();

    // chamber logic: button -> unlock exit -> win
    if (chamber.update(dt, camera, cube) && !won) { won = true; showBanner('TEST CHAMBER COMPLETE'); }
  }


  // 1) render each portal's through-view into its target, then the real frame
  portals.update(camera);
  gameRenderer.render(scene, camera);
  // 2) convert that frame to ASCII on the visible canvas
  ascii.render(gameCanvas, gameCanvas.width, gameCanvas.height);
}
requestAnimationFrame(animate);
