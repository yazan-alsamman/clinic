import { Panel, Cable, Lathe, Screen, Grille, Indicator, Caster, ArticulatedArm, CASTER_HEIGHT } from '../hardware'
import type { ClinicMaterials } from '../clinicMaterials'

interface Props {
  mats: ClinicMaterials
  lowPower: boolean
  highlight: number
  detail: boolean
}

const SERUMS = ['#cfd8b4', '#e8cfd6', '#c9dbe4']

/**
 * A multifunction facial treatment platform of the kind a premium aesthetic
 * clinic actually buys: a wheeled console with a tilted touchscreen, a bay of
 * clear solution bottles feeding the system, three handpieces racked on the
 * top deck with their tubing dropping back into the body, and a vapour/
 * magnifier arm on the side.
 *
 * The bottle bay does most of the identification work — visible serum flasks
 * with fluid levels are specific to this class of device, and are the reason
 * it no longer reads as a generic white box. Origin is at floor level.
 */
export function AestheticStation({ mats, lowPower, highlight, detail }: Props) {
  const seg = lowPower ? 8 : 14
  const deckY = CASTER_HEIGHT + 0.03

  return (
    <group>
      {/* ── Console ──────────────────────────────────────────────── */}
      {([
        [-0.17, 0.17],
        [0.17, 0.17],
        [-0.17, -0.17],
        [0.17, -0.17],
      ] as const).map(([x, z], i) => (
        <Caster key={i} position={[x, CASTER_HEIGHT, z]} materials={mats} yaw={i * 1.1} lowPower={lowPower} />
      ))}
      <Panel size={[0.46, 0.055, 0.46]} radius={0.02} position={[0, deckY, 0]} material={mats.shellDark} />
      <Panel size={[0.44, 0.72, 0.44]} radius={0.045} position={[0, deckY + 0.39, 0]} material={mats.shell} />
      <Panel size={[0.448, 0.012, 0.448]} radius={0.004} position={[0, deckY + 0.42, 0]} material={mats.shellDark} />

      {/* Solution bay — recessed, with the flasks visible inside it */}
      <Panel size={[0.3, 0.24, 0.02]} radius={0.01} position={[0, deckY + 0.2, 0.22]} material={mats.shellDark} />
      {detail &&
        SERUMS.map((c, i) => {
          const x = -0.09 + i * 0.09
          return (
            <group key={c} position={[x, deckY + 0.1, 0.235]}>
              <Lathe
                segments={seg}
                material={{ color: '#eef4f6', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.4 }}
                profile={[
                  [0, 0],
                  [0.028, 0],
                  [0.03, 0.015],
                  [0.03, 0.15],
                  [0.017, 0.175],
                  [0.016, 0.195],
                  [0, 0.196],
                ]}
              />
              {/* Fluid level inside the flask */}
              <mesh position={[0, 0.055, 0]}>
                <cylinderGeometry args={[0.026, 0.026, 0.095, seg]} />
                <meshPhysicalMaterial color={c} roughness={0.18} metalness={0} transparent opacity={0.82} />
              </mesh>
              <mesh position={[0, 0.202, 0]}>
                <cylinderGeometry args={[0.018, 0.018, 0.014, seg]} />
                <meshPhysicalMaterial {...mats.shellDark} />
              </mesh>
            </group>
          )
        })}

      <Grille size={[0.22, 0.16]} slats={6} position={[0, deckY + 0.24, -0.222]} rotation={[0, Math.PI, 0]} material={mats.shellDark} />

      {/* ── Top deck: screen and racked handpieces ───────────────── */}
      <Panel size={[0.46, 0.1, 0.46]} radius={0.03} position={[0, deckY + 0.79, 0]} material={mats.shell} />
      <group position={[0, deckY + 0.92, 0.05]} rotation={[-0.44, 0, 0]}>
        <Panel size={[0.38, 0.27, 0.032]} radius={0.016} material={mats.shellDark} />
        <Screen size={[0.31, 0.21]} position={[0, 0, 0.024]} materials={mats} glow="#c6a6b4" intensity={0.28 + highlight * 0.2} />
      </group>
      {detail &&
        [-0.15, 0, 0.15].map((x, i) => (
          <group key={x}>
            {/* Holder cup */}
            <Lathe
              position={[x, deckY + 0.84, -0.15]}
              segments={seg}
              material={mats.shellDark}
              profile={[
                [0.018, 0],
                [0.03, 0],
                [0.031, 0.05],
                [0.024, 0.05],
                [0.022, 0.006],
                [0.018, 0.006],
              ]}
            />
            {/* Handpiece sitting in it */}
            <Lathe
              position={[x, deckY + 0.86, -0.15]}
              rotation={[0.14, 0, 0]}
              segments={seg}
              material={i === 1 ? mats.chrome : mats.shell}
              profile={[
                [0, 0],
                [0.014, 0.004],
                [0.016, 0.03],
                [0.015, 0.1],
                [0.011, 0.125],
                [0, 0.128],
              ]}
            />
            <Cable
              from={[x, deckY + 0.85, -0.16]}
              to={[x * 0.4, deckY + 0.74, -0.21]}
              sag={0.07}
              radius={0.005}
              material={{ color: '#dfe6ea', roughness: 0.3, metalness: 0, transparent: true, opacity: 0.75 }}
              segments={12}
            />
          </group>
        ))}
      <Indicator position={[0.16, deckY + 0.79, 0.225]} color="#8fe0c0" intensity={0.9 + highlight * 0.5} />

      {/* ── Vapour / magnifier arm ───────────────────────────────── */}
      <group position={[0.52, 0, -0.32]}>
        <Lathe
          segments={seg}
          material={mats.shellDark}
          profile={[
            [0, 0],
            [0.16, 0],
            [0.155, 0.03],
            [0.05, 0.05],
            [0, 0.05],
          ]}
        />
        <mesh position={[0, 0.63, 0]}>
          <cylinderGeometry args={[0.022, 0.028, 1.16, seg]} />
          <meshPhysicalMaterial {...mats.chrome} />
        </mesh>
        <ArticulatedArm
          joints={[
            [0, 1.21, 0],
            [-0.26, 1.36, 0.16],
            [-0.5, 1.2, 0.34],
          ]}
          radius={0.014}
          jointRadius={0.022}
          materials={mats}
          segments={lowPower ? 6 : 10}
        />
        {/* Steam head: glass vessel, heater collar, nozzle */}
        <group position={[-0.52, 1.16, 0.36]} rotation={[0.4, 0.5, 0]}>
          <Lathe
            segments={lowPower ? 10 : 18}
            material={{ color: '#e7f0f4', roughness: 0.07, metalness: 0, transparent: true, opacity: 0.42 }}
            profile={[
              [0, 0],
              [0.052, 0.012],
              [0.058, 0.06],
              [0.05, 0.1],
              [0.026, 0.115],
              [0, 0.118],
            ]}
          />
          <mesh position={[0, 0.008, 0]}>
            <cylinderGeometry args={[0.056, 0.05, 0.03, seg]} />
            <meshPhysicalMaterial {...mats.shell} />
          </mesh>
          <mesh position={[0, -0.05, 0.05]} rotation={[1.1, 0, 0]}>
            <cylinderGeometry args={[0.013, 0.016, 0.09, seg]} />
            <meshPhysicalMaterial {...mats.shell} />
          </mesh>
          {detail && <Indicator position={[0.05, 0.012, 0.03]} color="#ffb98a" intensity={0.7} />}
        </group>
      </group>
    </group>
  )
}
