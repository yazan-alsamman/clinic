import { useMemo } from 'react'
import type { ServiceDef } from './serviceCatalog'
import { makeClinicMaterials } from './clinicMaterials'
import { DentalUnit } from './equipment/DentalUnit'
import { LaserPlatform } from './equipment/LaserPlatform'
import { Solarium } from './equipment/Solarium'
import { DermatologyStation } from './equipment/DermatologyStation'
import { AestheticStation } from './equipment/AestheticStation'
import { TreatmentBed, MedicalTrolley, Stool, CabinetRun, SterileTray, ConsumablesShelf } from './equipment/RoomFurniture'

interface GeometryProps {
  def: ServiceDef
  lowPower: boolean
  highlight: number
  /** Distance-gated: false when the room is far enough away that small
   * fittings cost geometry without reading. */
  detail: boolean
}

/**
 * Each department is a furnished treatment room, not a hero object on a
 * plinth. The layout of every room follows how one is actually used —
 * equipment on the operator's side, casework against the back wall, a stool
 * where someone would sit, circulation space kept clear — because that
 * spatial logic is what a viewer reads as "a real room" before they have
 * consciously identified a single object in it.
 *
 * Local axes: the doorway is toward −Z, the back wall toward +Z, origin at
 * floor level in the middle of the room. Everything is placed at true metric
 * scale, and everything stands on the floor.
 */
export function ServiceGeometry({ def, lowPower, highlight, detail }: GeometryProps) {
  const mats = useMemo(() => makeClinicMaterials(lowPower), [lowPower])
  const shared = { mats, lowPower, detail }

  switch (def.id) {
    case 'dentistry':
      return (
        <group>
          <group position={[0.15, 0, 0.15]} rotation={[0, -0.62, 0]}>
            <DentalUnit mats={mats} lowPower={lowPower} highlight={highlight} detail={detail} />
          </group>
          <CabinetRun {...shared} position={[0.1, 0, 1.62]} rotation={[0, Math.PI, 0]} width={2.6} />
          <Stool {...shared} position={[-1.0, 0, -0.15]} rotation={[0, 0.7, 0]} />
          <MedicalTrolley {...shared} position={[-1.25, 0, 0.85]} rotation={[0, 0.5, 0]} />
          <ConsumablesShelf {...shared} position={[1.5, 1.25, 1.55]} rotation={[0, Math.PI, 0]} />
        </group>
      )

    case 'dermatology':
      return (
        <group>
          <group position={[-0.1, 0, 0.2]} rotation={[0, -0.5, 0]}>
            <DermatologyStation mats={mats} lowPower={lowPower} highlight={highlight} detail={detail} />
          </group>
          <CabinetRun {...shared} position={[0.2, 0, 1.62]} rotation={[0, Math.PI, 0]} width={2.4} />
          <MedicalTrolley {...shared} position={[1.35, 0, 0.45]} rotation={[0, -0.7, 0]} />
          <SterileTray {...shared} position={[1.35, 0.62, 0.45]} rotation={[0, -0.7, 0]} />
          <Stool {...shared} position={[-1.15, 0, -0.35]} rotation={[0, 0.4, 0]} />
          <ConsumablesShelf {...shared} position={[-1.4, 1.25, 1.55]} rotation={[0, Math.PI, 0]} />
        </group>
      )

    case 'skincare':
      return (
        <group>
          <TreatmentBed {...shared} position={[-0.45, 0, 0.15]} rotation={[0, 0.42, 0]} light />
          {/* Turned to present the solution bay: visible serum flasks are what
              distinguish a facial platform from a generic white console. */}
          <group position={[1.05, 0, 0.55]} rotation={[0, 2.55, 0]}>
            <AestheticStation mats={mats} lowPower={lowPower} highlight={highlight} detail={detail} />
          </group>
          <MedicalTrolley {...shared} position={[-1.5, 0, -0.5]} rotation={[0, 0.9, 0]} />
          <SterileTray {...shared} position={[-1.5, 0.62, -0.5]} rotation={[0, 0.9, 0]} />
          <CabinetRun {...shared} position={[-0.2, 0, 1.62]} rotation={[0, Math.PI, 0]} width={2.2} />
          <Stool {...shared} position={[0.15, 0, -0.75]} rotation={[0, -0.3, 0]} />
        </group>
      )

    case 'solarium':
      return (
        <group>
          {/* Turned so the canopy's open mouth — and the lamp array inside it
              — faces the doorway. Opening away from the viewer showed only a
              blank moulded shell, which is what made this read as a capsule. */}
          <group position={[0.15, 0, 0.35]} rotation={[0, 1.2, 0]}>
            <Solarium mats={mats} lowPower={lowPower} highlight={highlight} detail={detail} />
          </group>
          {/* Changing bench — a tanning room is a private room, not a machine
              bay, and the bench is what says so. */}
          <CabinetRun {...shared} position={[-1.55, 0, 1.5]} rotation={[0, Math.PI, 0]} width={1.4} wallUnits={false} />
          <MedicalTrolley {...shared} position={[1.5, 0, -0.55]} rotation={[0, -0.8, 0]} />
        </group>
      )

    case 'laser':
      return (
        <group>
          <TreatmentBed {...shared} position={[-0.4, 0, 0.2]} rotation={[0, 0.38, 0]} />
          {/* Angled so both the console face and the handpiece in its cradle
              are toward the doorway — the handpiece is the single feature that
              identifies this as a hair-removal laser rather than any cabinet. */}
          <group position={[1.05, 0, 0.3]} rotation={[0, 2.44, 0]}>
            <LaserPlatform mats={mats} lowPower={lowPower} highlight={highlight} detail={detail} />
          </group>
          <Stool {...shared} position={[0.5, 0, -0.7]} rotation={[0, -0.5, 0]} />
          <MedicalTrolley {...shared} position={[-1.55, 0, -0.35]} rotation={[0, 0.85, 0]} />
          <SterileTray {...shared} position={[-1.55, 0.62, -0.35]} rotation={[0, 0.85, 0]} />
          <CabinetRun {...shared} position={[0, 0, 1.62]} rotation={[0, Math.PI, 0]} width={2.4} />
          <ConsumablesShelf {...shared} position={[1.45, 1.25, 1.55]} rotation={[0, Math.PI, 0]} />
        </group>
      )

    default:
      return null
  }
}
