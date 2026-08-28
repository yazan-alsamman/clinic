import { useEffect, useRef, useState, type RefObject } from 'react'
import { sampleWalkthrough, clamp01 } from './walkthroughPath'
import type { ServiceGeometry } from './serviceCatalog'

const WHEEL_SENSITIVITY = 0.00085
const TOUCH_SENSITIVITY = 0.0022
const KEY_STEP = 0.09
const CONTINUE_THRESHOLD = 0.86

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

    function onWheel(e: WheelEvent) {
      if (lockedRef.current) return
      e.preventDefault()
      targetRef.current = clamp01(targetRef.current + e.deltaY * WHEEL_SENSITIVITY)
      markInteracted()
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
      targetRef.current = clamp01(targetRef.current + delta * TOUCH_SENSITIVITY)
      markInteracted()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (lockedRef.current) return
      const isButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON'
      if ((e.key === ' ' || e.key === 'Enter') && isButton) return // let the button handle its own activation
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        targetRef.current = clamp01(targetRef.current + KEY_STEP)
        markInteracted()
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        targetRef.current = clamp01(targetRef.current - KEY_STEP)
        markInteracted()
      } else if (e.key === 'Home') {
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
    const damping = reducedMotion ? 1 : 0.09

    function tick() {
      const prev = progressRef.current
      progressRef.current += (targetRef.current - progressRef.current) * damping
      velocityRef.current = progressRef.current - prev

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
