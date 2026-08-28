import { useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'
import type { ScenePhase } from './types'
import { lerp } from './easing'

interface SceneRigProps {
  children: ReactNode
  phase: ScenePhase
  parallaxEnabled: boolean
  instant: boolean
}

// Establishing wide shot → the arrived, composed shot → a final forward push on exit.
const CAM_ESTABLISH = { x: 0, y: 0.95, z: 9.6 }
const CAM_ARRIVED = { x: 0, y: 0.2, z: 6.4 }
const CAM_EXIT_PUSH = { x: 0, y: 0.05, z: 4.6 }

function dollyTargetFor(phase: ScenePhase): number {
  switch (phase) {
    case 'dark':
      return 0
    case 'logo':
      return 0.4
    case 'services':
      return 0.8
    case 'exiting':
      return 1.4
    case 'interactive':
    default:
      return 1
  }
}

/** Wraps the whole composition: drives the cinematic camera dolly (wide
 * establishing shot → arrived → forward push on exit) and, once arrived, a
 * subtle pointer-reactive tilt — the "premium spatial UI" reaction, not a
 * full parallax gimmick. */
export function SceneRig({ children, phase, parallaxEnabled, instant }: SceneRigProps) {
  const groupRef = useRef<Group>(null)
  const dollyT = useRef(instant ? 1 : 0)
  const { pointer, camera } = useThree()

  useFrame(() => {
    if (!groupRef.current) return

    dollyT.current = lerp(dollyT.current, dollyTargetFor(phase), 0.02)
    const t = dollyT.current

    const base =
      t <= 1
        ? {
            x: lerp(CAM_ESTABLISH.x, CAM_ARRIVED.x, t),
            y: lerp(CAM_ESTABLISH.y, CAM_ARRIVED.y, t),
            z: lerp(CAM_ESTABLISH.z, CAM_ARRIVED.z, t),
          }
        : {
            x: lerp(CAM_ARRIVED.x, CAM_EXIT_PUSH.x, t - 1),
            y: lerp(CAM_ARRIVED.y, CAM_EXIT_PUSH.y, t - 1),
            z: lerp(CAM_ARRIVED.z, CAM_EXIT_PUSH.z, t - 1),
          }

    const parallax = parallaxEnabled && phase === 'interactive'
    const camTargetX = base.x + (parallax ? pointer.x * 0.3 : 0)
    const camTargetY = base.y + (parallax ? pointer.y * 0.18 : 0)

    // r3f's camera is a plain, imperative three.js Object3D — mutating its transform
    // every frame inside useFrame is the documented, standard way to drive it.
    // eslint-disable-next-line react-hooks/immutability
    camera.position.x = lerp(camera.position.x, camTargetX, 0.05)
    camera.position.y = lerp(camera.position.y, camTargetY, 0.05)
    camera.position.z = lerp(camera.position.z, base.z, 0.05)
    camera.lookAt(0, 0.1, -0.3)

    const targetTiltY = parallax ? pointer.x * 0.16 : 0
    const targetTiltX = parallax ? -pointer.y * 0.08 : 0
    groupRef.current.rotation.y = lerp(groupRef.current.rotation.y, targetTiltY, 0.045)
    groupRef.current.rotation.x = lerp(groupRef.current.rotation.x, targetTiltX, 0.045)
  })

  return <group ref={groupRef}>{children}</group>
}
