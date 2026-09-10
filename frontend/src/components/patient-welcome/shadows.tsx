import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { nextDirtyShadow, requestShadowRefresh } from './shadowBudget'

/**
 * Cast shadows, on a static scene, for free.
 *
 * Grounding decals put objects *on* the floor. What they cannot do is throw a
 * chair's shape across the wall behind it, put the operating lamp's arm in
 * shade, or darken the gap between a trolley and the cabinet it stands beside
 * — and that inter-object shadowing is the strongest remaining "this is CG"
 * signal once materials are right.
 *
 * Real shadow maps normally cost a full depth render per shadow-casting light
 * *per frame*, which is exactly the kind of budget that locked the renderer in
 * an earlier pass. But nothing in this clinic moves: the equipment is bolted
 * down, the lights are fixed, and only the camera travels. A shadow map for a
 * static scene is correct forever once it has been rendered.
 *
 * So the renderer's shadow auto-update is switched off and the maps are
 * refreshed only on demand — at start-up, and whenever a room crosses a
 * distance threshold and swaps its level of detail. Walking the whole corridor
 * triggers on the order of ten refreshes; every other frame pays nothing at
 * all for shadows beyond the lookup itself.
 */

/**
 * Drives the on-demand shadow refresh, one light per frame.
 *
 * Must live inside the Canvas. The queue itself is in `shadowBudget`.
 */
export function ShadowScheduler() {
  const gl = useThree((s) => s.gl)
  const lastCam = useRef<THREE.Vector3 | null>(null)
  const stillFrames = useRef(0)
  const waited = useRef(0)

  useEffect(() => {
    // Mutating the renderer is the only way to hand shadow scheduling to the
    // application: `WebGLShadowMap.autoUpdate` is a renderer-owned flag with no
    // declarative equivalent in react-three-fiber.
    // eslint-disable-next-line react-hooks/immutability
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => {
      // Restores the renderer flag this effect took ownership of.
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])

  // A bake is one depth pass over every casting object in view, and measured
  // on this scene it costs around a third of a second — far too much to spend
  // in a frame the patient is moving through. It is also completely wasted
  // there: a stale shadow map during a fast scroll is invisible, while the
  // hitch it causes is not.
  //
  // So bakes are held until the camera settles. Walking the corridor quickly
  // crosses every room's level-of-detail threshold in a couple of seconds and
  // asks for a bake at each one; all of those now collapse into a single bake
  // taken once the patient stops at a department — which is the only moment
  // the shadows are actually looked at. MAX_DEFER is the escape hatch for a
  // patient who scrolls continuously and never quite comes to rest.
  useFrame(({ camera }) => {
    const prev = lastCam.current
    if (!prev) {
      lastCam.current = camera.position.clone()
      return
    }
    const moved = prev.distanceToSquared(camera.position)
    prev.copy(camera.position)
    stillFrames.current = moved < STILL_EPSILON_SQ ? stillFrames.current + 1 : 0

    const settled = stillFrames.current >= STILL_FRAMES
    if (!settled && waited.current < MAX_DEFER) {
      waited.current++
      return
    }

    const light = nextDirtyShadow()
    if (!light) {
      // Nothing owed: don't let the deferral budget accumulate while idle, or
      // the next genuine request would bake immediately, mid-motion.
      waited.current = 0
      return
    }
    waited.current = 0
    light.shadow.needsUpdate = true
    // three only walks its light list at all when the global flag is set; the
    // per-light flags above decide which of them actually re-renders.
    // eslint-disable-next-line react-hooks/immutability
    gl.shadowMap.needsUpdate = true
  })

  return null
}

/** Squared distance below which the camera counts as parked for the frame.
 * 1 mm of travel: the walkthrough's damping never fully reaches zero, so an
 * exact-equality test would never fire. */
const STILL_EPSILON_SQ = 1e-6
/** Consecutive parked frames before the queue is released. */
const STILL_FRAMES = 5
/** Frames a pending bake will wait for stillness before giving up and taking
 * the hitch anyway — about a second and a half of continuous scrolling. */
const MAX_DEFER = 90

/**
 * Marks up a subtree for shadowing.
 *
 * Doing this by traversal rather than by hand is deliberate: the equipment is
 * assembled from a few hundred small meshes across six files, and tagging each
 * one at its call site would be both unreadable and impossible to keep
 * consistent. The rule applied here is the one a lighting artist would use —
 * everything receives, but only objects big enough to throw a shape worth
 * seeing are allowed to cast.
 *
 * Excluded from casting:
 *  - anything smaller than `minCastSize` (indicators, buttons, fasteners, panel
 *    seams, handpieces): their shadows are sub-pixel, they are the bulk of the
 *    mesh count, and each one is another draw call in every depth pass. The
 *    threshold is a *largest dimension* test, not a volume one, so a lamp arm
 *    or an armrest still casts while the fittings bolted to it do not — which
 *    is the split between the objects worth shadowing (chairs, lamps, consoles,
 *    beds, canopies, trolleys, casework) and the ones that merely cost. The
 *    threshold is set high deliberately: the depth pass is dominated by its
 *    draw-call count, and a treatment room's few hundred sub-400 mm fittings
 *    sit inside the shadow of the machine they are bolted to anyway.
 *  - transparent materials (glazing, acrylic, the grounding decals themselves):
 *    a sheet of clear acrylic casting a solid black shape is worse than no
 *    shadow at all, and a shadow decal casting a shadow is nonsense
 *  - unlit materials, which are decals and emissive fixtures by definition
 */
export function ShadowTag({
  children,
  revision,
  minCastSize = 0.4,
}: {
  children: ReactNode
  /** Bump to re-tag after the subtree's contents change. */
  revision?: unknown
  minCastSize?: number
}) {
  const ref = useRef<THREE.Group>(null)
  const box = useMemo(() => new THREE.Box3(), [])
  const size = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mat = mesh.material as THREE.Material | THREE.Material[]
      const first = Array.isArray(mat) ? mat[0] : mat
      const unlit = !first || (first as THREE.MeshBasicMaterial).isMeshBasicMaterial === true
      const transparent = !!first?.transparent

      mesh.receiveShadow = !unlit && !transparent
      if (unlit || transparent || !mesh.geometry) {
        mesh.castShadow = false
        return
      }
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      box.copy(mesh.geometry.boundingBox!)
      box.getSize(size)
      mesh.castShadow = Math.max(size.x, size.y, size.z) >= minCastSize
    })
    requestShadowRefresh()
  }, [revision, minCastSize, box, size])

  return <group ref={ref}>{children}</group>
}
