/**
 * Procedural face textures for the dice lab: d6 uses fixed box face order; other solids use `createPolyFaceMaterials`
 * with one canvas per entry in `faceTable` (must match `assignFaceGroupsFromFaceTable` group order in `dieLabConfig`).
 *
 * Intent: visual debugging of orientation and future UV mapping parity with production dice.
 * Contract: d6 returns six `MeshStandardMaterial`s in Three.js +X, -X, +Y, -Y, +Z, -Z order for `BoxGeometry` groups.
 */

import * as THREE from 'three'

import type { FaceNormalEntry } from './dieLabConfig'

const S = 256

/** Pip positions in normalized [0,1]² for classic d6 pairings (optional decoration). */
const PIP2: [number, number][] = [
  [0.28, 0.72],
  [0.72, 0.28],
]
const PIP3: [number, number][] = [
  [0.28, 0.72],
  [0.5, 0.5],
  [0.72, 0.28],
]
const PIP4: [number, number][] = [
  [0.28, 0.28],
  [0.72, 0.28],
  [0.28, 0.72],
  [0.72, 0.72],
]
const PIP5: [number, number][] = [
  [0.28, 0.28],
  [0.72, 0.28],
  [0.5, 0.5],
  [0.28, 0.72],
  [0.72, 0.72],
]
const PIP6: [number, number][] = [
  [0.28, 0.32],
  [0.72, 0.32],
  [0.28, 0.5],
  [0.72, 0.5],
  [0.28, 0.68],
  [0.72, 0.68],
]

/**
 * Draws one square facet: frame, fill gradient, optional pips, and a large digit.
 */
/**
 * Renders one face canvas: gradient fill, frame, optional d6 pips, centered digit, corner tag.
 */
function drawFacet(
  ctx: CanvasRenderingContext2D,
  faceValue: number,
  opts: {
    accent: string
    deep: string
    frame: string
    pipColor: string
    cornerTag: string
  },
): void {
  const g = ctx.createLinearGradient(0, 0, S, S)
  g.addColorStop(0, opts.deep)
  g.addColorStop(0.55, opts.accent)
  g.addColorStop(1, opts.deep)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)

  ctx.strokeStyle = opts.frame
  ctx.lineWidth = 10
  ctx.strokeRect(5, 5, S - 10, S - 10)
  ctx.lineWidth = 3
  ctx.globalAlpha = 0.35
  ctx.beginPath()
  ctx.moveTo(12, 12)
  ctx.lineTo(S - 12, S - 12)
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.fillStyle = opts.pipColor
  let pips: [number, number][] = []
  if (faceValue === 2) pips = PIP2
  else if (faceValue === 3) pips = PIP3
  else if (faceValue === 4) pips = PIP4
  else if (faceValue === 5) pips = PIP5
  else if (faceValue === 6) pips = PIP6
  for (const [u, v] of pips) {
    ctx.beginPath()
    ctx.arc(u * S, v * S, faceValue >= 5 ? 9 : 10, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = '#f5f0e6'
  const digitPx = faceValue >= 10 ? 76 : faceValue >= 8 ? 92 : 118
  ctx.font = `bold ${digitPx}px system-ui,sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 14
  ctx.fillText(String(faceValue), S * 0.52, S * 0.42)
  ctx.shadowBlur = 0

  ctx.font = '600 22px system-ui,sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(opts.cornerTag, 14, S - 10)
}

/**
 * Face-specific palette rows: [accent, deep, frame, pip, tag] per pip value 1–6.
 */
const FACE_STYLES: Record<
  number,
  { accent: string; deep: string; frame: string; pip: string; tag: string }
> = {
  1: { accent: '#4a3a6a', deep: '#1e1530', frame: '#c9a227', pip: '#e8d89a', tag: 'I · crown' },
  2: { accent: '#2a4f5a', deep: '#0f2228', frame: '#6ec8d8', pip: '#b8eef8', tag: 'II · sea' },
  3: { accent: '#5a2a58', deep: '#240f22', frame: '#d86ec8', pip: '#f6b8ee', tag: 'III · void' },
  4: { accent: '#5a3a2a', deep: '#28150f', frame: '#d8a06e', pip: '#f8dcb8', tag: 'IV · ember' },
  5: { accent: '#3a4a3a', deep: '#152018', frame: '#8ecf8e', pip: '#d8f8d8', tag: 'V · moss' },
  6: { accent: '#5a2a2a', deep: '#280f0f', frame: '#ff6e6e', pip: '#ffc4c4', tag: 'VI · blood' },
}

/**
 * `BoxGeometry` group order: +X, -X, +Y, -Y, +Z, -Z — pip values must match `readTopFaceValue` mapping in `main.ts`.
 */
export const BOX_GEOMETRY_FACE_VALUES: readonly number[] = [2, 5, 1, 6, 3, 4]

/**
 * Builds six materials for a d6: each face value uses a different facet layout (see `FACE_STYLES`).
 *
 * Contract: `dieIndex` shifts hue slightly so multiple dice read as siblings, not clones. Material order matches
 * `BOX_GEOMETRY_FACE_VALUES` for correct face–UV alignment.
 */
export function createD6FaceMaterials(dieIndex: number): THREE.MeshStandardMaterial[] {
  const hueShift = (dieIndex * 17) % 40
  const materials: THREE.MeshStandardMaterial[] = []
  for (const faceValue of BOX_GEOMETRY_FACE_VALUES) {
    const c = document.createElement('canvas')
    c.width = c.height = S
    const ctx = c.getContext('2d')
    if (!ctx) {
      materials.push(new THREE.MeshStandardMaterial({ color: 0x444454 }))
      continue
    }
    const st = FACE_STYLES[faceValue]
    const accent = shiftHue(st.accent, hueShift)
    const deep = shiftHue(st.deep, hueShift * 0.5)
    drawFacet(ctx, faceValue, {
      accent,
      deep,
      frame: st.frame,
      pipColor: st.pip,
      cornerTag: `${st.tag} · D${dieIndex + 1}`,
    })
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    materials.push(
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.42,
        metalness: 0.12,
      }),
    )
  }
  return materials
}

/**
 * Builds one `MeshStandardMaterial` per `faceTable` row for platonic lab solids after `assignFaceGroupsFromFaceTable`.
 *
 * Intent: same legibility as the d6 (digit + frame) so non-d6 dice are readable in the viewport, aligned with `value`
 * used by `readTopFaceValue`. Contract: material index `i` matches geometry group `i` and `faceTable[i].value` on the texture.
 */
export function createPolyFaceMaterials(
  faceTable: readonly FaceNormalEntry[],
  dieIndex: number,
  sides: number,
): THREE.MeshStandardMaterial[] {
  const hueShift = (dieIndex * 17) % 40
  const materials: THREE.MeshStandardMaterial[] = []
  for (let fi = 0; fi < faceTable.length; fi++) {
    const faceValue = faceTable[fi].value
    const styleKey = (((faceValue - 1) % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6
    const st = FACE_STYLES[styleKey]
    const c = document.createElement('canvas')
    c.width = c.height = S
    const ctx = c.getContext('2d')
    if (!ctx) {
      materials.push(new THREE.MeshStandardMaterial({ color: 0x444454 }))
      continue
    }
    const accent = shiftHue(st.accent, hueShift)
    const deep = shiftHue(st.deep, hueShift * 0.5)
    drawFacet(ctx, faceValue, {
      accent,
      deep,
      frame: st.frame,
      pipColor: st.pip,
      cornerTag: `d${sides} · ${faceValue} · D${dieIndex + 1}`,
    })
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    materials.push(
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.42,
        metalness: 0.12,
      }),
    )
  }
  return materials
}

/**
 * Nudges a hex color’s hue for per-die variation (cheap string parse for lab use only).
 */
/**
 * Rotates hue on a `#rrggbb` color for per-die tint variation.
 */
function shiftHue(hex: string, deg: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const { h, s, l } = rgbToHsl(r, g, b)
  const nh = (h + deg / 360 + 1) % 1
  const [nr, ng, nb] = hslToRgb(nh, s, l)
  return `#${[nr, ng, nb].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

/** RGB [0,255] to HSL [0,1] channels. */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h /= 6
  }
  return { h, s, l }
}

/** HSL [0,1] to RGB bytes. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

/** Helper for `hslToRgb` (piecewise linear segments). */
function hue2rgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}
