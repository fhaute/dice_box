/**
 * Play-pen bounds for the dice lab: fixed world-space XZ arena (predictable bounce + framing).
 *
 * Intent: viewport-ray walls tracked the camera and could collapse or shove dice off-screen; the lab instead uses a
 * centered box whose horizontal extent scales slightly with window aspect so wide monitors get a proportionally
 * wider pen. Values are **die center** limits (inset by `halfExtent + margin` so rotated hulls stay inside).
 */

import * as THREE from 'three'

export type XZCenterBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** World Y used only by legacy viewport helpers (kept for API stability if reused). */
export const REFERENCE_PLANE_Y = 1.35

const TMP_CLIP = new THREE.Vector3()
const TMP_DIR = new THREE.Vector3()

/**
 * Returns XZ bounds (inclusive) for die centers inside a **fixed** arena centered on the origin.
 *
 * Contract: The lab uses a **square** arena in XZ so the wireframe can be a true cube (X = Z = Y). `aspect` is kept
 * in the signature for API stability but no longer stretches the arena. Larger dice shrink the usable strip only via
 * `pad`. If padding inverts an axis, falls back to a thin slab.
 */
export function computeFixedPlayPenBoundsXZ(
  halfExtent: number,
  margin: number,
  aspect: number,
): XZCenterBounds {
  void aspect
  const halfSide = 5.8
  const pad = halfExtent + margin
  let minX = -halfSide + pad
  let maxX = halfSide - pad
  let minZ = -halfSide + pad
  let maxZ = halfSide - pad
  if (minX >= maxX) {
    const c = (minX + maxX) * 0.5
    minX = c - 0.02
    maxX = c + 0.02
  }
  if (minZ >= maxZ) {
    const c = (minZ + maxZ) * 0.5
    minZ = c - 0.02
    maxZ = c + 0.02
  }
  return { minX, maxX, minZ, maxZ }
}

/**
 * Legacy: maps viewport corners to an XZ slice at `planeY` (can interact badly with camera framing).
 *
 * Contract: kept for experiments; prefer `computeFixedPlayPenBoundsXZ` for the lab.
 */
export function computeDieCenterBoundsXZ(
  camera: THREE.PerspectiveCamera,
  _domWidth: number,
  _domHeight: number,
  planeY: number,
  half: number,
  margin: number,
): XZCenterBounds {
  camera.updateMatrixWorld(true)
  const xs: number[] = []
  const zs: number[] = []
  const ndcCorners: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]

  for (const [ndx, ndy] of ndcCorners) {
    TMP_CLIP.set(ndx, ndy, 0.5).unproject(camera)
    TMP_DIR.copy(TMP_CLIP).sub(camera.position).normalize()
    if (Math.abs(TMP_DIR.y) < 1e-5) continue
    const t = (planeY - camera.position.y) / TMP_DIR.y
    if (!Number.isFinite(t) || t <= 0) continue
    const x = camera.position.x + TMP_DIR.x * t
    const z = camera.position.z + TMP_DIR.z * t
    xs.push(x)
    zs.push(z)
  }

  let minX: number
  let maxX: number
  let minZ: number
  let maxZ: number
  if (xs.length >= 2) {
    minX = Math.min(...xs)
    maxX = Math.max(...xs)
    minZ = Math.min(...zs)
    maxZ = Math.max(...zs)
  } else {
    minX = -4
    maxX = 4
    minZ = -3
    maxZ = 3
  }

  const pad = half + margin
  minX += pad
  maxX -= pad
  minZ += pad
  maxZ -= pad
  if (minX >= maxX) {
    const c = (minX + maxX) / 2
    minX = c - 0.01
    maxX = c + 0.01
  }
  if (minZ >= maxZ) {
    const c = (minZ + maxZ) / 2
    minZ = c - 0.01
    maxZ = c + 0.01
  }
  return { minX, maxX, minZ, maxZ }
}
