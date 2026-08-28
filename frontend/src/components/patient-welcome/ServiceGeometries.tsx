import { useMemo } from 'react'
import * as THREE from 'three'
import type { ServiceDef } from './serviceCatalog'

interface GeometryProps {
  def: ServiceDef
  lowPower: boolean
  highlight: number
}

function accentColor([r, g, b]: [number, number, number]): THREE.Color {
  return new THREE.Color(r, g, b)
}

/** A shallow teardrop profile revolved into a lathe — used for the dermatology "serum drop". */
function useDropletGeometry(segments: number) {
  return useMemo(() => {
    const points: THREE.Vector2[] = []
    const steps = 14
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const y = (t - 0.32) * 1.15
      const radius = Math.sin(Math.PI * Math.pow(t, 0.72)) * 0.42 * (1 - t * 0.18)
      points.push(new THREE.Vector2(Math.max(radius, 0.0001), y))
    }
    return new THREE.LatheGeometry(points, segments)
  }, [segments])
}

function useSunRayPositions(count: number, radius: number) {
  return useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const a = (i / count) * Math.PI * 2
      return { x: Math.cos(a) * radius, z: Math.sin(a) * radius, rot: -a }
    })
  }, [count, radius])
}

export function ServiceGeometry({ def, lowPower, highlight }: GeometryProps) {
  const seg = lowPower ? 18 : 40
  const color = useMemo(() => accentColor(def.accent), [def.accent])
  const dropletGeo = useDropletGeometry(lowPower ? 10 : 20)
  const rays = useSunRayPositions(8, 0.66)

  const emissiveBoost = 0.15 + highlight * 0.55

  switch (def.id) {
    case 'dentistry':
      return (
        <mesh rotation={[0.3, 0, -0.15]} castShadow={false}>
          <torusGeometry args={[0.52, 0.15, lowPower ? 10 : 22, seg, Math.PI * 1.15]} />
          <meshPhysicalMaterial
            color="#f7f2ea"
            roughness={0.28}
            metalness={0.04}
            clearcoat={lowPower ? 0 : 0.7}
            clearcoatRoughness={0.25}
            emissive={color}
            emissiveIntensity={emissiveBoost * 0.25}
          />
        </mesh>
      )

    case 'dermatology':
      // No environment map in this scene, so a transmissive "true glass" material
      // renders murky/oversized here — a translucent physical material with a
      // strong emissive base reads as a lit glass/serum drop far more reliably.
      return (
        <mesh geometry={dropletGeo} rotation={[Math.PI, 0, 0]}>
          <meshPhysicalMaterial
            color={color}
            roughness={0.22}
            metalness={0.05}
            transparent
            opacity={0.86}
            clearcoat={lowPower ? 0 : 0.5}
            emissive={color}
            emissiveIntensity={0.32 + highlight * 0.35}
          />
        </mesh>
      )

    case 'skincare':
      return (
        <mesh rotation={[0.4, 0.6, 0]}>
          <icosahedronGeometry args={[0.5, 0]} />
          <meshPhysicalMaterial
            color={color}
            roughness={0.24}
            metalness={0.35}
            clearcoat={lowPower ? 0 : 0.55}
            emissive={color}
            emissiveIntensity={0.28 + highlight * 0.45}
          />
        </mesh>
      )

    case 'solarium':
      return (
        <group rotation={[Math.PI / 2.4, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[0.5, 0.5, 0.12, lowPower ? 16 : 40]} />
            <meshPhysicalMaterial
              color="#f6b93b"
              roughness={0.26}
              metalness={0.45}
              clearcoat={lowPower ? 0 : 0.4}
              emissive="#f6b93b"
              emissiveIntensity={0.35 + highlight * 0.6}
            />
          </mesh>
          {rays.map((r, i) => (
            <mesh key={i} position={[r.x, 0, r.z]} rotation={[0, r.rot, 0]}>
              <boxGeometry args={[0.05, 0.05, 0.22]} />
              <meshStandardMaterial
                color="#ffd27a"
                emissive="#ffd27a"
                emissiveIntensity={0.5 + highlight * 0.8}
                roughness={0.4}
              />
            </mesh>
          ))}
        </group>
      )

    case 'laser':
      return (
        <group rotation={[0, 0, Math.PI / 2.2]}>
          <mesh>
            <capsuleGeometry args={[0.22, 0.62, lowPower ? 4 : 8, lowPower ? 10 : 20]} />
            <meshPhysicalMaterial
              color="#eef2ff"
              roughness={0.28}
              metalness={0.25}
              clearcoat={lowPower ? 0 : 0.6}
              emissive="#c7d2fe"
              emissiveIntensity={0.16 + highlight * 0.25}
            />
          </mesh>
          <mesh>
            <cylinderGeometry args={[0.07, 0.07, 0.72, lowPower ? 8 : 16]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.9 + highlight * 1.1}
              roughness={0.3}
            />
          </mesh>
        </group>
      )

    default:
      return null
  }
}
