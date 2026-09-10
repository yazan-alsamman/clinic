import { Panel, Shell, Seam, Lathe, Screen, Grille, Indicator } from '../hardware'
import { ContactShadow, CasterShadows } from '../grounding'
import type { ClinicMaterials } from '../clinicMaterials'
import { ClinicMaterial } from '../ClinicMaterial'

interface Props {
  mats: ClinicMaterials
  lowPower: boolean
  highlight: number
  detail: boolean
}

const TUBE_MAT = { color: '#fff7ea', emissive: '#ffd9a4', roughness: 0.28, metalness: 0 }

/**
 * The bed's own acrylic grade — deliberately not the architectural glazing
 * used on the doors.
 *
 * At the grazing angles the walkthrough actually views this bed from, a
 * near-mirror acrylic returns the room rather than what is underneath it, and
 * the lamp array — the single feature that identifies the machine — vanishes
 * behind a flat white sheen. That is exactly what the bench read as: a blank
 * glossy lid. Real sunbed acrylic is lightly diffused anyway (it has to spread
 * the tubes into an even field over the body), so this grade is rougher, far
 * less reflective, and passes more of what is behind it.
 */
const BED_ACRYLIC = {
  color: '#eaf0f3',
  roughness: 0.24,
  metalness: 0,
  transparent: true,
  opacity: 0.13,
  envMapIntensity: 0.4,
}

/** Sheet-metal lamp holders. A tube has to be held at both ends by something,
 * and the dark cross-rail the sockets sit in is what makes the array read as
 * mounted hardware rather than as painted stripes. */
const HOLDER_MAT = { color: '#2a2b30', roughness: 0.62, metalness: 1, envMapIntensity: 0.5 }

// Deliberately mid-grey rather than white: a bright reflector behind bright
// tubes flattens into one white shape, and the tube array stops reading.
const REFLECTOR_MAT = { color: '#8f8c86', roughness: 0.3, metalness: 0 }

/**
 * A commercial canopy sunbed, 2.05 m long, shown half-open on its rear hinge.
 *
 * ── What changed in this pass, and why ──
 *
 * The previous version was mechanically correct — hinges, struts, lamp array,
 * vents — and still read as "a big flat white mass". Two reasons, both
 * structural rather than material:
 *
 * 1. The canopy was a flat slab. A flat surface returns one constant shade
 *    across its entire width; the deep-drawn arc of a real canopy sweeps
 *    continuously from a bright crown to a shaded flank across that same
 *    width. That sweep is the large-scale shading variation, and no texture
 *    can fake it. The canopy and the bench flanks are now genuinely curved
 *    (see `Shell`).
 *
 * 2. Every part used the same white. Real machines of this size are an
 *    assembly: a satin cowling, a slightly different moulding for the base,
 *    dark rubber edge seals, a stainless kick strip, an anodised hinge, a
 *    dark control module. Four or five materials at plausible boundaries do
 *    more to break up a white mass than any amount of noise on one material.
 *
 * The lamp array is still what makes the machine identifiable — parallel
 * low-pressure tubes behind acrylic in both bench and canopy, against a
 * reflector — so it keeps the detail budget.
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

  const feet = [
    [-0.38, -0.86],
    [0.38, -0.86],
    [-0.38, 0.86],
    [0.38, 0.86],
  ] as const

  return (
    <group>
      {/* This is a 300 kg machine standing on four levelling feet. The broad
          pool says "heavy body close to the floor"; the four dense pads say
          "and it is actually resting on these". */}
      <ContactShadow size={[1.35, 2.5]} opacity={0.34} />
      <CasterShadows points={feet} radius={0.13} opacity={0.6} />

      {/* ── Base unit ────────────────────────────────────────────── */}
      {feet.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.03, z]}>
          <cylinderGeometry args={[0.035, 0.042, 0.06, 8]} />
          <ClinicMaterial {...mats.shellDark} />
        </mesh>
      ))}

      {/* Recessed plinth. Setting the bottom 90 mm back and dark does two
          things a skirting does on a building: it puts the machine's weight
          on the floor, and it stops the flank reading as a single 600 mm
          slab of white running all the way down. */}
      <Panel size={[0.88, 0.09, 1.95]} radius={0.01} position={[0, 0.105, 0]} material={mats.recess} />

      {/* Main lower moulding, in the satin grade */}
      {/* Graphite, not white. From the doorway this bed presents roughly two
          square metres of body flank against a fraction of that in canopy, so
          while the body matched the hood and the bench surround the whole
          machine resolved as one continuous mass — and no seam, reveal or
          roughness work *inside* a value survives being read across a room.
          White hood over a darker base is also the standard commercial livery
          for the practical reason that makes it look right: the base is the
          part that gets kicked, wheeled into and wiped down. */}
      <Panel size={[0.98, 0.34, 2.05]} radius={0.05} position={[0, 0.32, 0]} material={mats.bodyGraphite} />
      {/* Curved flanks over the moulding. The bench sides of a real sunbed
          bulge; a vertical wall there is the giveaway that reads as furniture
          rather than as a moulded product.

          `Shell` sweeps its arc about local +Y, so the crown is aimed outward
          by rotating −90° about Z on the +X side and +90° on the −X side. The
          arc centre sits inboard of the body's own half-width so that the
          crown lands flush with it: the flank bulges, it does not widen the
          machine. */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <Shell
            outerRadius={0.2}
            innerRadius={0.15}
            halfAngle={0.85}
            length={2.02}
            position={[sx * 0.3, 0.36, 0]}
            rotation={[0, 0, -sx * (Math.PI / 2)]}
            material={mats.bodyGraphite}
          />
          {/* The reveal between the flank's two mouldings, following the same
              curve — a straight line across a curved surface would read as a
              decal rather than as a gap. */}
          <Shell
            outerRadius={0.207}
            innerRadius={0.196}
            halfAngle={0.05}
            length={1.9}
            position={[sx * 0.3, 0.36, 0]}
            rotation={[0, 0, -sx * (Math.PI / 2) + sx * 0.52]}
            material={mats.recess}
            radius={0.002}
          />
          {/* Satin trim rail lower down the flank. Two metres of unbroken
              white was the largest single field left on the machine, and no
              amount of roughness variation breaks up a field that size — it
              needs an actual change of material across it, which is what
              every commercial bed of this class carries anyway. Built as an
              arc on the flank's own radius so it follows the bulge instead of
              cutting across it. */}
          <Shell
            outerRadius={0.207}
            innerRadius={0.198}
            halfAngle={0.085}
            length={1.94}
            position={[sx * 0.3, 0.36, 0]}
            rotation={[0, 0, -sx * (Math.PI / 2) - sx * 0.5]}
            material={mats.brushedSteel}
            radius={0.003}
          />
        </group>
      ))}

      {/* Service access panel on the operator flank, with its gaps. Every one
          of these machines has one; it is where the ballasts live. */}
      {detail && (
        <>
          <Panel
            size={[0.012, 0.2, 0.62]}
            radius={0.004}
            position={[0.487, 0.33, -0.42]}
            material={mats.shellAlt}
          />
          {([-0.11, 0.11] as const).map((oz) => (
            <Seam
              key={oz}
              size={[0.012, 0.62]}
              position={[0.492, 0.33 + oz * 0.9, -0.42]}
              rotation={[0, 0, Math.PI / 2]}
              material={mats.recess}
              width={0.004}
            />
          ))}
          {/* Quarter-turn fasteners */}
          {([-0.24, 0.24] as const).map((oz) => (
            <mesh key={oz} position={[0.494, 0.33, -0.42 + oz]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.011, 0.011, 0.006, 8]} />
              <ClinicMaterial {...mats.brushedSteel} />
            </mesh>
          ))}
        </>
      )}

      {/* Moulding seam between the graphite lower shell and the white bench
          frame — the joint the two colours actually meet on. */}
      <Seam size={[1.0, 2.06]} position={[0, 0.497, 0]} material={mats.recess} width={0.008} />


      {/* Stainless kick strip along the foot end — where feet and trolleys
          actually hit the machine, and a real change of material. */}
      {detail && (
        <Panel size={[0.9, 0.1, 0.014]} radius={0.004} position={[0, 0.2, 1.028]} material={mats.brushedSteel} />
      )}

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

      {/* Rubber edge seal around the lamp bay. Dark, matte, and the single
          cheapest thing that stops the bench top reading as one white ring. */}
      {([
        [0.375, 0, 0.03, 1.94],
        [-0.375, 0, 0.03, 1.94],
        [0, 0.915, 0.82, 0.03],
        [0, -0.915, 0.82, 0.03],
      ] as const).map(([x, z, w, d], i) => (
        <Panel key={`s${i}`} size={[w, 0.022, d]} radius={0.008} position={[x, 0.66, z]} material={mats.rubber} />
      ))}

      {/* The lamp bay, finishing flush with the top of the surround.
          It used to sit 12 mm *below* the surround rails, which was wrong twice
          over: a person lies on the acrylic of a real bed, not on the frame
          around it, and — measured from the walkthrough's own camera — a
          110 mm rail standing proud of the bay hid the entire bench array
          behind it at standing eye height. From the doorway the bed then read
          as a machine with lamps only in its lid, which is the one thing a
          sunbed never is. Raising the whole bay so the acrylic finishes level
          with the surround fixes the section and the sightline together. */}
      <Panel size={[0.78, 0.03, 1.86]} radius={0.012} position={[0, 0.59, 0]} material={REFLECTOR_MAT} />
      {Array.from({ length: benchTubes }, (_, i) => {
        const x = -0.33 + (i / (benchTubes - 1)) * 0.66
        return (
          <mesh key={i} position={[x, 0.628, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.021, 0.021, 1.82, tubeSeg]} />
            <meshStandardMaterial {...TUBE_MAT} emissiveIntensity={lampGlow} toneMapped={false} />
          </mesh>
        )
      })}
      {/* Lamp holders at both ends of the bench array */}
      <Panel size={[0.72, 0.05, 0.05]} radius={0.008} position={[0, 0.624, -0.9]} material={HOLDER_MAT} />
      <Panel size={[0.72, 0.05, 0.05]} radius={0.008} position={[0, 0.624, 0.9]} material={HOLDER_MAT} />
      {/* The acrylic sits *inside* the surround, framed by the rails and
          finishing a few millimetres below them — the way a real bed's pane
          sits in its gasket. It used to be a 840 mm sheet laid over the top of
          the whole assembly, which covered the rails, the seals and the bay
          together and turned the bench into one blank lid. */}
      <Panel size={[0.76, 0.014, 1.86]} radius={0.02} position={[0, 0.648, 0]} material={BED_ACRYLIC} />

      {/* ── Canopy, on its rear hinge ────────────────────────────── */}
      {/* Hinge barrels the canopy actually pivots on */}
      {[-0.72, 0, 0.72].map((z) => (
        <mesh key={z} position={[-0.49, 0.66, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.032, 0.032, 0.16, seg]} />
          <ClinicMaterial {...mats.paintedSteel} />
        </mesh>
      ))}

      <group position={[-0.49, 0.66, 0]} rotation={[0, 0, canopyAngle]}>
        {/* The cowling itself: one deep-drawn arc, not a slab. This is the
            single biggest change in the asset — the crown-to-flank gradient
            it produces is what the material work had nothing to sit on. The
            arc rises ~290 mm over a 940 mm span, which is the proportion a
            real canopy has; a shallower curve reads as a hinged lid. */}
        <Shell
          outerRadius={0.52}
          innerRadius={0.455}
          halfAngle={1.12}
          length={1.98}
          position={[0.49, -0.287, 0]}
          material={mats.shellSatin}
        />
        {/* A narrower band of the second polymer grade along the crown, where
            a real canopy carries its moulded spine. */}
        <Shell
          outerRadius={0.532}
          innerRadius={0.516}
          halfAngle={0.24}
          length={1.9}
          position={[0.49, -0.287, 0]}
          material={mats.shellAlt}
        />
        {/* Inner liner, following the same curve. The inside of a moulding is
            never the same brightness as its outside, and a matching white in
            there is what made the open canopy read as a folded sheet of paper
            rather than a hood with a lamp bay inside it. */}
        <Shell
          outerRadius={0.452}
          innerRadius={0.436}
          halfAngle={1.08}
          length={1.9}
          position={[0.49, -0.287, 0]}
          material={mats.recess}
        />

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
        <Panel size={[0.74, 0.05, 0.05]} radius={0.008} position={[0.49, -0.03, -0.87]} material={HOLDER_MAT} />
        <Panel size={[0.74, 0.05, 0.05]} radius={0.008} position={[0.49, -0.03, 0.87]} material={HOLDER_MAT} />
        <Panel size={[0.86, 0.014, 1.84]} radius={0.03} position={[0.5, -0.062, 0]} material={BED_ACRYLIC} />
        {/* Rubber seal around the acrylic, as on the bench */}
        {([
          [0.075, 0],
          [0.925, 0],
        ] as const).map(([x], i) => (
          <Panel
            key={`cs${i}`}
            size={[0.03, 0.026, 1.86]}
            radius={0.008}
            position={[x, -0.055, 0]}
            material={mats.rubber}
          />
        ))}
        {/* Moulded end trim, following the hood's own curve. Flat rectangular
            caps were left over from when the hood was a slab, and against a
            290 mm arc they stood out past it as two pointed fins. */}
        {[-0.975, 0.975].map((z) => (
          <Shell
            key={z}
            outerRadius={0.462}
            innerRadius={0.424}
            halfAngle={1.09}
            length={0.045}
            position={[0.49, -0.287, z]}
            material={mats.shellAlt}
            radius={0.004}
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
            {/* Grab handle on the free edge, over-moulded in soft-touch the
                way a handle that gets pulled a hundred times a day is. */}
            <mesh position={[0.955, -0.048, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.017, 0.017, 0.66, seg]} />
              <ClinicMaterial {...mats.shellDark} />
            </mesh>
            {[-0.31, 0.31].map((z) => (
              <mesh key={z} position={[0.935, -0.02, z]} rotation={[0, 0, 0.4]}>
                <cylinderGeometry args={[0.012, 0.012, 0.08, 8]} />
                <ClinicMaterial {...mats.brushedSteel} />
              </mesh>
            ))}
          </>
        )}
      </group>

      {/* Gas struts holding the canopy open */}
      {[-0.68, 0.68].map((z) => (
        <group key={z}>
          <mesh position={[-0.16, 0.86, z]} rotation={[0, 0, -0.72]}>
            <cylinderGeometry args={[0.013, 0.013, 0.52, 8]} />
            <ClinicMaterial {...mats.chrome} />
          </mesh>
          <mesh position={[-0.28, 0.74, z]} rotation={[0, 0, -0.72]}>
            <cylinderGeometry args={[0.019, 0.019, 0.22, 8]} />
            <ClinicMaterial {...mats.shellDark} />
          </mesh>
        </group>
      ))}

      {/* ── Control panel at the foot end ────────────────────────── */}
      <group position={[0.3, 0.6, 0.94]} rotation={[-0.5, 0, 0]}>
        <Panel size={[0.28, 0.18, 0.03]} radius={0.012} material={mats.shellDark} />
        <Screen size={[0.11, 0.07]} position={[-0.05, 0.01, 0.022]} materials={mats} glow="#e8b57a" intensity={0.35} />
        {detail &&
          [0.04, 0.09].map((x, i) => (
            <Lathe
              key={x}
              position={[x, i === 0 ? 0.02 : -0.03, 0.016]}
              rotation={[Math.PI / 2, 0, 0]}
              segments={10}
              material={mats.shellAlt}
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
