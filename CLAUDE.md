# asciiPortal3D

A real-time **3D first-person Portal-like game that runs in the browser**, with
its final image rendered as **ASCII characters** before being shown. The 3D
scene is real (WebGL); the ASCII look is a post-processing pass over the
rendered frame — not a fake 2D grid.

This is the successor to two sibling projects on the same Desktop:
- `../asciiPortal` — the original attempt: a **2D character-grid platformer**
  faking Portal. It works and is fun, but it is NOT what the author wanted. None
  of its engine transfers here (its "3D" is faked; its physics/portals are
  tile-based). Kept only as reference/history.
- `../asciify` — a **client-side ASCII renderer** that converts any image or
  video frame into ASCII on a canvas. Its engine is reusable and is the
  foundation of the render pipeline here (see below).

## The vision (why this project exists)

The author originally wanted a 3D first-person Portal clone rendered in ASCII.
`asciiPortal` fell short (it's 2D). `asciify` proved the ASCII-conversion half
works great. This project unites them: **build a genuine 3D FP portal game, then
run every frame through asciify's converter before display.**

Goal is "very good, not perfect" graphics that read clearly as Portal-esque
**without being a direct copy** (avoid trademarked names/assets — it's an
homage, not a clone to be sued over).

## The core pipeline

The whole idea hinges on one fact about asciify's renderer
(`../asciify/js/asciiRenderer.js`):

```js
render(source, srcW, srcH)   // `source` is any CanvasImageSource
```

`render()` internally calls `drawImage(source, …)` to downsample. It does not
care whether `source` is an image, a video frame, **or another canvas**. So:

```
Three.js renders 3D frame  →  its WebGL <canvas>
    →  AsciiRenderer.render(gameCanvas)  →  visible ASCII <canvas>
```

…every frame, inside the game loop. That is the entire bridge. We lift
`asciiRenderer.js` in (nearly) unchanged as a module.

### Two tiers for the ASCII pass
- **Prototype (start here):** reuse asciify's **CPU** renderer as-is at modest
  resolution (~120–160 columns, mono). It maps luminance→glyph with `fillText`
  per row (mono) or per glyph (color) — cheap for stills, the bottleneck for a
  60fps game, but very likely fine to start.
- **If it chugs:** move the ASCII conversion into a **GLSL post-processing
  shader** (sample the game texture, map luminance→glyph from a font-atlas
  texture, all on GPU). Same look, essentially free. Pairs naturally with
  Three.js `EffectComposer`. This is the "proper" long-term path.

## Difficulty honesty (agreed with the author)

The ASCII part is the *easy, solved* part. The hard part is portals. In tiers:

- **Tier 1 — Portal rendering (seeing through): moderate, solved.** Place a
  virtual camera at the pose relative to portal B that mirrors the real camera
  relative to A; render that view to a texture; paint it on A's surface; use an
  oblique near-plane clip so nothing behind B leaks in. Many open-source Three.js
  references exist. Confident.
- **Tier 2 — Teleportation (physics through): moderate, solved.** On crossing a
  portal plane, apply the A→B relative transform to position, velocity, and view
  orientation. "Speedy thing goes in, speedy thing comes out." Confident.
- **Tier 3 — Seamlessness: the genuinely hard part.** No-seam camera clipping at
  the boundary, held objects through portals, and **recursive** portal-in-portal
  (infinite tunnel). Real Portal does all this; it takes iteration and may not be
  flawless.

**Key advantage for THIS project:** the ASCII downsample *hides* most Tier-3
problems. Seams, minor clipping artifacts, and recursion depth get quantized
away by rendering to ~150 chunky glyphs. The art style is forgiving exactly
where portal rendering is fussy.

**Committed deliverable:** non-recursive, single-bounce portals that render
through AND teleport correctly — that already plays like Portal for ~95% of
situations. Infinite recursion and pixel-perfect seams are "iterate as far as it
wants to go," not a day-one promise.

## Tech stack

- **Three.js** for 3D (browser standard). Prefer loading via ES module CDN /
  import map to keep the no-build-step spirit of the sibling projects, unless a
  build step becomes worth it.
- Vanilla JS, ES modules, fully client-side. No server required to play.
- Reuse `../asciify/js/asciiRenderer.js` (copy in or import) for the ASCII pass.

## Build order

1. **First-person movement in a 3D room** (Three.js scene + FP controls),
   rendered normally to a canvas.
2. **ASCII post-pass** — pipe that canvas through asciify's renderer; tune
   resolution/charset until it reads well.
3. **One working portal** — render-through (Tier 1) + teleport (Tier 2).
4. **Portal puzzle elements** — cube, pressure plate, exit door, a chamber.
5. Polish / performance (GLSL ASCII shader if the CPU pass is too slow).

Milestone framing: "walk around a 3D room shown as ASCII" comes BEFORE any
portal work.

## Working constraint (how we iterate)

Claude can build, run, and screenshot the game to self-verify mechanics, but
cannot casually *watch* it. Tuning "feel" (jump height, mouse sensitivity,
whether a transition looks right) is faster through the author's eyes. So the
loop is: **Claude builds + self-verifies mechanics → author playtests → reports
what feels off → Claude adjusts.** Same loop that got `asciiPortal` working, on a
harder engine.

## Status

**Steps 1 + 2 done and author-approved.** Working first-person 3D room
(`js/main.js`) rendered through the ASCII pass (`js/asciiRenderer.js`, lifted
from asciify). Three.js via CDN import map, no build step. Serve statically
(`python3 -m http.server`) and open — needs a server + internet (CDN), not
`file://`.

- Pipeline confirmed working: `gameRenderer.render()` (offscreen 960×540 canvas)
  → `ascii.render(gameCanvas)` → visible `#ascii` canvas, every tick.
- Default **200 columns**, mono green. Live tuning keys: `[` `]` resolution,
  `V` charset (standard/detailed/blocks), `C` mono↔color. HUD bottom-left.
- FP controls: pointer lock, WASD, mouse look, space jump, room-bounds clamp.

**Backlog / future polish (not started):**
- On-screen resolution control (asciify-style slider) instead of only `[` `]`
  keys. Deferred until the game is further along.
- GLSL ASCII shader if the CPU pass ever bottlenecks (color mode is the slow
  path).

**Step 3 IMPLEMENTED, awaiting playtest.** One fixed blue/orange portal pair
(`js/portals.js`, `PortalSystem`): blue on the left wall, orange on the back
wall (perpendicular, so teleporting turns a corner through space).
- Render-through: virtual camera at `T = M_dest · flip180 · M_src⁻¹ · mainCam`,
  scene rendered to each portal's WebGLRenderTarget, sampled in screen space on
  the portal quad (ShaderMaterial). A global clipping plane at the destination
  discards geometry behind that wall.
- Teleport: `postMove()` detects the camera crossing a mouth inside the opening
  and applies the same `T` to position, orientation (quaternion premultiply),
  and velocity. 0.25s cooldown; exit nudged clear of the destination.
- `clampToRoom()` keeps the player in the room but leaves gaps at portal
  openings so they can walk through the plane.
- Non-recursive (both groups hidden during target renders) — ASCII hides seams.

Gun placement is deliberately deferred: fixed portals first to prove
render+teleport, gun (raycast onto walls) built on top afterward.
