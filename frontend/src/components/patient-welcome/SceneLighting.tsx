import { STATIONS, CORRIDOR } from './walkthroughPath'
import { PooledPointLights, type LightFixture } from './lightPool'

/** Layered, restrained architectural lighting for the whole corridor. A single
 * fixed rig can't reach a 30-unit hallway, so illumination here is: an ambient
 * wash everywhere, a warm key at each end (reception / finale), and one quiet
 * accent light per department alcove. The light that actually follows the
 * patient down the hall — the "headlight" — is rendered by SceneRig, since it
 * needs the live camera position every frame. */
export function SceneLighting() {
  return (
    <>
      {/* Warm sky over a genuinely warm floor bounce. The ground half of a
          hemisphere light *is* a floor-bounce term — it lights the undersides
          of everything from below — and setting it to near-black, as earlier
          passes did, is equivalent to standing the clinic on a hole. Pale warm
          stone reflects a real fraction of what lands on it, so the underside
          of a chair arm or a trolley shelf is never as dark as its shadow. */}
      <hemisphereLight args={['#6b6558', '#4c463c', 0.46]} />

      {/* The corridor's architectural lighting: a warm key at each end and a
          soft pool from the recessed ceiling channel between the alcoves.

          These are six fixtures sharing three real lights. They are spread
          over a thirty-seven metre hall and every one of them carries a
          `distance`, so most of them are returning exactly zero at any given
          moment — the reception key cannot reach the finale wall thirty-four
          metres away, and the ceiling fills are spaced further apart than
          their own nine-metre throw. Three is the most that can be within
          range of the visible frame at once (at the finale: both end keys plus
          the nearest fill), so the pool never takes a light the patient can
          see. See `lightPool` for why this is worth doing. */}
      <PooledPointLights fixtures={CORRIDOR_FIXTURES} count={3} />
    </>
  )
}

// Every light here is compiled into every material's shader in the scene, and
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

/** The corridor's fixtures, as data for the pool above. Module-level so the
 * array identity is stable — the pool re-derives its per-frame scratch buffer
 * whenever this changes. */
const CORRIDOR_FIXTURES: LightFixture[] = [
  // Reception key — warm ivory, the first thing the patient sees.
  { key: 'reception', position: [0, 2.0, CORRIDOR.zStart - 1], color: '#f6dcc9', intensity: 2.2, distance: 12 },
  // Finale key — where the logo lives.
  { key: 'finale', position: [0, 1.6, CORRIDOR.zEnd + 2], color: '#f6dcc9', intensity: 2.4, distance: 12 },
  { key: 'finale-warm', position: [-1.6, 0.6, CORRIDOR.zEnd + 3.5], color: '#c9a68f', intensity: 0.9, distance: 10 },
  ...CEILING_FILL_Z.map((z, i) => ({
    key: 'fill-' + i,
    position: [0, CORRIDOR.ceilingY - 0.35, z] as [number, number, number],
    color: '#ffeeda',
    intensity: 2.3,
    distance: 9,
  })),
]
