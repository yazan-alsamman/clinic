import { useEffect, useRef, useState, type RefObject } from 'react'
import { sampleWalkthrough, clamp01, STATIONS } from './walkthroughPath'
import type { ServiceGeometry } from './serviceCatalog'

// Input → journey sensitivities. These are the pacing dial: the corridor, the
// curve and its control-point clustering are all unchanged, so the only thing
// setting how fast the patient walks is how much journey a gesture buys.
// Tuned for a slow architectural walkthrough — a standard mouse notch
// (deltaY 100 px) advances ~0.046 of the journey, so the full corridor is
// roughly twenty unhurried notches rather than a dozen quick ones.
const WHEEL_SENSITIVITY = 0.00046
const TOUCH_SENSITIVITY = 0.0012
const KEY_STEP = 0.055
const CONTINUE_THRESHOLD = 0.86

// A wheel event's deltaY is only in pixels when deltaMode is DOM_DELTA_PIXEL.
// Firefox reports lines (deltaY ≈ 3 per notch) and a page-scroll device reports
// pages, so without normalising, the same gesture buys wildly different amounts
// of journey per browser — cinematic on one and unusable on another.
const LINE_HEIGHT_PX = 16
function wheelPixels(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * LINE_HEIGHT_PX
  if (e.deltaMode === 2) return e.deltaY * window.innerHeight
  return e.deltaY
}

/** Journey positions that earn extra screen time: each department's hero frame
 * (the same railT the rail dots jump to) and the finale wall. Near one of these
 * the same gesture buys less journey, so the camera drifts through the reveal
 * instead of sweeping past it. Deliberately a soft field rather than a snap or
 * a hold — a hard stop would turn the corridor into a carousel. */
const DEPARTMENT_ANCHORS = STATIONS.map((s) => s.railT)
const DEPARTMENT_RADIUS = 0.055
const DEPARTMENT_SCALE = 0.62
// The finale gets a wider, slower field than a department: the logo should
// resolve out of the far end of the corridor over a long approach, not arrive.
const FINALE_RADIUS = 0.13
const FINALE_SCALE = 0.5

function smoothBump(d: number, radius: number): number {
  if (d >= radius) return 0
  const x = 1 - d / radius
  return x * x * (3 - 2 * x) // smoothstep — zero value *and* zero slope at the edge
}

/** Speed multiplier at journey position t: 1 in the open corridor, easing down
 * toward the anchor scales near a department or the finale. Takes the strongest
 * single field rather than multiplying them, so the last department overlapping
 * the finale approach cannot stack into a near-standstill. */
function pacingScale(t: number): number {
  let slow = 0
  for (const anchor of DEPARTMENT_ANCHORS) {
    slow = Math.max(slow, smoothBump(Math.abs(t - anchor), DEPARTMENT_RADIUS) * (1 - DEPARTMENT_SCALE))
  }
  slow = Math.max(slow, smoothBump(1 - t, FINALE_RADIUS) * (1 - FINALE_SCALE))
  return 1 - slow
}

// Exponential settle, stated per 60 fps frame and re-derived for the real frame
// interval below — a touch softer than before so the camera eases to rest,
// still well short of the lag that would read as sticky.
const DAMPING_PER_FRAME = 0.08
// Hard ceiling on how much journey a single 60 fps frame may cover, whatever
// input is pending. This is what keeps a trackpad fling reading as "walking
// faster" rather than teleporting: sustained maximum input crosses the whole
// clinic in ~2.2 s at the ceiling, and ordinary scrolling never reaches it.
const MAX_STEP_PER_FRAME = 0.0075
// A backgrounded tab hands back one enormous frame interval on resume; clamp it
// so the camera picks up where it left off rather than lurching forward.
const MAX_FRAME_SPAN = 4
// Below this the camera is within ~3 mm of its target along a 31 m corridor —
// close enough to call it arrived. See the settle below.
const SETTLE_EPSILON = 1e-4

export interface WalkthroughProgressApi {
  /** Live, damped 0..1 journey position — read every animation frame by the
   * camera. Intentionally a ref, not React state: it changes every frame and
   * the 3D layer must not re-render on each tick. */
  progressRef: RefObject<number>
  velocityRef: RefObject<number>
  activeStation: ServiceGeometry | null
  hasInteracted: boolean
  continueUnlocked: boolean
  locked: boolean
  jumpTo: (t: number, opts?: { instant?: boolean }) => void
  setLocked: (v: boolean) => void
}

/** Owns the "camera as the user" input model: wheel, touch drag, and keyboard
 * (arrows/page/space/home/end) all accumulate into a target journey position,
 * which is then damped toward every frame — the inertia/settle behavior a raw
 * `scrollY → camera.position` binding can't give you. Works identically with
 * or without the 3D layer, so the reduced-motion/no-WebGL fallback can drive
 * its own gentle cross-fades from the same source of truth. */
export function useWalkthroughProgress(
  containerRef: RefObject<HTMLElement | null>,
  reducedMotion: boolean,
): WalkthroughProgressApi {
  const targetRef = useRef(0)
  const progressRef = useRef(0)
  const velocityRef = useRef(0)
  const lockedRef = useRef(false)
  const activeStationRef = useRef<ServiceGeometry | null>(null)
  const hasInteractedRef = useRef(false)
  const continueUnlockedRef = useRef(false)

  const [activeStation, setActiveStation] = useState<ServiceGeometry | null>(null)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [continueUnlocked, setContinueUnlocked] = useState(false)
  const [locked, setLockedState] = useState(false)

  function markInteracted() {
    if (!hasInteractedRef.current) {
      hasInteractedRef.current = true
      setHasInteracted(true)
    }
  }

  function jumpTo(t: number, opts?: { instant?: boolean }) {
    const clamped = clamp01(t)
    targetRef.current = clamped
    if (opts?.instant || reducedMotion) progressRef.current = clamped
    markInteracted()
  }

  function setLocked(v: boolean) {
    lockedRef.current = v
    setLockedState(v)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    /** Travel a relative amount of journey, paced by where the camera currently
     * *is* rather than where the target may have run ahead to — the gesture
     * should be scaled by the room the patient is actually looking at. */
    function travel(amount: number) {
      targetRef.current = clamp01(targetRef.current + amount * pacingScale(progressRef.current))
      markInteracted()
    }

    function onWheel(e: WheelEvent) {
      if (lockedRef.current) return
      e.preventDefault()
      travel(wheelPixels(e) * WHEEL_SENSITIVITY)
    }

    let touchStartY: number | null = null
    function onTouchStart(e: TouchEvent) {
      touchStartY = e.touches[0]?.clientY ?? null
    }
    function onTouchMove(e: TouchEvent) {
      if (lockedRef.current || touchStartY === null) return
      e.preventDefault()
      const y = e.touches[0]?.clientY
      if (y === undefined) return
      const delta = touchStartY - y
      touchStartY = y
      travel(delta * TOUCH_SENSITIVITY)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (lockedRef.current) return
      const isButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON'
      if ((e.key === ' ' || e.key === 'Enter') && isButton) return // let the button handle its own activation
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        travel(KEY_STEP)
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        travel(-KEY_STEP)
      } else if (e.key === 'Home') {
        // Home/End name a destination rather than an amount of travel, so the
        // pacing field must not attenuate them — they address the ends of the
        // journey directly and must always be able to reach exactly 0 and 1.
        targetRef.current = 0
        markInteracted()
      } else if (e.key === 'End') {
        targetRef.current = 1
        markInteracted()
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [containerRef])

  useEffect(() => {
    let rafId: number
    let lastTime = performance.now()

    function tick(now: number) {
      const prev = progressRef.current
      // The frame interval expressed in 60 fps frames, so the damping constant
      // and the velocity ceiling below describe the same walking speed on a
      // 60 Hz panel and on a 144 Hz one. Without it, a ceiling stated per frame
      // is not a speed at all.
      const frames = Math.min(Math.max((now - lastTime) / (1000 / 60), 0), MAX_FRAME_SPAN)
      lastTime = now

      if (reducedMotion) {
        progressRef.current = targetRef.current
      } else {
        // Exponential settle, re-derived for the real frame interval: still an
        // ease-to-rest, with nothing to overshoot or oscillate around.
        const eased = (targetRef.current - prev) * (1 - Math.pow(1 - DAMPING_PER_FRAME, frames))
        // …then capped. The ceiling eases down with the same pacing field the
        // input uses, so even a rapid scroll slows through a department instead
        // of skating past it on the cap.
        const ceiling = MAX_STEP_PER_FRAME * pacingScale(prev) * frames
        progressRef.current = prev + Math.max(-ceiling, Math.min(ceiling, eased))
        // An exponential settle only ever *approaches* its target, so land it
        // once the remainder is below a few millimetres of corridor. Costs
        // nothing visible and guarantees the ends of the journey — t=0 and
        // t=1, and so the finale framing — are reached exactly, not merely
        // approximated for the rest of the session.
        if (Math.abs(targetRef.current - progressRef.current) < SETTLE_EPSILON) {
          progressRef.current = targetRef.current
        }
      }

      // Journey delta per 60 fps frame — frame-rate independent, so the
      // camera's walking sway reads the same on every display.
      velocityRef.current = frames > 0 ? (progressRef.current - prev) / frames : 0

      const sample = sampleWalkthrough(progressRef.current)
      if (sample.activeStation !== activeStationRef.current) {
        activeStationRef.current = sample.activeStation
        setActiveStation(sample.activeStation)
      }
      if (!continueUnlockedRef.current && progressRef.current >= CONTINUE_THRESHOLD) {
        continueUnlockedRef.current = true
        setContinueUnlocked(true)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [reducedMotion])

  return { progressRef, velocityRef, activeStation, hasInteracted, continueUnlocked, locked, jumpTo, setLocked }
}
