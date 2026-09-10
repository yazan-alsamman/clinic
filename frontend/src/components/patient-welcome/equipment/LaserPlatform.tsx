import { Panel, Shell, Seam, Cable, Lathe, Screen, Grille, Indicator, Caster, CASTER_HEIGHT } from '../hardware'
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

  const feet = [
    [-0.16, 0.19],
    [0.16, 0.19],
    [-0.16, -0.19],
    [0.16, -0.19],
  ] as const

  return (
    <group>
      {/* A ~90 kg wheeled console: four tight wheel pools plus the broad soft
          occlusion the overhanging cabinet casts between them. */}
      <ContactShadow size={[0.72, 0.82]} opacity={0.28} />
      <CasterShadows points={feet} radius={0.11} opacity={0.62} />
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
      {/* Three mouldings, not one box. A 780 mm column of a single white was
          the largest unbroken field on this asset; splitting it at the heights
          a real cabinet is actually split — plinth, lower body, upper body —
          and moulding the two bodies in slightly different grades gives the
          machine its own tonal steps before any light touches it. */}
      <Panel size={[0.4, 0.08, 0.48]} radius={0.008} position={[0, deckY + 0.06, 0]} material={mats.recess} />
      {/* Graphite lower body under the white upper. Three mouldings in three
          near-identical whites still resolved as one white column at the
          distance the doorway frames this machine from — a change of value is
          what separates them, and it is also how a real console is built: the
          lower body is the part that gets wheeled into and wiped down. */}
      <Panel size={[0.42, 0.34, 0.5]} radius={0.05} position={[0, deckY + 0.27, 0]} material={mats.bodyGraphite} />
      <Panel size={[0.42, 0.36, 0.5]} radius={0.05} position={[0, deckY + 0.62, 0]} material={mats.shell} />
      {/* Parting line between the upper and lower mouldings — real cabinets
          are assembled from separate shells, and the shadow gap shows it. */}
      <Seam size={[0.43, 0.51]} position={[0, deckY + 0.442, 0]} material={mats.recess} width={0.006} />
      {/* Curved front fascia, in two pieces split on the parting line. The
          face a patient actually sees is the one that most needs to stop being
          flat: a shallow arc sweeps its shading across the width instead of
          returning one constant tone. It used to be a single 660 mm sweep in
          one white, which meant it ran straight across the joint and covered
          the graphite lower body behind it — the machine kept reading as a
          white column from the only side anyone sees it from. */}
      <Shell
        outerRadius={1.1}
        innerRadius={1.07}
        halfAngle={0.19}
        length={0.35}
        position={[0, deckY + 0.62, -0.85]}
        rotation={[Math.PI / 2, 0, 0]}
        material={mats.shellSatin}
      />
      <Shell
        outerRadius={1.1}
        innerRadius={1.07}
        halfAngle={0.19}
        length={0.33}
        position={[0, deckY + 0.27, -0.85]}
        rotation={[Math.PI / 2, 0, 0]}
        material={mats.bodyGraphite}
      />
      {/* Recessed control fascia, in the dark grade */}
      <Panel size={[0.3, 0.4, 0.012]} radius={0.012} position={[0, deckY + 0.52, 0.256]} material={mats.shellDark} />
      {detail && (
        <>
          {/* Service panel and its fasteners on the operator flank */}
          <Panel size={[0.012, 0.26, 0.3]} radius={0.004} position={[-0.208, deckY + 0.27, -0.06]} material={mats.shellAlt} />
          {([-0.11, 0.11] as const).map((oy) => (
            <mesh key={oy} position={[-0.213, deckY + 0.27 + oy, -0.06]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.009, 0.009, 0.005, 8]} />
              <ClinicMaterial {...mats.brushedSteel} />
            </mesh>
          ))}
        </>
      )}

      {/* ── Control head ─────────────────────────────────────────── */}
      <Panel size={[0.44, 0.13, 0.5]} radius={0.035} position={[0, deckY + 0.86, 0]} material={mats.shellAlt} />
      <Seam size={[0.45, 0.51]} position={[0, deckY + 0.797, 0]} material={mats.recess} width={0.005} />
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
            <ClinicMaterial {...mats.brushedSteel} />
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
      {/* A second intake on the operator flank. The rear grille is the one a
          real chiller draws through, but it faces the wall from every angle
          the walkthrough composes — and a powered machine with no visible way
          to breathe is one of the quieter reasons a device reads as a prop. */}
      <Grille
        size={[0.3, 0.14]}
        slats={5}
        position={[0.212, deckY + 0.16, 0.06]}
        rotation={[0, Math.PI / 2, 0]}
        material={mats.shellDark}
      />
      {detail && (
        <>
          <mesh position={[0, deckY + 0.74, -0.28]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.016, 0.016, 0.34, seg]} />
            <ClinicMaterial {...mats.brushedSteel} />
          </mesh>
          {[-0.15, 0.15].map((x) => (
            <mesh key={x} position={[x, deckY + 0.74, -0.265]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.013, 0.013, 0.04, 8]} />
              <ClinicMaterial {...mats.brushedSteel} />
            </mesh>
          ))}
        </>
      )}

      {/* ── Handpiece in its cradle, on a slack umbilical ─────────── */}
      <mesh position={[0.235, deckY + 0.72, 0.02]} rotation={[Math.PI / 2, 0, 0.35]}>
        <torusGeometry args={[0.05, 0.011, 6, 14, Math.PI * 1.1]} />
        <ClinicMaterial {...mats.shellDark} />
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
          <ClinicMaterial color="#1b2028" roughness={0.08} metalness={0} />
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
