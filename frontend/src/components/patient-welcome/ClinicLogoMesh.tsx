import { useRef, type RefObject } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh, Sprite } from 'three'
import { getGlowTexture } from './glowTexture'
import { LOGO_POSITION } from './walkthroughPath'
import { lerp } from './easing'

const LOGO_ASPECT = 2600 / 771
const LOGO_WIDTH = 2.6
const LOGO_HEIGHT = LOGO_WIDTH / LOGO_ASPECT

interface ClinicLogoMeshProps {
  logoUrl: string
  progressRef: RefObject<number>
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Mounted on the finale wall — the destination of the walk, not a floating
 * hero. It's faintly present from far down the corridor (a glimmer of where
 * this is all leading) and grows steadily more prominent as the patient's
 * journey position approaches the end, per the brief's "final hero" beat. */
export function ClinicLogoMesh({ logoUrl, progressRef }: ClinicLogoMeshProps) {
  const texture = useLogoTexture(logoUrl)
  const meshRef = useRef<Mesh>(null)
  const glowRef = useRef<Sprite>(null)
  const glowTexture = getGlowTexture()

  useFrame(({ clock }) => {
    if (!meshRef.current || !glowRef.current) return
    const t = clock.getElapsedTime()
    const progress = progressRef.current ?? 0
    const reveal = smoothstep(0.5, 1, progress)

    const scale = lerp(0.16, 1, reveal)
    meshRef.current.scale.setScalar(scale)
    const mat = meshRef.current.material as THREE.MeshBasicMaterial
    mat.opacity = lerp(0.22, 1, reveal)
    glowRef.current.material.opacity = lerp(0.08, 0.46, reveal) + Math.sin(t * 0.5) * 0.05

    meshRef.current.rotation.y = Math.sin(t * 0.22) * 0.04
    meshRef.current.position.y = 0.15 + Math.sin(t * 0.35) * 0.035
    glowRef.current.position.y = meshRef.current.position.y
  })

  return (
    <group position={[LOGO_POSITION.x, LOGO_POSITION.y, LOGO_POSITION.z]}>
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
