import { STATIONS, CORRIDOR } from './walkthroughPath'

/** Layered, restrained architectural lighting for the whole corridor. A single
 * fixed rig can't reach a 30-unit hallway, so illumination here is: an ambient
 * wash everywhere, a warm key at each end (reception / finale), and one quiet
 * accent light per department alcove. The light that actually follows the
 * patient down the hall — the "headlight" — is rendered by SceneRig, since it
 * needs the live camera position every frame. */
export function SceneLighting() {
  return (
    <>
      <hemisphereLight args={['#4a4450', '#14121a', 0.9]} />

      {/* Reception key — warm ivory, the first thing the patient sees */}
      <pointLight position={[0, 2.0, CORRIDOR.zStart - 1]} intensity={2.2} color="#f6dcc9" distance={12} decay={2} />
      {/* Finale key — where the logo lives */}
      <pointLight position={[0, 1.6, CORRIDOR.zEnd + 2]} intensity={2.4} color="#f6dcc9" distance={12} decay={2} />
      <pointLight position={[-1.6, 0.6, CORRIDOR.zEnd + 3.5]} intensity={0.9} color="#c9a68f" distance={10} decay={2} />

      {/* The accent-tinted lamp that used to sit outside each alcove is gone.
          Every department now carries its own practical ceiling lighting at a
          plausible colour temperature (see ClinicEnvironment), which is both
          more convincing and cheaper than washing the corridor in five
          different brand colours — that wash was the main thing still reading
          as "lit like a product launch" rather than "lit like a building". */}

      {/* Practical fill from the recessed ceiling channel — one soft pool
          between each pair of alcoves, plus the two corridor ends, so the
          plain stretches of hallway aren't lit only by the moving headlight. */}
      {CEILING_FILL_Z.map((z) => (
        <pointLight key={z} position={[0, CORRIDOR.ceilingY - 0.35, z]} intensity={2.4} color="#fff1e0" distance={9} decay={2} />
      ))}
    </>
  )
}

// Every light here is compiled into every physical material in the scene, and
// the treatment rooms now carry their own practicals, so the corridor fill is
// thinned to every other bay — the moving headlight in SceneRig covers the
// gaps as the patient walks through them.
const CEILING_FILL_Z = (() => {
  const zs = [CORRIDOR.zStart - 3.5, ...STATIONS.map((s) => s.z)]
  const mids: number[] = []
  for (let i = 0; i < zs.length - 1; i++) mids.push((zs[i] + zs[i + 1]) / 2)
  mids.push((STATIONS[STATIONS.length - 1].z + (CORRIDOR.zEnd + 3)) / 2)
  return mids.filter((_, i) => i % 2 === 0)
})()
