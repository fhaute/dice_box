/**
 * Standalone Three.js dice sandbox: no React, no Zustand, no story engine.
 *
 * Intent: iterate on visuals and (later) real rigid-body physics without touching `src/`.
 * Contract: run `npm run dev`, open `/dice_box/index.html`. Uses the repo `three` dependency only.
 * Lab controls: dice count (1–12), facets per die (4/6/8/12/20), and gravity (m/s²). Physics uses a **fixed** XZ play pen, convex vertex
 * AABB floor/walls and bounding-sphere die–die passes. **240 Hz** substeps; near the table a small **topple torque**
 * (ω̇ in body frame) biases the lowest face toward world-down so dice finish on a face without quaternion easing hacks.
 * **Apply & re-roll** runs a short scripted **3D box shake** (Hann-windowed multi-sine motion on X, Y, Z; see `boxShake.ts`).
 * Click the empty canvas (short tap) or press Space to re-roll without Apply.
 */

import * as THREE from 'three'

import { createRandomApplyBoxShake, sampleApplyBoxShakeXYZ, type ApplyBoxShakeConfig } from './boxShake'
import { worldAabbOfLocalPoints, type WorldBoxAabb } from './boxContact'
import { buildLabDieSpec, disposeLabDieSpec, supportMaxHalfExtent, type FaceNormalEntry, type LabDieSpec } from './dieLabConfig'
import { createD6FaceMaterials, createPolyFaceMaterials } from './facets'
import { computeFixedPlayPenBoundsXZ, type XZCenterBounds } from './playBounds'

/** Lab gravity lower bound (m/s²); UI `lab-gravity` is clamped to `[MIN_LAB_GRAVITY, MAX_LAB_GRAVITY]`. */
const MIN_LAB_GRAVITY = 4
/** Lab gravity upper bound (m/s²). */
const MAX_LAB_GRAVITY = 80
/**
 * Downward linear acceleration (m/s²) used in integration; synced from `#lab-gravity` on input/change and when Apply runs.
 * Contract: safe to read from the physics loop; only written from the main lab UI handlers.
 */
let labGravityMps2 = 30

const LINEAR_DRAG = 0.02
/** Airborne spin decay (closer to 1 → freer tumble in flight). */
const ANGULAR_DRAG = 0.88
const WALL_RESTITUTION = 0.62
/** Sliding friction on floor (blend of grip vs slide after impact). */
const FRICTION = 0.52
/** Floor bounce for tiny taps / creep (almost inelastic “last inch”). */
const RESTITUTION_SOFT = 0.12
/** Floor bounce when hitting with speed (main drop bounce). */
const RESTITUTION_FIRM = 0.38
/** Impact speed (m/s) at which floor restitution reaches `RESTITUTION_FIRM`. */
const RESTITUTION_BLEND_AT = 7.5

/** Table-top torque scale (rad/s² order) so edge/corner poses roll onto a face; fades off the table. */
const TOPPLE_GAIN = 126.72
/**
 * Boosts topple torque when `misalign` is small: `sin(misalign)` alone makes the last edge→face phase very slow;
 * `1 + TOPPLE_LAST_A / (misalign + TOPPLE_LAST_K)` adds assist without changing mid-collision bounce (still gated by height + speed).
 */
const TOPPLE_LAST_A = 4.032
const TOPPLE_LAST_K = 0.052
/** Max |ω| after adding topple impulse (keeps sim stable). */
const OMEGA_CLAMP = 137.28
/**
 * Topple strength vs |ω| (rad/s): full assist below `TOPPLE_SPIN_FADE_MIN`, fades to zero by `TOPPLE_SPIN_FADE_MAX`.
 * Intent: replace a hard |ω| cutoff that left a “halt” with no torque while the die still rocked on an edge.
 */
const TOPPLE_SPIN_FADE_MIN = 0.5
const TOPPLE_SPIN_FADE_MAX = 2.55
/**
 * Same for |v| (m/s): damp assist during fast slides/slams while avoiding a binary on/off at the old fixed threshold.
 */
const TOPPLE_LINEAR_FADE_MIN = 0.18
const TOPPLE_LINEAR_FADE_MAX = 0.78

/** Scales linear impulse when the pen jumps between physics substeps (`applyPenShakeKick`). */
const SHAKE_LINEAR_GAIN = 0.52
/** Scales angular impulse from horizontal jerk during scripted shake. */
const SHAKE_ANGULAR_GAIN = 0.09

const SETTLE_V_EPS = 0.07
const SETTLE_W_EPS = 0.14
const SETTLE_STABLE_MS = 300

const BOUNDS_MARGIN = 0.08

const MIN_DICE = 1
const MAX_DICE = 12

/**
 * Mutable kinematic state for one die: integration advances these; meshes copy them each frame.
 *
 * Contract: `quaternion` is normalized after orientation integration; `supportLocal` from `LabDieSpec` defines hull extent.
 */
type DieSim = {
  position: THREE.Vector3
  velocity: THREE.Vector3
  quaternion: THREE.Quaternion
  angularVelocity: THREE.Vector3
}

const _axis = new THREE.Vector3()
const _dq = new THREE.Quaternion()
const _n = new THREE.Vector3()
const _delta = new THREE.Vector3()
const _relV = new THREE.Vector3()
const _worldUp = new THREE.Vector3(0, 1, 0)
const _worldDown = new THREE.Vector3(0, -1, 0)
/** Scratch: horizontal velocity on the floor for friction (avoid per-contact allocation). */
const _tang = new THREE.Vector3()
const _tauWorld = new THREE.Vector3()
const _nBottomLocal = new THREE.Vector3()
const _aabb: WorldBoxAabb = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }
/** Play-area focus (XZ centroid + table height) for camera and key light. */
const _camFocus = new THREE.Vector3()
/** Unit direction from focus toward camera (above + front-right). */
const _camDir = new THREE.Vector3(1.02, 0.88, 1.14)
_camDir.normalize()

const _shakePos0 = { x: 0, y: 0, z: 0 }
const _shakePos1 = { x: 0, y: 0, z: 0 }

/**
 * Spawns a die above the table with random orientation and zero velocity.
 */
function createDieSim(spawnXZ: THREE.Vector3, spawnY: number): DieSim {
  return {
    position: new THREE.Vector3(spawnXZ.x, spawnY, spawnXZ.z),
    velocity: new THREE.Vector3(0, 0, 0),
    quaternion: new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2),
    ),
    angularVelocity: new THREE.Vector3(0, 0, 0),
  }
}

/**
 * Random upward toss with spin (used on reset and initial throw).
 */
function throwDie(die: DieSim): void {
  die.velocity.set(
    (Math.random() - 0.5) * 7,
    8 + Math.random() * 5.5,
    (Math.random() - 0.5) * 7,
  )
  die.angularVelocity.set(
    (Math.random() - 0.5) * 18,
    (Math.random() - 0.5) * 18,
    (Math.random() - 0.5) * 18,
  )
}

/**
 * Advances orientation by integrating body-frame angular velocity (axis-angle quaternion multiply).
 */
function integrateOrientation(q: THREE.Quaternion, omega: THREE.Vector3, dt: number): void {
  const len = omega.length()
  if (len < 1e-8) return
  _axis.copy(omega).multiplyScalar(1 / len)
  _dq.setFromAxisAngle(_axis, len * dt)
  q.multiply(_dq).normalize()
}

/**
 * Soft pairwise sphere overlaps: positional projection + one-dimensional impulse along separation normal.
 *
 * Contract: `r` is the collision sphere radius shared by all dice in this lab configuration.
 */
function resolvePairwiseSpheres(dice: DieSim[], r: number, iterations: number): void {
  const minDist = 2 * r
  const rest = 0.52
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < dice.length; i++) {
      for (let j = i + 1; j < dice.length; j++) {
        const a = dice[i].position
        const b = dice[j].position
        _delta.copy(b).sub(a)
        const dist = _delta.length()
        if (dist < 1e-5 || dist >= minDist) continue
        _n.copy(_delta).multiplyScalar(1 / dist)
        const overlap = minDist - dist
        a.addScaledVector(_n, -overlap * 0.5)
        b.addScaledVector(_n, overlap * 0.5)
        _relV.copy(dice[i].velocity).sub(dice[j].velocity)
        const vn = _relV.dot(_n)
        if (vn < 0) {
          const impulse = (-(1 + rest) * vn) / 2
          dice[i].velocity.addScaledVector(_n, impulse)
          dice[j].velocity.addScaledVector(_n, -impulse)
        }
        dice[i].angularVelocity.multiplyScalar(0.98)
        dice[j].angularVelocity.multiplyScalar(0.98)
      }
    }
  }
}

/**
 * Semi-implicit gravity, linear drag, position step, orientation step, angular drag.
 */
function integrateDieMotion(die: DieSim, dt: number): void {
  die.velocity.y -= labGravityMps2 * dt
  die.velocity.multiplyScalar(Math.max(0, 1 - LINEAR_DRAG * dt * 60))
  die.position.addScaledVector(die.velocity, dt)
  integrateOrientation(die.quaternion, die.angularVelocity, dt)
  die.angularVelocity.multiplyScalar(Math.pow(ANGULAR_DRAG, dt * 60))
}

/**
 * Resolves penetration against one pair of parallel walls (X or Z) using the current `_aabb` hull footprint.
 *
 * Contract: caller recomputes `_aabb` after floor or sibling-axis corrections; mutates horizontal position/velocity.
 */
function resolveHorizontalWallPenetration(die: DieSim, walls: XZCenterBounds, axis: 'x' | 'z'): boolean {
  const wallMin = axis === 'x' ? walls.minX : walls.minZ
  const wallMax = axis === 'x' ? walls.maxX : walls.maxZ
  const aMin = axis === 'x' ? _aabb.minX : _aabb.minZ
  const aMax = axis === 'x' ? _aabb.maxX : _aabb.maxZ
  if (aMin < wallMin) {
    const shift = wallMin - aMin
    if (axis === 'x') {
      die.position.x += shift
      if (die.velocity.x < 0) die.velocity.x *= -WALL_RESTITUTION
    } else {
      die.position.z += shift
      if (die.velocity.z < 0) die.velocity.z *= -WALL_RESTITUTION
    }
    die.angularVelocity.multiplyScalar(0.94)
    return true
  }
  if (aMax > wallMax) {
    const shift = wallMax - aMax
    if (axis === 'x') {
      die.position.x += shift
      if (die.velocity.x > 0) die.velocity.x *= -WALL_RESTITUTION
    } else {
      die.position.z += shift
      if (die.velocity.z > 0) die.velocity.z *= -WALL_RESTITUTION
    }
    die.angularVelocity.multiplyScalar(0.94)
    return true
  }
  return false
}

/**
 * Adds inertial boosts when the pen shifts by `delta` over one physics substep (`invDt` = 1/dt).
 *
 * Intent: approximate dice rattling in an accelerating frame without coupling rigid bodies to a lid mesh.
 */
function applyPenShakeKick(dice: DieSim[], delta: THREE.Vector3, invDt: number): void {
  const dragLen = delta.length()
  if (dragLen <= 1e-9) return
  _n.crossVectors(delta, _worldUp)
  if (_n.lengthSq() < 1e-10) {
    _n.set(1, 0, 0).cross(delta)
  }
  if (_n.lengthSq() > 1e-12) {
    _n.multiplyScalar(1 / Math.sqrt(_n.lengthSq()))
    _tauWorld.crossVectors(delta, _n)
    if (_tauWorld.lengthSq() > 1e-12) _tauWorld.multiplyScalar(1 / Math.sqrt(_tauWorld.lengthSq()))
    for (const die of dice) {
      die.velocity.addScaledVector(delta, SHAKE_LINEAR_GAIN * invDt)
      die.angularVelocity.addScaledVector(_n, dragLen * invDt * SHAKE_ANGULAR_GAIN)
      die.angularVelocity.addScaledVector(_tauWorld, dragLen * invDt * SHAKE_ANGULAR_GAIN * 0.68)
    }
  } else {
    for (const die of dice) {
      die.velocity.addScaledVector(delta, SHAKE_LINEAR_GAIN * invDt)
    }
  }
}

/**
 * Floor at y=0 plus four vertical slabs; iterates vertex AABB projection against hull (`supportLocal`).
 *
 * Contract: uses shared `_aabb`; `dt` feeds floor friction blend.
 */
function resolveFloorAndWalls(
  die: DieSim,
  walls: XZCenterBounds,
  dt: number,
  supportLocal: readonly THREE.Vector3[],
): void {
  for (let iter = 0; iter < 8; iter++) {
    worldAabbOfLocalPoints(die.position, die.quaternion, supportLocal, _aabb)
    let adjusted = false

    if (_aabb.minY < 0) {
      die.position.y -= _aabb.minY
      if (die.velocity.y < 0) {
        const impact = -die.velocity.y
        const t = THREE.MathUtils.clamp(impact / RESTITUTION_BLEND_AT, 0, 1)
        const e = THREE.MathUtils.lerp(RESTITUTION_SOFT, RESTITUTION_FIRM, t)
        die.velocity.y *= -e
        const spinDamp = THREE.MathUtils.lerp(0.9, 0.74, t)
        die.angularVelocity.multiplyScalar(spinDamp)
      }
      _tang.set(die.velocity.x, 0, die.velocity.z)
      _tang.multiplyScalar(1 - FRICTION * dt * 60 * 0.1)
      die.velocity.x = _tang.x
      die.velocity.z = _tang.z
      adjusted = true
    }

    worldAabbOfLocalPoints(die.position, die.quaternion, supportLocal, _aabb)
    if (resolveHorizontalWallPenetration(die, walls, 'x')) adjusted = true

    worldAabbOfLocalPoints(die.position, die.quaternion, supportLocal, _aabb)
    if (resolveHorizontalWallPenetration(die, walls, 'z')) adjusted = true

    if (!adjusted) break
  }
}

/**
 * Biases the die toward resting on a **face** by adding body-frame angular acceleration when the hull is near the table
 * and motion is modest: the face whose outward normal is most “downward” is torqued toward world −Y.
 *
 * Contract: no direct quaternion slerp; only mutates `angularVelocity`. Fades when `minY` lifts off the slab so air
 * rolls stay unbiased. Near-flat misalignment, torque is scaled by `1 + TOPPLE_LAST_A/(misalign+TOPPLE_LAST_K)` so the
 * final edge→face motion does not crawl at `sin(misalign) → 0`. Linear/angular speed use a **smooth** fade into topple
 * (see `TOPPLE_*_FADE_*`) so edge rock never sits in a dead band with zero assist until a hard threshold crosses.
 */
function applyTableToppleTorque(
  die: DieSim,
  faceTable: readonly FaceNormalEntry[],
  dt: number,
  supportLocal: readonly THREE.Vector3[],
): void {
  worldAabbOfLocalPoints(die.position, die.quaternion, supportLocal, _aabb)
  if (_aabb.minY > 0.2) return

  const spin = die.angularVelocity.length()
  const lin = die.velocity.length()
  const spinFade = 1 - THREE.MathUtils.smoothstep(spin, TOPPLE_SPIN_FADE_MIN, TOPPLE_SPIN_FADE_MAX)
  const linFade = 1 - THREE.MathUtils.smoothstep(lin, TOPPLE_LINEAR_FADE_MIN, TOPPLE_LINEAR_FADE_MAX)
  const motionFade = spinFade * linFade
  if (motionFade < 0.012) return

  let worst = Infinity
  _nBottomLocal.set(0, -1, 0)
  for (const f of faceTable) {
    _n.set(f.nx, f.ny, f.nz).applyQuaternion(die.quaternion)
    const d = _n.dot(_worldUp)
    if (d < worst) {
      worst = d
      _nBottomLocal.set(f.nx, f.ny, f.nz)
    }
  }

  _n.copy(_nBottomLocal).applyQuaternion(die.quaternion)
  _axis.crossVectors(_n, _worldDown)
  if (_axis.lengthSq() < 1e-14) return
  _axis.normalize()

  const align = THREE.MathUtils.clamp(_n.dot(_worldDown), -1, 1)
  const misalign = Math.acos(align)
  if (misalign < 0.045) return

  const proximity = Math.max(0, 0.26 - _aabb.minY)
  const onTable = THREE.MathUtils.smoothstep(proximity, 0.035, 0.22)

  const sinM = Math.sin(misalign)
  const lastPush = 1 + TOPPLE_LAST_A / (misalign + TOPPLE_LAST_K)
  const mag = TOPPLE_GAIN * onTable * sinM * lastPush * motionFade
  _tauWorld.copy(_axis).multiplyScalar(mag)
  _dq.copy(die.quaternion).invert()
  _delta.copy(_tauWorld).applyQuaternion(_dq)
  die.angularVelocity.addScaledVector(_delta, dt)

  const wlen = die.angularVelocity.length()
  if (wlen > OMEGA_CLAMP) {
    die.angularVelocity.multiplyScalar(OMEGA_CLAMP / wlen)
  }
}

/**
 * Returns the face value whose outward normal best aligns with world +Y (die “reading” upward).
 */
function readTopFaceValue(q: THREE.Quaternion, faceTable: readonly FaceNormalEntry[]): number {
  let best = -Infinity
  let value = 1
  for (const f of faceTable) {
    _n.set(f.nx, f.ny, f.nz).applyQuaternion(q)
    const d = _n.dot(_worldUp)
    if (d > best) {
      best = d
      value = f.value
    }
  }
  return value
}

/**
 * True when the hull sits on the slab and linear/angular speeds are below settle thresholds.
 */
function isResting(die: DieSim, supportLocal: readonly THREE.Vector3[]): boolean {
  worldAabbOfLocalPoints(die.position, die.quaternion, supportLocal, _aabb)
  const onFloor = _aabb.minY >= -0.04 && _aabb.minY <= 0.07
  return onFloor && die.velocity.length() < SETTLE_V_EPS && die.angularVelocity.length() < SETTLE_W_EPS
}

/**
 * Disposes canvas textures on lab materials; does not dispose shared `BufferGeometry`.
 *
 * Contract: lab meshes use `MeshStandardMaterial` with optional `.map`; casts accordingly for disposal.
 */
function disposeMeshMaterialsOnly(mesh: THREE.Mesh): void {
  const mat = mesh.material
  const list = Array.isArray(mat) ? mat : [mat]
  for (const m of list) {
    const map = (m as THREE.MeshStandardMaterial).map
    if (map) map.dispose()
    m.dispose()
  }
}

/**
 * Builds a mesh for the current lab spec (shared geometry on `spec.geometry`): d6 uses pip textures; other solids use
 * one canvas texture per `faceTable` face (geometry groups from `assignFaceGroupsFromFaceTable`).
 */
function buildDieMesh(spec: LabDieSpec, dieIndex: number): THREE.Mesh {
  if (spec.usesD6Materials) {
    const mesh = new THREE.Mesh(spec.geometry, createD6FaceMaterials(dieIndex))
    mesh.castShadow = true
    return mesh
  }
  const mesh = new THREE.Mesh(spec.geometry, createPolyFaceMaterials(spec.faceTable, dieIndex, spec.sides))
  mesh.castShadow = true
  return mesh
}

/**
 * Reads `#facets-per-die`; invalid values fall back to d6.
 */
function parseSidesFromUi(): 4 | 6 | 8 | 12 | 20 {
  const el = document.getElementById('facets-per-die') as HTMLSelectElement | null
  const v = parseInt(el?.value ?? '6', 10)
  if (v === 4 || v === 6 || v === 8 || v === 12 || v === 20) return v
  return 6
}

/**
 * Reads `#dice-count` clamped to `MIN_DICE`…`MAX_DICE`.
 */
function parseDiceCountFromUi(): number {
  const el = document.getElementById('dice-count') as HTMLInputElement | null
  const n = parseInt(el?.value ?? '1', 10)
  return THREE.MathUtils.clamp(Number.isFinite(n) ? n : 1, MIN_DICE, MAX_DICE)
}

/**
 * Reads gravity from `#lab-gravity` (m/s²) for the dice integrator.
 * Contract: returns a finite value clamped to `MIN_LAB_GRAVITY`…`MAX_LAB_GRAVITY`; missing input falls back to 30.
 */
function parseLabGravityFromUi(): number {
  const el = document.getElementById('lab-gravity') as HTMLInputElement | null
  const v = parseFloat(el?.value ?? '30')
  return THREE.MathUtils.clamp(Number.isFinite(v) ? v : 30, MIN_LAB_GRAVITY, MAX_LAB_GRAVITY)
}

/**
 * Boots the lab: renderer, scene, arena sync, HUD, input hooks, and the animation/physics loop.
 *
 * Contract: assumes `#lab-controls` and `#lab-gravity` exist when served from `index.html`; no cleanup on unload (reload page).
 */
function main(): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  document.body.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x12121a)

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 260)
  camera.position.set(9, 6.5, 12)
  camera.lookAt(0, 0.92, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 0.36))
  const key = new THREE.DirectionalLight(0xffffff, 1.05)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  scene.add(key)
  scene.add(key.target)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x25252e, roughness: 0.92, metalness: 0.04 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  const arenaGroup = new THREE.Group()
  scene.add(arenaGroup)

  let walls: XZCenterBounds = { minX: -3, maxX: 3, minZ: -2.5, maxZ: 2.5 }
  /** Unshifted pen from `computeFixedPlayPenBoundsXZ` (origin-centered). */
  let baseWalls: XZCenterBounds = { ...walls }
  /** Scripted box-shake offset (XYZ); walls shift in XZ, arena wire moves in 3D; dice get matching translation + inertial kicks. */
  const shakerOffset = new THREE.Vector3()
  const MAX_SHAKER_OFFSET = 4.4
  /** Smaller vertical cap so brief lift/drop reads as jostle without chronic floor tunneling. */
  const MAX_SHAKER_OFFSET_Y = 0.42

  function offsetWalls(b: XZCenterBounds, o: THREE.Vector3): XZCenterBounds {
    return {
      minX: b.minX + o.x,
      maxX: b.maxX + o.x,
      minZ: b.minZ + o.z,
      maxZ: b.maxZ + o.z,
    }
  }

  function clampShakerXYZ(o: THREE.Vector3): void {
    o.x = THREE.MathUtils.clamp(o.x, -MAX_SHAKER_OFFSET, MAX_SHAKER_OFFSET)
    o.y = THREE.MathUtils.clamp(o.y, -MAX_SHAKER_OFFSET_Y, MAX_SHAKER_OFFSET_Y)
    o.z = THREE.MathUtils.clamp(o.z, -MAX_SHAKER_OFFSET, MAX_SHAKER_OFFSET)
  }

  /**
   * Places the camera from **unshifted** pen bounds (`baseWalls` / argument) so framing stays fixed while the arena
   * group jostles on Apply shake—otherwise the wireframe would appear almost still relative to the view.
   */
  function frameCameraOnPlayArea(
    w: XZCenterBounds,
    halfExtent: number,
    sphereRadius: number,
    keyLight: THREE.DirectionalLight,
  ): void {
    const cx = (w.minX + w.maxX) * 0.5
    const cz = (w.minZ + w.maxZ) * 0.5
    const spanXZ = Math.max(w.maxX - w.minX, w.maxZ - w.minZ, halfExtent * 2 + 0.6)
    const focusY = 0.92
    _camFocus.set(cx, focusY, cz)
    const dist = THREE.MathUtils.clamp(7.2 + spanXZ * 1.08 + halfExtent * 2.4 + sphereRadius * 1.15, 8.5, 28)
    camera.position.copy(_camFocus).addScaledVector(_camDir, dist)
    camera.lookAt(_camFocus)
    keyLight.position.set(_camFocus.x + 6.5, _camFocus.y + 10.5, _camFocus.z + 7.5)
    keyLight.target.position.copy(_camFocus)
    keyLight.target.updateMatrixWorld()
  }

  let labSpec: LabDieSpec = buildLabDieSpec(6)
  let supportHalf = supportMaxHalfExtent(labSpec.supportLocal)
  let sphereR = labSpec.sphereRadius * 0.99

  const dice: DieSim[] = []
  const meshes: THREE.Mesh[] = []
  let lastSettled: number[] = []

  const hud = document.createElement('div')
  hud.style.cssText =
    'position:fixed;right:12px;bottom:12px;padding:10px 14px;border-radius:8px;background:rgba(20,20,28,.92);border:1px solid rgba(255,255,255,.1);font:12px/1.45 system-ui,sans-serif;pointer-events:none;min-width:160px;text-align:right;white-space:pre-wrap;'
  hud.textContent = '… rolling'
  document.body.appendChild(hud)

  let stableRestMs = 0

  const clock = new THREE.Clock()
  /** Fixed physics substep (seconds); smaller = finer motion, costlier. */
  const PHYS_STEP = 1 / 240
  /** Safety cap on substeps per frame (avoids long hangs after tab backgrounding). */
  const MAX_PHYS_STEPS_PER_FRAME = 48
  let accum = 0

  function clearArenaGroup(): void {
    while (arenaGroup.children.length > 0) {
      const c = arenaGroup.children[0]
      arenaGroup.remove(c)
      if (c instanceof THREE.LineSegments) {
        c.geometry.dispose()
        ;(c.material as THREE.Material).dispose()
      }
    }
  }

  /**
   * Recomputes origin-centered `baseWalls`, shifted `walls`, camera, and optionally rebuilds pen wireframe.
   * Contract: `rebuildGeometry` false only after a full sync so `baseWalls` and mesh dimensions stay valid (e.g. mid-shake resize).
   */
  function syncArenaAndCamera(rebuildGeometry = true): void {
    const w = renderer.domElement.clientWidth
    const h = renderer.domElement.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    baseWalls = computeFixedPlayPenBoundsXZ(supportHalf, BOUNDS_MARGIN, camera.aspect)
    walls = offsetWalls(baseWalls, shakerOffset)
    frameCameraOnPlayArea(baseWalls, supportHalf, labSpec.sphereRadius, key)
    camera.updateMatrixWorld(true)

    if (rebuildGeometry) {
      clearArenaGroup()
      const wx = Math.max(0.08, baseWalls.maxX - baseWalls.minX)
      const wz = Math.max(0.08, baseWalls.maxZ - baseWalls.minZ)
      const side = Math.max(wx, wz)
      const bcx = (baseWalls.minX + baseWalls.maxX) * 0.5
      const bcz = (baseWalls.minZ + baseWalls.maxZ) * 0.5

      const boxGeo = new THREE.BoxGeometry(side, side, side)
      const edgesGeo = new THREE.EdgesGeometry(boxGeo, 18)
      boxGeo.dispose()
      const wire = new THREE.LineSegments(
        edgesGeo,
        new THREE.LineBasicMaterial({ color: 0x6c6c92, transparent: true, opacity: 0.42 }),
      )
      wire.position.set(bcx, side * 0.5 + 0.02, bcz)
      arenaGroup.add(wire)
    }

    arenaGroup.position.set(shakerOffset.x, shakerOffset.y, shakerOffset.z)
  }

  /**
   * Updates shifted collision bounds and camera after `shakerOffset` changes without rebuilding pen geometry.
   */
  function updateShakerPose(): void {
    walls = offsetWalls(baseWalls, shakerOffset)
    frameCameraOnPlayArea(baseWalls, supportHalf, labSpec.sphereRadius, key)
    arenaGroup.position.set(shakerOffset.x, shakerOffset.y, shakerOffset.z)
  }

  let shakeCfg: ApplyBoxShakeConfig | null = null
  let shakeT = 0
  let shakeActive = false

  /**
   * Starts the post-Apply box rattling profile (randomized multi-sine burst in `boxShake.ts`).
   */
  function startApplyBoxShake(): void {
    shakeCfg = createRandomApplyBoxShake()
    shakeT = 0
    shakeActive = true
  }

  /**
   * Advances scripted shake one fixed substep: updates `shakerOffset`, moves dice with the pen, adds inertial linear/angular
   * impulse from Δoffset/Δt. On completion, zeros offset and recenters dice in the stationary pen frame.
   */
  function advanceApplyShakeSubstep(): void {
    if (!shakeActive || !shakeCfg) return
    const cfg = shakeCfg
    const t0 = shakeT
    const t1 = Math.min(shakeT + PHYS_STEP, cfg.duration)
    sampleApplyBoxShakeXYZ(t0, cfg, _shakePos0)
    sampleApplyBoxShakeXYZ(t1, cfg, _shakePos1)
    shakerOffset.set(_shakePos1.x, _shakePos1.y, _shakePos1.z)
    clampShakerXYZ(shakerOffset)
    _delta.set(shakerOffset.x - _shakePos0.x, shakerOffset.y - _shakePos0.y, shakerOffset.z - _shakePos0.z)

    for (const die of dice) {
      die.position.add(_delta)
    }
    const invDt = 1 / PHYS_STEP
    applyPenShakeKick(dice, _delta, invDt)
    updateShakerPose()
    shakeT = t1
    if (shakeT >= cfg.duration - 1e-8) {
      shakeActive = false
      shakeCfg = null
      shakeT = 0
      for (const d of dice) {
        d.position.sub(shakerOffset)
      }
      shakerOffset.set(0, 0, 0)
      updateShakerPose()
    }
  }

  function tearDownDice(): void {
    for (const m of meshes) {
      scene.remove(m)
      disposeMeshMaterialsOnly(m)
    }
    meshes.length = 0
    dice.length = 0
  }

  /**
   * Syncs `labGravityMps2` from `#lab-gravity` so gravity tweaks apply on input without rebuilding dice.
   */
  function syncLabGravityFromUi(): void {
    labGravityMps2 = parseLabGravityFromUi()
  }

  /**
   * Rebuilds die meshes/sim state from UI (dice count + facets per die + gravity read). Disposes previous lab geometry after clearing meshes.
   */
  function applyLabFromUi(): void {
    shakeActive = false
    shakeCfg = null
    shakeT = 0
    shakerOffset.set(0, 0, 0)
    syncLabGravityFromUi()
    const count = parseDiceCountFromUi()
    const sides = parseSidesFromUi()
    tearDownDice()
    disposeLabDieSpec(labSpec)
    labSpec = buildLabDieSpec(sides)
    supportHalf = supportMaxHalfExtent(labSpec.supportLocal)
    sphereR = labSpec.sphereRadius * 0.99

    const padX = 0.15
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * padX
      dice.push(createDieSim(new THREE.Vector3(x, 0, 0), 3.35 + i * 0.06))
      const mesh = buildDieMesh(labSpec, i)
      scene.add(mesh)
      meshes.push(mesh)
    }
    lastSettled = Array(count).fill(-1)
    syncArenaAndCamera()
    stableRestMs = 0
    hud.textContent = '… rolling'
  }

  function resetThrow(): void {
    const n = dice.length
    if (n === 0) return
    const padX = (walls.maxX - walls.minX) * 0.08
    const padZ = (walls.maxZ - walls.minZ) * 0.08
    for (let i = 0; i < n; i++) {
      const u = (i + 1) / (n + 1)
      const x = THREE.MathUtils.clamp(
        walls.minX + padX + u * (walls.maxX - walls.minX - 2 * padX),
        walls.minX,
        walls.maxX,
      )
      const z = THREE.MathUtils.clamp(
        walls.minZ + padZ + (((i * 13) % 100) / 100) * (walls.maxZ - walls.minZ - 2 * padZ),
        walls.minZ,
        walls.maxZ,
      )
      dice[i].position.set(x, 3.1 + Math.random() * 0.45 + i * 0.06, z)
      dice[i].velocity.set(0, 0, 0)
      dice[i].angularVelocity.set(0, 0, 0)
      dice[i].quaternion.setFromEuler(
        new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2),
      )
      throwDie(dice[i])
      lastSettled[i] = -1
    }
    stableRestMs = 0
    hud.textContent = '… rolling'
  }

  function onResize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight)
    syncArenaAndCamera()
  }
  window.addEventListener('resize', onResize)

  function onThrowKey(ev: KeyboardEvent): void {
    if (ev.code === 'Space') {
      const t = ev.target as HTMLElement | null
      if (t?.closest?.('#lab-controls')) return
      ev.preventDefault()
      resetThrow()
    }
  }
  window.addEventListener('keydown', onThrowKey)

  const canvas = renderer.domElement
  canvas.style.touchAction = 'none'

  let pendingCanvasReroll = false
  let canvasDownX = 0
  let canvasDownY = 0
  let canvasMoveAccum = 0

  /**
   * Arms a short-tap canvas re-roll (ignored when interacting with `#lab-controls`).
   */
  function onCanvasPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return
    if ((ev.target as HTMLElement).closest('#lab-controls')) return
    pendingCanvasReroll = true
    canvasDownX = ev.clientX
    canvasDownY = ev.clientY
    canvasMoveAccum = 0
  }

  function onCanvasPointerMove(ev: PointerEvent): void {
    if (pendingCanvasReroll) canvasMoveAccum += Math.abs(ev.movementX) + Math.abs(ev.movementY)
  }

  /**
   * A light tap on empty canvas (little movement) re-rolls without Apply.
   */
  function onCanvasPointerUp(ev: PointerEvent): void {
    if (pendingCanvasReroll) {
      const dx = ev.clientX - canvasDownX
      const dy = ev.clientY - canvasDownY
      if (canvasMoveAccum < 14 && dx * dx + dy * dy < 196) {
        resetThrow()
      }
    }
    pendingCanvasReroll = false
    canvasMoveAccum = 0
  }

  canvas.addEventListener('pointerdown', onCanvasPointerDown)
  canvas.addEventListener('pointermove', onCanvasPointerMove)
  canvas.addEventListener('pointerup', onCanvasPointerUp)
  canvas.addEventListener('pointercancel', onCanvasPointerUp)

  const gravInput = document.getElementById('lab-gravity') as HTMLInputElement | null
  gravInput?.addEventListener('input', syncLabGravityFromUi)
  gravInput?.addEventListener('change', syncLabGravityFromUi)
  syncLabGravityFromUi()

  const applyBtn = document.getElementById('lab-apply')
  applyBtn?.addEventListener('click', (e) => {
    e.stopPropagation()
    applyLabFromUi()
    resetThrow()
    startApplyBoxShake()
  })

  applyLabFromUi()
  resetThrow()

  function tick(): void {
    requestAnimationFrame(tick)
    const dt = Math.min(clock.getDelta(), 0.05)
    accum += dt
    const support = labSpec.supportLocal
    let steps = 0
    while (accum >= PHYS_STEP && steps < MAX_PHYS_STEPS_PER_FRAME) {
      advanceApplyShakeSubstep()
      for (const d of dice) {
        integrateDieMotion(d, PHYS_STEP)
      }
      resolvePairwiseSpheres(dice, sphereR, 3)
      for (const d of dice) {
        resolveFloorAndWalls(d, walls, PHYS_STEP, support)
        applyTableToppleTorque(d, labSpec.faceTable, PHYS_STEP, support)
      }
      accum -= PHYS_STEP
      steps++
    }
    if (steps >= MAX_PHYS_STEPS_PER_FRAME) {
      accum = 0
    }

    for (let i = 0; i < meshes.length; i++) {
      meshes[i].position.copy(dice[i].position)
      meshes[i].quaternion.copy(dice[i].quaternion)
    }

    const allRest = dice.length > 0 && dice.every((d) => isResting(d, support))
    if (allRest) {
      stableRestMs += dt * 1000
      if (stableRestMs >= SETTLE_STABLE_MS) {
        const parts: string[] = []
        const ft = labSpec.faceTable
        for (let i = 0; i < dice.length; i++) {
          const v = readTopFaceValue(dice[i].quaternion, ft)
          if (lastSettled[i] !== v) lastSettled[i] = v
          parts.push(`D${i + 1}:${v}`)
        }
        hud.textContent = parts.join('  ')
      }
    } else {
      stableRestMs = 0
      hud.textContent = '… rolling'
    }

    renderer.render(scene, camera)
  }
  tick()
}

main()
