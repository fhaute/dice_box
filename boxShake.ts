/**
 * Kinematic “box shake” profile for the dice lab: **3D** offset of the pen vs time (seconds) — X, Y, and Z — so the
 * motion reads like rattling a handheld dice box (up/down and sideways), not only sliding on the table.
 *
 * Intent: approximate someone jostling a rigid container without full rigid-body coupling. Classical **damped harmonic
 * motion** obeys \(m\ddot{x}+b\dot{x}+kx=0\); underdamped solutions are exponentially decaying sinusoids (see e.g.
 * OpenStax University Physics §15.6, or Wikipedia “Damped harmonic oscillator”). Here we use a **finite burst** with a
 * \(\sin^2(\pi t/T)\) envelope (Hann-style window, zero displacement and slope at \(t=0\) and \(t=T\)) multiplied by
 * **independent** pairs of sinusoids on **X, Y, and Z** (different frequencies/phases) so the path wanders in 3D and
 * returns smoothly to rest.
 *
 * Contract: `sampleApplyBoxShakeXYZ` is pure; `createRandomApplyBoxShake` picks amplitudes/phases within clamps expected
 * in `main.ts` (`MAX_SHAKER_OFFSET` horizontal, smaller vertical cap).
 */

export type ApplyBoxShakeConfig = {
  /** Seconds; offset is exactly 0 for \(t\le 0\) and \(t\ge T\). */
  duration: number
  ampX: number
  ampY: number
  ampZ: number
  wx1: number
  wx2: number
  wy1: number
  wy2: number
  wz1: number
  wz2: number
  phX1: number
  phX2: number
  phY1: number
  phY2: number
  phZ1: number
  phZ2: number
}

/** Hann-style window: 0 at endpoints, smooth in between (finite shake burst). */
function envAt(t: number, T: number): number {
  if (t <= 0 || t >= T) return 0
  return Math.sin((Math.PI * t) / T) ** 2
}

/**
 * Writes pen offset at time `t` (world XYZ) into `out`.
 */
export function sampleApplyBoxShakeXYZ(
  t: number,
  cfg: ApplyBoxShakeConfig,
  out: { x: number; y: number; z: number },
): void {
  if (t <= 0 || t >= cfg.duration) {
    out.x = 0
    out.y = 0
    out.z = 0
    return
  }
  const env = envAt(t, cfg.duration)
  out.x =
    env *
    (cfg.ampX * Math.sin(cfg.wx1 * t + cfg.phX1) + 0.42 * cfg.ampX * Math.sin(cfg.wx2 * t + cfg.phX2))
  out.y =
    env *
    (cfg.ampY * Math.sin(cfg.wy1 * t + cfg.phY1) + 0.42 * cfg.ampY * Math.sin(cfg.wy2 * t + cfg.phY2))
  out.z =
    env *
    (cfg.ampZ * Math.sin(cfg.wz1 * t + cfg.phZ1) + 0.42 * cfg.ampZ * Math.sin(cfg.wz2 * t + cfg.phZ2))
}

/**
 * Builds one randomized shake profile (strong mid-burst, bounded amplitude; vertical slightly gentler than horizontal).
 */
export function createRandomApplyBoxShake(duration = 0.82): ApplyBoxShakeConfig {
  const twopi = Math.PI * 2
  return {
    duration,
    ampX: 0.34 + Math.random() * 0.2,
    ampY: 0.11 + Math.random() * 0.12,
    ampZ: 0.34 + Math.random() * 0.2,
    wx1: 38 + Math.random() * 22,
    wx2: 52 + Math.random() * 28,
    wy1: 46 + Math.random() * 26,
    wy2: 62 + Math.random() * 30,
    wz1: 44 + Math.random() * 24,
    wz2: 58 + Math.random() * 26,
    phX1: Math.random() * twopi,
    phX2: Math.random() * twopi,
    phY1: Math.random() * twopi,
    phY2: Math.random() * twopi,
    phZ1: Math.random() * twopi,
    phZ2: Math.random() * twopi,
  }
}
