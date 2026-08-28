import { Suspense, type RefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { SERVICES } from './serviceCatalog'
import { STATIONS } from './walkthroughPath'
import { ClinicLogoMesh } from './ClinicLogoMesh'
import { DepartmentEquipment } from './DepartmentEquipment'
import { ClinicEnvironment } from './ClinicEnvironment'
import { SceneLighting } from './SceneLighting'
import { SceneRig } from './SceneRig'
import type { ServiceGeometry } from './serviceCatalog'

interface WalkthroughCanvasProps {
  active: boolean
  isTouch: boolean
  lowPower: boolean
  mobile: boolean
  logoUrl: string
  progressRef: RefObject<number>
  velocityRef: RefObject<number>
  activeStation: ServiceGeometry | null
}

export default function WalkthroughCanvas({
  active,
  isTouch,
  lowPower,
  mobile,
  logoUrl,
  progressRef,
  velocityRef,
  activeStation,
}: WalkthroughCanvasProps) {
  return (
    <Canvas
      dpr={[1, lowPower ? 1.4 : 2]}
      gl={{ antialias: !lowPower, alpha: true, powerPreference: lowPower ? 'low-power' : 'high-performance' }}
      camera={{ position: [0, 0.55, 9.6], fov: mobile ? 52 : 42, near: 0.1, far: 40 }}
      frameloop={active ? 'always' : 'never'}
      style={{ position: 'absolute', inset: 0 }}
    >
      <fogExp2 attach="fog" args={['#0a0a12', 0.022]} />
      <SceneLighting />
      {/* A real interior HDRI gives glass/metal/stone believable reflections
          instead of the flat, "3D demo" look flat ambient light alone
          produces — lighting-only (no background swap), skipped on low-power
          devices, and safe to fail: the scene's own error boundary catches a
          fetch failure and still lets the patient continue. */}
      {!lowPower && (
        <Suspense fallback={null}>
          {/* Metals are now physically correct (metalness 1), and a conductor
              has no diffuse response at all — it can only show what it
              reflects. Starve it of environment and every steel rail, chrome
              trim and instrument tray renders near-black. */}
          <Environment preset="studio" background={false} environmentIntensity={0.55} />
        </Suspense>
      )}
      <ClinicEnvironment lowPower={lowPower} />
      <SceneRig progressRef={progressRef} velocityRef={velocityRef} isTouch={isTouch}>
        <Suspense fallback={null}>
          <ClinicLogoMesh logoUrl={logoUrl} progressRef={progressRef} />
        </Suspense>
        {SERVICES.map((def, i) => (
          <DepartmentEquipment
            key={def.id}
            def={def}
            station={STATIONS[i]}
            active={activeStation === def.id}
            lowPower={lowPower}
          />
        ))}
      </SceneRig>
    </Canvas>
  )
}
