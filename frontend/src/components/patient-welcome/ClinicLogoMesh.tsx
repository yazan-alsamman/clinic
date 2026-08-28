import { useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh, Sprite } from 'three'
import { getGlowTexture } from './glowTexture'
import { clamp01, easeOutBack, easeOutCubic } from './easing'

const LOGO_ASPECT = 2600 / 771
const LOGO_WIDTH = 2.25
const LOGO_HEIGHT = LOGO_WIDTH / LOGO_ASPECT

interface ClinicLogoMeshProps {
  logoUrl: string
  visible: boolean
  instant: boolean
}

/** Loads the logo texture and configures its color space/filtering once on load.
 * three.js textures are plain mutable objects; this one-time setup is the
 * standard way to configure a loaded texture before first use. */
function useLogoTexture(url: string) {
  const texture = useLoader(THREE.TextureLoader, url)
  // eslint-disable-next-line react-hooks/immutability
  texture.colorSpace = THREE.SRGBColorSpace
  // eslint-disable-next-line react-hooks/immutability
  texture.anisotropy = 4
  return texture
}

export function ClinicLogoMesh({ logoUrl, visible, instant }: ClinicLogoMeshProps) {
  const texture = useLogoTexture(logoUrl)
  const meshRef = useRef<Mesh>(null)
  const glowRef = useRef<Sprite>(null)
  const revealStart = useRef<number | null>(null)
  const glowTexture = getGlowTexture()

  useFrame(({ clock }) => {
    if (!meshRef.current || !glowRef.current) return
    const t = clock.getElapsedTime()

    if (instant) {
      meshRef.current.scale.setScalar(1)
      const mat = meshRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = 1
      glowRef.current.material.opacity = 0.42 + Math.sin(t * 0.5) * 0.06
    } else {
      if (visible && revealStart.current === null) revealStart.current = t
      const local = revealStart.current === null ? 0 : t - revealStart.current
      const progress = clamp01(local / 1.15)
      const scale = visible ? 0.001 + easeOutBack(progress) * 0.999 : 0.001
      meshRef.current.scale.setScalar(Math.max(scale, 0.001))
      const mat = meshRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = visible ? easeOutCubic(progress) : 0
      glowRef.current.material.opacity = visible ? easeOutCubic(progress) * (0.42 + Math.sin(t * 0.5) * 0.06) : 0
    }

    // Gentle breathing sway — never enough to foreshorten the wordmark unreadably.
    meshRef.current.rotation.y = Math.sin(t * 0.22) * 0.05
    meshRef.current.position.y = Math.sin(t * 0.35) * 0.045
    glowRef.current.position.y = meshRef.current.position.y
  })

  return (
    <group position={[0, 0.15, 0.4]}>
      <sprite ref={glowRef} scale={[LOGO_WIDTH * 2.1, LOGO_WIDTH * 2.1 * 0.55, 1]}>
        <spriteMaterial
          map={glowTexture}
          color="#f0c6b8"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <mesh ref={meshRef}>
        <planeGeometry args={[LOGO_WIDTH, LOGO_HEIGHT]} />
        <meshBasicMaterial map={texture} transparent opacity={0} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
}
