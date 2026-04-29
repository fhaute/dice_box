/**
 * Oriented-unit-cube support queries for a cheap rigid-body substitute (no physics engine).
 *
 * Intent: floor and wall contacts must use the cube’s **world** corners, not `center.y ± half`,
 * or a tilted die sinks through y=0 and “top face” reads settle wrong.
 * Contract: `half` is the box half-extent in local space; `quaternion` rotates local → world (same as `THREE.Mesh`).
 */

import * as THREE from 'three'

/** Sign triples for the eight vertices of a centered axis-aligned box in local space. */
const CORNER_SIGNS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
]

const _corner = new THREE.Vector3()

export type WorldBoxAabb = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

/**
 * World-space axis-aligned bounds of arbitrary local points (e.g. convex hull vertices) after rotation + translation.
 *
 * Intent: cheap floor/wall tests using the die’s vertex footprint instead of a bounding sphere alone.
 * Contract: writes all six min/max fields on `out`; reuses an internal corner scratch vector (not thread-safe).
 */
export function worldAabbOfLocalPoints(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  localPoints: readonly THREE.Vector3[],
  out: WorldBoxAabb,
): void {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const lp of localPoints) {
    _corner.copy(lp).applyQuaternion(quaternion)
    const x = position.x + _corner.x
    const y = position.y + _corner.y
    const z = position.z + _corner.z
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  out.minX = minX
  out.maxX = maxX
  out.minY = minY
  out.maxY = maxY
  out.minZ = minZ
  out.maxZ = maxZ
}

/**
 * World AABB of an axis-aligned cube of half-extent `half` after rotation.
 */
export function worldAabbOfUnitCube(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  half: number,
  out: WorldBoxAabb,
): void {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [sx, sy, sz] of CORNER_SIGNS) {
    _corner.set(sx * half, sy * half, sz * half).applyQuaternion(quaternion)
    const x = position.x + _corner.x
    const y = position.y + _corner.y
    const z = position.z + _corner.z
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  out.minX = minX
  out.maxX = maxX
  out.minY = minY
  out.maxY = maxY
  out.minZ = minZ
  out.maxZ = maxZ
}
