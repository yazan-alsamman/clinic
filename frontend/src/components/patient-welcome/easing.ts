export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Gentle overshoot-then-settle curve — used for the "objects arriving into orbit" reveal. */
export function easeOutBack(x: number): number {
  const c1 = 1.4
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

export function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
