import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { STATIONS, CORRIDOR, ROOM, roomCenterX, type Station } from './walkthroughPath'
import { getGlowTexture } from './glowTexture'
import {
  configureProceduralQuality,
  getFloorMaps,
  getWallMaps,
  getStoneMaps,
  getSignTexture,
  tiled,
  TILE,
} from './proceduralMaps'
import { makeClinicMaterials } from './clinicMaterials'
import { ContactShadow, CornerAo, AoStrip, LightWash } from './grounding'
import { registerShadowLight, requestShadowRefresh } from './shadowBudget'
import { ShadowTag } from './shadows'
import { PooledPointLights, type LightFixture } from './lightPool'
import { Panel } from './hardware'
import { ClinicMaterial } from './ClinicMaterial'

const CORRIDOR_LENGTH = CORRIDOR.zStart - CORRIDOR.zEnd
const CORRIDOR_CENTER_Z = (CORRIDOR.zStart + CORRIDOR.zEnd) / 2
const ROOM_HEIGHT = CORRIDOR.ceilingY - CORRIDOR.floorY
const BASEBOARD_H = 0.11
const WALL_Z0 = CORRIDOR_CENTER_Z + (CORRIDOR_LENGTH + 3) / 2
const WALL_Z1 = CORRIDOR_CENTER_Z - (CORRIDOR_LENGTH + 3) / 2
const HEAD_Y = CORRIDOR.floorY + ROOM.openingHeight
const FLOOR_W = CORRIDOR.halfWidth * 2 + 1.2
const FLOOR_L = CORRIDOR_LENGTH + 3

/** Suspended ceiling rafts: one either side of the central light slot, each
 * stopping 300 mm short of its wall so the perimeter gap can hold the cove. */
const RAFT_GAP_WALL = 0.3
const RAFT_GAP_CENTRE = 0.35
const RAFT_W = CORRIDOR.halfWidth - RAFT_GAP_WALL - RAFT_GAP_CENTRE
const RAFT_CX = RAFT_GAP_CENTRE + RAFT_W / 2

/** One pair of slot diffusers per alcove bay. */
const HVAC_Z = STATIONS.map((s) => s.z + 2.2)

/** Practical lighting per department. Same fixture family throughout — only
 * the colour temperature shifts, the way it genuinely does between a dental
 * operatory and a tanning room. */
/** Dark anodised aluminium shadow-gap skirting. Metalness 1 (it is metal),
 * but dark and matte enough that it reads as a recessed profile rather than
 * as a chrome strip mirroring the environment down the whole hall. */
const SKIRTING = {
  color: '#4c4a4d',
  roughness: 0.45,
  metalness: 1,
  envMapIntensity: 0.55,
}

/**
 * The planter's leaves.
 *
 * These were cones — four-sided ones — and a cone is the single most
 * recognisable "this is a 3D model" shape there is, sitting in the opening
 * frame of the whole walkthrough. The replacement is a blade: a pointed oval
 * extruded thin with a bevelled edge, standing up out of the soil the way an
 * architectural sansevieria does. Straight blades are the honest choice here —
 * that genus really does grow in stiff upright leaves, so nothing has to be
 * faked with bending, and the realism comes from the silhouette and from each
 * blade catching a different highlight along its bevel.
 *
 * Eleven of them rather than twenty-two: fewer, larger, better-shaped leaves
 * read as a plant, while a dense spray of small ones reads as a texture.
 */
const FOLIAGE = Array.from({ length: 11 }, (_, i) => {
  const a = i * 2.399963 // golden angle, so nothing lines up
  const t = i / 10
  return {
    len: 0.3 + ((i * 7) % 5) * 0.04,
    wid: 0.03 + ((i * 5) % 3) * 0.006,
    yaw: a,
    /** Lean out from vertical — the outer blades fall away further. */
    tilt: 0.1 + t * 0.36,
    /** A little roll, so no two blades present the same face to the light. */
    roll: ((i * 11) % 7) * 0.09 - 0.27,
  }
})

/** One leaf blade, in the XY plane and thin in Z. The bevel is the point of
 * building it as an extrusion rather than a plane: it gives the leaf a real
 * edge, and a lit edge is what separates a leaf from a cut-out. */
function leafGeometry(len: number, wid: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.bezierCurveTo(wid * 1.05, len * 0.16, wid * 0.8, len * 0.7, 0, len)
  s.bezierCurveTo(-wid * 0.8, len * 0.7, -wid * 1.05, len * 0.16, 0, 0)
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.0025,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.003,
    bevelSegments: 1,
    curveSegments: 6,
  })
  g.computeVertexNormals()
  return g
}

const ROOM_LIGHT: Record<string, { color: string; intensity: number }> = {
  dentistry: { color: '#f6f6f2', intensity: 7.6 },
  dermatology: { color: '#f4f4f0', intensity: 7.0 },
  skincare: { color: '#ffe8d2', intensity: 6.2 },
  solarium: { color: '#ffd9ae', intensity: 5.4 },
  laser: { color: '#f2f3f2', intensity: 6.8 },
}

/** Restrained signage: the department name on a small brushed plate beside
 * each door, at the height a real wayfinding plate is fixed. */
const ROOM_SIGN: Record<string, string> = {
  dentistry: 'طب الأسنان',
  dermatology: 'الجلدية',
  skincare: 'العناية بالبشرة',
  solarium: 'السولاريوم',
  laser: 'الليزر',
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
 * Turn 6 made this read as architecture. What this pass adds is the physical
 * evidence a camera records and a renderer does not volunteer: stone with
 * slab-to-slab tonal variation and a real grout recess, plaster with a tooth,
 * a floor whose polish breaks up instead of behaving like a mirror, and —
 * most importantly — occlusion in every corner and under every object. A
 * clean plane meeting another clean plane at exactly 90° with no darkening
 * between them is the most reliable single tell that an interior was modelled
 * rather than photographed, and this fixes it everywhere it occurs.
 */
export function ClinicEnvironment({ lowPower, mobile }: { lowPower: boolean; mobile: boolean }) {
  // Stable array identity: the pool derives per-frame scratch state from it.
  const practicalFixtures = useMemo<LightFixture[]>(
    () => [
      ...STATIONS.map((s) => ({
        key: s.id,
        position: [roomCenterX(s), CORRIDOR.ceilingY - 0.9, s.z] as [number, number, number],
        color: ROOM_LIGHT[s.id].color,
        intensity: ROOM_LIGHT[s.id].intensity * (lowPower ? 0.95 : 0.34),
        distance: 9,
      })),
      // Tight and close: a picture light grazing the plaque, not a room light.
      // Its short throw is what leaves the wall around it falling away into
      // shadow instead of flattening the whole frame.
      {
        key: 'finale-plaque',
        position: [0, 0.7, CORRIDOR.zEnd + 0.5] as [number, number, number],
        color: '#ffe2c6',
        intensity: 0.85,
        distance: 3.0,
      },
    ],
    [lowPower],
  )

  // Declared before the first map is requested: the whole texture library is
  // generated synchronously on first mount (~420 ms at full size on a laptop,
  // ~120 ms at half), so the quality decision has to be made before anything
  // is memoised. Narrow viewports take the reduced path too, not just the
  // formally "low power" ones — a phone that happens to report eight cores
  // still cannot afford a half-second of blocked main thread before its first
  // frame, and at that pixel ratio the extra resolution is invisible anyway.
  configureProceduralQuality(lowPower || mobile)
  const glow = getGlowTexture()
  const mats = useMemo(() => makeClinicMaterials(lowPower), [lowPower])

  // Every map set is tiled to its real physical size, so a 1.2 m stone slab is
  // 1.2 m whether it is under the camera at reception or 30 m down the hall.
  const corridorFloor = useMemo(
    () => tiled(getFloorMaps(), FLOOR_W / TILE.floor, FLOOR_L / TILE.floor),
    [],
  )
  const roomFloor = useMemo(
    () => tiled(getFloorMaps(), ROOM.depth / TILE.floor, (ROOM.halfWidth * 2) / TILE.floor),
    [],
  )
  const corridorWall = useMemo(() => tiled(getWallMaps(), FLOOR_L / TILE.wall, ROOM_HEIGHT / TILE.wall), [])
  const roomWall = useMemo(() => tiled(getWallMaps(), (ROOM.halfWidth * 2) / TILE.wall, ROOM_HEIGHT / TILE.wall), [])
  const roomSideWall = useMemo(() => tiled(getWallMaps(), ROOM.depth / TILE.wall, ROOM_HEIGHT / TILE.wall), [])
  const ceiling = useMemo(() => tiled(getWallMaps(), FLOOR_W / 3, FLOOR_L / 3), [])
  const finaleStone = useMemo(() => tiled(getStoneMaps(), FLOOR_W / TILE.stone, ROOM_HEIGHT / TILE.stone), [])

  // Each solid stretch of wall between two doorways is a different length, so
  // each needs its own repeat or the plaster stretches differently on every
  // one of them. Built once here rather than per render — a texture clone
  // allocated inside JSX is a texture clone leaked on every re-render.
  const segmentsBySide = useMemo(() => {
    const withMaps = (stations: Station[]) =>
      wallSegments(stations).map((seg) => ({
        ...seg,
        maps: tiled(getWallMaps(), seg.len / TILE.wall, ROOM_HEIGHT / TILE.wall),
      }))
    return {
      left: withMaps(STATIONS.filter((s) => s.side === 'left')),
      right: withMaps(STATIONS.filter((s) => s.side === 'right')),
    }
  }, [])

  return (
    <group>
      {/* ── Corridor shell ───────────────────────────────────────── */}
      {/* Polished large-format porcelain.

          This floor used to carry a real planar reflection (drei's
          `MeshReflectorMaterial`) on desktop, on the reasoning that an
          environment map cannot reflect the room's *own* architecture back at
          the viewer, and a corridor floor that never carries the doorways and
          the ceiling channel does not read as stone.

          The reasoning was right; the price was not. A planar reflection is a
          second full pass over the corridor every frame, and this corridor is
          seven hundred draw calls across eighty distinct shader programs.
          Measured on the production build against a real GPU (AMD Radeon,
          D3D11/ANGLE), that second pass cost:

            cold load   62.6 s of blocked main thread  ->  18.3 s without it
            longtasks   529                            ->  8
            median frame 54.4 ms                       ->  18.2 ms
            walk p99    473 ms                         ->  146 ms

          Forty-four seconds of frozen tab, on the first screen a patient sees
          after logging in, is not a trade a floor finish gets to make. The
          reflection is gone on every device.

          What replaces it is not the old low-power fallback unchanged: with
          the planar pass removed the floor has to earn its polish from the
          environment alone, so it is smoother and takes more of the
          environment than the fallback did. `RoomEnvironment` is an interior
          lightbox, so what a low-roughness floor picks up from it is a broad
          soft sheen and the bright ceiling band overhead — which is most of
          what the blurred planar reflection was actually contributing at this
          strength. What is genuinely lost is the doorways: the floor no longer
          carries them. That is a real loss, and it is worth it. */}
      {/* Receives, but never casts: it is the plane everything else stands on.
          Until this pass the corridor floor was outside the shadow system
          entirely, so the reception furniture and the columns had grounding
          decals underneath them and nothing beside them — the giveaway that
          the contact shadows were painted rather than thrown. */}
      <mesh position={[0, CORRIDOR.floorY, CORRIDOR_CENTER_Z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_W, FLOOR_L]} />
        <meshStandardMaterial
          {...corridorFloor}
          color="#cfc6b8"
          roughness={lowPower || mobile ? 0.42 : 0.3}
          metalness={0}
          envMapIntensity={lowPower || mobile ? 0.7 : 1.05}
        />
      </mesh>
      {/* The structural soffit. Everything below is suspended off it, so this
          plane is only ever seen through the shadow gaps — which is exactly
          what makes those gaps read as depth rather than as drawn lines. */}
      <mesh position={[0, CORRIDOR.ceilingY, CORRIDOR_CENTER_Z]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[FLOOR_W, FLOOR_L]} />
        <meshStandardMaterial {...ceiling} color="#3d372f" roughness={0.95} metalness={0} envMapIntensity={0.3} />
      </mesh>
      {/* ── Suspended ceiling rafts ──────────────────────────────────
          A flat plane overhead was the largest untouched surface left in the
          building, and it is the one a person walking a corridor sees most of.
          Real clinical corridors of this class are not built that way: the
          plasterboard is dropped as rafts that stop short of both the walls
          and the central light slot, leaving a shadow gap on either side. That
          detail does three things at once — it gives the ceiling a visible
          thickness, it puts two more continuous horizontals down the length of
          the hall to sit alongside the wall rail, and the gap at the wall is
          where the concealed cove sits. */}
      {[-1, 1].map((sx) => (
        <Panel
          key={`raft${sx}`}
          size={[RAFT_W, 0.1, FLOOR_L - 0.4]}
          radius={0.01}
          position={[sx * RAFT_CX, CORRIDOR.ceilingY - 0.05, CORRIDOR_CENTER_Z]}
          material={{ color: '#4a443c', roughness: 0.92, metalness: 0, envMapIntensity: 0.3 }}
        />
      ))}
      {/* Concealed cove in the perimeter gap. This is the single cheapest
          source of believable indirect light in the scene: a real cove is not
          seen directly, it is inferred from the wash it throws up the wall and
          across the soffit, and an emissive strip tucked into the gap reads as
          exactly that at no per-material cost — unlike another point light,
          which every physical material in the building would have to carry. */}
      {[-1, 1].map((sx) => (
        <mesh key={`cove${sx}`} position={[sx * 3.86, CORRIDOR.ceilingY - 0.04, CORRIDOR_CENTER_Z]}>
          <boxGeometry args={[0.05, 0.014, FLOOR_L - 0.6]} />
          <meshStandardMaterial
            color="#fff3e4"
            emissive="#ffe6c8"
            emissiveIntensity={0.85}
            roughness={0.6}
            toneMapped={false}
          />
        </mesh>
      ))}
      {/* Linear slot diffusers. Every conditioned room needs supply and return,
          and a ceiling with no way to move air is a quiet tell. Kept to a slot
          per bay and set flush into the raft, so the ceiling stays minimal. */}
      {HVAC_Z.map((z) =>
        [-1, 1].map((sx) => (
          <mesh
            key={`hv${sx}${z}`}
            position={[sx * RAFT_CX, CORRIDOR.ceilingY - 0.101, z]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[0.62, 0.085]} />
            <meshStandardMaterial color="#17161a" roughness={0.9} metalness={0} envMapIntensity={0.1} />
          </mesh>
        )),
      )}

      {/* Side walls, broken by the department doorways, with a lintel over each */}
      {(['left', 'right'] as const).map((side) => {
        const dir = side === 'left' ? -1 : 1
        const facing: 1 | -1 = dir > 0 ? -1 : 1
        return (
          <group key={side}>
            {segmentsBySide[side].map((seg) => (
              <group key={seg.z}>
                <mesh
                  position={[dir * CORRIDOR.halfWidth, (CORRIDOR.floorY + CORRIDOR.ceilingY) / 2, seg.z]}
                  rotation={[0, dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
                  receiveShadow
                >
                  <planeGeometry args={[seg.len, ROOM_HEIGHT]} />
                  <meshStandardMaterial
                    {...seg.maps}
                    color="#7b736a"
                    roughness={0.78}
                    metalness={0}
                    envMapIntensity={0.35}
                  />
                </mesh>
                {/* Skirting: a real aluminium shadow-gap profile rather than a
                    painted stripe, and the wall/floor occlusion that goes with
                    it. Between them the corner stops being two planes. */}
                <Panel
                  size={[0.026, BASEBOARD_H, seg.len]}
                  radius={0.004}
                  position={[dir * (CORRIDOR.halfWidth - 0.014), CORRIDOR.floorY + BASEBOARD_H / 2, seg.z]}
                  material={SKIRTING}
                />
                <CornerAo
                  length={seg.len}
                  floorY={CORRIDOR.floorY + BASEBOARD_H}
                  wallX={dir * CORRIDOR.halfWidth}
                  facing={facing}
                  z={seg.z}
                  opacity={0.6}
                />
                {/* Wall protection rail at a 900 mm datum.
                    Every clinical corridor in the world has one — trolleys and
                    beds are pushed down it all day — so its absence is quietly
                    wrong, and its presence does something no amount of plaster
                    texture can: it puts a single continuous horizontal line at
                    a constant height down the whole hall. That line is most of
                    what tells a viewer the walls are built rather than
                    extruded, and it gives the flat plaster field above and
                    below it a scale to be read against. */}
                <Panel
                  size={[0.022, 0.075, seg.len - 0.06]}
                  radius={0.008}
                  position={[dir * (CORRIDOR.halfWidth - 0.011), CORRIDOR.floorY + 0.9, seg.z]}
                  material={{ ...mats.shellDark, color: '#43403c', roughness: 0.66, clearcoat: 0 }}
                />
                {/* The shade the rail throws on the plaster just under it. */}
                <AoStrip
                  length={seg.len - 0.06}
                  reach={0.14}
                  position={[dir * (CORRIDOR.halfWidth - 0.004), CORRIDOR.floorY + 0.855, seg.z]}
                  rotation={[0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
                  opacity={0.32}
                />
                {/* The cove's wash down the top of the wall. This junction used
                    to carry an occlusion strip, which was right when the
                    ceiling met the wall directly — but there is a lit shadow
                    gap up there now, and a corner with a light source in it is
                    the brightest part of the wall, not the darkest. Swapping
                    the sign of this one term is what makes the cove read as
                    illuminating something rather than as a glowing line. */}
                <LightWash
                  length={seg.len}
                  reach={0.62}
                  position={[dir * (CORRIDOR.halfWidth - 0.012), CORRIDOR.ceilingY - 0.31, seg.z]}
                  rotation={[Math.PI, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
                  color="#ffe4c4"
                  intensity={0.5}
                />
              </group>
            ))}
            {STATIONS.filter((s) => s.side === side).map((s) => (
              <mesh
                key={s.id}
                position={[dir * CORRIDOR.halfWidth, (HEAD_Y + CORRIDOR.ceilingY) / 2, s.z]}
                rotation={[0, dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
              >
                <planeGeometry args={[ROOM.openingHalfWidth * 2, CORRIDOR.ceilingY - HEAD_Y]} />
                <meshStandardMaterial
                  {...corridorWall}
                  color="#7b736a"
                  roughness={0.78}
                  metalness={0}
                  envMapIntensity={0.35}
                />
              </mesh>
            ))}
          </group>
        )
      })}

      {/* Recessed ceiling light channel running the length of the hall.
          Modelled as a real slot: a dark reveal, the diffuser inside it, and a
          shadow gap at each cheek — so the light in the scene has a visible
          physical source rather than arriving from nowhere. */}
      <mesh position={[0, CORRIDOR.ceilingY - 0.005, CORRIDOR_CENTER_Z]}>
        <boxGeometry args={[0.5, 0.03, CORRIDOR_LENGTH + 2]} />
        <meshStandardMaterial color="#1b1920" roughness={0.9} metalness={0} />
      </mesh>
      <mesh position={[0, CORRIDOR.ceilingY - 0.016, CORRIDOR_CENTER_Z]}>
        <boxGeometry args={[0.15, 0.012, CORRIDOR_LENGTH + 1.8]} />
        <meshStandardMaterial
          color="#fff6ee"
          emissive="#ffeedd"
          emissiveIntensity={0.75}
          roughness={0.55}
          toneMapped={false}
        />
      </mesh>
      {[-0.09, 0.09].map((x) => (
        <mesh key={x} position={[x, CORRIDOR.ceilingY - 0.012, CORRIDOR_CENTER_Z]}>
          <boxGeometry args={[0.012, 0.022, CORRIDOR_LENGTH + 1.9]} />
          <meshStandardMaterial color="#26242c" roughness={0.7} metalness={0} />
        </mesh>
      ))}

      {/* ── Finale wall ──────────────────────────────────────────── */}
      {/* Book-matched engineered stone, matte. A lacquered finish here mirrored
          the environment's softbox straight across the logo shot as a large
          bright fan; stone does not do that. */}
      <mesh position={[0, (CORRIDOR.floorY + CORRIDOR.ceilingY) / 2, CORRIDOR.zEnd - 0.05]} receiveShadow>
        <planeGeometry args={[FLOOR_W, ROOM_HEIGHT]} />
        <meshStandardMaterial
          {...finaleStone}
          color="#6a635b"
          roughness={0.72}
          metalness={0}
          envMapIntensity={0.35}
        />
      </mesh>
      {/* The logo is mounted on a raised stone plaque with a shadow gap behind
          it, and lit by a concealed strip above — so it is a physical object
          fixed to a wall, not a texture floating in front of one. */}
      <Panel
        size={[3.05, 1.3, 0.05]}
        radius={0.008}
        position={[0, 0.16, CORRIDOR.zEnd + 0.02]}
        material={{ ...mats.stone, color: '#8e857a', roughness: 0.68, envMapIntensity: 0.5 }}
      />
      {/* Shadow gap: the plaque stands 50 mm proud, so the wall immediately
          below its bottom edge is in shade. Rotated a half turn so the dark
          end of the gradient lands against the plaque, not away from it. */}
      <AoStrip
        length={3.05}
        reach={0.13}
        position={[0, -0.555, CORRIDOR.zEnd - 0.02]}
        rotation={[0, 0, Math.PI]}
        opacity={0.42}
      />
      {/* Concealed grazing light above the plaque */}
      <mesh position={[0, 0.9, CORRIDOR.zEnd + 0.03]}>
        <boxGeometry args={[3.05, 0.03, 0.09]} />
        <meshStandardMaterial color="#2a2830" roughness={0.8} metalness={0} />
      </mesh>
      <mesh position={[0, 0.888, CORRIDOR.zEnd + 0.055]}>
        <boxGeometry args={[2.85, 0.012, 0.03]} />
        <meshStandardMaterial
          color="#fff4e6"
          emissive="#ffe6cd"
          emissiveIntensity={0.9}
          roughness={0.6}
          toneMapped={false}
        />
      </mesh>
      {/* The graze itself. A picture light is read from the gradient it lays
          down the face it lights, and the point light alone was producing a
          soft pool rather than the strong top-down falloff a concealed strip
          actually gives. */}
      <LightWash
        length={2.9}
        reach={0.95}
        position={[0, 0.32, CORRIDOR.zEnd + 0.075]}
        rotation={[0, 0, Math.PI]}
        color="#ffe2c0"
        intensity={0.2}
      />
      {/* Tight and close: this is a picture light grazing a plaque, not a
          room light. Its short throw is what leaves the wall around it
          falling away into shadow instead of flattening the whole frame. */}
      {/* Finale skirting, and the wall/floor corner occlusion that closes the
          end of the hall. Without it the floor appears to slide under a wall
          that is not quite touching it. */}
      <Panel
        size={[FLOOR_W, BASEBOARD_H, 0.026]}
        radius={0.004}
        position={[0, CORRIDOR.floorY + BASEBOARD_H / 2, CORRIDOR.zEnd + 0.014]}
        material={SKIRTING}
      />
      <AoStrip
        length={FLOOR_W}
        reach={0.32}
        position={[0, CORRIDOR.floorY + BASEBOARD_H + 0.16, CORRIDOR.zEnd + 0.03]}
        opacity={0.55}
      />
      <AoStrip
        length={FLOOR_W}
        reach={0.32}
        position={[0, CORRIDOR.floorY + 0.005, CORRIDOR.zEnd + 0.19]}
        rotation={[-Math.PI / 2, 0, Math.PI]}
        opacity={0.45}
      />

      {/* ── Reception ────────────────────────────────────────────── */}
      {/* Tagged for shadowing like a treatment room: the counter, the lounge
          chairs and the planter are the only furniture the patient sees before
          the first doorway, and they are what the opening frame is judged on. */}
      <ShadowTag>
        <ReceptionArea mats={mats} lowPower={lowPower} />
      </ShadowTag>

      {/* Corridor rhythm columns. Paired against the walls rather than down
          the centreline — a column on the camera's own forward axis parks a
          black bar through the middle of every shot in the walkthrough. */}
      <ShadowTag>
        {STATIONS.slice(0, -1).map((s, i) => {
          const midZ = (s.z + STATIONS[i + 1].z) / 2
          return [-1, 1].map((side) => (
            <group key={`${s.id}${side}`}>
              <Panel
                size={[0.3, ROOM_HEIGHT, 0.3]}
                radius={0.014}
                position={[side * (CORRIDOR.halfWidth - 0.34), CORRIDOR.floorY + ROOM_HEIGHT / 2, midZ]}
                material={{ ...mats.stone, color: '#8b8177', roughness: 0.55 }}
              />
              {/* A column that runs from slab to slab in one unbroken extrusion
                  is the most obvious primitive left in the corridor. Real ones
                  are clad, and the cladding stops short of both slabs behind a
                  recessed shadow gap — which is why the top and bottom of a
                  real column read as dark lines rather than as the stone simply
                  ending. The kick plate at the base is there for the same
                  reason the wall rail is: this is a corridor things get pushed
                  down. */}
              <Panel
                size={[0.322, 0.05, 0.322]}
                radius={0.006}
                position={[side * (CORRIDOR.halfWidth - 0.34), CORRIDOR.floorY + 0.025, midZ]}
                material={{ ...mats.shellDark, color: '#1e1c1a' }}
              />
              <Panel
                size={[0.318, 0.055, 0.318]}
                radius={0.005}
                position={[side * (CORRIDOR.halfWidth - 0.34), CORRIDOR.floorY + 0.082, midZ]}
                material={mats.brushedSteel}
              />
              <Panel
                size={[0.322, 0.045, 0.322]}
                radius={0.006}
                position={[side * (CORRIDOR.halfWidth - 0.34), CORRIDOR.ceilingY - 0.022, midZ]}
                material={{ ...mats.shellDark, color: '#1e1c1a' }}
              />
              <ContactShadow
                position={[side * (CORRIDOR.halfWidth - 0.34), CORRIDOR.floorY, midZ]}
                size={[0.78, 0.78]}
                opacity={0.5}
              />
            </group>
          ))
        })}
      </ShadowTag>

      {/* The building's single shadow-casting light, following the patient. */}
      <RoamingKeyLight lowPower={lowPower} />
      {/* Each treatment room's practical, plus the finale's picture light, as
          six fixtures sharing four real lights.

          A practical sits 5.8 m off the corridor centreline with a 9 m throw,
          so it is already dark past ~6.9 m of corridor travel — and the rooms
          are 4.4 m apart. Standing between two rooms, those two and their
          outer neighbours are the most that can be contributing at once; the
          pair beyond that are 11 m away and returning zero. Four is therefore
          the smallest pool that never removes a light the patient can see, and
          the finale's picture light has a 3 m throw at the far end of the hall
          where no practical reaches. */}
      <PooledPointLights fixtures={practicalFixtures} count={4} />

      {/* ── Treatment rooms ──────────────────────────────────────── */}
      {STATIONS.map((s) => {
        const dir = s.side === 'left' ? -1 : 1
        const cx = roomCenterX(s)
        const backX = dir * (CORRIDOR.halfWidth + ROOM.depth)
        const light = ROOM_LIGHT[s.id]
        const sign = getSignTexture(ROOM_SIGN[s.id])
        return (
          <group key={s.id}>
            {/* Treatment rooms are bright, light-floored clinical spaces seen
                from a deliberately dim corridor. That contrast is both how a
                real clinic reads at night and what makes each doorway play as
                a lit frame rather than another dark recess. */}
            <mesh position={[cx, CORRIDOR.floorY + 0.002, s.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[ROOM.depth, ROOM.halfWidth * 2]} />
              <meshStandardMaterial
                {...roomFloor}
                color="#f2ebde"
                roughness={0.5}
                metalness={0}
                envMapIntensity={0.7}
              />
            </mesh>
            <mesh position={[cx, CORRIDOR.ceilingY - 0.002, s.z]} rotation={[Math.PI / 2, 0, 0]}>
              <planeGeometry args={[ROOM.depth, ROOM.halfWidth * 2]} />
              <meshStandardMaterial color="#443d36" roughness={0.96} metalness={0} envMapIntensity={0.25} />
            </mesh>
            {/* The same suspended raft the corridor got. The hallway was
                rebuilt with rafts, a shadow gap and a cove, and the treatment
                rooms then read as the cheaper spaces — which is backwards, as
                these are the rooms the clinic is actually judged on and the
                ones the camera spends its time looking into. One raft dropped
                100 mm inside a 200 mm perimeter gap, with a cove down each
                long side, carries the detail across without repeating the
                corridor's central slot: a treatment room is lit from troffers
                over the chair, not from a line down the middle. */}
            <Panel
              size={[ROOM.depth - 0.4, 0.1, ROOM.halfWidth * 2 - 0.4]}
              radius={0.01}
              position={[cx, CORRIDOR.ceilingY - 0.05, s.z]}
              material={{ color: '#4f4840', roughness: 0.92, metalness: 0, envMapIntensity: 0.3 }}
            />
            {[-1, 1].map((sx) => (
              <mesh
                key={`rcove${sx}`}
                position={[cx + sx * (ROOM.depth / 2 - 0.1), CORRIDOR.ceilingY - 0.04, s.z]}
              >
                <boxGeometry args={[0.05, 0.014, ROOM.halfWidth * 2 - 0.5]} />
                <meshStandardMaterial
                  color="#fff6ec"
                  emissive={light.color}
                  emissiveIntensity={0.55}
                  roughness={0.6}
                  toneMapped={false}
                />
              </mesh>
            ))}
            {/* Back wall */}
            <mesh
              position={[backX, (CORRIDOR.floorY + CORRIDOR.ceilingY) / 2, s.z]}
              rotation={[0, dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
              receiveShadow
            >
              <planeGeometry args={[ROOM.halfWidth * 2, ROOM_HEIGHT]} />
              <meshStandardMaterial
                {...roomWall}
                color="#a89f95"
                roughness={0.8}
                metalness={0}
                envMapIntensity={0.35}
                emissive={light.color}
                emissiveIntensity={0.045}
              />
            </mesh>
            {/* Room side walls */}
            {[-1, 1].map((sz) => (
              <mesh
                key={sz}
                position={[cx, (CORRIDOR.floorY + CORRIDOR.ceilingY) / 2, s.z + sz * ROOM.halfWidth]}
                rotation={[0, sz > 0 ? Math.PI : 0, 0]}
                receiveShadow
              >
                <planeGeometry args={[ROOM.depth, ROOM_HEIGHT]} />
                <meshStandardMaterial
                  {...roomSideWall}
                  color="#a89f95"
                  roughness={0.8}
                  metalness={0}
                  envMapIntensity={0.35}
                  emissive={light.color}
                  emissiveIntensity={0.045}
                />
              </mesh>
            ))}
            {/* Room skirting and corner occlusion along the back wall */}
            <Panel
              size={[0.026, BASEBOARD_H, ROOM.halfWidth * 2]}
              radius={0.004}
              position={[backX - dir * 0.014, CORRIDOR.floorY + BASEBOARD_H / 2, s.z]}
              material={SKIRTING}
            />
            <CornerAo
              length={ROOM.halfWidth * 2}
              floorY={CORRIDOR.floorY + BASEBOARD_H}
              wallX={backX}
              facing={dir > 0 ? -1 : 1}
              z={s.z}
              opacity={0.55}
            />
            {/* Side-wall corners. CornerAo is written against a wall lying in
                the YZ plane, so the room's side walls (which lie in XY) are
                reached by rotating a quarter turn about Y: inside that frame
                world X reads off local Z and world Z off negated local X. */}
            {[-1, 1].map((sz) => (
              <group key={`ao${sz}`} rotation={[0, Math.PI / 2, 0]}>
                <CornerAo
                  length={ROOM.depth}
                  floorY={CORRIDOR.floorY + BASEBOARD_H}
                  wallX={-(s.z + sz * ROOM.halfWidth)}
                  facing={sz > 0 ? 1 : -1}
                  z={cx}
                  opacity={0.5}
                />
              </group>
            ))}

            {/* The troffers' own bounce down the room's back wall. Seen through
                the doorway this is what gives the room a bright top and a
                falling-off bottom instead of one evenly shaded plane. */}
            <LightWash
              length={ROOM.halfWidth * 2 - 0.2}
              reach={1.0}
              position={[backX - dir * 0.02, CORRIDOR.ceilingY - 0.5, s.z]}
              rotation={[Math.PI, dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
              color={light.color}
              intensity={0.34}
            />
            {/* Recessed ceiling troffers — the fixture a real treatment room has */}
            {[-0.85, 0.85].map((oz) => (
              <group key={oz}>
                <mesh position={[cx, CORRIDOR.ceilingY - 0.012, s.z + oz]}>
                  <boxGeometry args={[0.98, 0.028, 0.32]} />
                  <meshStandardMaterial color="#2c2a33" roughness={0.75} metalness={0} />
                </mesh>
                <mesh position={[cx, CORRIDOR.ceilingY - 0.028, s.z + oz]} rotation={[Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[0.9, 0.24]} />
                  <meshStandardMaterial
                    color="#fff8f0"
                    emissive="#fff4ea"
                    emissiveIntensity={0.8}
                    roughness={0.5}
                    toneMapped={false}
                  />
                </mesh>
              </group>
            ))}
            {/* One practical per room, and it is the room's only real light.
                Every additional light compiles into every physical material's
                shader in the whole building, so the emissive troffers above
                carry the *visible* fixture and this single spot carries the
                actual illumination — and, now, the room's cast shadows.

                A spot rather than a point light for two reasons: a point
                light's shadow is a cube map (six renders), a spot's is one;
                and a spot can be aimed. It is deliberately placed on the
                doorway side and aimed past the equipment, so the shadows it
                throws fall away from the viewer and onto the back wall, where
                the camera can actually see them through the opening. */}
            {/* Indirect approximation. No extra lights: the bounce is carried
                by a very slight emissive tint on the surfaces that would be
                doing the bouncing, plus soft pools of brightness on the floor
                under each troffer. Together with the corner occlusion already
                in place, that produces the bright-centre / dark-corner falloff
                a real room has, which is the actual perceptual content of
                "indirect light" at this scale. */}
            <LightPool
              cx={cx}
              z={s.z}
              color={light.color}
              lowPower={lowPower}
            />

            {/* ── Doorway: reveal lining, glazed screen, frame, handle ── */}
            <group position={[dir * CORRIDOR.halfWidth, 0, s.z]} rotation={[0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
              {/* Jamb linings, so the wall reads as having thickness */}
              {[-1, 1].map((sx) => (
                <Panel
                  key={sx}
                  size={[0.06, ROOM.openingHeight, 0.34]}
                  radius={0.006}
                  position={[sx * ROOM.openingHalfWidth, CORRIDOR.floorY + ROOM.openingHeight / 2, 0]}
                  material={{ ...mats.shellDark, color: '#26242c' }}
                />
              ))}
              <Panel
                size={[ROOM.openingHalfWidth * 2 + 0.06, 0.07, 0.34]}
                radius={0.006}
                position={[0, HEAD_Y, 0]}
                material={{ ...mats.shellDark, color: '#26242c' }}
              />
              {/* Occlusion inside the reveal — a doorway is a hole in a thick
                  wall, and the shade in the reveal is what gives it depth. */}
              <AoStrip
                length={ROOM.openingHalfWidth * 2}
                reach={0.28}
                position={[0, HEAD_Y - 0.15, 0.02]}
                rotation={[0, 0, 0]}
                opacity={0.34}
              />
              {/* A fixed glazed screen fills one side of the opening; the other
                  side is open, so the room is seen partly through glass and
                  partly directly — the mix real clinics have, and the reason
                  the reflections read as architecture rather than a filter. */}
              <mesh position={[-ROOM.openingHalfWidth + 0.42, CORRIDOR.floorY + ROOM.openingHeight / 2, 0.02]}>
                <planeGeometry args={[0.8, ROOM.openingHeight - 0.14]} />
                <ClinicMaterial {...mats.glazing} side={THREE.DoubleSide} />
              </mesh>
              {/* Outer stile and head rail. Without them the leaf is invisible
                  glass and its handle appears to hang unsupported in the
                  doorway — framing it is what makes the glass read as a door. */}
              <Panel
                size={[0.05, ROOM.openingHeight - 0.1, 0.05]}
                radius={0.006}
                position={[-ROOM.openingHalfWidth + 0.02, CORRIDOR.floorY + ROOM.openingHeight / 2, 0.02]}
                material={mats.paintedSteel}
              />
              <Panel
                size={[0.8, 0.06, 0.05]}
                radius={0.006}
                position={[-ROOM.openingHalfWidth + 0.42, CORRIDOR.floorY + ROOM.openingHeight - 0.06, 0.02]}
                material={mats.paintedSteel}
              />
              {/* The mullion sits at the edge of the glazed leaf, well off the
                  doorway's centreline — a post through the middle of the
                  opening would bisect every shot the camera composes here. */}
              <Panel
                size={[0.05, ROOM.openingHeight - 0.1, 0.05]}
                radius={0.006}
                position={[-ROOM.openingHalfWidth + 0.84, CORRIDOR.floorY + ROOM.openingHeight / 2, 0.02]}
                material={mats.paintedSteel}
              />
              <Panel
                size={[0.8, 0.1, 0.05]}
                radius={0.006}
                position={[-ROOM.openingHalfWidth + 0.42, CORRIDOR.floorY + 0.05, 0.02]}
                material={mats.brushedSteel}
              />
              <mesh position={[-ROOM.openingHalfWidth + 0.72, CORRIDOR.floorY + 1.05, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.014, 0.014, 0.34, 10]} />
                <ClinicMaterial {...mats.brushedSteel} />
              </mesh>
              {/* Room signage plate beside the door, with the department name
                  etched into it. Small and quiet: real wayfinding is.

                  Note the sign of the local Z here. This group's +Z points
                  *into the treatment room* (which is what puts the door leaf
                  and its handle correctly on the room side of the opening), so
                  anything belonging to the corridor — signage, switches,
                  access plates — has to be placed at negative Z and turned to
                  face back down the hall. Mounted the other way round they sit
                  inside the wall and are never seen at all. */}
              <group
                position={[ROOM.openingHalfWidth + 0.22, CORRIDOR.floorY + 1.5, -0.03]}
                rotation={[0, Math.PI, 0]}
              >
                <Panel size={[0.29, 0.11, 0.012]} radius={0.004} material={mats.brushedSteel} />
                {sign && (
                  <mesh position={[0, 0, 0.0072]}>
                    <planeGeometry args={[0.26, 0.088]} />
                    <meshStandardMaterial map={sign} roughness={0.42} metalness={0} envMapIntensity={0.5} />
                  </mesh>
                )}
              </group>
              {/* Light switch and a service access plate — the small fittings
                  every real corridor has and no 3D corridor ever does. */}
              <Panel
                size={[0.08, 0.08, 0.008]}
                radius={0.004}
                position={[ROOM.openingHalfWidth + 0.22, CORRIDOR.floorY + 1.16, -0.028]}
                material={{ ...mats.shell, color: '#d9d5cd' }}
              />
              <Panel
                size={[0.075, 0.045, 0.008]}
                radius={0.003}
                position={[-ROOM.openingHalfWidth - 0.26, CORRIDOR.floorY + 0.28, -0.028]}
                material={{ ...mats.shell, color: '#d9d5cd' }}
              />
            </group>

            {/* Light spilling out of the doorway onto the corridor floor */}
            <sprite position={[dir * (CORRIDOR.halfWidth - 1.0), CORRIDOR.floorY + 0.014, s.z]} scale={[2.6, 3.0, 1]}>
              <spriteMaterial map={glow} color={light.color} transparent opacity={0.07} depthWrite={false} />
            </sprite>
          </group>
        )
      })}
    </group>
  )
}

/**
 * One shadow-casting light for the whole building, which moves.
 *
 * The patient can only ever be looking into one treatment room at a time, so
 * only one room's shadows are ever visible. Rather than pay for five shadow
 * maps to have four of them off screen, a single spot snaps to whichever room
 * is nearest and re-bakes its map on arrival — five re-bakes over the length
 * of the whole walk, against five maps sampled on every pixel of every frame.
 *
 * It is placed on the doorway side of that room and aimed diagonally past the
 * equipment. That geometry is the point: a light directly overhead throws
 * shadows straight down where the grounding decals already are, and someone
 * standing in the corridor never sees them. Thrown from the doorway side, the
 * same objects lay their shapes across the back wall and the far floor, which
 * is precisely the part of the room the opening frames.
 *
 * The handover happens mid-corridor, when the camera is equidistant from two
 * rooms and roughly five metres from both — far enough down the inverse-square
 * curve that the swap is not visible.
 */
function RoamingKeyLight({ lowPower }: { lowPower: boolean }) {
  const lightRef = useRef<THREE.SpotLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  const activeRef = useRef(-1)

  useEffect(() => {
    const l = lightRef.current
    if (!l) return
    l.target = target
    l.shadow.camera.near = 0.5
    l.shadow.bias = -0.0007
    // Normal bias is what keeps a large soft shadow off the surfaces that cast
    // it. Without it a map spread over a 3.6 m room shadow-acnes across every
    // curved moulding in the scene.
    l.shadow.normalBias = 0.032
    return registerShadowLight(l)
  }, [target])

  useFrame(({ camera }) => {
    const l = lightRef.current
    if (!l) return
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < KEY_STOPS.length; i++) {
      const d = Math.abs(camera.position.z - KEY_STOPS[i].z)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best === activeRef.current) return
    activeRef.current = best
    const stop = KEY_STOPS[best]
    l.position.set(stop.position[0], stop.position[1], stop.position[2])
    target.position.set(stop.target[0], stop.target[1], stop.target[2])
    target.updateMatrixWorld()
    l.color.set(stop.color)
    // Reception is a much larger volume than a treatment room, so its stop
    // carries its own intensity and shadow-camera depth rather than inheriting
    // a room's: at 5 m an intensity tuned for a 2.5 m throw arrives at a
    // quarter of the level, and a frustum that ends at 8 m clips the planter
    // out of the map entirely.
    l.intensity = stop.intensity
    l.shadow.camera.far = stop.far
    l.shadow.camera.updateProjectionMatrix()
    requestShadowRefresh()
  })

  if (lowPower) return null
  return (
    <>
      <primitive object={target} />
      <spotLight
        ref={lightRef}
        intensity={KEY_STOPS[0].intensity}
        distance={13}
        decay={2}
        angle={1.02}
        penumbra={1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
    </>
  )
}

interface KeyStop {
  /** Where along the corridor this stop takes over, in world Z. */
  z: number
  position: [number, number, number]
  target: [number, number, number]
  color: string
  intensity: number
  /** Far plane of this stop's shadow frustum — as tight as the furthest
   * caster allows, since the map's depth precision is spread across it. */
  far: number
}

/**
 * The stops the single shadow-casting light visits, in corridor order.
 *
 * Reception comes first. It was the one furnished part of the building the
 * shadow pass never reached: the desk, the lounge chairs and the planter had
 * grounding decals underneath them and nothing else — no shape thrown across
 * the floor beside them, nothing on the wall behind. That is the opening frame
 * of the whole walkthrough, so it is the worst place in the building to be
 * missing the effect.
 *
 * Its light hangs over the middle of the lobby and aims down the room rather
 * than across it, which is the only geometry that keeps all three groups —
 * spread over about five metres of floor — inside one cone.
 */
const KEY_STOPS: KeyStop[] = [
  {
    z: CORRIDOR.zStart - 3.6,
    position: [0.6, CORRIDOR.ceilingY - 0.35, CORRIDOR.zStart - 1.6],
    target: [0, CORRIDOR.floorY, CORRIDOR.zStart - 4.0],
    color: '#f6dcc9',
    // A fifth of a room's, because the lobby already has its own warm key and
    // this is here to give that key a direction, not to relight the space.
    intensity: 14,
    far: 9,
  },
  ...STATIONS.map((st): KeyStop => {
    const dir = st.side === 'left' ? -1 : 1
    const cx = roomCenterX(st)
    return {
      z: st.z,
      position: [cx - dir * 0.6, CORRIDOR.ceilingY - 0.16, st.z - 0.75],
      target: [cx + dir * 0.55, CORRIDOR.floorY, st.z + 0.55],
      color: ROOM_LIGHT[st.id].color,
      intensity: 34,
      far: 8,
    }
  }),
]

/**
 * The indirect term, approximated without spending a single extra light.
 *
 * Real rooms are not lit only by what arrives directly from the fixture: light
 * lands on a pale floor, scatters, and comes back up under everything. The
 * perceptual signature of that is a soft pool of extra brightness on the floor
 * beneath each fixture, fading out well before the corners — which, set
 * against the corner occlusion already in the scene, gives the bright-middle /
 * dark-edge falloff that makes a room feel like a volume rather than a set of
 * evenly shaded planes.
 *
 * Rendered as unlit additive quads, tinted with the room's own colour
 * temperature so the bounce carries the room's warmth (a warm skincare room
 * bounces warm, a neutral laser room bounces neutral) rather than a single
 * global ambient colour.
 */
function LightPool({
  cx,
  z,
  color,
  lowPower,
}: {
  cx: number
  z: number
  color: string
  lowPower: boolean
}) {
  const tex = getGlowTexture()
  if (lowPower) return null
  return (
    <>
      {[-0.85, 0.85].map((oz) => (
        <sprite key={oz} position={[cx, CORRIDOR.floorY + 0.02, z + oz]} scale={[2.6, 2.6, 1]}>
          <spriteMaterial
            map={tex}
            color={color}
            transparent
            opacity={0.09}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
      {/* A second, tighter pool low on the back wall: the same bounce reaching
          the vertical surface behind the equipment. */}
      <sprite position={[cx, CORRIDOR.floorY + 0.5, z]} scale={[3.0, 1.6, 1]}>
        <spriteMaterial
          map={tex}
          color={color}
          transparent
          opacity={0.05}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </>
  )
}

/**
 * The reception: the first thing the patient sees, and the frame the whole
 * walkthrough is judged by. Built as joinery rather than as boxes — an oak
 * counter front, a stone top with a real overhang and a shadow gap under it,
 * a concealed LED reveal at the toe, and a back-lit brand panel behind.
 */
function ReceptionArea({ mats, lowPower }: { mats: ReturnType<typeof makeClinicMaterials>; lowPower: boolean }) {
  const deskZ = CORRIDOR.zStart - 3.6
  // Eleven small extrusions, built once. Allocating these inside the JSX would
  // leak a geometry per leaf on every re-render.
  const leafGeo = useMemo(() => FOLIAGE.map((l) => leafGeometry(l.len, l.wid)), [])
  return (
    <group>
      <group position={[-2.4, CORRIDOR.floorY, deskZ]} rotation={[0, 0.35, 0]}>
        {/* Counter carcass, set back from the top so the stone overhangs */}
        <Panel size={[1.7, 0.62, 0.46]} radius={0.008} position={[0, 0.34, 0]} material={mats.wood} />
        {/* Recessed toe kick — the shadow under a counter is what gives it
            weight and stops it looking like a slab resting on the floor. */}
        <Panel
          size={[1.62, 0.09, 0.4]}
          radius={0.004}
          position={[0, 0.045, 0]}
          material={{ ...mats.shellDark, color: '#1a1920' }}
        />
        <Panel
          size={[1.78, 0.045, 0.58]}
          radius={0.006}
          position={[0, 0.685, 0]}
          material={{ ...mats.stone, color: '#b3ab9f', roughness: 0.32 }}
        />
        {/* Concealed reveal light under the counter lip */}
        <mesh position={[0, 0.115, 0.235]}>
          <boxGeometry args={[1.5, 0.014, 0.008]} />
          <meshStandardMaterial
            color="#f0d0c2"
            emissive="#e9b2a8"
            emissiveIntensity={0.55}
            roughness={0.5}
            toneMapped={false}
          />
        </mesh>
        {/* Monitor on a real stand, angled to the receptionist */}
        <group position={[0.42, 0.71, -0.04]} rotation={[0, -0.45, 0]}>
          <Panel size={[0.2, 0.012, 0.14]} radius={0.004} material={mats.shellDark} />
          <mesh position={[0, 0.075, -0.02]}>
            <cylinderGeometry args={[0.016, 0.022, 0.14, 10]} />
            <ClinicMaterial {...mats.shellDark} />
          </mesh>
          <group position={[0, 0.26, -0.02]} rotation={[0.1, 0, 0]}>
            <Panel size={[0.42, 0.27, 0.016]} radius={0.006} material={mats.shellDark} />
            <mesh position={[0, 0, 0.0095]}>
              <planeGeometry args={[0.39, 0.24]} />
              <ClinicMaterial {...mats.screenGlass} emissive="#7fa8c4" emissiveIntensity={0.22} />
            </mesh>
          </group>
        </group>
        {/* Keyboard, so the desk reads as worked at rather than styled */}
        <Panel
          size={[0.34, 0.014, 0.12]}
          radius={0.004}
          position={[0.36, 0.715, 0.16]}
          rotation={[0, -0.4, 0]}
          material={{ ...mats.shellDark, color: '#232128' }}
        />
        {/* Two patches rather than one wide pool: a counter's own footprint is
            a hard, dark line under the recessed toe kick, and the softer halo
            reaching out past it is only the ambient occlusion of the mass
            above. Merging them into a single ellipse is what made the desk
            read as sitting in a painted shadow. */}
        <ContactShadow position={[0, 0, 0]} size={[2.15, 0.95]} opacity={0.3} />
        <ContactShadow position={[0, 0, 0]} size={[1.68, 0.5]} opacity={0.6} />
      </group>

      {/* Waiting seating: a pair of low lounge chairs on real legs */}
      <group position={[2.5, CORRIDOR.floorY, CORRIDOR.zStart - 3.2]} rotation={[0, -0.5, 0]}>
        {[0, 0.72].map((z) => (
          <group key={z} position={[0, 0, z]}>
            {([
              [-0.2, -0.18],
              [0.2, -0.18],
              [-0.2, 0.18],
              [0.2, 0.18],
            ] as const).map(([x, lz], i) => (
              <mesh key={i} position={[x, 0.16, lz]}>
                <cylinderGeometry args={[0.014, 0.017, 0.32, 8]} />
                <ClinicMaterial {...mats.brushedSteel} />
              </mesh>
            ))}
            <Panel size={[0.52, 0.11, 0.48]} radius={0.045} position={[0, 0.38, 0]} material={mats.upholsteryLight} />
            <Panel
              size={[0.52, 0.42, 0.1]}
              radius={0.04}
              position={[0, 0.6, -0.2]}
              rotation={[-0.16, 0, 0]}
              material={mats.upholsteryLight}
            />
            <ContactShadow position={[0, 0, 0]} size={[0.85, 0.8]} opacity={0.42} />
          </group>
        ))}
      </group>

      {/* Planter — a real vessel with soil, not floating cones */}
      <group position={[-3.5, CORRIDOR.floorY, CORRIDOR.zStart - 5.0]}>
        <mesh position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.14, 0.17, 0.36, lowPower ? 10 : 18]} />
          <ClinicMaterial {...mats.stone} color="#6e675e" />
        </mesh>
        <mesh position={[0, 0.355, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.132, lowPower ? 10 : 18]} />
          <meshStandardMaterial color="#241f19" roughness={0.98} metalness={0} />
        </mesh>
        {FOLIAGE.map((leaf, i) => (
          <group key={i} rotation={[0, leaf.yaw, 0]}>
            <group position={[0, 0.355, 0]} rotation={[leaf.tilt, 0, leaf.roll]}>
              <mesh geometry={leafGeo[i]}>
                {/* Leaves are rough, quite dark, and pass a little light at
                    their edges. The emissive term is standing in for that
                    transmission: a real leaf lit from behind is never as dark
                    as an opaque surface of the same colour, and without it
                    foliage reads as painted plastic however good its
                    silhouette is. */}
                <meshStandardMaterial
                  color={i % 3 === 0 ? '#3a5a33' : i % 3 === 1 ? '#26412a' : '#44643d'}
                  roughness={0.72}
                  metalness={0}
                  envMapIntensity={0.35}
                  emissive="#1e3a1c"
                  emissiveIntensity={0.3}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </group>
          </group>
        ))}
        <ContactShadow position={[0, 0, 0]} size={[0.7, 0.7]} opacity={0.55} />
      </group>
    </group>
  )
}
