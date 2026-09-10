import * as THREE from 'three'
/**
 * Where the dental unit stands in its room.
 *
 * Exported, rather than inlined above, because the operating lamp's *light*
 * cannot live inside the unit. A room is culled by hiding its group, and three
 * gathers lights with `traverseVisible` — so a light inside a culled room drops
 * out of the light list, `NUM_POINT_LIGHTS` falls from 9 to 8, and every
 * material in the entire clinic needs a second shader program compiled for the
 * 8-light case. Measured, that one nested light was responsible for 16 of the
 * scene's 68 programs and for essentially all of the first-use link stalls
 * during a walk, because the variants prepared while the room was culled were
 * never the ones the renderer asked for once it came into view.
 *
 * So the light is mounted outside the cull group by `DepartmentEquipment`, and
 * this is the transform the two of them have to agree on.
 */
export const DENTAL_UNIT_PLACEMENT = {
  position: [0.15, 0, 0.15] as [number, number, number],
  rotationY: -0.62,
}

/** The lamp head's own offset within the unit. */
const DENTAL_LAMP_LOCAL: [number, number, number] = [0.06, 1.6, -0.36]

/** The operating lamp's light, in room-local space — the unit's placement
 * applied to the lamp head's offset, so it still sits at the lamp. */
export const DENTAL_LAMP_LIGHT = {
  position: new THREE.Vector3(...DENTAL_LAMP_LOCAL)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), DENTAL_UNIT_PLACEMENT.rotationY)
    .add(new THREE.Vector3(...DENTAL_UNIT_PLACEMENT.position))
    .toArray() as [number, number, number],
  color: '#fff3e2',
  distance: 2.6,
}
