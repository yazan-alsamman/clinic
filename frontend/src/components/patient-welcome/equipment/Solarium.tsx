import { Panel, Lathe, Screen, Grille, Indicator } from '../hardware'
import type { ClinicMaterials } from '../clinicMaterials'

interface Props {
  mats: ClinicMaterials
  lowPower: boolean
  highlight: number
  detail: boolean
}

const TUBE_MAT = { color: '#fff7ea', emissive: '#ffd9a4', roughness: 0.28, metalness: 0 }
// Deliberately mid-grey rather than white: a bright reflector behind bright
// tubes flattens into one white shape, and the tube array stops reading.
const REFLECTOR_MAT = { color: '#8f8c86', roughness: 0.3, metalness: 0 }

/**
 * A commercial canopy sunbed, 2.05 m long, shown half-open on its rear hinge.
 *
 * The single detail that makes a tanning bed recognisable is the lamp array:
 * parallel low-pressure tubes running the full length behind an acrylic sheet,
 * in both the bench and the canopy, against a polished reflector. The previous
 * version was a glowing half-cylinder over a box, which is precisely the
 * "abstract capsule" silhouette this replaces — here the canopy is a real
 * shell with thickness, end caps, ventilation, gas struts and hinge barrels,
 * and it is mechanically attached to the base along a visible pivot.
 *
 * Length runs along Z; origin is at floor level.
 */
export function Solarium({ mats, lowPower, highlight, detail }: Props) {
  const seg = lowPower ? 8 : 14
  const tubeSeg = lowPower ? 5 : 8
  const benchTubes = lowPower ? 5 : 8
  const canopyTubes = lowPower ? 6 : 10
  // These are lamps, and they sit behind a sheet of acrylic that goes mirror-
  // bright at the grazing angles the walkthrough actually views the bed from.
  // They have to out-punch that reflection or the array disappears into it.
  const lampGlow = 1.5 + highlight * 0.5
  const canopyAngle = 0.56

  return (
    <group>
      {/* ── Base unit ────────────────────────────────────────────── */}
      {([
        [-0.38, -0.86],
        [0.38, -0.86],
        [-0.38, 0.86],
        [0.38, 0.86],
      ] as const).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.03, z]}>
          <cylinderGeometry args={[0.035, 0.042, 0.06, 8]} />
          <meshPhysicalMaterial {...mats.shellDark} />
        </mesh>
      ))}
      <Panel size={[0.98, 0.5, 2.05]} radius={0.075} position={[0, 0.31, 0]} material={mats.shell} />
      {/* Moulding seam between the lower shell and the bench frame */}
      <Panel size={[0.99, 0.014, 2.06]} radius={0.005} position={[0, 0.5, 0]} material={mats.shellDark} />
      {/* Bench top is a surround, not a lid: four rails around a recessed lamp
          bay. Modelling it as one solid slab buried the tube array underneath
          it, which is exactly the detail that identifies a sunbed. */}
      {([
        [0.44, 0, 0.1, 2.05],
        [-0.44, 0, 0.1, 2.05],
        [0, 0.975, 0.98, 0.1],
        [0, -0.975, 0.98, 0.1],
      ] as const).map(([x, z, w, d], i) => (
        <Panel key={i} size={[w, 0.11, d]} radius={0.03} position={[x, 0.605, z]} material={mats.shell} />
      ))}

      {/* Recessed lamp bay, sitting clear of the shell top so the tubes read
          against the dark reflector rather than against white moulding. */}
      <Panel size={[0.78, 0.03, 1.86]} radius={0.012} position={[0, 0.578, 0]} material={REFLECTOR_MAT} />
      {Array.from({ length: benchTubes }, (_, i) => {
        const x = -0.33 + (i / (benchTubes - 1)) * 0.66
        return (
          <mesh key={i} position={[x, 0.615, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.021, 0.021, 1.82, tubeSeg]} />
            <meshStandardMaterial {...TUBE_MAT} emissiveIntensity={lampGlow} toneMapped={false} />
          </mesh>
        )
      })}
      <Panel size={[0.84, 0.014, 1.9]} radius={0.03} position={[0, 0.648, 0]} material={mats.acrylic} />

      {/* ── Canopy, on its rear hinge ────────────────────────────── */}
      {/* Hinge barrels the canopy actually pivots on */}
      {[-0.72, 0, 0.72].map((z) => (
        <mesh key={z} position={[-0.49, 0.66, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.032, 0.032, 0.16, seg]} />
          <meshPhysicalMaterial {...mats.paintedSteel} />
        </mesh>
      ))}

      <group position={[-0.49, 0.66, 0]} rotation={[0, 0, canopyAngle]}>
        <Panel size={[0.98, 0.13, 1.94]} radius={0.055} position={[0.49, 0.075, 0]} material={mats.shell} />
        <Panel size={[0.8, 0.04, 1.8]} radius={0.012} position={[0.5, -0.005, 0]} material={REFLECTOR_MAT} />
        {Array.from({ length: canopyTubes }, (_, i) => {
          const x = 0.16 + (i / (canopyTubes - 1)) * 0.66
          return (
            <mesh key={i} position={[x, -0.034, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.021, 0.021, 1.76, tubeSeg]} />
              <meshStandardMaterial {...TUBE_MAT} emissiveIntensity={lampGlow} />
            </mesh>
          )
        })}
        {/* Higher-output facial section, set apart as it is on a real canopy */}
        {detail &&
          [-0.2, 0, 0.2].map((z) => (
            <mesh key={z} position={[0.5, -0.038, z - 0.62]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.028, 0.028, 0.4, tubeSeg]} />
              <meshStandardMaterial {...TUBE_MAT} emissiveIntensity={lampGlow * 1.15} />
            </mesh>
          ))}
        <Panel size={[0.86, 0.014, 1.84]} radius={0.03} position={[0.5, -0.062, 0]} material={mats.acrylic} />
        {/* End caps close the shell off — an open-ended tube reads as a prop */}
        {[-0.97, 0.97].map((z) => (
          <Panel
            key={z}
            size={[0.96, 0.15, 0.05]}
            radius={0.03}
            position={[0.49, 0.06, z]}
            material={mats.shell}
          />
        ))}
        {detail && (
          <>
            <Grille
              size={[0.4, 0.07]}
              slats={4}
              position={[0.49, 0.06, 0.995]}
              rotation={[0, 0, 0]}
              material={mats.shellDark}
            />
            {/* Grab handle on the free edge, where a user pulls the canopy down */}
            <mesh position={[0.98, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.016, 0.016, 0.7, seg]} />
              <meshPhysicalMaterial {...mats.shellDark} />
            </mesh>
          </>
        )}
      </group>

      {/* Gas struts holding the canopy open */}
      {[-0.68, 0.68].map((z) => (
        <group key={z}>
          <mesh position={[-0.16, 0.86, z]} rotation={[0, 0, -0.72]}>
            <cylinderGeometry args={[0.013, 0.013, 0.52, 8]} />
            <meshPhysicalMaterial {...mats.chrome} />
          </mesh>
          <mesh position={[-0.28, 0.74, z]} rotation={[0, 0, -0.72]}>
            <cylinderGeometry args={[0.019, 0.019, 0.22, 8]} />
            <meshPhysicalMaterial {...mats.shellDark} />
          </mesh>
        </group>
      ))}

      {/* ── Control panel at the foot end ────────────────────────── */}
      <group position={[0.3, 0.6, 0.94]} rotation={[-0.5, 0, 0]}>
        <Panel size={[0.26, 0.16, 0.03]} radius={0.012} material={mats.shellDark} />
        <Screen size={[0.11, 0.07]} position={[-0.05, 0.01, 0.022]} materials={mats} glow="#e8b57a" intensity={0.35} />
        {detail &&
          [0.04, 0.09].map((x, i) => (
            <Lathe
              key={x}
              position={[x, i === 0 ? 0.02 : -0.03, 0.016]}
              rotation={[Math.PI / 2, 0, 0]}
              segments={10}
              material={mats.shell}
              profile={[
                [0, 0],
                [0.016, 0],
                [0.017, 0.008],
                [0, 0.01],
              ]}
            />
          ))}
        <Indicator position={[-0.05, -0.05, 0.02]} color="#ffbf6b" intensity={0.9 + highlight * 0.5} />
      </group>

      {/* Base ventilation at both ends — the extraction a sunbed needs */}
      <Grille size={[0.5, 0.16]} slats={5} position={[0, 0.3, 1.03]} material={mats.shellDark} />
      <Grille size={[0.5, 0.16]} slats={5} position={[0, 0.3, -1.03]} rotation={[0, Math.PI, 0]} material={mats.shellDark} />

      {/* The tube array's own emission carries "switched on" here — an extra
          point light would cost every material in the scene a shader slot to
          say something the geometry already says. */}
    </group>
  )
}
