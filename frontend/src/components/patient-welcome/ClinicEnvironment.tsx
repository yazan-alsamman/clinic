import { useMemo } from 'react'
import * as THREE from 'three'
import { STATIONS, CORRIDOR, ROOM, roomCenterX, type Station } from './walkthroughPath'
import { getGlowTexture } from './glowTexture'
import { getFloorTexture, getWallTexture } from './architecturalTextures'
import { makeClinicMaterials } from './clinicMaterials'

const CORRIDOR_LENGTH = CORRIDOR.zStart - CORRIDOR.zEnd
const CORRIDOR_CENTER_Z = (CORRIDOR.zStart + CORRIDOR.zEnd) / 2
const ROOM_HEIGHT = CORRIDOR.ceilingY - CORRIDOR.floorY
const BASEBOARD_H = 0.11
const WALL_Z0 = CORRIDOR_CENTER_Z + (CORRIDOR_LENGTH + 3) / 2
const WALL_Z1 = CORRIDOR_CENTER_Z - (CORRIDOR_LENGTH + 3) / 2
const HEAD_Y = CORRIDOR.floorY + ROOM.openingHeight

/** Practical lighting per department. Same fixture family throughout — only
 * the colour temperature shifts, the way it genuinely does between a dental
 * operatory and a tanning room. */
const ROOM_LIGHT: Record<string, { color: string; intensity: number }> = {
  dentistry: { color: '#f4f7fa', intensity: 5.2 },
  dermatology: { color: '#eff4f8', intensity: 4.8 },
  skincare: { color: '#ffe6cd', intensity: 4.2 },
  solarium: { color: '#ffd6a8', intensity: 3.6 },
  laser: { color: '#edf2f7', intensity: 4.6 },
}

/** Splits a wall run into the solid stretches between the door openings. */
function wallSegments(stations: Station[]): { z: number; len: number }[] {
  const gaps = stations
    .map((s) => ({ hi: s.z + ROOM.openingHalfWidth, lo: s.z - ROOM.openingHalfWidth }))
    .sort((a, b) => b.hi - a.hi)
  const out: { z: number; len: number }[] = []
  let cursor = WALL_Z0
  for (const g of gaps) {
    if (cursor > g.hi) out.push({ z: (cursor + g.hi) / 2, len: cursor - g.hi })
    cursor = g.lo
  }
  if (cursor > WALL_Z1) out.push({ z: (cursor + WALL_Z1) / 2, len: cursor - WALL_Z1 })
  return out
}

/**
 * One continuous building: a corridor with a floor, two walls and a ceiling,
 * opening through full-height doorways into five real treatment rooms, and
 * ending at the branded finale wall.
 *
 * The change that matters most here is that the departments are now rooms
 * rather than niches — each has its own volume, back wall, ceiling, casework
 * lighting and colour temperature, and the corridor wall genuinely opens into
 * it. That is what lets the camera look *through* a doorway into a space,
 * which is how anyone actually experiences a clinic, instead of looking at a
 * shallow recess with a prop in it.
 */
export function ClinicEnvironment({ lowPower }: { lowPower: boolean }) {
  const glow = getGlowTexture()
  const floorTex = getFloorTexture()
  const wallTex = getWallTexture()
  const mats = useMemo(() => makeClinicMaterials(lowPower), [lowPower])

  const floorMap = useMemo(() => {
    const t = floorTex.clone()
    t.repeat.set((CORRIDOR.halfWidth * 2 + 1.2) / 1.7, (CORRIDOR_LENGTH + 3) / 1.7)
    t.needsUpdate = true
    return t
  }, [floorTex])

  const wallMap = useMemo(() => {
    const t = wallTex.clone()
    t.repeat.set((CORRIDOR_LENGTH + 3) / 4, ROOM_HEIGHT / 2.2)
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }, [wallTex])

  // The finale wall is a tenth of the corridor's length but was sharing the
  // corridor's tiling rate, which squeezed ~10 repeats into 9 m and produced a
  // radial moiré fan across the logo shot. It needs its own repeat.
  const finaleWallMap = useMemo(() => {
    const t = wallTex.clone()
    t.repeat.set((CORRIDOR.halfWidth * 2 + 1.2) / 4, ROOM_HEIGHT / 2.2)
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }, [wallTex])

  const segmentsBySide = useMemo(
    () => ({
      left: wallSegments(STATIONS.filter((s) => s.side === 'left')),
      right: wallSegments(STATIONS.filter((s) => s.side === 'right')),
    }),
    [],
  )

  return (
    <group>
      {/* ── Corridor shell ───────────────────────────────────────── */}
      <mesh position={[0, CORRIDOR.floorY, CORRIDOR_CENTER_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CORRIDOR.halfWidth * 2 + 1.2, CORRIDOR_LENGTH + 3]} />
        <meshStandardMaterial map={floorMap} color="#1d1a15" roughness={0.42} metalness={0.04} />
      </mesh>
      <mesh position={[0, CORRIDOR.ceilingY, CORRIDOR_CENTER_Z]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CORRIDOR.halfWidth * 2 + 1.2, CORRIDOR_LENGTH + 3]} />
        <meshStandardMaterial color="#131118" roughness={0.94} metalness={0} />
      </mesh>

      {/* Side walls, broken by the department doorways, with a lintel over each */}
      {(['left', 'right'] as const).map((side) => {
        const dir = side === 'left' ? -1 : 1
        return (
          <group key={side}>
            {segmentsBySide[side].map((seg) => (
              <mesh
                key={seg.z}
                position={[dir * CORRIDOR.halfWidth, (CORRIDOR.floorY + CORRIDOR.ceilingY) / 2, seg.z]}
                rotation={[0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
              >
                <planeGeometry args={[seg.len, ROOM_HEIGHT]} />
                <meshStandardMaterial map={wallMap} color="#171519" roughness={0.62} metalness={0.02} />
              </mesh>
            ))}
            {STATIONS.filter((s) => s.side === side).map((s) => (
              <mesh
                key={s.id}
                position={[dir * CORRIDOR.halfWidth, (HEAD_Y + CORRIDOR.ceilingY) / 2, s.z]}
                rotation={[0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
              >
                <planeGeometry args={[ROOM.openingHalfWidth * 2, CORRIDOR.ceilingY - HEAD_Y]} />
                <meshStandardMaterial map={wallMap} color="#171519" roughness={0.62} metalness={0.02} />
              </mesh>
            ))}
            {/* Baseboard, interrupted by the doorways just as the wall is */}
            {segmentsBySide[side].map((seg) => (
              <mesh
                key={`b${seg.z}`}
                position={[dir * (CORRIDOR.halfWidth - 0.018), CORRIDOR.floorY + BASEBOARD_H / 2, seg.z]}
              >
                <boxGeometry args={[0.036, BASEBOARD_H, seg.len]} />
                <meshStandardMaterial color="#2a2822" roughness={0.4} metalness={0.08} />
              </mesh>
            ))}
          </group>
        )
      })}

      {/* Recessed ceiling light channel running the length of the hall */}
      <mesh position={[0, CORRIDOR.ceilingY - 0.005, CORRIDOR_CENTER_Z]}>
        <boxGeometry args={[0.5, 0.03, CORRIDOR_LENGTH + 2]} />
        <meshStandardMaterial color="#050508" roughness={0.9} />
      </mesh>
      <mesh position={[0, CORRIDOR.ceilingY - 0.012, CORRIDOR_CENTER_Z]}>
        <boxGeometry args={[0.14, 0.014, CORRIDOR_LENGTH + 1.8]} />
        <meshStandardMaterial color="#fff6ee" emissive="#fff1e2" emissiveIntensity={0.55} roughness={0.5} />
      </mesh>

      {/* ── Finale wall ──────────────────────────────────────────── */}
      <mesh position={[0, (CORRIDOR.floorY + CORRIDOR.ceilingY) / 2, CORRIDOR.zEnd - 0.05]}>
        <planeGeometry args={[CORRIDOR.halfWidth * 2 + 1.2, ROOM_HEIGHT]} />
        {/* Matte, and deliberately not clearcoated: a lacquered finish here
            mirrored the environment's softbox straight across the logo shot as
            a large bright fan. Plaster does not do that. */}
        <meshStandardMaterial map={finaleWallMap} color="#171519" roughness={0.82} metalness={0} />
      </mesh>
      <mesh position={[0, 0.15, CORRIDOR.zEnd + 0.02]}>
        <planeGeometry args={[3.4, 1.7]} />
        <meshBasicMaterial color="#f0c6b8" transparent opacity={0.07} />
      </mesh>
      <mesh position={[0, ROOM_HEIGHT * 0.3, CORRIDOR.zEnd - 0.03]}>
        <boxGeometry args={[3.6, 0.04, 0.06]} />
        <meshStandardMaterial color="#fff6ee" emissive="#fff1e2" emissiveIntensity={0.35} roughness={0.6} />
      </mesh>

      {/* ── Reception ────────────────────────────────────────────── */}
      {/* Set back ~3.5 m from where the walk begins. At the old 1.4 m the desk
          sat below the camera's frame at t=0, so the journey opened on an empty
          hallway instead of on a reception. */}
      <group position={[-2.4, CORRIDOR.floorY + 0.31, CORRIDOR.zStart - 3.6]} rotation={[0, 0.35, 0]}>
        <mesh>
          <boxGeometry args={[1.7, 0.62, 0.5]} />
          <meshStandardMaterial color="#131218" roughness={0.5} metalness={0.12} />
        </mesh>
        <mesh position={[0, 0.325, 0]}>
          <boxGeometry args={[1.76, 0.035, 0.56]} />
          <meshStandardMaterial color="#3a2c26" roughness={0.3} metalness={0.15} />
        </mesh>
        <mesh position={[0, 0.05, 0.255]}>
          <boxGeometry args={[1.5, 0.02, 0.01]} />
          <meshStandardMaterial color="#e9b2a8" emissive="#e9b2a8" emissiveIntensity={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[0.4, 0.42, -0.05]}>
          <cylinderGeometry args={[0.03, 0.05, 0.1, 10]} />
          <meshStandardMaterial color="#1c1c22" roughness={0.4} metalness={0.3} />
        </mesh>
        <mesh position={[0.4, 0.55, -0.05]}>
          <boxGeometry args={[0.34, 0.22, 0.015]} />
          <meshStandardMaterial color="#0a0a0d" roughness={0.25} metalness={0.2} />
        </mesh>
        <mesh position={[0.4, 0.55, -0.043]}>
          <planeGeometry args={[0.3, 0.18]} />
          <meshStandardMaterial color="#9fd0e6" emissive="#7fb8d8" emissiveIntensity={0.25} roughness={0.3} />
        </mesh>
      </group>
      <group position={[2.5, CORRIDOR.floorY + 0.14, CORRIDOR.zStart - 3.2]} rotation={[0, -0.5, 0]}>
        {[0, 0.62].map((z) => (
          <group key={z} position={[0, 0, z]}>
            <mesh position={[0, 0.14, 0]}>
              <boxGeometry args={[0.5, 0.16, 0.46]} />
              <meshStandardMaterial color="#1c1a22" roughness={0.75} metalness={0.05} />
            </mesh>
            <mesh position={[0, 0.34, -0.2]}>
              <boxGeometry args={[0.5, 0.36, 0.08]} />
              <meshStandardMaterial color="#1c1a22" roughness={0.75} metalness={0.05} />
            </mesh>
          </group>
        ))}
      </group>
      <group position={[-3.5, CORRIDOR.floorY, CORRIDOR.zStart - 5.0]}>
        <mesh position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.13, 0.16, 0.36, 10]} />
          <meshStandardMaterial color="#22201c" roughness={0.55} metalness={0.1} />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[Math.sin(i) * 0.06, 0.5 + i * 0.05, Math.cos(i) * 0.06]} rotation={[0.2, i, 0.1]}>
            <coneGeometry args={[0.13, 0.55, 6]} />
            <meshStandardMaterial color="#2e4a34" roughness={0.7} />
          </mesh>
        ))}
      </group>

      {/* Corridor rhythm columns. Paired against the walls rather than down
          the centreline — a column on the camera's own forward axis parks a
          black bar through the middle of every shot in the walkthrough. */}
      {STATIONS.slice(0, -1).map((s, i) => {
        const midZ = (s.z + STATIONS[i + 1].z) / 2
        return [-1, 1].map((side) => (
          <mesh
            key={`${s.id}${side}`}
            position={[side * (CORRIDOR.halfWidth - 0.34), CORRIDOR.floorY + ROOM_HEIGHT / 2, midZ]}
          >
            <boxGeometry args={[0.3, ROOM_HEIGHT, 0.3]} />
            <meshStandardMaterial color="#26242c" roughness={0.85} metalness={0.05} />
          </mesh>
        ))
      })}

      {/* ── Treatment rooms ──────────────────────────────────────── */}
      {STATIONS.map((s) => {
        const dir = s.side === 'left' ? -1 : 1
        const cx = roomCenterX(s)
        const backX = dir * (CORRIDOR.halfWidth + ROOM.depth)
        const light = ROOM_LIGHT[s.id]
        return (
          <group key={s.id}>
            {/* Treatment rooms are bright, light-floored clinical spaces seen
                from a deliberately dim corridor. That contrast is both how a
                real clinic reads at night and what makes each doorway play as
                a lit frame rather than another dark recess. */}
            <mesh position={[cx, CORRIDOR.floorY + 0.002, s.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[ROOM.depth, ROOM.halfWidth * 2]} />
              <meshStandardMaterial color="#8d887e" roughness={0.5} metalness={0.03} />
            </mesh>
            <mesh position={[cx, CORRIDOR.ceilingY - 0.002, s.z]} rotation={[Math.PI / 2, 0, 0]}>
              <planeGeometry args={[ROOM.depth, ROOM.halfWidth * 2]} />
              <meshStandardMaterial color="#3a3740" roughness={0.95} metalness={0} />
            </mesh>
            {/* Back wall */}
            <mesh
              position={[backX, (CORRIDOR.floorY + CORRIDOR.ceilingY) / 2, s.z]}
              rotation={[0, dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
            >
              <planeGeometry args={[ROOM.halfWidth * 2, ROOM_HEIGHT]} />
              <meshStandardMaterial map={wallMap} color="#5c5762" roughness={0.68} metalness={0.02} />
            </mesh>
            {/* Room side walls */}
            {[-1, 1].map((sz) => (
              <mesh
                key={sz}
                position={[cx, (CORRIDOR.floorY + CORRIDOR.ceilingY) / 2, s.z + sz * ROOM.halfWidth]}
                rotation={[0, sz > 0 ? Math.PI : 0, 0]}
              >
                <planeGeometry args={[ROOM.depth, ROOM_HEIGHT]} />
                <meshStandardMaterial map={wallMap} color="#5c5762" roughness={0.68} metalness={0.02} />
              </mesh>
            ))}
            {/* Room baseboard along the back wall */}
            <mesh position={[backX - dir * 0.018, CORRIDOR.floorY + BASEBOARD_H / 2, s.z]}>
              <boxGeometry args={[0.036, BASEBOARD_H, ROOM.halfWidth * 2]} />
              <meshStandardMaterial color="#2a2822" roughness={0.4} metalness={0.08} />
            </mesh>

            {/* Recessed ceiling troffers — the fixture a real treatment room has */}
            {[-0.85, 0.85].map((oz) => (
              <mesh key={oz} position={[cx, CORRIDOR.ceilingY - 0.02, s.z + oz]} rotation={[Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.9, 0.24]} />
                <meshStandardMaterial
                  color="#fff8f0"
                  emissive="#fff4ea"
                  emissiveIntensity={0.7}
                  roughness={0.5}
                  toneMapped={false}
                />
              </mesh>
            ))}
            {/* One practical per room. Real lamps are cheap to *look* at and
                expensive to *have*: every additional light recompiles into
                every physical material's shader, so the emissive troffers
                above carry the visible fixture and a single point light
                carries the actual illumination. */}
            <pointLight
              position={[cx, CORRIDOR.ceilingY - 0.9, s.z]}
              intensity={light.intensity * (lowPower ? 0.8 : 1)}
              color={light.color}
              distance={9}
              decay={2}
            />

            {/* ── Doorway: reveal lining, glazed screen, frame, handle ── */}
            <group position={[dir * CORRIDOR.halfWidth, 0, s.z]} rotation={[0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
              {/* Jamb linings, so the wall reads as having thickness */}
              {[-1, 1].map((sx) => (
                <mesh key={sx} position={[sx * ROOM.openingHalfWidth, CORRIDOR.floorY + ROOM.openingHeight / 2, 0]}>
                  <boxGeometry args={[0.06, ROOM.openingHeight, 0.34]} />
                  <meshStandardMaterial color="#23212a" roughness={0.5} metalness={0.12} />
                </mesh>
              ))}
              <mesh position={[0, HEAD_Y, 0]}>
                <boxGeometry args={[ROOM.openingHalfWidth * 2 + 0.06, 0.07, 0.34]} />
                <meshStandardMaterial color="#23212a" roughness={0.5} metalness={0.12} />
              </mesh>
              {/* A fixed glazed screen fills one side of the opening; the other
                  side is open, so the room is seen partly through glass and
                  partly directly — the mix real clinics have, and the reason
                  the reflections read as architecture rather than a filter. */}
              <mesh position={[-ROOM.openingHalfWidth + 0.42, CORRIDOR.floorY + ROOM.openingHeight / 2, 0.02]}>
                <planeGeometry args={[0.8, ROOM.openingHeight - 0.14]} />
                <meshPhysicalMaterial
                  color="#cbd7de"
                  roughness={0.04}
                  metalness={0}
                  transparent
                  opacity={0.16}
                  clearcoat={lowPower ? 0 : 1}
                  clearcoatRoughness={0.03}
                  side={THREE.DoubleSide}
                />
              </mesh>
              {/* Outer stile and head rail. Without them the leaf is invisible
                  glass and its handle appears to hang unsupported in the
                  doorway — framing it is what makes the glass read as a door. */}
              <mesh position={[-ROOM.openingHalfWidth + 0.02, CORRIDOR.floorY + ROOM.openingHeight / 2, 0.02]}>
                <boxGeometry args={[0.05, ROOM.openingHeight - 0.1, 0.05]} />
                <meshStandardMaterial color="#2b2933" roughness={0.45} metalness={0.3} />
              </mesh>
              <mesh position={[-ROOM.openingHalfWidth + 0.42, CORRIDOR.floorY + ROOM.openingHeight - 0.06, 0.02]}>
                <boxGeometry args={[0.8, 0.06, 0.05]} />
                <meshStandardMaterial color="#2b2933" roughness={0.45} metalness={0.3} />
              </mesh>
              {/* The mullion sits at the edge of the glazed leaf, well off the
                  doorway's centreline — a post through the middle of the
                  opening would bisect every shot the camera composes here. */}
              <mesh position={[-ROOM.openingHalfWidth + 0.84, CORRIDOR.floorY + ROOM.openingHeight / 2, 0.02]}>
                <boxGeometry args={[0.05, ROOM.openingHeight - 0.1, 0.05]} />
                <meshStandardMaterial color="#2b2933" roughness={0.45} metalness={0.3} />
              </mesh>
              <mesh position={[-ROOM.openingHalfWidth + 0.42, CORRIDOR.floorY + 0.05, 0.02]}>
                <boxGeometry args={[0.8, 0.1, 0.05]} />
                <meshStandardMaterial color="#8a8f98" roughness={0.35} metalness={0.9} />
              </mesh>
              <mesh position={[-ROOM.openingHalfWidth + 0.72, CORRIDOR.floorY + 1.05, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.014, 0.014, 0.34, 10]} />
                <meshPhysicalMaterial {...mats.brushedSteel} />
              </mesh>
              {/* Room signage plate beside the door */}
              <mesh position={[ROOM.openingHalfWidth + 0.2, CORRIDOR.floorY + 1.5, 0.03]}>
                <planeGeometry args={[0.2, 0.28]} />
                <meshStandardMaterial color="#0d0d10" roughness={0.35} metalness={0.2} />
              </mesh>
            </group>

            {/* Light spilling out of the doorway onto the corridor floor */}
            <sprite position={[dir * (CORRIDOR.halfWidth - 1.0), CORRIDOR.floorY + 0.012, s.z]} scale={[2.6, 3.0, 1]}>
              <spriteMaterial map={glow} color={light.color} transparent opacity={0.07} depthWrite={false} />
            </sprite>
          </group>
        )
      })}
    </group>
  )
}
