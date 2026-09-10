import { Panel, Seam, Cushion, Cable, CoiledCable, Lathe, Screen, Indicator, ArticulatedArm } from '../hardware'
import { ContactShadow } from '../grounding'
import type { ClinicMaterials } from '../clinicMaterials'
import { ClinicMaterial } from '../ClinicMaterial'

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

/** Positions of the individual LED optics across the lamp face. A surgical
 * light emits from a lens array, and modelling it as one uniform glowing
 * rectangle is what made this head read as a light box with a white lid — the
 * discrete lenses are the feature that identifies the object at a glance.
 * Three across at distance, six close up. */
const LENS_GRID: readonly (readonly [number, number])[] = [
  [-0.15, -0.045],
  [0, -0.045],
  [0.15, -0.045],
  [-0.15, 0.045],
  [0, 0.045],
  [0.15, 0.045],
]
const LENS_ROW: readonly (readonly [number, number])[] = [
  [-0.15, 0],
  [0, 0],
  [0.15, 0],
]
export function DentalUnit({ mats, lowPower, highlight, detail }: Props) {
  const seg = lowPower ? 10 : 20
  const lampOn = 0.55 + highlight * 0.5

  return (
    <group>
      {/* Grounding. A dental unit is a ~200 kg pedestal bolted through the
          floor, and the dense pool of occlusion right at its foot is what
          makes it read that way rather than as a chair resting on a picture
          of a floor. The lamp post and the foot control get their own, much
          smaller, because they are separate objects touching the floor
          separately — one shared blob would fuse them into a single mass. */}
      <ContactShadow size={[1.1, 1.5]} opacity={0.34} />
      <ContactShadow size={[0.86, 0.62]} opacity={0.66} />
      <ContactShadow position={[0.36, 0, -1.08]} size={[0.24, 0.24]} opacity={0.6} />
      {detail && <ContactShadow position={[-0.5, 0, 0.5]} size={[0.34, 0.34]} opacity={0.5} />}
      {detail && <ContactShadow position={[-0.56, 0, -0.5]} size={[0.2, 0.2]} opacity={0.55} />}
      {/* ── Pedestal ─────────────────────────────────────────────── */}
      {/* Rubber foot bumper under the base casting. A 200 kg pedestal does not
          meet a stone floor in bare plastic, and the dark band at the very
          bottom is also what stops the base looking like a white slab that has
          been pushed down into the floor. */}
      <Panel size={[0.63, 0.022, 0.39]} radius={0.008} position={[0, 0.011, 0]} material={mats.rubber} />
      <Panel size={[0.62, 0.055, 0.38]} radius={0.028} position={[0, 0.05, 0]} material={mats.shellDark} />
      {/* The shroud is two mouldings, not one. A real pedestal is a base cowl
          bolted to a column cowl, and the recessed ring where they meet is the
          only large-scale shading break available on an otherwise featureless
          white cone — without it the entire lower half of the unit returns one
          constant tone from every angle in the walkthrough. The two cowls are
          moulded in different grades, as they are on the real machine. */}
      <Lathe
        position={[0, 0, 0]}
        segments={seg}
        material={mats.shellAlt}
        profile={[
          [0, 0.078],
          [0.17, 0.078],
          [0.163, 0.13],
          [0.118, 0.243],
          [0, 0.243],
        ]}
      />
      <mesh position={[0, 0.252, 0]}>
        <cylinderGeometry args={[0.111, 0.111, 0.024, seg]} />
        <ClinicMaterial {...mats.recess} />
      </mesh>
      <Lathe
        position={[0, 0, 0]}
        segments={seg}
        material={mats.shellSatin}
        profile={[
          [0, 0.26],
          [0.114, 0.26],
          [0.104, 0.4],
          [0.096, 0.44],
          [0, 0.45],
        ]}
      />
      {/* Telescoping ram — the visible hydraulic stage — inside the concertina
          boot every hydraulic chair carries over it. Bare chrome emerging from
          a white cone was the one place on this unit where two materials met
          with no component between them. */}
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.062, 0.062, 0.12, seg]} />
        <ClinicMaterial {...mats.chrome} />
      </mesh>
      <mesh position={[0, 0.474, 0]}>
        <cylinderGeometry args={[0.073, 0.079, 0.056, seg]} />
        <ClinicMaterial {...mats.rubber} />
      </mesh>
      {detail &&
        [0.461, 0.488].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.077, 0.006, 4, Math.max(8, seg)]} />
            <ClinicMaterial {...mats.rubber} />
          </mesh>
        ))}
      {/* Structural spine the cushions bolt onto */}
      <Panel size={[0.42, 0.055, 1.12]} radius={0.02} position={[0, 0.555, -0.08]} material={mats.shellDark} />

      {/* ── Chair ────────────────────────────────────────────────── */}
      {/* Moulded pans under the upholstery. A dental pad is vinyl over foam
          clipped into a plastic shell, and the ~10 mm of that shell showing
          around the edge of each pad is what separates the pads from one
          another and from the frame — without them the chair reads as three
          dark slabs floating above a white pedestal. */}
      <Panel size={[0.52, 0.045, 0.6]} radius={0.02} position={[0, 0.583, 0.14]} material={mats.shellAlt} />
      <Panel
        size={[0.5, 0.045, 0.5]}
        radius={0.02}
        position={[0, 0.607, -0.35]}
        rotation={[-0.05, 0, 0]}
        material={mats.shellAlt}
      />
      <Panel
        size={[0.42, 0.045, 0.52]}
        radius={0.02}
        position={[0, 0.632, -0.81]}
        rotation={[-0.05, 0, 0]}
        material={mats.shellAlt}
      />
      <Panel
        size={[0.42, 0.04, 0.7]}
        radius={0.018}
        position={[0, 0.556, 0.72]}
        rotation={[0.09, 0, 0]}
        material={mats.shellAlt}
      />
      <Cushion size={[0.5, 0.56, 0.15]} position={[0, 0.645, 0.14]} material={mats.upholstery} radius={0.07} />
      {/* The backrest is two pads, and the upper one is narrower.
          A dental backrest tapers hard toward the shoulders — it has to, or
          the operator cannot get to the patient's head — and building it as
          one 480 mm slab running the whole length gave the chair the
          silhouette of a bench. Splitting it at the lumbar break and pulling
          60 mm off each side of the shoulder section is the single change
          that makes this read as a treatment chair from the doorway, and it
          also puts a real articulation joint where the chair actually folds. */}
      <Cushion
        size={[0.48, 0.46, 0.14]}
        position={[0, 0.672, -0.36]}
        rotation={[-0.05, 0, 0]}
        material={mats.upholstery}
        radius={0.075}
      />
      <Cushion
        size={[0.4, 0.5, 0.13]}
        position={[0, 0.695, -0.81]}
        rotation={[-0.05, 0, 0]}
        material={mats.upholstery}
        radius={0.08}
      />
      {/* Headrest on its slider — the two-stage articulation real chairs have */}
      <mesh position={[0, 0.66, -1.06]} rotation={[Math.PI / 2 - 0.05, 0, 0]}>
        <cylinderGeometry args={[0.016, 0.016, 0.14, 8]} />
        <ClinicMaterial {...mats.chrome} />
      </mesh>
      <Cushion
        size={[0.25, 0.26, 0.11]}
        position={[0, 0.7, -1.14]}
        rotation={[-0.14, 0, 0]}
        material={mats.upholstery}
        radius={0.055}
      />
      <Cushion
        size={[0.4, 0.66, 0.13]}
        position={[0, 0.618, 0.72]}
        rotation={[0.09, 0, 0]}
        material={mats.upholstery}
        radius={0.07}
      />
      {/* The break between the seat and the back. Two pads whose bevels meet
          with nothing between them fuse into one moulded piece; the recess is
          what keeps them reading as separate upholstered components. */}
      <Seam size={[0.5, 0.045]} position={[0, 0.695, -0.145]} material={mats.recess} width={0.03} />

      {/* Armrests — bar plus its drop bracket, on both sides */}
      {[-0.29, 0.29].map((x) => (
        <group key={x}>
          <Panel size={[0.055, 0.05, 0.42]} radius={0.024} position={[x, 0.775, 0.04]} material={mats.shellDark} />
          {/* Elastomer top face — the part a patient's forearm actually rests
              on, and a third material on a component that was one dark box. */}
          <Panel size={[0.05, 0.014, 0.4]} radius={0.006} position={[x, 0.803, 0.04]} material={mats.softTouch} />
          <mesh position={[x, 0.7, 0.2]}>
            <cylinderGeometry args={[0.013, 0.013, 0.16, 8]} />
            <ClinicMaterial {...mats.chrome} />
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
        {/* Two mouldings with a parting line between them rather than one
            white brick: the upper shell carries the tray and the display, the
            lower one the hose outlets, and they are moulded in different
            grades the way a real console's are. This is the piece the patient
            looks at for the longest — it hangs directly over the chair — so
            it is the one that could least afford to be a single flat field. */}
        <Panel size={[0.42, 0.062, 0.3]} radius={0.02} position={[0, 0.029, 0]} material={mats.shell} />
        <Panel size={[0.412, 0.058, 0.292]} radius={0.016} position={[0, -0.031, 0]} material={mats.shellAlt} />
        <Seam size={[0.43, 0.31]} position={[0, -0.0015, 0]} material={mats.recess} width={0.005} />
        <Panel size={[0.38, 0.012, 0.26]} radius={0.006} position={[0, 0.066, 0]} material={mats.brushedSteel} />
        <Screen size={[0.15, 0.09]} position={[0, 0.01, 0.152]} materials={mats} glow="#8fb6cf" intensity={0.3 + highlight * 0.25} />
        {/* Soft-touch positioning bar. The console is swung over the patient a
            dozen times a day and this is the part the dentist actually grips —
            elastomer over the moulding, at a true 28 mm diameter. */}
        <mesh position={[0, -0.022, 0.166]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.014, 0.014, 0.34, lowPower ? 6 : 10]} />
          <ClinicMaterial {...mats.softTouch} />
        </mesh>
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
          {/* Column: dark and slim. In white it read as scaffolding parked in
              the middle of the composition, which is the opposite of what a
              cuspidor pillar does in a real operatory. */}
          <mesh position={[0, 0.42, 0]}>
            <cylinderGeometry args={[0.028, 0.036, 0.84, seg]} />
            <ClinicMaterial {...mats.shellDark} />
          </mesh>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.075, 0.085, 0.04, seg]} />
            <ClinicMaterial {...mats.shellDark} />
          </mesh>
          {/* Rubber floor grommet. Every free-standing column in a wet room
              has one, and it is what puts this pillar *on* the floor rather
              than through it. */}
          <mesh position={[0, 0.008, 0]}>
            <cylinderGeometry args={[0.088, 0.093, 0.016, seg]} />
            <ClinicMaterial {...mats.rubber} />
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
            <ClinicMaterial {...mats.chrome} />
          </mesh>
        </group>
      )}

      {/* ── Operating light on its post ──────────────────────────── */}
      {/* Slim and dark on purpose: a pale full-height column parked beside the
          chair reads as scaffolding and steals the shot from the chair. */}
      <mesh position={[0.36, 0.98, -1.08]}>
        <cylinderGeometry args={[0.026, 0.032, 1.96, seg]} />
        <ClinicMaterial {...mats.shellDark} />
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
        {/* The head is a white upper cowl clipped onto a dark optic housing,
            with the shadow gap between them. A single white slab with a
            glowing underside is the shape a lamp has in a diagram, not the
            two-part moulding an LED operating light actually is. */}
        <Panel size={[0.54, 0.058, 0.22]} radius={0.028} position={[0, 0.026, 0]} material={mats.shell} />
        <Seam size={[0.55, 0.23]} position={[0, -0.005, 0]} material={mats.recess} width={0.005} />
        <Panel size={[0.52, 0.048, 0.21]} radius={0.018} position={[0, -0.032, 0]} material={mats.shellDark} />
        {/* Optic plate: a pale reflector face carrying the individual lenses,
            rather than one uniformly emitting rectangle. The plate itself is
            only faintly lit; the lenses below carry the output. */}
        <mesh position={[0, -0.0585, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.47, 0.17]} />
          <meshStandardMaterial
            color="#d9d6ce"
            emissive="#fff1dc"
            emissiveIntensity={lampOn * 0.3}
            roughness={0.35}
            metalness={0}
          />
        </mesh>
        {(detail ? LENS_GRID : LENS_ROW).map(([lx, lz], i) => (
          <mesh key={i} position={[lx, -0.0595, lz]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.034, lowPower ? 8 : 14]} />
            <meshStandardMaterial
              color="#fffaf2"
              emissive="#fff4e4"
              emissiveIntensity={lampOn * 1.4}
              roughness={0.18}
              toneMapped={false}
            />
          </mesh>
        ))}
        {/* Sterilisable handle each side — over-moulded in elastomer, which is
            what they are, rather than in the same hard dark plastic as the
            housing they are bolted to. */}
        {detail &&
          [-0.3, 0.3].map((x) => (
            <mesh key={x} position={[x, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.045, 0.009, 6, 14, Math.PI]} />
              <ClinicMaterial {...mats.softTouch} />
            </mesh>
          ))}
      </group>
      {/* The operating lamp's light is mounted by `DepartmentEquipment`, not
          here: a light inside this group would be culled with the room, and a
          light that comes and goes changes NUM_POINT_LIGHTS and doubles the
          scene's shader programs. See `DENTAL_LAMP_LIGHT`. */}

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
