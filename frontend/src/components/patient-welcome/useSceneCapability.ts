import { useState } from 'react'

export interface SceneCapability {
  /** user prefers-reduced-motion — skip the 3D scene and cinematic entrance entirely */
  reducedMotion: boolean
  /** WebGL context could not be created — hardware/driver/browser limitation */
  webglSupported: boolean
  /** coarse pointer (touch) — used to simplify geometry and skip pointer parallax */
  isTouch: boolean
  /** low core count or small viewport — trims geometry detail and disables glass materials */
  isLowPower: boolean
}

function detectWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    return !!gl
  } catch {
    return false
  }
}

function computeCapability(): SceneCapability {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const isTouch = window.matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency || 4
  const isLowPower = isTouch && (cores <= 4 || window.innerWidth < 480)
  return {
    reducedMotion,
    webglSupported: reducedMotion ? false : detectWebgl(),
    isTouch,
    isLowPower,
  }
}

/** Pure client-side app (no SSR) — safe to read matchMedia/WebGL synchronously
 * on first render via a lazy initializer instead of deferring to an effect. */
export function useSceneCapability(): SceneCapability {
  const [state] = useState<SceneCapability>(computeCapability)
  return state
}
