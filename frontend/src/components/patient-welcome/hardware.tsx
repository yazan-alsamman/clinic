import { useMemo, type ReactNode } from 'react'
import * as THREE from 'three'

type Vec3 = [number, number, number]
type Mat = Record<string, unknown>

/**
 * The manufactured-parts kit every device in the clinic is assembled from.
 *
 * Primitive boxes and cylinders read as "3D shapes" for one specific reason:
 * nothing manufactured has a truly sharp edge. Injection molds need draft and
 * fillets, sheet metal has a bend radius, upholstery has piping. A filleted
 * edge catches a thin specular highlight along its length, and that highlight
 * is most of what tells a viewer they're looking at a real object. Everything
 * below exists to put correct edges, real sag, and real mechanical joints on
 * geometry that would otherwise be a box.
 */

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const radius = Math.min(r, w / 2 - 0.001, h / 2 - 0.001)
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + radius, y)
  s.lineTo(x + w - radius, y)
  s.quadraticCurveTo(x + w, y, x + w, y + radius)
  s.lineTo(x + w, y + h - radius)
  s.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  s.lineTo(x + radius, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - radius)
  s.lineTo(x, y + radius)
  s.quadraticCurveTo(x, y, x + radius, y)
  return s
}

interface PanelProps {
  /** [width, height, depth] in metres */
  size: Vec3
  /** Edge fillet. Real molded housings sit around 4–10 mm. */
  radius?: number
  position?: Vec3
  rotation?: Vec3
  material: Mat
  segments?: number
  children?: ReactNode
}

/** A filleted panel — the workhorse. Replaces `boxGeometry` everywhere a real
 * housing, base, bezel or bracket is being modelled. */
export function Panel({ size, radius = 0.012, position, rotation, material, segments = 3, children }: PanelProps) {
  const geo = useMemo(() => {
    const [w, h, d] = size
    const r = Math.min(radius, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005)
    const shape = roundedRectShape(w, h, Math.max(r, 0.0005))
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(d - r * 2, 0.0005),
      bevelEnabled: true,
      bevelThickness: r,
      bevelSize: r,
      bevelSegments: segments,
      curveSegments: segments + 2,
    })
    g.center()
    g.computeVertexNormals()
    return g
  }, [size, radius, segments])

  return (
    <mesh position={position} rotation={rotation} geometry={geo} castShadow={false}>
      <meshPhysicalMaterial {...material} />
      {children}
    </mesh>
  )
}

interface CushionProps {
  /** [width, length, thickness] — thickness is the vertical axis. */
  size: Vec3
  position?: Vec3
  rotation?: Vec3
  material: Mat
  /** Corner radius of the pad outline. */
  radius?: number
  segments?: number
}

/** Upholstery. A seat pad is a soft slab with a generous bevel all round —
 * the bevel is what reads as "stuffed and stitched" rather than "cut from a
 * block", so it is proportionally much larger here than on a hard panel. */
export function Cushion({ size, position, rotation, material, radius = 0.05, segments = 4 }: CushionProps) {
  const geo = useMemo(() => {
    const [w, l, t] = size
    const bevel = Math.min(t * 0.42, 0.05)
    const shape = roundedRectShape(w, l, Math.min(radius, w / 2 - 0.001, l / 2 - 0.001))
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(t - bevel * 2, 0.001),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelSegments: segments,
      curveSegments: segments + 3,
    })
    g.center()
    g.rotateX(-Math.PI / 2)
    g.computeVertexNormals()
    return g
  }, [size, radius, segments])

  return (
    <mesh position={position} rotation={rotation} geometry={geo}>
      <meshPhysicalMaterial {...material} />
    </mesh>
  )
}

interface CableProps {
  from: Vec3
  to: Vec3
  /** How far the middle of the run hangs below the straight line, in metres. */
  sag?: number
  radius?: number
  /** Lateral bow, so a cable doesn't sit in a perfectly flat plane. */
  bow?: number
  material: Mat
  segments?: number
}

/** A hose or power cable that actually hangs. Straight floating tubes are one
 * of the clearest giveaways of procedural modelling; a real cable leaves its
 * port, sags under its own weight, and terminates somewhere it plausibly
 * plugs into. */
export function Cable({ from, to, sag = 0.12, radius = 0.011, bow = 0, material, segments = 20 }: CableProps) {
  const geo = useMemo(() => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const m1 = a.clone().lerp(b, 0.33)
    const m2 = a.clone().lerp(b, 0.67)
    m1.y -= sag * 0.85
    m2.y -= sag
    if (bow) {
      const side = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 1, 0)).normalize()
      m1.addScaledVector(side, bow * 0.7)
      m2.addScaledVector(side, bow)
    }
    const curve = new THREE.CatmullRomCurve3([a, m1, m2, b], false, 'catmullrom', 0.5)
    return new THREE.TubeGeometry(curve, segments, radius, 6, false)
  }, [from, to, sag, radius, bow, segments])

  return (
    <mesh geometry={geo}>
      <meshPhysicalMaterial {...material} />
    </mesh>
  )
}

interface CoiledCableProps {
  from: Vec3
  to: Vec3
  turns?: number
  coilRadius?: number
  radius?: number
  material: Mat
  segments?: number
}

/** The curly hose on a dental delivery unit / a laser handpiece lead. */
export function CoiledCable({
  from,
  to,
  turns = 5,
  coilRadius = 0.045,
  radius = 0.009,
  material,
  segments = 90,
}: CoiledCableProps) {
  const geo = useMemo(() => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const axis = new THREE.Vector3().subVectors(b, a)
    const len = axis.length()
    axis.normalize()
    const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const u = new THREE.Vector3().crossVectors(axis, ref).normalize()
    const v = new THREE.Vector3().crossVectors(axis, u).normalize()

    const pts: THREE.Vector3[] = []
    const n = 60
    for (let i = 0; i <= n; i++) {
      const t = i / n
      // Ease the coil in and out so it leaves both ports straight rather than
      // springing to full diameter the instant it exits the housing.
      const env = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.08) / 0.84))) ** 0.6
      const ang = t * turns * Math.PI * 2
      const p = a.clone().addScaledVector(axis, len * t)
      p.addScaledVector(u, Math.cos(ang) * coilRadius * env)
      p.addScaledVector(v, Math.sin(ang) * coilRadius * env)
      pts.push(p)
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5)
    return new THREE.TubeGeometry(curve, segments, radius, 5, false)
  }, [from, to, turns, coilRadius, radius, segments])

  return (
    <mesh geometry={geo}>
      <meshPhysicalMaterial {...material} />
    </mesh>
  )
}

interface LatheProps {
  /** Profile as [radius, height] pairs, bottom to top. */
  profile: [number, number][]
  position?: Vec3
  rotation?: Vec3
  material: Mat
  segments?: number
}

/** Turned and molded parts — pedestal columns, lamp housings, handpiece
 * bodies, bowls. A lathed profile gives the continuous curvature that stacked
 * cylinders can only step through. */
export function Lathe({ profile, position, rotation, material, segments = 24 }: LatheProps) {
  const geo = useMemo(
    () => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), segments),
    [profile, segments],
  )
  return (
    <mesh position={position} rotation={rotation} geometry={geo}>
      <meshPhysicalMaterial {...material} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** Height of a standard 75 mm medical caster, measured mount-face to floor. */
export const CASTER_HEIGHT = 0.105

interface CasterProps {
  /** Position of the *mounting face*; the caster hangs below it to the floor. */
  position: Vec3
  materials: { paintedSteel: Mat; rubber: Mat; chrome: Mat }
  /** Swivel angle, so a set of four don't all point the same way. */
  yaw?: number
  lowPower?: boolean
}

/** A real swivel caster: mounting stem, offset fork, axle, rubber tyre. The
 * offset between stem and axle is what makes a caster look like a caster —
 * a sphere or a plain cylinder never will. */
export function Caster({ position, materials, yaw = 0, lowPower = false }: CasterProps) {
  const seg = lowPower ? 8 : 14
  const wheelR = 0.0375
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {/* Mounting stem into the equipment base */}
      <mesh position={[0, -0.014, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.028, seg]} />
        <meshPhysicalMaterial {...materials.chrome} />
      </mesh>
      {/* Swivel housing */}
      <Panel size={[0.052, 0.022, 0.046]} radius={0.008} position={[0, -0.039, 0]} material={materials.paintedSteel} />
      {/* Fork legs, offset behind the stem as a real swivel caster is */}
      {[-0.021, 0.021].map((x) => (
        <Panel
          key={x}
          size={[0.008, 0.05, 0.03]}
          radius={0.003}
          position={[x, -0.062, -0.012]}
          material={materials.paintedSteel}
        />
      ))}
      {/* Tyre + hub */}
      <mesh position={[0, -CASTER_HEIGHT + wheelR, -0.012]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[wheelR, wheelR, 0.024, seg + 4]} />
        <meshPhysicalMaterial {...materials.rubber} />
      </mesh>
      <mesh position={[0, -CASTER_HEIGHT + wheelR, -0.012]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[wheelR * 0.45, wheelR * 0.45, 0.027, seg]} />
        <meshPhysicalMaterial {...materials.chrome} />
      </mesh>
    </group>
  )
}

interface ScreenProps {
  /** [width, height] of the whole bezel. */
  size: [number, number]
  position?: Vec3
  rotation?: Vec3
  materials: { shellDark: Mat; screenGlass: Mat }
  /** Screen content tint; kept dim — a real UI is not a light source. */
  glow?: string
  intensity?: number
}

/** A display: bezel, recessed dark glass, and a faint panel emission. Real
 * medical displays are dim, matte and mostly dark — a bright saturated slab
 * is what makes equipment read as sci-fi. */
export function Screen({ size, position, rotation, materials, glow = '#7fa8c4', intensity = 0.35 }: ScreenProps) {
  const [w, h] = size
  return (
    <group position={position} rotation={rotation}>
      <Panel size={[w, h, 0.016]} radius={0.005} material={materials.shellDark} />
      <mesh position={[0, 0, 0.0092]}>
        <planeGeometry args={[w - 0.022, h - 0.022]} />
        <meshPhysicalMaterial {...materials.screenGlass} emissive={glow} emissiveIntensity={intensity} />
      </mesh>
    </group>
  )
}

interface GrilleProps {
  /** [width, height] of the vent area. */
  size: [number, number]
  slats?: number
  depth?: number
  position?: Vec3
  rotation?: Vec3
  material: Mat
}

/** Ventilation louvres. Every powered device has to breathe, and the shadow
 * line of a vent is cheap, high-value evidence that something is a machine. */
export function Grille({ size, slats = 7, depth = 0.006, position, rotation, material }: GrilleProps) {
  const [w, h] = size
  const pitch = h / slats
  return (
    <group position={position} rotation={rotation}>
      {Array.from({ length: slats }, (_, i) => (
        <mesh key={i} position={[0, -h / 2 + pitch * (i + 0.5), 0]} rotation={[0.34, 0, 0]}>
          <boxGeometry args={[w, pitch * 0.62, depth]} />
          <meshPhysicalMaterial {...material} />
        </mesh>
      ))}
    </group>
  )
}

interface IndicatorProps {
  position: Vec3
  color: string
  size?: number
  intensity?: number
}

/** A status LED. Deliberately tiny: on real equipment these are 3 mm dots,
 * not glowing strips, and keeping them at true size is most of what stops a
 * device looking like a gaming PC. */
export function Indicator({ position, color, size = 0.005, intensity = 1.4 }: IndicatorProps) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 8, 6]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} roughness={0.3} />
    </mesh>
  )
}

interface ArticulatedArmProps {
  /** Joint positions, in order, in the parent's local space. */
  joints: Vec3[]
  radius?: number
  jointRadius?: number
  materials: { paintedSteel: Mat; shellDark: Mat }
  segments?: number
}

/** A multi-segment support arm with real knuckles at every pivot. Modelling
 * the joint spheres matters: an arm that changes direction without a knuckle
 * looks like a bent wire rather than a mechanism. */
export function ArticulatedArm({
  joints,
  radius = 0.017,
  jointRadius = 0.026,
  materials,
  segments = 10,
}: ArticulatedArmProps) {
  const links = useMemo(() => {
    const out: { pos: Vec3; quat: THREE.Quaternion; len: number }[] = []
    for (let i = 0; i < joints.length - 1; i++) {
      const a = new THREE.Vector3(...joints[i])
      const b = new THREE.Vector3(...joints[i + 1])
      const dir = new THREE.Vector3().subVectors(b, a)
      const len = dir.length()
      const mid = a.clone().addScaledVector(dir, 0.5)
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
      out.push({ pos: [mid.x, mid.y, mid.z], quat, len })
    }
    return out
  }, [joints])

  return (
    <group>
      {links.map((l, i) => (
        <mesh key={i} position={l.pos} quaternion={l.quat}>
          <cylinderGeometry args={[radius, radius, l.len, segments]} />
          <meshPhysicalMaterial {...materials.paintedSteel} />
        </mesh>
      ))}
      {joints.map((j, i) => (
        <mesh key={i} position={j}>
          <sphereGeometry args={[jointRadius, segments, segments - 2]} />
          <meshPhysicalMaterial {...materials.shellDark} />
        </mesh>
      ))}
    </group>
  )
}
