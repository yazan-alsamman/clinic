import { useMemo } from 'react'
import * as THREE from 'three'

type Vec3 = [number, number, number]

/**
 * Grounding: contact shadows and ambient occlusion, done as decals.
 *
 * This is the single highest-value realism change available here, and it is
 * almost entirely about one perceptual fact: a viewer decides whether an
 * object is *standing on* a surface or *floating above* it from the darkening
 * in the last few centimetres before they meet. Without it, a perfectly
 * modelled 300 kg laser console reads as a sticker; with it, a plain box reads
 * as furniture.
 *
 * These are decals rather than real shadow maps on purpose. The scene carries
 * a dozen point lights (corridor fill, five room practicals, the operating
 * lamp, the moving headlight), and shadow-mapping even a few of them means
 * re-rendering the whole corridor once per light per frame — the exact class
 * of cost that locked the renderer in an earlier pass. A decal costs one
 * unlit, depth-write-free draw call and is *stable*, which matters more here
 * than physical derivation: the scene is static, so a baked-looking shadow is
 * indistinguishable from a computed one, and it cannot flicker.
 *
 * ── Why the falloff is geometry and not a texture ──
 *
 * The obvious implementation is a quad with a soft radial alpha texture. That
 * was tried first and renders as nothing at all on the verified target: every
 * route that varies alpha *per fragment* — an RGBA texture's alpha channel,
 * `alphaMap`, and a 4-component vertex-colour attribute — came out fully
 * transparent, while the same material with a flat `opacity` and the same
 * textures' RGB channels drew correctly. Rather than ship a decal that
 * silently disappears on some machines, the falloff is built out of stacked
 * coplanar rings that each carry a *uniform* opacity: overlapping rings
 * accumulate through ordinary alpha blending, so N rings produce an N-step
 * gradient using only the one blending behaviour that is known to work here.
 * It is a handful of extra triangles in a single draw call, and it cannot
 * fail quietly.
 */

/** Rings per decal. Twelve is where the banding stops being readable on the
 * worst case in the scene — a two-metre reception-desk shadow passed within
 * arm's reach of the camera — and it is still only a few hundred triangles in
 * a single draw call. */
const STEPS = 12
const SEGMENTS = 20

/** Cumulative alpha of N stacked layers is 1-(1-a)^N, so a single layer needs
 * this much to reach the requested peak darkness. */
function layerOpacity(peak: number): number {
  return 1 - Math.pow(1 - Math.min(0.98, Math.max(0, peak)), 1 / STEPS)
}

/**
 * A unit-diameter stack of concentric discs in the XY plane, largest first.
 * Radii are spaced with an exponent below 1 so the discs bunch toward the
 * centre — that is what turns a linear step ramp into something closer to the
 * tight, fast-falling core a real contact shadow has.
 */
function stackedDiscGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  for (let s = 0; s < STEPS; s++) {
    const r = 0.5 * Math.pow((STEPS - s) / STEPS, 0.7)
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = (i / SEGMENTS) * Math.PI * 2
      const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2
      pos.push(0, 0, 0)
      pos.push(Math.cos(a0) * r, Math.sin(a0) * r, 0)
      pos.push(Math.cos(a1) * r, Math.sin(a1) * r, 0)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/**
 * A unit strip in the XY plane, spanning −0.5..0.5 on both axes, built from
 * stacked rectangles that all share the bottom edge and reach progressively
 * less far up. The result is a one-sided gradient: darkest at y = −0.5,
 * gone by y = +0.5.
 */
function stackedStripGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  for (let s = 0; s < STEPS; s++) {
    const top = -0.5 + Math.pow((STEPS - s) / STEPS, 1.35)
    pos.push(-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, top, 0)
    pos.push(-0.5, -0.5, 0, 0.5, top, 0, -0.5, top, 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

let discGeo: THREE.BufferGeometry | null = null
let stripGeo: THREE.BufferGeometry | null = null
function getDiscGeo(): THREE.BufferGeometry {
  if (!discGeo) discGeo = stackedDiscGeometry()
  return discGeo
}
function getStripGeo(): THREE.BufferGeometry {
  if (!stripGeo) stripGeo = stackedStripGeometry()
  return stripGeo
}

interface ContactShadowProps {
  /** Centre of the shadow, in the parent's local space. Y is the floor. */
  position?: Vec3
  /** Footprint [x, z] in metres — roughly the object's plan dimensions plus
   * the soft penumbra, so a little larger than the object itself. */
  size: [number, number]
  /** Yaw, for objects that do not sit square to the room. */
  rotation?: number
  /** Peak darkness at the centre. Heavy objects sit low and dark; a stool on
   * five thin legs barely occludes anything and should stay faint. */
  opacity?: number
  /** Lift above the floor plane. The default clears the treatment rooms'
   * 2 mm floor offset without becoming visible as a floating sheet. */
  lift?: number
}

/** The soft pool of occlusion directly beneath an object. */
export function ContactShadow({
  position = [0, 0, 0],
  size,
  rotation = 0,
  opacity = 0.55,
  lift = 0.006,
}: ContactShadowProps) {
  const geo = getDiscGeo()
  const layer = useMemo(() => layerOpacity(opacity), [opacity])
  return (
    <mesh
      geometry={geo}
      position={[position[0], position[1] + lift, position[2]]}
      rotation={[-Math.PI / 2, 0, rotation]}
      scale={[size[0], size[1], 1]}
      renderOrder={2}
    >
      <meshBasicMaterial
        color="#05050a"
        transparent
        opacity={layer}
        depthWrite={false}
        toneMapped={false}
        fog={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

interface CasterShadowsProps {
  /** [x, z] positions of each wheel/foot in the parent's local space. */
  points: readonly (readonly [number, number])[]
  y?: number
  radius?: number
  opacity?: number
}

/** Tight, dark pools under individual wheels and feet. A wheeled console does
 * not sit in one broad shadow — it makes four small ones, and that difference
 * is most of what communicates "this rolls" versus "this is a block". */
export function CasterShadows({ points, y = 0, radius = 0.13, opacity = 0.6 }: CasterShadowsProps) {
  return (
    <>
      {points.map(([x, z], i) => (
        <ContactShadow key={i} position={[x, y, z]} size={[radius * 2, radius * 2]} opacity={opacity} lift={0.005} />
      ))}
    </>
  )
}

interface AoStripProps {
  /** Length of the run, along the strip's local X. */
  length: number
  /** How far the occlusion reaches up the wall / out across the floor. */
  reach?: number
  position?: Vec3
  rotation?: Vec3
  opacity?: number
}

/**
 * The gradient that lives in a concave corner. Used two ways: standing up
 * against a wall where it meets the floor, and lying on the floor where it
 * runs into a wall. Together they close the corner — two clean planes meeting
 * at exactly 90° with no darkening between them is one of the most reliable
 * tells that an interior was modelled rather than photographed.
 *
 * The strip's dark edge is its local −Y, so callers orient it by rotation.
 */
export function AoStrip({ length, reach = 0.32, position, rotation, opacity = 0.6 }: AoStripProps) {
  const geo = getStripGeo()
  const layer = useMemo(() => layerOpacity(opacity), [opacity])
  return (
    <mesh
      geometry={geo}
      position={position}
      rotation={rotation}
      scale={[length, reach, 1]}
      renderOrder={1}
    >
      <meshBasicMaterial
        color="#05050a"
        transparent
        opacity={layer}
        depthWrite={false}
        toneMapped={false}
        fog={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

interface LightWashProps {
  /** Length of the run, along the strip's local X. */
  length: number
  /** How far the wash reaches away from the source. */
  reach?: number
  position?: Vec3
  rotation?: Vec3
  color?: string
  /** Peak added brightness at the strip's local −Y edge. */
  intensity?: number
}

/**
 * The inverse of `AoStrip`: the band of light a concealed source throws across
 * the surface beside it.
 *
 * Every darkening term in this file exists because a renderer does not
 * volunteer occlusion. The same is true in the other direction — it does not
 * volunteer *bounce* either. A cove tucked into a ceiling shadow gap is never
 * seen directly; what a viewer actually reads is the bright band it lays along
 * the top of the wall, falling away downward. Without that band the cove is
 * just a bright line with no consequence, which is precisely how CG lighting
 * announces itself.
 *
 * Real indirect light here would mean either a global-illumination solution or
 * a ring of extra lights, and both were ruled out on cost: every additional
 * light compiles into every physical material in the building. This is the
 * same stacked-strip geometry the occlusion uses, blended additively instead
 * of over — one unlit, depth-write-free draw call for a term that would
 * otherwise cost a light.
 *
 * The bright edge is local −Y, matching `AoStrip`'s dark edge, so the two are
 * oriented by callers the same way.
 */
export function LightWash({
  length,
  reach = 0.5,
  position,
  rotation,
  color = '#ffe6c8',
  intensity = 0.4,
}: LightWashProps) {
  const geo = getStripGeo()
  // Additive layers accumulate linearly, so each carries its equal share.
  const layer = useMemo(() => Math.max(0, intensity) / STEPS, [intensity])
  return (
    <mesh geometry={geo} position={position} rotation={rotation} scale={[length, reach, 1]} renderOrder={1}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={layer}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
        fog={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

interface CornerAoProps {
  /** Length of the wall run. */
  length: number
  /** Floor height in the parent's space. */
  floorY: number
  /** Signed distance from the parent origin to the wall face along X. */
  wallX: number
  /** Which way the wall faces: −1 if its face looks toward −X, +1 toward +X. */
  facing: 1 | -1
  z?: number
  opacity?: number
}

/** A wall/floor junction: the vertical half on the wall, the horizontal half
 * on the floor, both fading away from the joint. */
export function CornerAo({ length, floorY, wallX, facing, z = 0, opacity = 0.55 }: CornerAoProps) {
  const reach = 0.34
  return (
    <group>
      {/* Up the wall — the strip's dark edge already points down. */}
      <AoStrip
        length={length}
        reach={reach}
        position={[wallX + facing * 0.012, floorY + reach / 2, z]}
        rotation={[0, facing > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
        opacity={opacity}
      />
      {/* Out across the floor. The extra roll puts the dark edge against the
          wall rather than out in the middle of the room. */}
      <AoStrip
        length={length}
        reach={reach}
        position={[wallX + facing * (reach / 2 + 0.012), floorY + 0.004, z]}
        rotation={[-Math.PI / 2, 0, facing > 0 ? -Math.PI / 2 : Math.PI / 2]}
        opacity={opacity * 0.75}
      />
    </group>
  )
}
