/** Per-object orbital parameters. Radii, tilts and speeds are deliberately uneven
 * across the five objects — that irregularity is what keeps the composition from
 * reading as a mechanical carousel. Indexes line up with `SERVICES`. */
export interface OrbitParams {
  baseAngle: number
  radiusX: number
  radiusZ: number
  tilt: number
  speed: number
  bobAmp: number
  bobFreq: number
  selfSpin: number
  scale: number
}

const TAU = Math.PI * 2

export const ORBIT_CONFIG: OrbitParams[] = [
  // dentistry
  { baseAngle: 0, radiusX: 2.55, radiusZ: 1.55, tilt: 0.08, speed: 0.14, bobAmp: 0.1, bobFreq: 0.55, selfSpin: 0.06, scale: 0.62 },
  // dermatology
  { baseAngle: TAU * 0.2, radiusX: 2.9, radiusZ: 1.7, tilt: -0.12, speed: 0.11, bobAmp: 0.14, bobFreq: 0.4, selfSpin: 0.09, scale: 0.5 },
  // skincare
  { baseAngle: TAU * 0.42, radiusX: 2.35, radiusZ: 1.85, tilt: 0.18, speed: 0.17, bobAmp: 0.08, bobFreq: 0.62, selfSpin: 0.14, scale: 0.44 },
  // solarium
  { baseAngle: TAU * 0.63, radiusX: 3.05, radiusZ: 1.45, tilt: -0.06, speed: 0.09, bobAmp: 0.12, bobFreq: 0.48, selfSpin: 0.05, scale: 0.58 },
  // laser
  { baseAngle: TAU * 0.83, radiusX: 2.7, radiusZ: 1.65, tilt: 0.14, speed: 0.13, bobAmp: 0.1, bobFreq: 0.7, selfSpin: 0.11, scale: 0.5 },
]
