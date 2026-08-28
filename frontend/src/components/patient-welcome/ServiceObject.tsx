import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { ServiceDef } from './serviceCatalog'
import type { OrbitParams } from './orbitConfig'
import { ServiceGeometry } from './ServiceGeometries'
import { clamp01, easeOutBack, lerp } from './easing'

interface ServiceObjectProps {
  def: ServiceDef
  orbit: OrbitParams
  index: number
  entering: boolean
  instant: boolean
  active: boolean
  lowPower: boolean
  onHover: (id: string | null) => void
  onSelect: (href: string) => void
}

export function ServiceObject({
  def,
  orbit,
  index,
  entering,
  instant,
  active,
  lowPower,
  onHover,
  onSelect,
}: ServiceObjectProps) {
  const groupRef = useRef<Group>(null)
  const innerRef = useRef<Group>(null)
  const revealStart = useRef<number | null>(null)
  const [localHover, setLocalHover] = useState(false)
  const highlightRef = useRef(0)

  useEffect(() => {
    if (localHover) return () => { document.body.style.cursor = 'auto' }
  }, [localHover])

  const staggerDelay = index * 0.16

  useFrame(({ clock }) => {
    if (!groupRef.current || !innerRef.current) return
    const t = clock.getElapsedTime()

    // Entrance progress: 0 (not arrived) → 1 (settled in orbit).
    let progress = 1
    if (!instant) {
      if (entering && revealStart.current === null) revealStart.current = t
      const local = revealStart.current === null ? -1 : t - revealStart.current - staggerDelay
      progress = local < 0 ? 0 : clamp01(local / 0.85)
    }
    const eased = instant ? 1 : easeOutBack(progress)
    const radiusMul = instant ? 1 : lerp(0.35, 1, Math.min(progress / 0.9, 1))

    const angle = orbit.baseAngle + t * orbit.speed
    const x = Math.cos(angle) * orbit.radiusX * radiusMul
    const z = Math.sin(angle) * orbit.radiusZ * radiusMul
    const bob = Math.sin(t * orbit.bobFreq + index) * orbit.bobAmp
    const y = bob + Math.sin(angle) * orbit.tilt

    groupRef.current.position.set(x, y, z)

    const isActive = active || localHover
    const targetHighlight = isActive ? 1 : 0
    highlightRef.current = lerp(highlightRef.current, targetHighlight, 0.12)

    const baseScale = orbit.scale * Math.max(eased, 0)
    const hoverBoost = 1 + highlightRef.current * 0.32
    innerRef.current.scale.setScalar(Math.max(baseScale * hoverBoost, 0.0001))
    innerRef.current.rotation.y += orbit.selfSpin * 0.016
    innerRef.current.visible = progress > 0 || instant

    // Depth cue: objects further along -z read slightly dimmer/smaller via fog (scene fog)
    // already handles color falloff; here we nudge scale for near/far separation.
    const depthScale = 1 + (z / (orbit.radiusZ * 2)) * 0.08
    innerRef.current.scale.multiplyScalar(depthScale)
  })

  return (
    <group ref={groupRef}>
      <group
        ref={innerRef}
        onPointerOver={(e) => {
          e.stopPropagation()
          setLocalHover(true)
          onHover(def.id)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setLocalHover(false)
          onHover(null)
          document.body.style.cursor = 'auto'
        }}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(def.href)
        }}
      >
        <ServiceGeometry def={def} lowPower={lowPower} highlight={active || localHover ? 1 : 0} />
      </group>
    </group>
  )
}
