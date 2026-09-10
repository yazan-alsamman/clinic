/**
 * A one-at-a-time gate for expensive level-of-detail upgrades.
 *
 * Furnishing a treatment room at full detail means building a few dozen
 * extruded housings, cushions and lathed mouldings, and that construction is
 * synchronous CPU work in the React commit — measured on this scene at roughly
 * a quarter of a second per room. The corridor puts five rooms within a few
 * metres of one another, so a patient scrolling briskly used to cross several
 * thresholds almost together and pay for all of those builds in one frame.
 *
 * This serialises them. A room asks to upgrade; if another room upgraded very
 * recently the answer is no, and it simply asks again next frame. The total
 * work is unchanged, but it arrives as separate short pauses rather than one
 * long freeze — and, paired with the latch in `DepartmentEquipment` (a room
 * that has been built is never torn back down), each room pays it once for the
 * whole session instead of on every threshold crossing.
 *
 * Kept in its own module rather than beside the component so the component
 * file stays fast-refreshable: a module exporting both a component and shared
 * mutable state has its state reset on every edit, which is exactly what a
 * budget must not do.
 */

/** Minimum spacing between two rooms' upgrades. A little longer than a single
 * room's build, so two builds never land in the same frame. */
const MIN_GAP_MS = 280

let lastUpgrade = -Infinity

/** Asks permission to build one room at full detail this frame. */
export function claimLodUpgrade(now: number): boolean {
  if (now - lastUpgrade < MIN_GAP_MS) return false
  lastUpgrade = now
  return true
}

/**
 * When rooms may be furnished *ahead* of the patient reaching them.
 *
 * Furnishing a room used to be triggered purely by proximity, which meant the
 * work landed at the worst possible moment: the patient arrives at a doorway,
 * and only then does the room build its geometry and link its shaders. Profiled
 * over a natural traversal, that cost 5.2 s of blocked main thread in first-use
 * shader linking alone, plus ~2.1 s of geometry construction — arriving as one
 * multi-second hitch per room, right as the room came into view.
 *
 * None of that work has to happen then. The corridor is known in advance, so
 * once the opening frame is on screen and the patient is still reading the
 * welcome, every room can be built and its shaders linked while it is still
 * culled and the camera is stationary — which is the one moment in the whole
 * experience with capacity to spare.
 *
 * The delay is measured from the first shadow bake rather than from mount: it
 * has to clear both the entrance animation and the cold-load compile, or the
 * prewarm simply piles onto the stall it exists to avoid.
 */
const PREWARM_DELAY_MS = 900
let readyAt = 0

/** Called once the scene is genuinely established (see `hasBakedOnce`). */
export function noteSceneReady(now: number): void {
  if (readyAt === 0) readyAt = now
}

/** Whether rooms may now be furnished ahead of arrival. */
export function prewarmOpen(now: number): boolean {
  return readyAt !== 0 && now - readyAt >= PREWARM_DELAY_MS
}
