import {
  Panel,
  Shell,
  Seam,
  Cushion,
  Cable,
  Lathe,
  Screen,
  Grille,
  Indicator,
  Caster,
  ArticulatedArm,
  CASTER_HEIGHT,
} from '../hardware'
import { ContactShadow, CasterShadows } from '../grounding'
import type { ClinicMaterials } from '../clinicMaterials'
import { ClinicMaterial } from '../ClinicMaterial'

interface Props {
  mats: ClinicMaterials
  lowPower: boolean
  highlight: number
  detail: boolean
}

/**
 * A dermatology consulting setup: a powered three-section examination chair,
 * an illuminated magnifier lamp on a five-star base, and a skin-imaging tower
 * with its capture head and reporting display.
 *
 * The magnifier lamp is the object that identifies the room — a ring-lit lens
 * on a counterbalanced spring arm is dermatology-specific in a way that a
 * generic console never is, so it gets the detail budget here. Origin is at
 * floor level.
 */
export function DermatologyStation({ mats, lowPower, highlight, detail }: Props) {
  const seg = lowPower ? 8 : 14

  const lampFeet = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 + 0.3
    return [-0.82 + Math.sin(a) * 0.2, -0.18 + Math.cos(a) * 0.2] as const
  })
  const towerFeet = [
    [0.95 - 0.13, -0.5 + 0.13],
    [0.95 + 0.13, -0.5 + 0.13],
    [0.95 - 0.13, -0.5 - 0.13],
    [0.95 + 0.13, -0.5 - 0.13],
  ] as const

  return (
    <group>
      {/* Three separate objects touch this floor, so there are three separate
          shadows — the chair's pedestal, the lamp's five-star base and the
          imaging tower's casters. */}
      <ContactShadow size={[1.0, 1.4]} opacity={0.28} />
      <ContactShadow size={[0.78, 0.86]} opacity={0.62} />
      <CasterShadows points={lampFeet} radius={0.075} opacity={0.5} />
      <CasterShadows points={towerFeet} radius={0.1} opacity={0.58} />
      {/* ── Examination chair ────────────────────────────────────── */}
      <group position={[0, 0, 0]}>
        <Panel size={[0.54, 0.05, 0.62]} radius={0.02} position={[0, 0.025, 0]} material={mats.shellDark} />
        <Lathe
          segments={seg}
          material={mats.shell}
          profile={[
            [0, 0.05],
            [0.15, 0.05],
            [0.14, 0.1],
            [0.1, 0.2],
            [0.095, 0.36],
            [0, 0.38],
          ]}
        />
        <mesh position={[0, 0.44, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.14, seg]} />
          <ClinicMaterial {...mats.chrome} />
        </mesh>
        <Panel size={[0.5, 0.05, 1.0]} radius={0.018} position={[0, 0.52, -0.02]} material={mats.shellDark} />
        {/* Seat, reclined back, headrest and a lowered leg section */}
        <Cushion size={[0.56, 0.5, 0.13]} position={[0, 0.6, 0.06]} material={mats.upholstery} radius={0.06} />
        <Cushion
          size={[0.54, 0.72, 0.12]}
          position={[0, 0.83, -0.44]}
          rotation={[0.72, 0, 0]}
          material={mats.upholstery}
          radius={0.07}
        />
        <Cushion
          size={[0.3, 0.2, 0.09]}
          position={[0, 1.18, -0.72]}
          rotation={[0.62, 0, 0]}
          material={mats.upholstery}
          radius={0.045}
        />
        <Cushion
          size={[0.5, 0.62, 0.12]}
          position={[0, 0.55, 0.6]}
          rotation={[0.26, 0, 0]}
          material={mats.upholstery}
          radius={0.06}
        />
        {[-0.31, 0.31].map((x) => (
          <group key={x}>
            <Panel size={[0.05, 0.045, 0.36]} radius={0.021} position={[x, 0.79, 0.02]} material={mats.shellDark} />
            <mesh position={[x, 0.71, 0.14]}>
              <cylinderGeometry args={[0.012, 0.012, 0.15, 8]} />
              <ClinicMaterial {...mats.chrome} />
            </mesh>
          </group>
        ))}
        {detail && (
          <Panel size={[0.06, 0.13, 0.02]} radius={0.008} position={[0.24, 0.56, 0.32]} rotation={[0.2, 0, 0]} material={mats.shellDark} />
        )}
      </group>

      {/* ── Magnifier examination lamp ───────────────────────────── */}
      <group position={[-0.82, 0, -0.18]}>
        {Array.from({ length: 5 }, (_, i) => {
          const a = (i / 5) * Math.PI * 2 + 0.3
          return (
            <group key={i}>
              <Panel
                size={[0.04, 0.026, 0.22]}
                radius={0.011}
                position={[Math.sin(a) * 0.11, 0.085, Math.cos(a) * 0.11]}
                rotation={[0, a, 0]}
                material={mats.shellDark}
              />
              <mesh position={[Math.sin(a) * 0.2, 0.03, Math.cos(a) * 0.2]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.029, 0.029, 0.018, 8]} />
                <ClinicMaterial {...mats.rubber} />
              </mesh>
            </group>
          )
        })}
        <mesh position={[0, 0.6, 0]}>
          <cylinderGeometry args={[0.024, 0.03, 1.02, seg]} />
          <ClinicMaterial {...mats.chrome} />
        </mesh>
        <ArticulatedArm
          joints={[
            [0, 1.11, 0],
            [0.3, 1.32, 0.12],
            [0.62, 1.14, 0.3],
          ]}
          radius={0.015}
          jointRadius={0.024}
          materials={mats}
          segments={lowPower ? 6 : 10}
        />
        {/* Lens head: housing, ring light, glass */}
        <group position={[0.66, 1.08, 0.33]} rotation={[0.6, -0.3, 0]}>
          <Lathe
            segments={lowPower ? 12 : 22}
            material={mats.shell}
            profile={[
              [0.07, 0],
              [0.15, 0],
              [0.155, 0.03],
              [0.15, 0.055],
              [0.07, 0.055],
            ]}
          />
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.115, 0.014, 6, lowPower ? 12 : 24]} />
            <meshStandardMaterial
              color="#fffaf0"
              emissive="#fff2df"
              emissiveIntensity={0.7 + highlight * 0.5}
              roughness={0.35}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, -0.004, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.098, lowPower ? 12 : 24]} />
            <ClinicMaterial color="#e9f2f6" roughness={0.04} metalness={0} transparent opacity={0.26} />
          </mesh>
        </group>
      </group>

      {/* ── Skin-imaging tower ───────────────────────────────────── */}
      <group position={[0.95, 0, -0.5]} rotation={[0, -0.55, 0]}>
        {([
          [-0.13, 0.13],
          [0.13, 0.13],
          [-0.13, -0.13],
          [0.13, -0.13],
        ] as const).map(([x, z], i) => (
          <Caster key={i} position={[x, CASTER_HEIGHT, z]} materials={mats} yaw={i * 0.8} lowPower={lowPower} />
        ))}
        <Panel size={[0.38, 0.05, 0.38]} radius={0.018} position={[0, CASTER_HEIGHT + 0.025, 0]} material={mats.shellDark} />
        {/* Body split into its two mouldings with a real parting line, and a
            shallow arc on the face — the same treatment as the other large
            white devices, so they read as one product family. */}
        <Panel size={[0.34, 0.42, 0.34]} radius={0.04} position={[0, 0.36, 0]} material={mats.bodyGraphite} />
        <Panel size={[0.34, 0.42, 0.34]} radius={0.04} position={[0, 0.79, 0]} material={mats.shell} />
        <Seam size={[0.35, 0.35]} position={[0, 0.577, 0]} material={mats.recess} width={0.005} />
        <Shell
          outerRadius={0.85}
          innerRadius={0.83}
          halfAngle={0.18}
          length={0.82}
          position={[0, 0.58, -0.68]}
          rotation={[Math.PI / 2, 0, 0]}
          material={mats.shellSatin}
        />
        <Panel size={[0.346, 0.01, 0.346]} radius={0.004} position={[0, 1.0, 0]} material={mats.shellDark} />
        <Grille size={[0.2, 0.14]} slats={5} position={[0, 0.32, -0.175]} rotation={[0, Math.PI, 0]} material={mats.shellDark} />
        {/* Capture head with its dark optical dome */}
        <Panel size={[0.32, 0.2, 0.3]} radius={0.035} position={[0, 1.12, 0]} material={mats.shell} />
        <Lathe
          position={[0, 1.02, 0.06]}
          rotation={[Math.PI, 0, 0]}
          segments={lowPower ? 10 : 18}
          material={{ color: '#14171c', roughness: 0.1, metalness: 0 }}
          profile={[
            [0, 0],
            [0.05, 0.012],
            [0.062, 0.04],
            [0.06, 0.055],
            [0, 0.058],
          ]}
        />
        <group position={[0, 1.36, 0.03]} rotation={[-0.32, 0, 0]}>
          <Screen size={[0.34, 0.23]} materials={mats} glow="#8fb4cf" intensity={0.28 + highlight * 0.2} />
        </group>
        {detail && (
          <>
            <Indicator position={[0, 0.76, 0.176]} color="#6fdc9a" intensity={0.9} />
            <Cable
              from={[0.1, 1.04, 0.14]}
              to={[0.18, 0.78, 0.19]}
              sag={0.06}
              radius={0.008}
              material={mats.rubber}
              segments={12}
            />
          </>
        )}
      </group>
    </group>
  )
}
