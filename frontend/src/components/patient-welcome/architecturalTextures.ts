import * as THREE from 'three'

let floorTexture: THREE.CanvasTexture | null = null
let wallTexture: THREE.CanvasTexture | null = null

/** Large-format stone floor: subtle tonal variation between tiles plus faint
 * grout seams, generated once and tiled down the corridor. Self-contained —
 * no image assets to fetch — but reads as real stone rather than a flat color. */
export function getFloorTexture(): THREE.CanvasTexture {
  if (floorTexture) return floorTexture
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#141319'
  ctx.fillRect(0, 0, size, size)

  // Soft tonal veining — a handful of large, low-opacity blotches, not noise.
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 40 + Math.random() * 120
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    const light = Math.random() > 0.5
    grad.addColorStop(0, light ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
  }

  // Large-format tile grout lines — a 2x2 seam grid per tile.
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = 2
  const half = size / 2
  ctx.beginPath()
  ctx.moveTo(half, 0)
  ctx.lineTo(half, size)
  ctx.moveTo(0, half)
  ctx.lineTo(size, half)
  ctx.stroke()

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  floorTexture = texture
  return texture
}

/** Architectural wall panels: faint vertical joint lines at a believable panel
 * width, plus very light plaster-like noise — enough to read as constructed
 * wall paneling rather than a mathematically flat plane. */
export function getWallTexture(): THREE.CanvasTexture {
  if (wallTexture) return wallTexture
  const w = 512
  const h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#131119'
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < 14; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const r = 30 + Math.random() * 70
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, Math.random() > 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  // Vertical panel joints — three evenly spaced, matching a ~1.2–1.5m panel width.
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'
  ctx.lineWidth = 1.5
  for (const x of [w * 0.25, w * 0.5, w * 0.75]) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  wallTexture = texture
  return texture
}
