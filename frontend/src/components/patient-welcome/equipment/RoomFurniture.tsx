import { Panel, Cushion, Lathe, Caster, Indicator, CASTER_HEIGHT } from '../hardware'
import type { ClinicMaterials } from '../clinicMaterials'

type Vec3 = [number, number, number]

interface BaseProps {
  mats: ClinicMaterials
  lowPower: boolean
  detail: boolean
  position?: Vec3
  rotation?: Vec3
}

/**
 * The furniture every treatment room shares. Keeping beds, trolleys, stools
 * and casework in one kit is what makes five rooms read as five rooms in one
 * building rather than five separate scenes — and it is where most of the
 * "someone works here" signal comes from, since a room containing only its
 * hero device looks like a showroom, not a clinic.
 *
 * All origins are at floor level, all dimensions in real metres.
 */

/** Powered treatment couch: 1.95 m long, top at 0.72 m, head section raised. */
export function TreatmentBed({ mats, lowPower, detail, position, rotation, light = false }: BaseProps & { light?: boolean }) {
  const seg = lowPower ? 8 : 14
  const pad = light ? mats.upholsteryLight : mats.upholstery
  return (
    <group position={position} rotation={rotation}>
      {/* Twin pedestal base with a linear actuator between them */}
      {[-0.52, 0.52].map((z) => (
        <group key={z}>
          <Panel size={[0.5, 0.045, 0.16]} radius={0.018} position={[0, 0.022, z]} material={mats.shellDark} />
          <Panel size={[0.16, 0.5, 0.13]} radius={0.03} position={[0, 0.29, z]} material={mats.shell} />
        </group>
      ))}
      <mesh position={[0, 0.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.95, seg]} />
        <meshPhysicalMaterial {...mats.chrome} />
      </mesh>
      {/* Frame and the three-section mattress */}
      <Panel size={[0.66, 0.06, 1.92]} radius={0.02} position={[0, 0.58, 0]} material={mats.shellDark} />
      <Cushion size={[0.68, 0.78, 0.11]} position={[0, 0.665, 0.52]} material={pad} radius={0.05} />
      <Cushion size={[0.68, 0.52, 0.11]} position={[0, 0.665, -0.04]} material={pad} radius={0.05} />
      <Cushion
        size={[0.68, 0.6, 0.11]}
        position={[0, 0.685, -0.58]}
        rotation={[-0.16, 0, 0]}
        material={pad}
        radius={0.05}
      />
      {detail && (
        <>
          {/* Paper roll and its dispenser at the head end — the detail that
              reads "a patient will lie here next", not "furniture display". */}
          <mesh position={[0, 0.79, -0.93]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.055, 0.055, 0.62, seg]} />
            <meshStandardMaterial color="#f7f4ee" roughness={0.85} metalness={0} />
          </mesh>
          <Panel size={[0.68, 0.004, 0.34]} radius={0.002} position={[0, 0.727, -0.74]} material={{ color: '#f7f4ee', roughness: 0.85, metalness: 0 }} />
          {/* Hand control on its coiled lead, hooked over the side rail */}
          <Panel size={[0.05, 0.11, 0.022]} radius={0.008} position={[0.36, 0.55, 0.18]} rotation={[0, 0, 0.2]} material={mats.shellDark} />
        </>
      )}
    </group>
  )
}

/** Utility trolley: 0.9 m to the top shelf, drawers, push handle, casters. */
export function MedicalTrolley({ mats, lowPower, detail, position, rotation }: BaseProps) {
  const deck = CASTER_HEIGHT
  return (
    <group position={position} rotation={rotation}>
      {([
        [-0.19, 0.14],
        [0.19, 0.14],
        [-0.19, -0.14],
        [0.19, -0.14],
      ] as const).map(([x, z], i) => (
        <Caster key={i} position={[x, deck, z]} materials={mats} yaw={i * 0.9} lowPower={lowPower} />
      ))}
      <Panel size={[0.46, 0.05, 0.38]} radius={0.016} position={[0, deck + 0.025, 0]} material={mats.shellDark} />
      <Panel size={[0.44, 0.44, 0.36]} radius={0.02} position={[0, deck + 0.27, 0]} material={mats.shell} />
      {/* Drawer fronts with a real reveal between them */}
      {detail &&
        [0.12, 0.27, 0.42].map((y) => (
          <group key={y}>
            <Panel size={[0.4, 0.12, 0.012]} radius={0.006} position={[0, deck + y, 0.184]} material={mats.shell} />
            <mesh position={[0, deck + y + 0.04, 0.194]}>
              <boxGeometry args={[0.18, 0.008, 0.012]} />
              <meshPhysicalMaterial {...mats.brushedSteel} />
            </mesh>
          </group>
        ))}
      <Panel size={[0.48, 0.016, 0.4]} radius={0.008} position={[0, deck + 0.5, 0]} material={mats.brushedSteel} />
      {/* Raised lip around the worktop, so instruments can't slide off */}
      {detail &&
        ([
          [0, 0.196, 0.46, 0.02],
          [0, -0.196, 0.46, 0.02],
          [0.236, 0, 0.02, 0.4],
          [-0.236, 0, 0.02, 0.4],
        ] as const).map(([x, z, w, d], i) => (
          <mesh key={i} position={[x, deck + 0.518, z]}>
            <boxGeometry args={[w, 0.02, d]} />
            <meshPhysicalMaterial {...mats.brushedSteel} />
          </mesh>
        ))}
      {detail && (
        <mesh position={[0, deck + 0.56, -0.21]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.012, 0.36, 8]} />
          <meshPhysicalMaterial {...mats.brushedSteel} />
        </mesh>
      )}
    </group>
  )
}

/** Operator stool on a five-star gas-lift base. */
export function Stool({ mats, lowPower, position, rotation }: BaseProps) {
  const seg = lowPower ? 8 : 14
  return (
    <group position={position} rotation={rotation}>
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2
        return (
          <group key={i}>
            <Panel
              size={[0.045, 0.028, 0.24]}
              radius={0.012}
              position={[Math.sin(a) * 0.12, 0.09, Math.cos(a) * 0.12]}
              rotation={[0, a, 0]}
              material={mats.shellDark}
            />
            <mesh position={[Math.sin(a) * 0.22, 0.033, Math.cos(a) * 0.22]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.032, 0.032, 0.02, 8]} />
              <meshPhysicalMaterial {...mats.rubber} />
            </mesh>
          </group>
        )
      })}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.028, 0.034, 0.4, seg]} />
        <meshPhysicalMaterial {...mats.chrome} />
      </mesh>
      <Cushion size={[0.38, 0.36, 0.09]} position={[0, 0.55, 0]} material={mats.upholstery} radius={0.14} />
    </group>
  )
}

/** Fitted casework along a room's back wall: base units, worktop, wall units. */
export function CabinetRun({
  mats,
  detail,
  position,
  rotation,
  width = 2.4,
  wallUnits = true,
}: BaseProps & { width?: number; wallUnits?: boolean }) {
  const doors = Math.max(2, Math.round(width / 0.6))
  return (
    <group position={position} rotation={rotation}>
      <Panel size={[width, 0.1, 0.58]} radius={0.01} position={[0, 0.05, 0]} material={mats.shellDark} />
      <Panel size={[width, 0.78, 0.6]} radius={0.008} position={[0, 0.49, 0]} material={mats.shell} />
      {detail &&
        Array.from({ length: doors }, (_, i) => {
          const x = -width / 2 + (width / doors) * (i + 0.5)
          return (
            <group key={i}>
              <Panel
                size={[width / doors - 0.012, 0.72, 0.016]}
                radius={0.005}
                position={[x, 0.49, 0.305]}
                material={mats.shell}
              />
              <mesh position={[x + width / doors / 2 - 0.06, 0.49, 0.322]}>
                <boxGeometry args={[0.012, 0.16, 0.012]} />
                <meshPhysicalMaterial {...mats.brushedSteel} />
              </mesh>
            </group>
          )
        })}
      {/* Stone worktop with an overhang and a shadow gap beneath */}
      <Panel size={[width + 0.04, 0.04, 0.64]} radius={0.006} position={[0, 0.9, 0.01]} material={{ color: '#3b3730', roughness: 0.3, metalness: 0.05 }} />
      {/* Wall units, set at the height they are actually hung, with their own
          door divisions — a single unbroken slab up there reads as a painted
          rectangle rather than joinery. Suppressed when the run is used as a
          freestanding bench, since a wall cupboard needs a wall behind it. */}
      {wallUnits && (
        <Panel size={[width * 0.8, 0.62, 0.34]} radius={0.008} position={[0, 1.72, -0.12]} material={mats.shell} />
      )}
      {wallUnits &&
        detail &&
        Array.from({ length: Math.max(2, Math.round((width * 0.8) / 0.6)) }, (_, i) => {
          const count = Math.max(2, Math.round((width * 0.8) / 0.6))
          const w = (width * 0.8) / count
          const x = -(width * 0.8) / 2 + w * (i + 0.5)
          return (
            <group key={i}>
              <Panel size={[w - 0.014, 0.58, 0.014]} radius={0.004} position={[x, 1.72, 0.055]} material={mats.shell} />
              <mesh position={[x, 1.46, 0.07]}>
                <boxGeometry args={[w * 0.5, 0.011, 0.011]} />
                <meshPhysicalMaterial {...mats.brushedSteel} />
              </mesh>
            </group>
          )
        })}
      {wallUnits && (
        <mesh position={[0, 1.4, -0.12]}>
          <boxGeometry args={[width * 0.78, 0.012, 0.3]} />
          <meshStandardMaterial color="#fff4e6" emissive="#ffe9d2" emissiveIntensity={0.5} roughness={0.6} />
        </mesh>
      )}
    </group>
  )
}

/**
 * A prepared sterile tray. Deliberately small — these sit at roughly 10 cm and
 * are read as texture in the corner of a shot, never as hero objects. Sealed,
 * capped and laid out as a clean pre-treatment setup: nothing in use, nobody
 * being treated, no clinical waste on show.
 */
export function SterileTray({ mats, lowPower, detail, position, rotation }: BaseProps) {
  const seg = lowPower ? 6 : 10
  const barrel = { color: '#eaf2f5', roughness: 0.12, metalness: 0, transparent: true, opacity: 0.55 }
  return (
    <group position={position} rotation={rotation}>
      {/* Kidney dish / tray with a raised lip */}
      <Panel size={[0.28, 0.014, 0.19]} radius={0.02} material={mats.brushedSteel} />
      <Panel size={[0.26, 0.006, 0.17]} radius={0.018} position={[0, 0.009, 0]} material={{ color: '#dfe6e9', roughness: 0.7, metalness: 0 }} />

      {detail && (
        <>
          {/* Two sealed syringes, capped, with plunger and graduations */}
          {[-0.06, -0.015].map((x, i) => (
            <group key={x} position={[x, 0.022, -0.03 + i * 0.025]} rotation={[0, 0.22 - i * 0.4, Math.PI / 2]}>
              <mesh>
                <cylinderGeometry args={[0.0065, 0.0065, 0.062, seg]} />
                <meshPhysicalMaterial {...barrel} />
              </mesh>
              {/* Graduation band */}
              <mesh position={[0, 0.006, 0]}>
                <cylinderGeometry args={[0.0067, 0.0067, 0.03, seg, 1, true]} />
                <meshStandardMaterial color="#9aa6ad" roughness={0.6} transparent opacity={0.5} />
              </mesh>
              {/* Flange and plunger stem */}
              <mesh position={[0, -0.033, 0]}>
                <cylinderGeometry args={[0.011, 0.011, 0.004, seg]} />
                <meshPhysicalMaterial {...barrel} />
              </mesh>
              <mesh position={[0, -0.046, 0]}>
                <cylinderGeometry args={[0.004, 0.004, 0.026, seg]} />
                <meshPhysicalMaterial {...mats.shell} />
              </mesh>
              {/* Protective needle cap, still on */}
              <mesh position={[0, 0.045, 0]}>
                <cylinderGeometry args={[0.0045, 0.0035, 0.028, seg]} />
                <meshPhysicalMaterial {...{ color: '#d8dde0', roughness: 0.4, metalness: 0 }} />
              </mesh>
            </group>
          ))}
          {/* Folded gauze squares */}
          {[0.05, 0.08].map((x, i) => (
            <Panel
              key={x}
              size={[0.042, 0.006, 0.042]}
              radius={0.003}
              position={[x, 0.014 + i * 0.006, 0.03]}
              rotation={[0, 0.3 * i, 0]}
              material={{ color: '#f6f4ef', roughness: 0.9, metalness: 0 }}
            />
          ))}
          {/* Capped vials */}
          {[0.09, 0.115].map((x, i) => (
            <group key={x} position={[x, 0.012, -0.05 + i * 0.02]}>
              <Lathe
                segments={seg}
                material={{ color: '#e8eef0', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.6 }}
                profile={[
                  [0, 0],
                  [0.009, 0],
                  [0.0095, 0.022],
                  [0.006, 0.028],
                  [0.0062, 0.033],
                  [0, 0.034],
                ]}
              />
              <mesh position={[0, 0.034, 0]}>
                <cylinderGeometry args={[0.0068, 0.0068, 0.005, seg]} />
                <meshPhysicalMaterial {...{ color: '#c8a24e', roughness: 0.35, metalness: 1 }} />
              </mesh>
            </group>
          ))}
        </>
      )}
    </group>
  )
}

/** Wall-mounted glove dispensers and a sharps bin — small, high-signal props. */
export function ConsumablesShelf({ detail, position, rotation }: BaseProps) {
  if (!detail) return null
  return (
    <group position={position} rotation={rotation}>
      {[-0.16, 0, 0.16].map((x, i) => (
        <Panel
          key={x}
          size={[0.14, 0.16, 0.07]}
          radius={0.008}
          position={[x, 0, 0]}
          material={{
            color: ['#dfe4e7', '#cdd7dc', '#e3dcd2'][i],
            roughness: 0.7,
            metalness: 0,
          }}
        />
      ))}
      {/* Sharps container — instantly readable as a clinical space */}
      <Panel size={[0.15, 0.2, 0.13]} radius={0.01} position={[0.4, -0.02, 0]} material={{ color: '#c8a02c', roughness: 0.55, metalness: 0 }} />
      <Panel size={[0.155, 0.035, 0.135]} radius={0.008} position={[0.4, 0.1, 0]} material={{ color: '#7a3f2a', roughness: 0.5, metalness: 0 }} />
      <Indicator position={[-0.3, 0.0, 0.045]} color="#8fe0b0" size={0.004} intensity={0.5} />
    </group>
  )
}
