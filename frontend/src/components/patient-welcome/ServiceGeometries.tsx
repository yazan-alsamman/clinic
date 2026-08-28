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

/**
 * Each service is a small assembled "museum miniature" of real clinic equipment —
 * a handful of primitives composed into a recognizable silhouette — rather than a
 * single abstract symbol. All five share the same material language (ivory
 * ceramic / brushed metal / warm glass) so they read as one design system.
 */
export function ServiceGeometry({ def, lowPower, highlight }: GeometryProps) {
  const segLow = lowPower ? 10 : 20
  const segMed = lowPower ? 14 : 28
  const color = useMemo(() => accentColor(def.accent), [def.accent])
  const glow = 0.16 + highlight * 0.5

  const chrome = { color: '#cfd6e0', roughness: 0.28, metalness: 0.55, clearcoat: lowPower ? 0 : 0.5 }
  const ivory = { color: '#f7f2ea', roughness: 0.32, metalness: 0.05, clearcoat: lowPower ? 0 : 0.4 }

  switch (def.id) {
    // ── Dentistry — a reclined examination chair with an overhead lamp ──
    case 'dentistry':
      return (
        <group rotation={[0, -0.5, 0]} position={[0, -0.1, 0]}>
          <mesh position={[0, -0.42, 0]}>
            <cylinderGeometry args={[0.12, 0.18, 0.16, segLow]} />
            <meshPhysicalMaterial {...chrome} />
          </mesh>
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.26, segLow]} />
            <meshPhysicalMaterial {...chrome} />
          </mesh>
          <mesh position={[0, -0.1, 0.02]} rotation={[-0.12, 0, 0]}>
            <boxGeometry args={[0.5, 0.1, 0.42]} />
            <meshPhysicalMaterial {...ivory} emissive={color} emissiveIntensity={glow * 0.2} />
          </mesh>
          <mesh position={[0, 0.16, -0.16]} rotation={[0.55, 0, 0]}>
            <boxGeometry args={[0.5, 0.42, 0.09]} />
            <meshPhysicalMaterial {...ivory} emissive={color} emissiveIntensity={glow * 0.2} />
          </mesh>
          <mesh position={[0, 0.36, -0.32]} rotation={[0.55, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.1, 0.1, segLow]} />
            <meshPhysicalMaterial {...ivory} />
          </mesh>
          {[-0.27, 0.27].map((x) => (
            <mesh key={x} position={[x, -0.02, 0.03]}>
              <capsuleGeometry args={[0.025, 0.34, 4, segLow]} />
              <meshPhysicalMaterial {...chrome} />
            </mesh>
          ))}
          <mesh position={[0.18, 0.5, 0.24]} rotation={[0, 0, 0.5]}>
            <cylinderGeometry args={[0.018, 0.018, 0.46, 8]} />
            <meshPhysicalMaterial {...chrome} />
          </mesh>
          <mesh position={[0.36, 0.68, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.11, 0.11, 0.03, segLow]} />
            <meshStandardMaterial color="#fff8ef" emissive="#fff3df" emissiveIntensity={0.5 + highlight * 0.7} roughness={0.3} />
          </mesh>
        </group>
      )

    // ── Dermatology — a diagnostic console with an articulated scan lens ──
    case 'dermatology':
      return (
        <group position={[0, -0.16, 0]}>
          <mesh position={[0, -0.36, 0]}>
            <cylinderGeometry args={[0.16, 0.19, 0.06, segLow]} />
            <meshPhysicalMaterial {...chrome} />
          </mesh>
          <mesh position={[0, -0.1, 0]}>
            <boxGeometry args={[0.28, 0.58, 0.2]} />
            <meshPhysicalMaterial color="#f3f4f7" roughness={0.3} metalness={0.08} clearcoat={lowPower ? 0 : 0.4} />
          </mesh>
          <mesh position={[0, 0.1, 0.105]}>
            <cylinderGeometry args={[0.09, 0.09, 0.02, segMed]} />
            <meshPhysicalMaterial
              color={color}
              roughness={0.2}
              metalness={0.1}
              emissive={color}
              emissiveIntensity={0.3 + highlight * 0.45}
            />
          </mesh>
          <mesh position={[0.02, 0.34, 0.02]} rotation={[0.2, 0.5, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.36, 8]} />
            <meshPhysicalMaterial {...chrome} />
          </mesh>
          <mesh position={[0.2, 0.46, 0.2]} rotation={[0.35, 0.2, 0]}>
            <sphereGeometry args={[0.08, segMed, segMed]} />
            <meshPhysicalMaterial
              color="#eaf6fb"
              roughness={0.08}
              metalness={0}
              transparent
              opacity={0.8}
              clearcoat={lowPower ? 0 : 0.6}
              emissive={color}
              emissiveIntensity={0.22 + highlight * 0.4}
            />
          </mesh>
        </group>
      )

    // ── Skincare — a facial-steamer cart with a warm glass dome ──
    case 'skincare':
      return (
        <group position={[0, -0.18, 0]}>
          <mesh position={[0, -0.32, 0]}>
            <boxGeometry args={[0.34, 0.14, 0.26]} />
            <meshPhysicalMaterial {...ivory} />
          </mesh>
          <mesh position={[0.02, -0.16, 0.02]}>
            <boxGeometry args={[0.24, 0.03, 0.18]} />
            <meshPhysicalMaterial {...chrome} />
          </mesh>
          {[-0.08, 0.06].map((x, i) => (
            <mesh key={x} position={[x, -0.12, 0.06]}>
              <cylinderGeometry args={[0.018, 0.018, 0.08, 8]} />
              <meshPhysicalMaterial
                color={i === 0 ? color : '#f3d9d0'}
                roughness={0.15}
                metalness={0.05}
                transparent
                opacity={0.85}
              />
            </mesh>
          ))}
          <mesh position={[-0.02, 0.02, -0.06]} rotation={[0, 0, 0.12]}>
            <cylinderGeometry args={[0.022, 0.022, 0.38, 8]} />
            <meshPhysicalMaterial {...chrome} />
          </mesh>
          <mesh position={[0.02, 0.24, -0.02]} rotation={[0.5, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.24, 8]} />
            <meshPhysicalMaterial {...chrome} />
          </mesh>
          <mesh position={[0.06, 0.38, 0.1]}>
            <sphereGeometry args={[0.05, segMed, segMed]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6 + highlight * 0.8} roughness={0.35} />
          </mesh>
          <mesh position={[0.06, 0.38, 0.1]}>
            <sphereGeometry args={[0.11, segMed, segMed]} />
            <meshPhysicalMaterial
              color="#ffffff"
              roughness={0.06}
              metalness={0}
              transparent
              opacity={0.32}
              clearcoat={lowPower ? 0 : 0.7}
            />
          </mesh>
        </group>
      )

    // ── Solarium — a canopy tanning bed with a warm interior glow ──
    case 'solarium':
      return (
        <group position={[0, -0.08, 0]} rotation={[0, 0.35, 0]}>
          <mesh position={[0, -0.14, 0]}>
            <boxGeometry args={[0.85, 0.07, 0.34]} />
            <meshPhysicalMaterial {...ivory} />
          </mesh>
          <mesh position={[0, -0.09, 0]}>
            <boxGeometry args={[0.78, 0.02, 0.28]} />
            <meshStandardMaterial
              color="#ffd27a"
              emissive="#ffb347"
              emissiveIntensity={0.55 + highlight * 0.7}
              roughness={0.4}
            />
          </mesh>
          <mesh position={[0, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.2, 0.2, 0.82, segMed, 1, true, 0, Math.PI]} />
            <meshPhysicalMaterial
              color="#ffe3b0"
              roughness={0.18}
              metalness={0}
              transparent
              opacity={0.4}
              side={THREE.DoubleSide}
              emissive="#ffb347"
              emissiveIntensity={0.12 + highlight * 0.25}
            />
          </mesh>
          {[-0.36, 0.36].map((x) => (
            <mesh key={x} position={[x, -0.1, 0]}>
              <cylinderGeometry args={[0.015, 0.015, 0.1, 8]} />
              <meshPhysicalMaterial {...chrome} />
            </mesh>
          ))}
        </group>
      )

    // ── Laser hair removal — a console with an articulated handpiece ──
    case 'laser':
      return (
        <group position={[0, -0.18, 0]}>
          <mesh position={[0, -0.34, 0]}>
            <cylinderGeometry args={[0.13, 0.15, 0.05, segLow]} />
            <meshPhysicalMaterial {...chrome} />
          </mesh>
          <mesh position={[0, -0.06, 0]}>
            <boxGeometry args={[0.26, 0.5, 0.22]} />
            <meshPhysicalMaterial color="#2c2f3a" roughness={0.35} metalness={0.4} clearcoat={lowPower ? 0 : 0.4} />
          </mesh>
          <mesh position={[0, 0.08, 0.115]}>
            <boxGeometry args={[0.17, 0.11, 0.01]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55 + highlight * 0.8} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.22, 8]} />
            <meshPhysicalMaterial {...chrome} />
          </mesh>
          <group position={[0.2, 0.3, 0.06]} rotation={[0, 0, -0.7]}>
            <mesh>
              <capsuleGeometry args={[0.05, 0.28, 4, segLow]} />
              <meshPhysicalMaterial color="#eef2ff" roughness={0.22} metalness={0.3} clearcoat={lowPower ? 0 : 0.6} />
            </mesh>
            <mesh position={[0, -0.19, 0]}>
              <cylinderGeometry args={[0.035, 0.035, 0.05, segLow]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9 + highlight * 1.1} roughness={0.2} />
            </mesh>
          </group>
        </group>
      )

    default:
      return null
  }
}
