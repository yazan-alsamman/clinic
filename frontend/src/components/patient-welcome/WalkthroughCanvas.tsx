import { Component, Suspense, useEffect, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { SERVICES } from './serviceCatalog'
import { STATIONS } from './walkthroughPath'
import { ClinicLogoMesh } from './ClinicLogoMesh'
import { DepartmentEquipment } from './DepartmentEquipment'
import { ClinicEnvironment } from './ClinicEnvironment'
import { SceneLighting } from './SceneLighting'
import { SceneRig } from './SceneRig'
import { ShadowScheduler } from './shadows'
import { requestShadowRefresh } from './shadowBudget'
import type { ServiceGeometry } from './serviceCatalog'

/**
 * Keeps an optional scene addition from taking the walkthrough down with it.
 *
 * The environment map no longer comes off the network, so the failure it was
 * originally written for — a blocked CDN — cannot happen any more. The boundary
 * stays because the remaining failure modes are real ones: `PMREMGenerator`
 * needs float render targets, and a driver that refuses them, or loses the
 * context mid-bake, throws from inside the scene graph. Without a boundary of
 * its own that unwinds to the page-level boundary and the patient loses the
 * entire 3D clinic; with one, they lose some reflection detail on the metals
 * and never notice.
 */
class OptionalScenery extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * The scene's reflection environment, generated locally.
 *
 * Metals here are physically correct (metalness 1), and a conductor has no
 * diffuse response at all — it can only show what it reflects. Starve it of
 * environment and every steel rail, chrome trim and instrument tray renders
 * near-black. So an environment map is not decoration, it is what makes half
 * the material library work.
 *
 * It used to come from drei's `preset="studio"`, which fetches an HDRI from a
 * public CDN. Measured on a cold production load that single request took
 * **17.5 seconds** — it was the whole of the cold-load problem, and it is a
 * hard dependency on a third-party host for a clinic that should not need the
 * open internet to draw its own reception desk. Slow is also worse than
 * broken here: the error boundary catches a *failed* fetch, but a fetch that
 * merely takes twenty seconds just stalls, and the metals stay black until it
 * lands.
 *
 * `RoomEnvironment` is three's own procedurally-built lightbox — a handful of
 * emissive planes in a white room — pre-filtered through `PMREMGenerator` into
 * exactly the same kind of irradiance map the HDRI produced. It costs one
 * off-screen render at mount, needs no network at all, and cannot fail. For a
 * scene whose reflective surfaces are brushed steel, glazing and polished
 * stone under an artificial ceiling, a neutral interior lightbox is also the
 * more honest reference than an outdoor-lit photographic studio.
 *
 * The intensity is not the HDRI's. `RoomEnvironment` is a far brighter
 * reference than a studio capture — swapped in at the old 0.46 it blew the
 * stone floor out to white and made the contact-shadow decals visible as
 * concentric rings against it — so it is recalibrated by eye against the
 * previous look rather than carried across.
 */
function LocalEnvironment({ intensity }: { intensity: number }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const target = pmrem.fromScene(room, 0.04)
    // `fromScene` renders a scene of its own through the same renderer, and
    // that render consumes whatever shadow-map update was pending — the flag
    // is renderer-global, not per-scene. With the scheduler holding
    // `shadowMap.autoUpdate` off, nothing ever re-raises it, so the roaming
    // key light's depth map is left empty and every surface it lights samples
    // as fully shadowed: the whole clinic renders black apart from the
    // emissive fixtures. Asking for a fresh bake here puts it back.
    requestShadowRefresh()
    // `scene.environment` is renderer-owned state with no declarative
    // equivalent in react-three-fiber; assigning it is the supported route.
    // eslint-disable-next-line react-hooks/immutability
    scene.environment = target.texture
    scene.environmentIntensity = intensity
    return () => {
      scene.environment = null
      target.dispose()
      pmrem.dispose()
      room.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
      })
    }
  }, [gl, scene, intensity])

  return null
}

/*
 * A note on cold-load shader linking, so the next pass does not re-derive it.
 *
 * The largest single cost left on a cold load is not this code: it is the GPU
 * driver linking the forty-five distinct shader programs this corridor needs.
 * three only discovers a program when it first draws something that uses it,
 * and `WebGLProgram.getUniforms()` then calls `getProgramParameter`, which
 * blocks the main thread until that one program has finished compiling. So the
 * links happen strictly one at a time. Measured on the production build
 * against an AMD Radeon (D3D11/ANGLE), that is around eighteen seconds of
 * blocked main thread, in two large tasks.
 *
 * `renderer.compileAsync()` is the obvious answer — it links the whole set up
 * front and waits on `KHR_parallel_shader_compile` (which this browser has)
 * rather than on any single program. It was tried, gated behind
 * `frameloop="never"` so nothing drew until it resolved, and it worked as
 * advertised: blocked main thread fell from ~18.1 s to ~12.5 s.
 *
 * It was removed anyway. Walking the scene through the renderer ahead of the
 * first real frame left the shadow samplers bound to render targets that had
 * not been rendered yet, and every frame until the bake landed came back as
 * `GL_INVALID_OPERATION: Mismatch between texture format and sampler type` —
 * the driver dropping those draws. Re-queueing the bake on completion (the
 * remedy `LocalEnvironment` uses for the same renderer-global hazard) did not
 * clear it. Six seconds of cold load is not worth first frames whose geometry
 * the driver is silently discarding.
 *
 * The real fix is upstream of all of this: forty-five programs is a lot for one
 * corridor, and most of them differ only in which maps a material happens to
 * carry. Consolidating the material library would cut both the link cost and
 * the per-draw uniform uploads, and it would cost no visual quality at all.
 */

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
      gl={{
        antialias: !lowPower,
        alpha: true,
        powerPreference: lowPower ? 'low-power' : 'high-performance',
        // Stated rather than left to the default, because exposure is a
        // photographic decision here: ACES holds detail in both the white
        // equipment and the dark corridor instead of clipping one to keep the
        // other, and 1.05 is the stop that keeps the operating lamp and the
        // ceiling channel just short of blowing out.
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
      camera={{ position: [0, 0.55, 9.6], fov: mobile ? 52 : 42, near: 0.1, far: 40 }}
      onCreated={({ gl }) => {
        // Every program three links, it also immediately interrogates — it
        // reads `LINK_STATUS` and the info log so it can print a readable
        // diagnostic if the shader failed to compile. Those are synchronous
        // round trips to the driver, one pair per program, and this corridor
        // links forty-five programs.
        //
        // Measured on its own this was not the cold-load bottleneck: turning it
        // off changed the blocked-main-thread total by less than the run-to-run
        // variance. The real stall was `getUniforms` — see the note above. It
        // is kept because it is still the right setting for a production build
        // — it drops forty-five pairs of driver round trips, and the only thing
        // it costs is a console message aimed at a developer, on a screen whose
        // audience is a patient.
        gl.debug.checkShaderErrors = false
      }}
      // Real cast shadows, at close to zero per-frame cost: nothing in this
      // clinic moves, so the maps are rendered on demand and then frozen (see
      // `ShadowScheduler`). Low-power devices keep the grounding decals only —
      // the maps themselves are the one part of this that does not scale down
      // far enough to be worth it on a phone.
      shadows={lowPower ? false : { type: THREE.PCFSoftShadowMap }}
      frameloop={active ? 'always' : 'never'}
      style={{ position: 'absolute', inset: 0 }}
    >
      {/* Warm near-black rather than the blue-black an earlier pass used: fog
          colour is what every distant surface converges to, so a cool fog
          quietly drags the whole palette away from the clinic's stone and
          champagne and toward night-time sci-fi. */}
      <fogExp2 attach="fog" args={['#100d0c', 0.02]} />
      {!lowPower && <ShadowScheduler />}
      <SceneLighting />
      {/* A locally generated interior environment gives glass/metal/stone
          believable reflections instead of the flat, "3D demo" look flat
          ambient light alone produces — lighting-only (no background swap),
          skipped on low-power devices, and safe to fail: it carries its own
          error boundary, so a driver that cannot pre-filter it costs some
          reflection detail on the metals rather than the whole walkthrough. */}
      {!lowPower && (
        <OptionalScenery>
          <LocalEnvironment intensity={0.62} />
        </OptionalScenery>
      )}
      <ClinicEnvironment lowPower={lowPower} mobile={mobile} />
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
