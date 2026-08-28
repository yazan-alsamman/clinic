import { Panel, Cushion, Cable, CoiledCable, Lathe, Screen, Indicator, ArticulatedArm } from '../hardware'
import type { ClinicMaterials } from '../clinicMaterials'

interface Props {
  mats: ClinicMaterials
  lowPower: boolean
  highlight: number
  /** Distance-gated detail: skip the small fittings when the room is far away. */
  detail: boolean
}

/**
 * A dental treatment unit, modelled from the standard configuration of a
 * modern operatory: a pedestal-mounted patient chair with an articulated
 * back, an over-patient delivery console carrying the handpieces, a cuspidor
 * on the assistant's side, an LED operating light on its own post, and a
 * chart monitor.
 *
 * Dimensions are real: 2.2 m from headrest to footrest, seat at 0.62 m, light
 * head at 1.7 m — a person could sit in this. The earlier version of this
 * asset was roughly a third of that, which is most of why it read as a model
 * of a chair rather than a chair. Origin is at floor level.
 */
export function DentalUnit({ mats, lowPower, highlight, detail }: Props) {
  const seg = lowPower ? 10 : 20
  const lampOn = 0.55 + highlight * 0.5

  return (
    <group>
      {/* ── Pedestal ─────────────────────────────────────────────── */}
      <Panel size={[0.62, 0.07, 0.38]} radius={0.03} position={[0, 0.035, 0]} material={mats.shellDark} />
      <Lathe
        position={[0, 0, 0]}
        segments={seg}
        material={mats.shell}
        profile={[
          [0, 0.07],
          [0.17, 0.07],
          [0.163, 0.13],
          [0.112, 0.25],
          [0.104, 0.4],
          [0.096, 0.44],
          [0, 0.45],
        ]}
      />
      {/* Telescoping ram — the visible hydraulic stage */}
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.062, 0.062, 0.12, seg]} />
        <meshPhysicalMaterial {...mats.chrome} />
      </mesh>
      {/* Structural spine the cushions bolt onto */}
      <Panel size={[0.42, 0.055, 1.12]} radius={0.02} position={[0, 0.555, -0.08]} material={mats.shellDark} />

      {/* ── Chair ────────────────────────────────────────────────── */}
      <Cushion size={[0.5, 0.56, 0.15]} position={[0, 0.645, 0.14]} material={mats.upholstery} radius={0.07} />
      <Cushion
        size={[0.48, 0.92, 0.14]}
        position={[0, 0.672, -0.6]}
        rotation={[-0.05, 0, 0]}
        material={mats.upholstery}
        radius={0.09}
      />
      {/* Headrest on its slider — the two-stage articulation real chairs have */}
      <mesh position={[0, 0.66, -1.06]} rotation={[Math.PI / 2 - 0.05, 0, 0]}>
        <cylinderGeometry args={[0.016, 0.016, 0.14, 8]} />
        <meshPhysicalMaterial {...mats.chrome} />
      </mesh>
      <Cushion
        size={[0.25, 0.26, 0.11]}
        position={[0, 0.7, -1.14]}
        rotation={[-0.14, 0, 0]}
        material={mats.upholstery}
        radius={0.055}
      />
      <Cushion
        size={[0.46, 0.66, 0.14]}
        position={[0, 0.618, 0.72]}
        rotation={[0.09, 0, 0]}
        material={mats.upholstery}
        radius={0.07}
      />

      {/* Armrests — bar plus its drop bracket, on both sides */}
      {[-0.29, 0.29].map((x) => (
        <group key={x}>
          <Panel size={[0.055, 0.05, 0.42]} radius={0.024} position={[x, 0.775, 0.04]} material={mats.shellDark} />
          <mesh position={[x, 0.7, 0.2]}>
            <cylinderGeometry args={[0.013, 0.013, 0.16, 8]} />
            <meshPhysicalMaterial {...mats.chrome} />
          </mesh>
        </group>
      ))}

      {/* Foot control on the floor, wired back into the pedestal */}
      {detail && (
        <>
          <Lathe
            position={[-0.5, 0, 0.5]}
            segments={lowPower ? 8 : 14}
            material={mats.shellDark}
            profile={[
              [0, 0],
              [0.1, 0],
              [0.098, 0.03],
              [0.075, 0.055],
              [0, 0.06],
            ]}
          />
          <Cable
            from={[-0.44, 0.03, 0.46]}
            to={[-0.08, 0.06, 0.12]}
            sag={0.02}
            radius={0.008}
            material={mats.rubber}
            segments={12}
          />
        </>
      )}

      {/* ── Delivery console, swung over the patient ─────────────── */}
      <ArticulatedArm
        joints={[
          [0.09, 0.46, -0.18],
          [0.42, 0.98, -0.3],
          [0.66, 1.0, -0.22],
        ]}
        radius={0.019}
        jointRadius={0.028}
        materials={mats}
        segments={lowPower ? 6 : 10}
      />
      <group position={[0.7, 0.96, -0.16]} rotation={[0, -0.26, 0]}>
        <Panel size={[0.42, 0.12, 0.3]} radius={0.022} material={mats.shell} />
        <Panel size={[0.38, 0.012, 0.26]} radius={0.006} position={[0, 0.066, 0]} material={mats.brushedSteel} />
        <Screen size={[0.15, 0.09]} position={[0, 0.01, 0.152]} materials={mats} glow="#8fb6cf" intensity={0.3 + highlight * 0.25} />
        {/* Handpieces racked along the back edge, each on its own coiled hose */}
        {detail &&
          [-0.13, -0.045, 0.045, 0.13].map((x, i) => (
            <group key={x}>
              <Lathe
                position={[x, 0.075, -0.09]}
                rotation={[0.34, 0, 0]}
                segments={lowPower ? 6 : 12}
                material={i === 3 ? mats.shellDark : mats.chrome}
                profile={[
                  [0, 0],
                  [0.013, 0.005],
                  [0.014, 0.07],
                  [0.009, 0.1],
                  [0.005, 0.13],
                  [0, 0.135],
                ]}
              />
              <CoiledCable
                from={[x, 0.06, -0.1]}
                to={[x * 0.5, -0.055, -0.13]}
                turns={3}
                coilRadius={0.02}
                radius={0.006}
                material={mats.rubber}
                segments={lowPower ? 28 : 54}
              />
            </group>
          ))}
      </group>

      {/* ── Cuspidor on the assistant's side ─────────────────────── */}
      {detail && (
        <group position={[-0.56, 0, -0.5]}>
          <mesh position={[0, 0.42, 0]}>
            <cylinderGeometry args={[0.035, 0.045, 0.84, seg]} />
            <meshPhysicalMaterial {...mats.shell} />
          </mesh>
          <Lathe
            position={[0, 0.84, 0]}
            segments={seg}
            material={mats.ceramic}
            profile={[
              [0, 0.0],
              [0.075, 0.005],
              [0.115, 0.035],
              [0.128, 0.07],
              [0.12, 0.072],
              [0.1, 0.045],
              [0.04, 0.02],
              [0.032, 0.024],
              [0, 0.024],
            ]}
          />
          {/* Water cup and its filler spout */}
          <Lathe
            position={[0.15, 0.86, 0.03]}
            segments={lowPower ? 8 : 14}
            material={mats.ceramic}
            profile={[
              [0, 0],
              [0.028, 0],
              [0.031, 0.06],
              [0.028, 0.062],
              [0.026, 0.004],
              [0, 0.004],
            ]}
          />
          <mesh position={[0.15, 0.95, -0.03]} rotation={[0.5, 0, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 0.09, 6]} />
            <meshPhysicalMaterial {...mats.chrome} />
          </mesh>
        </group>
      )}

      {/* ── Operating light on its post ──────────────────────────── */}
      {/* Slim and dark on purpose: a pale full-height column parked beside the
          chair reads as scaffolding and steals the shot from the chair. */}
      <mesh position={[0.36, 0.98, -1.08]}>
        <cylinderGeometry args={[0.026, 0.032, 1.96, seg]} />
        <meshPhysicalMaterial {...mats.shellDark} />
      </mesh>
      <ArticulatedArm
        joints={[
          [0.36, 2.0, -1.08],
          [0.36, 2.06, -0.78],
          [0.2, 1.86, -0.36],
        ]}
        radius={0.021}
        jointRadius={0.03}
        materials={mats}
        segments={lowPower ? 6 : 10}
      />
      <group position={[0.06, 1.74, -0.36]} rotation={[0.42, 0.14, 0]}>
        <Panel size={[0.54, 0.1, 0.22]} radius={0.045} material={mats.shell} />
        {/* Emitting face, and the twin handles a dentist actually grips */}
        <mesh position={[0, -0.052, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.46, 0.16]} />
          <meshStandardMaterial
            color="#fffaf2"
            emissive="#fff4e4"
            emissiveIntensity={lampOn}
            roughness={0.3}
            toneMapped={false}
          />
        </mesh>
        {detail &&
          [-0.3, 0.3].map((x) => (
            <mesh key={x} position={[x, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.045, 0.009, 6, 14, Math.PI]} />
              <meshPhysicalMaterial {...mats.shellDark} />
            </mesh>
          ))}
      </group>
      <pointLight position={[0.06, 1.6, -0.36]} intensity={lowPower ? 1.1 : 1.8} color="#fff3e2" distance={2.6} decay={2} />

      {/* ── Chart monitor ────────────────────────────────────────── */}
      {detail && (
        <>
          <ArticulatedArm
            joints={[
              [0.36, 1.5, -1.08],
              [0.62, 1.5, -1.0],
            ]}
            radius={0.016}
            jointRadius={0.023}
            materials={mats}
            segments={lowPower ? 6 : 10}
          />
          <group position={[0.68, 1.52, -0.96]} rotation={[0, -1.0, 0]}>
            <Screen size={[0.38, 0.24]} materials={mats} glow="#93b9d4" intensity={0.26} />
          </group>
        </>
      )}

      <Indicator position={[0.7, 0.9, 0.0]} color="#7fe0a8" intensity={0.9 + highlight * 0.6} />
    </group>
  )
}
