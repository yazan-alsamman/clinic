import type * as THREE from 'three'

/**
 * The shadow refresh queue.
 *
 * Nothing in this clinic moves: the equipment is bolted down, the lights are
 * fixed, and only the camera travels. A shadow map for a static scene is
 * correct forever once it has been rendered — so the renderer's automatic
 * per-frame shadow update is switched off (see `ShadowScheduler`) and maps are
 * re-rendered only when something genuinely changed: at start-up, when a room
 * crosses a level-of-detail threshold, and when the roaming key light moves to
 * a new room. Over a whole walk that is on the order of ten refreshes, against
 * one per frame.
 *
 * Kept in its own module rather than beside the components that use it so the
 * component files stay fast-refreshable — a module that exports both a
 * component and shared mutable state gets its state reset on every edit, which
 * is exactly what a registry must not do.
 */

type ShadowLight = THREE.Light & { shadow: THREE.LightShadow }

const registry = new Set<ShadowLight>()
const dirty = new Set<ShadowLight>()
let pending = false

/**
 * Frames to wait after the last refresh request before actually baking.
 *
 * Two jobs, both measured. A refresh is always asked for from inside the frame
 * that changed the scene — a room crossing its level-of-detail threshold builds
 * a few dozen extruded housings in that frame — and letting the depth pass land
 * on top of that build stacks the two most expensive things in the walkthrough
 * into a single stall. And while the patient scrolls quickly, those threshold
 * crossings arrive in bursts: five rooms un-culling and gaining detail across a
 * couple of seconds asked for a bake apiece, at ~250 ms each, which is what put
 * repeated third-of-a-second freezes into a fast walk.
 *
 * Waiting a short settle window fixes both: the bake never shares a frame with
 * the build that caused it, and a burst of requests collapses into one bake at
 * the end of the burst instead of one per request. The map is stale for about a
 * tenth of a second afterwards, during which the camera is still moving and the
 * room in question is still at the far end of the corridor.
 */
const SETTLE_FRAMES = 8
let settle = 0

/** Whether any light has actually had its depth map rendered yet.
 *
 * This is the readiness signal the room prewarm waits on, and it is a
 * correctness gate rather than a nicety. Preparing a material binds its shadow
 * samplers to the render targets those maps live in; do that before any map has
 * been rendered and the driver is handed a sampler pointing at a target that
 * was never drawn, which it reports as
 * `GL_INVALID_OPERATION: Mismatch between texture format and sampler type` and
 * answers by dropping the draw. An earlier attempt at prewarming ran at start-up
 * for exactly this reason and had to be abandoned. Waiting for the first bake
 * costs a fraction of a second and removes the whole failure mode. */
let bakedOnce = false

/** Puts a light under manual shadow control and queues its first bake.
 * Returns the unregister function, for use as an effect cleanup. */
export function registerShadowLight(light: ShadowLight): () => void {
  registry.add(light)
  light.shadow.autoUpdate = false
  dirty.add(light)
  pending = true
  settle = SETTLE_FRAMES
  return () => {
    registry.delete(light)
    dirty.delete(light)
  }
}

/** Queues every registered light for a re-bake. */
export function requestShadowRefresh(): void {
  for (const light of registry) dirty.add(light)
  pending = true
  settle = SETTLE_FRAMES
}

/** Pops the next light owed a bake, or null when the queue is empty. Called
 * once per frame by `ShadowScheduler`: refreshing every light in the same
 * frame costs all of their depth passes plus the first-time compile of their
 * depth programs at once, which lands as a visible stall. */
export function nextDirtyShadow(): ShadowLight | null {
  if (!pending) return null
  // Hold off until the scene has been quiet for a few frames — see SETTLE_FRAMES.
  if (settle > 0) {
    settle--
    return null
  }
  const next = dirty.values().next()
  if (next.done) {
    pending = false
    return null
  }
  dirty.delete(next.value)
  bakedOnce = true
  return next.value
}

/** True once at least one shadow map has been rendered — see `bakedOnce`. */
export function hasBakedOnce(): boolean {
  return bakedOnce
}
