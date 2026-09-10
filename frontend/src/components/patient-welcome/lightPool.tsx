import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

/**
 * A fixed number of real lights, standing in for a larger number of fixtures.
 *
 * Every light in a three.js scene is compiled into *every* material's shader,
 * whether or not it can reach the surface being drawn. `NUM_POINT_LIGHTS` is
 * global: at fourteen point lights, every one of the scene's shader programs
 * carries fourteen unrolled direct-lighting evaluations, and the driver has to
 * compile all of that before the first frame can be drawn.
 *
 * Measured on the production build against a real GPU (AMD Radeon,
 * D3D11/ANGLE), removing just three point lights — with the program count held
 * at 57 — took the cold-load main-thread block from 16.5 s to 12.1 s. That is
 * roughly a second and a half of frozen tab *per point light*, paid on every
 * cold load, for lights that spend almost the whole walk contributing nothing.
 *
 * Nothing contributing is the key. These fixtures all carry a `distance`, so a
 * point light is mathematically zero beyond it — a treatment room's practical
 * cannot light the corridor twelve metres away, and the reception key cannot
 * reach the finale wall thirty-four metres down the hall. The scene has twelve
 * such fixtures spread over a thirty-seven metre corridor and, at any camera
 * position, only a handful are within range of anything on screen.
 *
 * So the fixtures become data, and a small pool of real lights is moved onto
 * whichever ones are nearest the camera. This is the same trade `RoamingKeyLight`
 * already makes for the single shadow-casting spot, generalised: the patient
 * sees the same lighting, because the lights that were dropped were the ones
 * already returning zero.
 *
 * **Choosing `count` is a correctness decision, not a tuning knob.** It has to
 * be at least the largest number of fixtures that can be simultaneously within
 * range of the visible frame; set it lower and a light the patient can see will
 * be snatched away, which reads as a room going dark as they walk past it. The
 * pools in this scene are sized from the fixture spacing and their `distance`
 * values, then confirmed by comparing captures at every station.
 */
export interface LightFixture {
  key: string
  position: [number, number, number]
  color: string
  intensity: number
  distance: number
}

export function PooledPointLights({
  fixtures,
  count,
}: {
  fixtures: LightFixture[]
  count: number
}) {
  const slots = Math.min(count, fixtures.length)
  const refs = useRef<(THREE.PointLight | null)[]>([])
  // Scratch buffer for the per-frame nearest-fixture sort. Deliberately a ref
  // rather than a memo: it is rewritten and re-sorted in place on every frame
  // so the render loop allocates nothing, and a ref is the honest way to say
  // "this is mutable state", where a memo would be claiming a purity it does
  // not have.
  const orderRef = useRef<{ i: number; d: number }[]>([])
  const assigned = useRef<string[]>([])

  useFrame(({ camera }) => {
    const cam = camera.position
    const order = orderRef.current
    if (order.length !== fixtures.length) {
      order.length = 0
      for (let i = 0; i < fixtures.length; i++) order.push({ i, d: 0 })
    }
    for (let i = 0; i < fixtures.length; i++) {
      const p = fixtures[i].position
      const dx = p[0] - cam.x
      const dy = p[1] - cam.y
      const dz = p[2] - cam.z
      order[i].i = i
      order[i].d = dx * dx + dy * dy + dz * dz
    }
    order.sort((a, b) => a.d - b.d)

    for (let s = 0; s < slots; s++) {
      const light = refs.current[s]
      if (!light) continue
      const f = fixtures[order[s].i]
      // Only touch the light when its fixture actually changed. Writing the
      // same colour and position every frame is harmless but pointless, and
      // three re-uploads a light's uniforms when it is marked dirty.
      if (assigned.current[s] === f.key) continue
      assigned.current[s] = f.key
      light.position.set(f.position[0], f.position[1], f.position[2])
      light.color.set(f.color)
      light.intensity = f.intensity
      light.distance = f.distance
      light.decay = 2
    }
  })

  return (
    <>
      {Array.from({ length: slots }, (_, s) => (
        <pointLight
          key={s}
          ref={(el) => {
            refs.current[s] = el
          }}
          // Placeholders only. react-three-fiber runs `useFrame` subscribers
          // before it renders, so the assignment above has already claimed
          // every slot by the time the first frame is drawn — these values are
          // never the ones on screen.
          position={fixtures[s].position}
          color={fixtures[s].color}
          intensity={fixtures[s].intensity}
          distance={fixtures[s].distance}
          decay={2}
        />
      ))}
    </>
  )
}
