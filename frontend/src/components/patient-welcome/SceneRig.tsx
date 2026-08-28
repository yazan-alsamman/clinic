import { useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'
import { lerp } from './easing'

interface SceneRigProps {
  children: ReactNode
  enabled: boolean
}

/** Wraps the whole composition and subtly tilts it toward the pointer — the
 * "premium spatial UI" reaction called for in the brief, not a full parallax gimmick. */
export function SceneRig({ children, enabled }: SceneRigProps) {
  const groupRef = useRef<Group>(null)
  const { pointer, camera } = useThree()

  useFrame(() => {
    if (!groupRef.current) return
    const targetY = enabled ? pointer.x * 0.22 : 0
    const targetX = enabled ? -pointer.y * 0.12 : 0
    groupRef.current.rotation.y = lerp(groupRef.current.rotation.y, targetY, 0.045)
    groupRef.current.rotation.x = lerp(groupRef.current.rotation.x, targetX, 0.045)

    const camTargetX = enabled ? pointer.x * 0.35 : 0
    const camTargetY = enabled ? 0.2 + pointer.y * 0.2 : 0.2
    // r3f's camera is a plain, imperative three.js Object3D — mutating its transform
    // every frame inside useFrame is the documented, standard way to drive it.
    // eslint-disable-next-line react-hooks/immutability
    camera.position.x = lerp(camera.position.x, camTargetX, 0.03)
    camera.position.y = lerp(camera.position.y, camTargetY, 0.03)
    camera.lookAt(0, 0.05, 0)
  })

  return <group ref={groupRef}>{children}</group>
}
