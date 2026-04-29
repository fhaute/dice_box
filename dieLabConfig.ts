/**
 * Lab die shape: geometry, convex support vertices, outward face normals for “top” readout, and collision radius.
 *
 * Intent: one place to switch d4/d6/d8/d12/d20 without scattering magic numbers in `main.ts`.
 * Contract: `supportLocal` are unique vertices in mesh local space; floor/walls use their world AABB. For d6, `faceTable`
 * matches `BoxGeometry` material order; other solids use merged triangle normals with a stable sort → values 1..N, then
 * `assignFaceGroupsFromFaceTable` + canvas materials (`createPolyFaceMaterials`) for on-mesh digits (lab convention, not casino-standard engraving).
 */

import * as THREE from 'three'

/** Supported polyhedral counts in the lab (matches common RPG dice). */
export type LabDieSides = 4 | 6 | 8 | 12 | 20

export type FaceNormalEntry = { nx: number; ny: number; nz: number; value: number }

export type LabDieSpec = {
  sides: LabDieSides
  geometry: THREE.BufferGeometry
  /** Unique vertices (local space) for AABB floor/walls. */
  supportLocal: THREE.Vector3[]
  /** Bounding-sphere radius (center = origin in local space). */
  sphereRadius: number
  /** Outward unit normals in local space → displayed value when that face is “up” (+world Y). */
  faceTable: FaceNormalEntry[]
  /** True when `createD6FaceMaterials` should be used (per-face textures). */
  usesD6Materials: boolean
}

/** Canonical d6: must match `facets.BOX_GEOMETRY_FACE_VALUES` / `BoxGeometry` group order. */
const D6_FACE_TABLE: FaceNormalEntry[] = [
  { nx: 1, ny: 0, nz: 0, value: 2 },
  { nx: -1, ny: 0, nz: 0, value: 5 },
  { nx: 0, ny: 1, nz: 0, value: 1 },
  { nx: 0, ny: -1, nz: 0, value: 6 },
  { nx: 0, ny: 0, nz: 1, value: 3 },
  { nx: 0, ny: 0, nz: -1, value: 4 },
]

const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _e1 = new THREE.Vector3()
const _e2 = new THREE.Vector3()
const _tn = new THREE.Vector3()
const _cent = new THREE.Vector3()

/**
 * Returns max(|x|,|y|,|z|) over support vertices (half-extent of axis-aligned local bounding cube).
 */
export function supportMaxHalfExtent(supportLocal: readonly THREE.Vector3[]): number {
  let m = 0
  for (const p of supportLocal) {
    m = Math.max(m, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))
  }
  return Math.max(m, 1e-3)
}

const _afA = new THREE.Vector3()
const _afB = new THREE.Vector3()
const _afC = new THREE.Vector3()
const _afE1 = new THREE.Vector3()
const _afE2 = new THREE.Vector3()
const _afTn = new THREE.Vector3()
const _afCent = new THREE.Vector3()
const _afCenter = new THREE.Vector3()
const _afUax = new THREE.Vector3()
const _afVax = new THREE.Vector3()
const _afUp = new THREE.Vector3()
const _afD = new THREE.Vector3()

/**
 * Rebuilds non-d6 `BufferGeometry` as non-indexed triangles grouped by `faceTable` order so each face can use its own
 * canvas material (same index as `createPolyFaceMaterials`). Planar UVs per face from local tangent axes.
 *
 * Intent: Three.js platonic helpers ship a single draw group; we need stable `geometry.groups` aligned with `faceTable`.
 * Contract: mutates `geometry` in place (drops index, replaces position/normal/uv); call only after `faceTable` is built
 * from the same mesh topology. Recompute `supportLocal` after this call.
 */
function assignFaceGroupsFromFaceTable(geometry: THREE.BufferGeometry, faceTable: FaceNormalEntry[]): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!posAttr) return

  const index = geometry.getIndex()
  const triCount = index ? index.count / 3 : posAttr.count / 3
  const faceNormals = faceTable.map((f) => new THREE.Vector3(f.nx, f.ny, f.nz).normalize())

  type TriBucket = { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; fi: number }
  const tris: TriBucket[] = []

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3
    const ia = index ? index.getX(i0) : i0
    const ib = index ? index.getX(i0 + 1) : i0 + 1
    const ic = index ? index.getX(i0 + 2) : i0 + 2
    _afA.fromBufferAttribute(posAttr, ia)
    _afB.fromBufferAttribute(posAttr, ib)
    _afC.fromBufferAttribute(posAttr, ic)
    _afE1.subVectors(_afB, _afA)
    _afE2.subVectors(_afC, _afA)
    _afTn.crossVectors(_afE1, _afE2)
    if (_afTn.lengthSq() < 1e-12) continue
    _afTn.normalize()
    _afCent.copy(_afA).add(_afB).add(_afC).multiplyScalar(1 / 3)
    if (_afTn.dot(_afCent) < 0) _afTn.negate()

    let bestFi = 0
    let bestDot = -2
    for (let fi = 0; fi < faceNormals.length; fi++) {
      const d = _afTn.dot(faceNormals[fi])
      if (d > bestDot) {
        bestDot = d
        bestFi = fi
      }
    }
    tris.push({ a: _afA.clone(), b: _afB.clone(), c: _afC.clone(), fi: bestFi })
  }

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  geometry.clearGroups()

  for (let fi = 0; fi < faceTable.length; fi++) {
    const fn = faceNormals[fi]
    _afCenter.set(0, 0, 0)
    let nTri = 0
    for (const tri of tris) {
      if (tri.fi !== fi) continue
      _afCenter.add(tri.a).add(tri.b).add(tri.c)
      nTri++
    }
    if (nTri === 0) continue
    _afCenter.multiplyScalar(1 / (nTri * 3))

    _afUp.set(0, 1, 0)
    if (Math.abs(fn.dot(_afUp)) > 0.92) _afUp.set(1, 0, 0)
    _afUax.crossVectors(_afUp, fn).normalize()
    _afVax.crossVectors(fn, _afUax).normalize()

    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    const projUv = (p: THREE.Vector3): { u: number; v: number } => {
      _afD.subVectors(p, _afCenter)
      return { u: _afD.dot(_afUax), v: _afD.dot(_afVax) }
    }
    for (const tri of tris) {
      if (tri.fi !== fi) continue
      for (const p of [tri.a, tri.b, tri.c]) {
        const { u, v } = projUv(p)
        minU = Math.min(minU, u)
        maxU = Math.max(maxU, u)
        minV = Math.min(minV, v)
        maxV = Math.max(maxV, v)
      }
    }
    const ru = maxU - minU + 1e-7
    const rv = maxV - minV + 1e-7

    const groupStartVerts = positions.length / 3
    for (const tri of tris) {
      if (tri.fi !== fi) continue
      for (const p of [tri.a, tri.b, tri.c]) {
        positions.push(p.x, p.y, p.z)
        normals.push(fn.x, fn.y, fn.z)
        const { u, v } = projUv(p)
        uvs.push((u - minU) / ru, (v - minV) / rv)
      }
    }
    const groupVertCount = positions.length / 3 - groupStartVerts
    if (groupVertCount > 0) {
      geometry.addGroup(groupStartVerts, groupVertCount, fi)
    }
  }

  geometry.setIndex(null)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeBoundingSphere()
}

/**
 * Builds geometry, physics support points, merged face normals, and sphere radius for one `sides` value.
 */
export function buildLabDieSpec(sides: LabDieSides): LabDieSpec {
  let geometry: THREE.BufferGeometry
  switch (sides) {
    case 4:
      geometry = new THREE.TetrahedronGeometry(1.18, 0)
      break
    case 6:
      geometry = new THREE.BoxGeometry(1, 1, 1)
      break
    case 8:
      geometry = new THREE.OctahedronGeometry(1.12, 0)
      break
    case 12:
      geometry = new THREE.DodecahedronGeometry(1.06, 0)
      break
    case 20:
      geometry = new THREE.IcosahedronGeometry(1.05, 0)
      break
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1)
  }

  const faceTable =
    sides === 6 ? [...D6_FACE_TABLE] : buildFaceTableFromTriangles(geometry, sides)

  if (sides !== 6) {
    assignFaceGroupsFromFaceTable(geometry, faceTable)
  }

  const supportLocal = extractUniqueVertices(geometry)
  const sphereRadius = Math.max(...supportLocal.map((p) => p.length()), 1e-3)

  return {
    sides,
    geometry,
    supportLocal,
    sphereRadius,
    faceTable,
    usesD6Materials: sides === 6,
  }
}

/**
 * Disposes GPU buffers for a spec’s geometry (materials owned by meshes).
 */
export function disposeLabDieSpec(spec: LabDieSpec): void {
  spec.geometry.dispose()
}

/**
 * Dedupes quantized vertex positions for convex hull support (`worldAabbOfLocalPoints`).
 */
function extractUniqueVertices(geo: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return [new THREE.Vector3(0.5, 0.5, 0.5)]
  const map = new Map<string, THREE.Vector3>()
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const key = `${round4(v.x)}_${round4(v.y)}_${round4(v.z)}`
    if (!map.has(key)) map.set(key, v.clone())
  }
  return [...map.values()]
}

/** Stable string key for vertex deduplication in `extractUniqueVertices`. */
function round4(n: number): string {
  return (Math.round(n * 1e4) / 1e4).toFixed(4)
}

/**
 * Merges triangle normals (same physical face), orients outward (away from origin), sorts, assigns 1..N.
 */
type NormalBucket = { sum: THREE.Vector3 }

/**
 * Buckets triangle normals into merged face normals, sorts for stable value assignment 1…N.
 */
function buildFaceTableFromTriangles(geo: THREE.BufferGeometry, sides: LabDieSides): FaceNormalEntry[] {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const buckets: NormalBucket[] = []

  for (let i = 0; i < pos.count; i += 3) {
    _v0.fromBufferAttribute(pos, i)
    _v1.fromBufferAttribute(pos, i + 1)
    _v2.fromBufferAttribute(pos, i + 2)
    _e1.subVectors(_v1, _v0)
    _e2.subVectors(_v2, _v0)
    _tn.crossVectors(_e1, _e2)
    if (_tn.lengthSq() < 1e-10) continue
    _tn.normalize()
    _cent.copy(_v0).add(_v1).add(_v2).multiplyScalar(1 / 3)
    if (_tn.dot(_cent) < 0) _tn.negate()

    let merged = false
    for (const b of buckets) {
      const bn = b.sum.clone().normalize()
      if (bn.dot(_tn) > 0.985) {
        b.sum.add(_tn)
        merged = true
        break
      }
    }
    if (!merged) buckets.push({ sum: _tn.clone() })
  }

  const normals = buckets.map((b) => b.sum.clone().normalize())
  normals.sort((a, b) => {
    const dy = b.y - a.y
    if (Math.abs(dy) > 1e-4) return dy
    const dx = b.x - a.x
    if (Math.abs(dx) > 1e-4) return dx
    return b.z - a.z
  })

  const faceTable: FaceNormalEntry[] = []
  for (let i = 0; i < normals.length; i++) {
    const n = normals[i]
    faceTable.push({ nx: n.x, ny: n.y, nz: n.z, value: i + 1 })
  }

  if (faceTable.length > sides) {
    faceTable.length = sides
  } else if (faceTable.length < sides) {
    console.warn(`[dieLab] merged ${faceTable.length} face normals for d${sides}, expected ${sides}`)
  }
  if (faceTable.length === 0) {
    return [{ nx: 0, ny: 1, nz: 0, value: 1 }]
  }
  return faceTable
}
