import * as THREE from 'three'
import type { ServiceGeometry } from './serviceCatalog'

export interface Station {
  id: ServiceGeometry
  /** Alcove side, for the environment/equipment placement */
  side: 'left' | 'right'
  /** Equipment position in world space */
  x: number
  z: number
  /** Roughly where this station sits along the 0..1 journey — used only for the rail's progress bar, not for camera sampling (that comes from proximity, below). */
  railT: number
}

// Five alcoves alternating left/right down a single corridor, in the same order
// as SERVICES — the corridor is one continuous building, not five separate scenes.
// railT values are each station's exact "peak" control-point index / 23 segments
// in POSITION_POINTS below — clicking a rail dot lands the camera precisely on
// the composed shot, not somewhere mid-approach.
export const STATIONS: Station[] = [
  { id: 'dentistry', side: 'left', x: -3.0, z: 0, railT: 4 / 23 },
  { id: 'dermatology', side: 'right', x: 3.0, z: -4.6, railT: 8 / 23 },
  { id: 'skincare', side: 'left', x: -3.0, z: -9.0, railT: 12 / 23 },
  { id: 'solarium', side: 'right', x: 3.0, z: -13.4, railT: 16 / 23 },
  { id: 'laser', side: 'left', x: -3.0, z: -17.8, railT: 20 / 23 },
]

/** Each department is a real room off the corridor rather than a niche in the
 * wall: the wall opens into it through a full-height doorway, and the room has
 * its own floor, back wall, ceiling and lighting. Treatment equipment is
 * 2 m-class furniture, so it needs a room to stand in — the 1.8 m alcove the
 * earlier passes used could only ever hold a scale model of a clinic. */
export const ROOM = {
  depth: 3.6,
  halfWidth: 2.7,
  // Wide enough that the room's full working layout falls inside the aperture.
  // At the old 2.6 m the doorway cropped anything more than ~1.3 m off the
  // centreline, which cut the feet off equipment standing against the side
  // walls and left arms and lamps apparently floating in mid-air.
  openingHalfWidth: 1.7,
  openingHeight: 2.5,
}

export const CORRIDOR = {
  halfWidth: 4.0,
  zStart: 10, // reception (open, closest to the "camera enters" end)
  zEnd: -27, // finale wall, where the logo lives — kept well past the last
  // alcove (laser, z=-17.8) so the camera has room to clear its influence
  // radius *and* still rest a proper composing distance from the logo,
  // rather than ending up nearly pressed against the wall.
  floorY: -1.35,
  ceilingY: 2.4,
}

// Camera position control points — deliberately clustered near each alcove
// (three points per stop: approach / peak / depart) so that stretch of the
// journey consumes more of the walk than the plain corridor between stops.
// THREE's CatmullRomCurve3.getPoint(t) allocates equal *parametric* t per
// segment regardless of physical segment length, so denser points = more
// dwell time — this is what creates the "linger at each department" pacing
// without hand-tuning a separate timing curve.
const POSITION_POINTS: THREE.Vector3[] = [
  [0, 0.55, 9.6],
  [0, 0.45, 6.4],
  [-0.15, 0.3, 3.0],
  [-0.27, 0.25, 0.7],
  [-0.3, 0.25, 0.0],
  [-0.18, 0.25, -1.9],
  [0.09, 0.28, -3.1],
  [0.27, 0.25, -4.1],
  [0.3, 0.25, -4.7],
  [0.18, 0.25, -6.3],
  [-0.09, 0.28, -7.5],
  [-0.27, 0.25, -8.5],
  [-0.3, 0.25, -9.1],
  [-0.18, 0.25, -10.7],
  [0.09, 0.28, -11.9],
  [0.27, 0.25, -12.9],
  [0.3, 0.25, -13.5],
  [0.18, 0.25, -15.1],
  [-0.09, 0.28, -16.3],
  [-0.27, 0.25, -17.3],
  [-0.3, 0.25, -17.9],
  [-0.15, 0.25, -19.3],
  [0, 0.3, -20.6],
  // The room opens up here — clear of every alcove's influence, the corridor
  // gives way to a wider, calmer final space the logo lives in.
  [0, 0.2, -22.0],
].map(([x, y, z]) => new THREE.Vector3(x, y, z))

/** Where the logo lives — the finale wall, and the fixed gaze target the
 * camera settles onto as the journey approaches its end. */
export const LOGO_POSITION = new THREE.Vector3(0, 0.15, CORRIDOR.zEnd + 0.55)

/** Centre of a department's room, out beyond the corridor wall. */
export function roomCenterX(s: Station): number {
  return (s.side === 'left' ? -1 : 1) * (CORRIDOR.halfWidth + ROOM.depth / 2)
}

/** Where the camera looks when passing a department: through the doorway and
 * into the room, aimed short of the room's centre so the hero equipment lands
 * off-centre in frame. A dead-centred product shot is exactly what a person
 * walking down a corridor never sees. */
function roomGazeX(s: Station): number {
  return (s.side === 'left' ? -1 : 1) * (CORRIDOR.halfWidth + 1.25)
}

const positionCurve = new THREE.CatmullRomCurve3(POSITION_POINTS, false, 'catmullrom', 0.5)

const ALCOVE_INFLUENCE_RADIUS = 2.6
const FORWARD_LOOKAHEAD = 0.025

function alcoveWeight(z: number, stationZ: number): number {
  const d = Math.abs(z - stationZ)
  if (d >= ALCOVE_INFLUENCE_RADIUS) return 0
  const x = 1 - d / ALCOVE_INFLUENCE_RADIUS
  return x * x * (3 - 2 * x) // smoothstep
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export interface WalkthroughSample {
  position: THREE.Vector3
  lookAt: THREE.Vector3
  /** id of the station the camera is currently favoring, or null if mid-corridor */
  activeStation: ServiceGeometry | null
  /** 0..1 confidence in that station (for UI cross-fade), 0 when in the corridor */
  stationWeight: number
}

const tmpAhead = new THREE.Vector3()
const tmpForwardTarget = new THREE.Vector3()
const tmpAlcoveTarget = new THREE.Vector3()
const tmpLookAt = new THREE.Vector3()

/** Samples the walkthrough curve at journey progress t (0..1) — position, where
 * the camera should look, and which department (if any) is currently "in focus"
 * so the UI can cross-fade its name/description without needing hover. */
export function sampleWalkthrough(t: number): WalkthroughSample {
  const ct = clamp01(t)
  const position = positionCurve.getPoint(ct)
  tmpAhead.copy(positionCurve.getPoint(clamp01(ct + FORWARD_LOOKAHEAD)))
  tmpForwardTarget.set(tmpAhead.x, 0.16, tmpAhead.z)

  let bestWeight = 0
  let bestStation: Station | null = null
  for (const station of STATIONS) {
    const w = alcoveWeight(position.z, station.z)
    if (w > bestWeight) {
      bestWeight = w
      bestStation = station
    }
  }

  if (bestStation && bestWeight > 0) {
    // Eye level for someone glancing into the room: a little below the
    // camera's own height, which is where a treatment chair or console sits.
    tmpAlcoveTarget.set(roomGazeX(bestStation), CORRIDOR.floorY + 0.95, bestStation.z)
    tmpLookAt.lerpVectors(tmpForwardTarget, tmpAlcoveTarget, bestWeight)
  } else {
    tmpLookAt.copy(tmpForwardTarget)
  }

  // The last stretch of the curve has nowhere left to look "ahead" to (and
  // may still be fading out of the final alcove's influence), so explicitly
  // settle the gaze onto the logo as the destination — guaranteed, rather
  // than left to whatever the curve's tangent happens to be at t=1.
  const finaleWeight = smoothstep(0.9, 1, ct)
  if (finaleWeight > 0) tmpLookAt.lerp(LOGO_POSITION, finaleWeight)

  return {
    position: position.clone(),
    lookAt: tmpLookAt.clone(),
    activeStation: bestWeight > 0.55 && bestStation ? bestStation.id : null,
    stationWeight: bestWeight,
  }
}
