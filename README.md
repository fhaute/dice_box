# Dice box lab (`dice_box/`)

Standalone **Three.js** sandbox: polyhedral dice in a fixed wireframe **play pen**, custom lightweight physics, and a scripted **3D “box shake”** when you use **Apply & re-roll**. No React and no dependency on the main Arcanum SPA — only [three](https://threejs.org/) (via the repo root).

Use this folder when you want the **minimal** tree (TypeScript + HTML + README). A sibling folder, **`dice roll/`**, adds legacy prototypes (`Dice Roll.html`, `animations.jsx`).

---

## What you get

- **1–12 dice**, each **d4 / d6 / d8 / d12 / d20**, with **adjustable gravity** (m/s²).
- A **fixed XZ pen** (floor + four walls) drawn as a wireframe “box”; dice bounce and slide inside it.
- **Face readout** on the HUD (`D1:…`) once every die has **settled** (low linear and angular speed held for a short window).
- **Apply & re-roll**: respawns throws **and** runs a short **kinematic shake** of the whole pen in world space (see below).
- **Re-roll only**: short click on empty canvas or **Space** — new random throws **without** the shake motion.

Non-d6 solids use **canvas-drawn numerals** on faces (lab ordering on the mesh), not casino-standard engraving.

---

## What the code is doing (high level)

### Rendering and scene

`main.ts` builds a Three.js scene: perspective camera, lighting, the wireframe pen, and one **mesh per die** built from `dieLabConfig.ts` (geometry, support vertices, face normals for “which value is up”). Materials for numbered faces come from `facets.ts` (d6 box groups vs merged poly faces).

### Physics (custom integrator, not a full rigid-body engine)

The lab uses a **semi-implicit** integration loop tuned for dice-on-table feel:

1. **Gravity** pulls dice downward; **linear drag** and **angular drag** damp motion in air.
2. **Substeps** run at **240 Hz** so collisions stay stable when things move quickly.
3. **Floor and walls**: the pen is aligned to **world axes**. Contact uses the die’s **convex support vertices** projected into an **axis-aligned bounding box** in world space (`boxContact.ts`) so resting on the floor or sliding along walls is resolved without a generic physics library.
4. **Die–die**: pairwise **bounding spheres** with several resolve iterations — cheap bouncey overlaps, not continuous convex-convex contact.
5. **Resting bias (“topple”)**: near the table, a **torque in the body frame** nudges the lowest face toward **world down** so dice tend to finish **on a face** instead of balancing forever on an edge. Strength fades with height and speed so mid-air tumbling is not over-constrained.

Constants at the top of `main.ts` (restitution, friction, topple gains, settle thresholds) are the knobs for **bounce**, **slide**, and **settling**.

### Scripted box shake (`boxShake.ts`)

**Apply & re-roll** does not simulate a hinged lid or coupled rigid container. Instead, the **entire pen** (and thus the collision geometry dice interact with) moves along a **smooth finite burst** in **X, Y, and Z**:

- A **Hann-style envelope** \(\sin^2(\pi t/T)\) forces displacement and velocity to **zero at start and end**, so the box returns cleanly to its rest pose.
- Inside that envelope, **two sinusoids per axis** (different frequencies and phases) superpose so the path **wanders in 3D** — roughly like rattling a handheld box, not only sliding on the table.

`createRandomApplyBoxShake` picks amplitudes and frequencies within clamps; `sampleApplyBoxShakeXYZ` is pure sampling over time. Dice already in flight pick up the resulting boundary motion through the usual floor/wall resolution.

---

## Module map

| File | Role |
|------|------|
| `index.html` | Shell UI: hints, `#lab-controls` (dice count, facets, gravity, Apply). Loads `./main.ts` as an ES module. |
| `main.ts` | Scene, animation loop, physics integration, HUD, pen shake orchestration. |
| `boxShake.ts` | Randomized 3D shake profile and sampling (envelope × multi-sine offsets). |
| `dieLabConfig.ts` | Per–die-type geometry, support vertices, sphere radius, face-normal → value table for readout. |
| `facets.ts` | Face materials / textures (d6 vs other solids). |
| `boxContact.ts` | World AABB helpers for convex-vertex floor and walls. |
| `playBounds.ts` | Fixed pen size / placement in XZ so camera and bounds stay consistent. |

Root **`vite.config.ts`** exposes this folder as the **`diceBoxLab`** HTML entry; production build emits **`dist/dice_box/index.html`**.

---

## Run locally

From the **repository root** (dependencies are hoisted there):

```bash
npm install
npm run dev:dice:box
```

Then open **`/dice_box/index.html`** (the script sets the dev shortcut to that path).

Production-style output:

```bash
npm run build
```

Artifacts appear under **`dist/dice_box/`**.

---

## Relation to `dice roll/`

| | `dice_box/` | `dice roll/` |
|---|-------------|--------------|
| **Scope** | Minimal lab only | Same lab **plus** legacy HTML/JSX assets |
| **Dev script** | `npm run dev:dice:box` | `npm run dev:dice` |

Lab TypeScript may be **duplicated** between the two folders; treat edits as needing a **manual mirror** unless you consolidate to a single source later.

---

## Limitations (by design)

- **Toy physics**: tuned for visuals and iteration, not tournament-grade fairness or determinism across platforms.
- **Die–die** interaction is **sphere-based**, not exact polyhedron contact.
- **Shake** moves the **pen kinematically**; dice are not rigidly welded to a separate lid mesh.

If this README ships beside the rest of the Arcanum app repo, the main product lives under **`src/`**; this directory is an **optional dev playground** for dice feel and rendering.
