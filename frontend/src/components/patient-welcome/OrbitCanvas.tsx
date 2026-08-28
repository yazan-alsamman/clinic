import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { SERVICES } from './serviceCatalog'
import { ORBIT_CONFIG } from './orbitConfig'
import { ClinicLogoMesh } from './ClinicLogoMesh'
import { ServiceObject } from './ServiceObject'
import { SceneLighting } from './SceneLighting'
import { SceneRig } from './SceneRig'
import type { ScenePhase } from './PatientWelcomeScene'

interface OrbitCanvasProps {
  phase: ScenePhase
  instant: boolean
  active: boolean
  isTouch: boolean
  lowPower: boolean
  logoUrl: string
  activeService: string | null
  onHoverService: (id: string | null) => void
  onSelectService: (href: string) => void
}

export default function OrbitCanvas({
  phase,
  instant,
  active,
  isTouch,
  lowPower,
  logoUrl,
  activeService,
  onHoverService,
  onSelectService,
}: OrbitCanvasProps) {
  const logoVisible = instant || phase === 'logo' || phase === 'services' || phase === 'interactive'
  const objectsEntering = instant || phase === 'services' || phase === 'interactive'
  const parallaxEnabled = !isTouch && (instant || phase === 'interactive')

  return (
    <Canvas
      dpr={[1, lowPower ? 1.4 : 2]}
      gl={{ antialias: !lowPower, alpha: true, powerPreference: lowPower ? 'low-power' : 'high-performance' }}
      camera={{ position: [0, 0.2, 6.4], fov: 40, near: 0.1, far: 30 }}
      frameloop={active ? 'always' : 'never'}
      style={{ position: 'absolute', inset: 0 }}
    >
      <fogExp2 attach="fog" args={['#0a0a12', 0.058]} />
      <SceneLighting />
      <SceneRig enabled={parallaxEnabled}>
        <Suspense fallback={null}>
          <ClinicLogoMesh logoUrl={logoUrl} visible={logoVisible} instant={instant} />
        </Suspense>
        {SERVICES.map((def, i) => (
          <ServiceObject
            key={def.id}
            def={def}
            orbit={ORBIT_CONFIG[i]}
            index={i}
            entering={objectsEntering}
            instant={instant}
            active={activeService === def.id}
            lowPower={lowPower}
            onHover={onHoverService}
            onSelect={onSelectService}
          />
        ))}
      </SceneRig>
    </Canvas>
  )
}
