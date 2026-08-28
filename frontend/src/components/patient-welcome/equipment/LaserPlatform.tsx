import { Panel, Cable, Lathe, Screen, Grille, Indicator, Caster, CASTER_HEIGHT } from '../hardware'
import type { ClinicMaterials } from '../clinicMaterials'

interface Props {
  mats: ClinicMaterials
  lowPower: boolean
  highlight: number
  detail: boolean
}

/**
 * A professional diode hair-removal platform, in the standard trolley-console
 * form factor: a wheeled cabinet about 1.2 m tall, a tilted touchscreen at
 * working height, a cooled handpiece resting in its cradle on a thick
 * umbilical, ventilation for the chiller, a push handle, a key switch and an
 * emergency stop.
 *
 * The deliberate restraint here is the lighting: a real medical laser is a
 * matte off-white cabinet with two or three 3 mm status LEDs. Everything that
 * previously made this read as sci-fi — the large emissive panels, the glowing
 * accent-coloured aperture — is gone; the only light it emits is a standby LED
 * and the dim UI behind the screen glass. Origin is at floor level.
 */
export function LaserPlatform({ mats, lowPower, highlight, detail }: Props) {
  const seg = lowPower ? 10 : 18
  const deckY = CASTER_HEIGHT + 0.03

  return (
    <group>
      {/* ── Wheeled chassis ──────────────────────────────────────── */}
      {([
        [-0.16, 0.19],
        [0.16, 0.19],
        [-0.16, -0.19],
        [0.16, -0.19],
      ] as const).map(([x, z], i) => (
        <Caster
          key={i}
          position={[x, CASTER_HEIGHT, z]}
          materials={mats}
          yaw={i * 0.7}
          lowPower={lowPower}
        />
      ))}
      <Panel size={[0.44, 0.06, 0.52]} radius={0.022} position={[0, deckY, 0]} material={mats.shellDark} />

      {/* ── Cabinet ──────────────────────────────────────────────── */}
      <Panel size={[0.42, 0.78, 0.5]} radius={0.05} position={[0, deckY + 0.42, 0]} material={mats.shell} />
      {/* Parting line between the upper and lower mouldings — real cabinets
          are assembled from separate shells, and the shadow gap shows it. */}
      <Panel size={[0.428, 0.012, 0.508]} radius={0.004} position={[0, deckY + 0.44, 0]} material={mats.shellDark} />
      {/* Recessed front fascia, slightly proud of the shell */}
      <Panel size={[0.3, 0.42, 0.01]} radius={0.012} position={[0, deckY + 0.5, 0.253]} material={mats.shellDark} />

      {/* ── Control head ─────────────────────────────────────────── */}
      <Panel size={[0.44, 0.13, 0.5]} radius={0.035} position={[0, deckY + 0.86, 0]} material={mats.shell} />
      <group position={[0, deckY + 1.0, 0.06]} rotation={[-0.46, 0, 0]}>
        <Panel size={[0.4, 0.3, 0.035]} radius={0.018} material={mats.shellDark} />
        <Screen
          size={[0.33, 0.24]}
          position={[0, 0, 0.026]}
          materials={mats}
          glow="#86a9c6"
          intensity={0.3 + highlight * 0.22}
        />
      </group>

      {/* Emergency stop and key switch — the two controls every medical laser
          is required to carry, and instantly readable as clinical hardware. */}
      {detail && (
        <>
          <Lathe
            position={[0.14, deckY + 0.78, 0.26]}
            rotation={[Math.PI / 2, 0, 0]}
            segments={lowPower ? 8 : 14}
            material={{ color: '#a3221d', roughness: 0.42, metalness: 0 }}
            profile={[
              [0, 0],
              [0.026, 0],
              [0.028, 0.012],
              [0.022, 0.018],
              [0, 0.02],
            ]}
          />
          <mesh position={[-0.02, deckY + 0.78, 0.258]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.014, 0.014, 0.008, 10]} />
            <meshPhysicalMaterial {...mats.brushedSteel} />
          </mesh>
          <Indicator position={[-0.09, deckY + 0.78, 0.259]} color="#6fdc9a" intensity={1.1 + highlight * 0.5} />
          <Indicator position={[-0.13, deckY + 0.78, 0.259]} color="#e0b45c" intensity={0.5} />
        </>
      )}

      {/* ── Cooling intake and rear handle ───────────────────────── */}
      <Grille
        size={[0.26, 0.2]}
        slats={7}
        position={[0, deckY + 0.22, -0.253]}
        rotation={[0, Math.PI, 0]}
        material={mats.shellDark}
      />
      {detail && (
        <>
          <mesh position={[0, deckY + 0.74, -0.28]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.016, 0.016, 0.34, seg]} />
            <meshPhysicalMaterial {...mats.brushedSteel} />
          </mesh>
          {[-0.15, 0.15].map((x) => (
            <mesh key={x} position={[x, deckY + 0.74, -0.265]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.013, 0.013, 0.04, 8]} />
              <meshPhysicalMaterial {...mats.brushedSteel} />
            </mesh>
          ))}
        </>
      )}

      {/* ── Handpiece in its cradle, on a slack umbilical ─────────── */}
      <mesh position={[0.235, deckY + 0.72, 0.02]} rotation={[Math.PI / 2, 0, 0.35]}>
        <torusGeometry args={[0.05, 0.011, 6, 14, Math.PI * 1.1]} />
        <meshPhysicalMaterial {...mats.shellDark} />
      </mesh>
      <group position={[0.25, deckY + 0.78, 0.02]} rotation={[0, 0, -0.32]}>
        <Lathe
          segments={seg}
          material={mats.shell}
          profile={[
            [0, -0.11],
            [0.03, -0.115],
            [0.036, -0.09],
            [0.034, 0.02],
            [0.038, 0.05],
            [0.037, 0.1],
            [0.03, 0.115],
            [0, 0.118],
          ]}
        />
        {/* Sapphire treatment window at the business end — dark, not glowing */}
        <mesh position={[0, -0.117, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.028, 0.018]} />
          <meshPhysicalMaterial color="#1b2028" roughness={0.08} metalness={0} />
        </mesh>
        {detail && <Indicator position={[0.031, 0.04, 0.016]} color="#6fdc9a" size={0.0035} intensity={0.8} />}
      </group>
      <Cable
        from={[0.26, deckY + 0.9, 0.02]}
        to={[0.12, deckY + 0.99, -0.16]}
        sag={0.16}
        bow={0.05}
        radius={0.016}
        material={mats.rubber}
        segments={lowPower ? 12 : 22}
      />

      {/* Mains lead running off to the wall — grounds the machine in the room */}
      {detail && (
        <Cable
          from={[-0.14, deckY - 0.02, -0.22]}
          to={[-0.66, 0.012, -0.5]}
          sag={0.06}
          radius={0.009}
          material={mats.rubber}
          segments={14}
        />
      )}
    </group>
  )
}
