import { useRef, type ReactNode, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PointLight } from 'three'
import { sampleWalkthrough } from './walkthroughPath'

interface SceneRigProps {
  children: ReactNode
  progressRef: RefObject<number>
  velocityRef: RefObject<number>
  isTouch: boolean
}

/** The walkthrough camera. All the "inertia/damping/settle" work already
 * happened upstream in useWalkthroughProgress — this just samples the path at
 * the current (already-smoothed) journey position each frame, adds a barely-
 * perceptible walking sway/bob scaled to how fast the patient is currently
 * moving (near-zero once they stop — a human settles, a drone doesn't), and
 * carries one small point light that follows the camera, since no fixed rig
 * of lights can reach every point along a 30-unit corridor. */
export function SceneRig({ children, progressRef, velocityRef, isTouch }: SceneRigProps) {
  const headlightRef = useRef<PointLight>(null)
  const { camera, pointer } = useThree()
  const swayPhase = useRef(0)

  useFrame(() => {
    const progress = progressRef.current ?? 0
    const velocity = velocityRef.current ?? 0
    const { position, lookAt } = sampleWalkthrough(progress)

    // Walking motion is proportional to how fast the journey position is
    // currently changing — brisk while scrolling, settling to stillness
    // within a beat of the patient stopping.
    const speed = Math.min(Math.abs(velocity) * 45, 1)
    swayPhase.current += 0.15 + speed * 0.35
    const bobY = Math.sin(swayPhase.current * 2.1) * 0.018 * speed
    const swayX = Math.sin(swayPhase.current * 1.05) * 0.012 * speed

    camera.position.set(position.x + swayX, position.y + bobY, position.z)

    const headTurnX = isTouch ? 0 : pointer.x * 0.14
    const headTurnY = isTouch ? 0 : pointer.y * 0.05
    camera.lookAt(lookAt.x + headTurnX, lookAt.y + headTurnY, lookAt.z)

    if (headlightRef.current) {
      headlightRef.current.position.set(position.x, position.y + 0.35, position.z)
    }
  })

  return (
    <>
      <pointLight ref={headlightRef} intensity={1.1} color="#fff4ee" distance={7} decay={2.3} />
      {children}
    </>
  )
}
