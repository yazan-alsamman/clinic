import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group } from 'three'
import type { ServiceDef } from './serviceCatalog'
import { type Station, CORRIDOR, roomCenterX } from './walkthroughPath'
import { ServiceGeometry } from './ServiceGeometries'
import { DENTAL_LAMP_LIGHT } from './dentalLamp'
import { ShadowTag } from './shadows'
import { hasBakedOnce, requestShadowRefresh } from './shadowBudget'
import { claimLodUpgrade, noteSceneReady, prewarmOpen } from './lodBudget'

interface DepartmentEquipmentProps {
  def: ServiceDef
  station: Station
  active: boolean
  lowPower: boolean
}

/** Beyond this the room's small fittings do not resolve, so a room that has
 * never been approached is not built at full detail — which is what keeps the
 * first frame cheap.
 *
 * There is deliberately no threshold going the other way. An earlier version
 * tore the detail back down once the patient was 12.5 m past the room, and
 * rebuilt it if they scrolled back: measured, each rebuild is a synchronous
 * ~quarter-second of extruded-geometry construction, and reverse scrolling
 * through the corridor paid it again for every room, every time. Keeping a
 * built room built costs some resident geometry — five rooms of it by the end
 * of the walk, which measured at a few milliseconds of extra frame time — and
 * removes roughly three quarters of the stall from a traversal. */
const DETAIL_IN = 10
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
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const groupRef = useRef<Group>(null)
  const centre = useRef(new THREE.Vector3(roomCenterX(station), CORRIDOR.floorY + 0.9, station.z))
  const detailRef = useRef(false)
  const visibleRef = useRef(true)
  const [detail, setDetail] = useState(false)

  useFrame(({ camera }) => {
    const d = camera.position.distanceTo(centre.current)

    const shouldShow = d < CULL_DISTANCE
    if (groupRef.current) groupRef.current.visible = shouldShow
    // Shadow maps are frozen between refreshes, so anything that changes what
    // is actually in the room has to ask for one — otherwise a room that pops
    // into view keeps whatever shadows were baked while it was still culled.
    if (shouldShow !== visibleRef.current) {
      visibleRef.current = shouldShow
      requestShadowRefresh()
    }

    // Latched: once a room has been furnished it stays furnished. The only
    // transition left is off → on, and the budget lets one room take it at a
    // time so two rooms never build in the same frame.
    //
    // Two things can open that transition. Proximity is the original one, and
    // it remains the guarantee: a room the patient has reached is always
    // furnished, whatever else is going on. The second is the prewarm window —
    // once the opening frame is up and the camera is parked at reception, every
    // remaining room is furnished in turn while it is still culled, so the
    // build never lands on the frame the patient walks into the doorway on.
    const now = performance.now()
    if (hasBakedOnce()) noteSceneReady(now)
    if (!detailRef.current && (d < DETAIL_IN || prewarmOpen(now)) && claimLodUpgrade(now)) {
      detailRef.current = true
      setDetail(true)
    }
  })

  // Link this room's shaders before anything asks to draw them.
  //
  // Building the geometry is only half of a room's first-entry cost; the other
  // half is that three does not link a shader program until it first draws
  // something that uses it, and `getUniforms()` then blocks the main thread on
  // `getProgramParameter` until that program is ready. Profiled across a
  // natural traversal that was 5.2 s of frozen tab, arriving as roughly a
  // second per room at the exact moment the room came into view.
  //
  // `compileAsync` is the escape, but only in the targeted form: passing the
  // room's own group as the scene and the real scene as `targetScene` means
  // three gathers lights from the scene that will actually draw it, so the
  // programs it links carry the same cache keys the render will look up — and
  // it links only this room's materials rather than walking the whole clinic.
  // Readiness is then polled through `KHR_parallel_shader_compile`, so the
  // driver compiles in the background and nothing blocks.
  //
  // It matters that this runs while the room is still culled. `compile` gathers
  // materials with `traverse`, not `traverseVisible`, so an invisible group is
  // warmed perfectly well — and the previous attempt at prewarming failed
  // precisely because it ran before the scene had rendered a shadow map (see
  // `hasBakedOnce`), which this path now waits for.
  useEffect(() => {
    const group = groupRef.current
    if (!detail || !group) return
    try {
      // A browser without the extension, or an older three, still renders
      // correctly — it just pays the original first-use stall.
      void Promise.resolve(gl.compileAsync(group, camera, scene)).catch(() => {})
    } catch {
      /* warm-up is an optimisation; never let it break the room */
    }
  }, [detail, gl, camera, scene])

  const facing = station.side === 'left' ? -Math.PI / 2 : Math.PI / 2

  return (
    <group position={[roomCenterX(station), CORRIDOR.floorY, station.z]} rotation={[0, facing, 0]}>
      {/* The dental operating lamp's light, deliberately outside the culled
          group below. Its throw is 2.6 m, so it only ever lights the chair it
          hangs over and costs nothing when the patient is elsewhere in the
          corridor — but it has to stay *mounted* wherever they are. Culling it
          with the room would drop it out of `traverseVisible`, take
          NUM_POINT_LIGHTS from 9 to 8, and oblige three to compile a second
          shader program for every material in the clinic. See
          `DENTAL_LAMP_LIGHT`. */}
      {def.id === 'dentistry' && (
        <pointLight
          position={DENTAL_LAMP_LIGHT.position}
          intensity={lowPower ? 1.1 : 1.8}
          color={DENTAL_LAMP_LIGHT.color}
          distance={DENTAL_LAMP_LIGHT.distance}
          decay={2}
        />
      )}
      <group ref={groupRef}>
        <ShadowTag revision={detail}>
          <ServiceGeometry def={def} lowPower={lowPower} highlight={active ? 1 : 0} detail={detail} />
        </ShadowTag>
      </group>
    </group>
  )
}
