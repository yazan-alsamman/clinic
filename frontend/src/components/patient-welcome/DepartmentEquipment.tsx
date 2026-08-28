import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group } from 'three'
import type { ServiceDef } from './serviceCatalog'
import { type Station, CORRIDOR, roomCenterX } from './walkthroughPath'
import { ServiceGeometry } from './ServiceGeometries'

interface DepartmentEquipmentProps {
  def: ServiceDef
  station: Station
  active: boolean
  lowPower: boolean
}

/** Beyond this the room's small fittings stop resolving, so they stop being
 * built. Hysteresis on the way back out prevents a visible pop if the patient
 * parks the camera exactly on the boundary. */
const DETAIL_IN = 10
const DETAIL_OUT = 12.5
/** A room this far down the corridor is a few dark pixels through a doorway;
 * skipping it entirely keeps at most three rooms in the draw call budget. */
const CULL_DISTANCE = 17

/**
 * A department's furnished room, standing on the floor of the building.
 *
 * Everything in here is stationary. The earlier version gently bobbed the
 * equipment, rotated it, and scaled it up when the camera looked at it — and
 * a levitating, slowly spinning, breathing dental chair is a stronger cue
 * that the scene is a 3D toy than any amount of material work can undo.
 * Real fittings are bolted down, so these are too: the only thing that
 * changes as the patient walks past is which lights are up.
 */
export function DepartmentEquipment({ def, station, active, lowPower }: DepartmentEquipmentProps) {
  const groupRef = useRef<Group>(null)
  const centre = useRef(new THREE.Vector3(roomCenterX(station), CORRIDOR.floorY + 0.9, station.z))
  const detailRef = useRef(false)
  const [detail, setDetail] = useState(false)

  useFrame(({ camera }) => {
    const d = camera.position.distanceTo(centre.current)

    if (groupRef.current) groupRef.current.visible = d < CULL_DISTANCE

    const want = detailRef.current ? d < DETAIL_OUT : d < DETAIL_IN
    if (want !== detailRef.current) {
      detailRef.current = want
      setDetail(want)
    }
  })

  const facing = station.side === 'left' ? -Math.PI / 2 : Math.PI / 2

  return (
    <group ref={groupRef} position={[roomCenterX(station), CORRIDOR.floorY, station.z]} rotation={[0, facing, 0]}>
      <ServiceGeometry def={def} lowPower={lowPower} highlight={active ? 1 : 0} detail={detail} />
    </group>
  )
}
