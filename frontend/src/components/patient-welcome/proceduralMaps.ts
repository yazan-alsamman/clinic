import * as THREE from 'three'

/**
 * The clinic's procedural PBR texture library.
 *
 * Everything a surface needs to stop reading as a shaded polygon is here:
 * base colour with tonal variation, a roughness map so light breaks up across
 * a surface instead of behaving identically at every point, and a normal map
 * carrying the micro-relief real materials have. No fetched image assets —
 * partly so the welcome experience stays self-contained and can never be
 * broken by a missing file, and partly because a texture we generate is a
 * texture we can guarantee the *physical scale* of (see TILE below), which is
 * the realism failure nobody notices consciously and everybody notices.
 *
 * Every generator is lazy, cached, and individually fail-safe: if a canvas
 * cannot be created, or 2D context is unavailable, the accessor returns
 * `undefined` and the material simply renders with its base colour. One
 * texture failing must never take the walkthrough down with it.
 */

/** Physical size, in metres, that one repeat of each texture represents.
 * These are the real dimensions of the thing being modelled — 1.2 m porcelain
 * slabs, ~2.5 mm vinyl grain, a 0.9 m wood grain cycle — and they are what
 * stop the scene from looking like a doll house wrapped in giant textures. */
export const TILE = {
  /** 2 x 2 grid of 1.2 m large-format slabs. */
  floor: 2.4,
  /** A plaster field with a joint at every 1.2 m panel. */
  wall: 2.4,
  /** Vinyl/leather grain cell is ~2.5 mm; the tile holds ~48 of them. */
  vinyl: 0.12,
  /** Brushed steel graining runs at ~0.16 m before it repeats visibly. */
  brushed: 0.16,
  /** Injection-moulding orange peel — very fine. */
  plastic: 0.09,
  /** Micro-scratch field on polished/painted surfaces. */
  micro: 0.25,
  /** Oak grain cycle. */
  wood: 0.9,
  /** Engineered stone worktop / feature wall. */
  stone: 1.6,
} as const

/**
 * Generation resolution scale. Every map below is authored at a desktop size
 * and divided by this, because the whole library is built synchronously on the
 * main thread the first time the scene mounts — a few hundred thousand noise
 * samples that a laptop swallows and a phone stalls on. Halving the side
 * quarters the work, and micro-relief at half resolution is indistinguishable
 * on a screen that is already rendering at a reduced pixel ratio.
 *
 * Must be set before the first accessor is called; afterwards every map is
 * memoised and the setting has no effect.
 */
let scaleDiv = 1
export function configureProceduralQuality(lowPower: boolean): void {
  scaleDiv = lowPower ? 2 : 1
}
function res(size: number): number {
  return Math.max(64, Math.round(size / scaleDiv))
}

type Ctx = CanvasRenderingContext2D

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    return { canvas, ctx }
  } catch {
    return null
  }
}

/** Tileable integer-lattice value noise. Wrapping the lattice at `period`
 * is what lets these textures repeat down a 37 m corridor without a seam. */
function makeNoise(seed: number) {
  const hash = (xi: number, yi: number): number => {
    let n = (xi * 1619 + yi * 31337 + seed * 6971) | 0
    n = (n << 13) ^ n
    return 1 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824
  }
  const fade = (t: number) => t * t * (3 - 2 * t)
  return (x: number, y: number, period: number): number => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const wrap = (a: number) => ((a % period) + period) % period
    const x0 = wrap(xi)
    const x1 = wrap(xi + 1)
    const y0 = wrap(yi)
    const y1 = wrap(yi + 1)
    const u = fade(xf)
    const v = fade(yf)
    const top = hash(x0, y0) + (hash(x1, y0) - hash(x0, y0)) * u
    const bot = hash(x0, y1) + (hash(x1, y1) - hash(x0, y1)) * u
    return top + (bot - top) * v
  }
}

interface FbmOptions {
  seed?: number
  /** Lattice cells across the tile at the first octave. */
  base?: number
  octaves?: number
  /** Independent scaling of the x axis — how wood grain and brushed metal get
   * their direction, rather than being isotropic noise pretending to have one. */
  stretchX?: number
  stretchY?: number
}

/** Samples fractal noise into a Float32 field in -1..1, tileable at the edges. */
function fbmField(w: number, h: number, opts: FbmOptions = {}): Float32Array {
  const { seed = 1, base = 4, octaves = 4, stretchX = 1, stretchY = 1 } = opts
  const noise = makeNoise(seed)
  const out = new Float32Array(w * h)
  let norm = 0
  for (let o = 0; o < octaves; o++) norm += 1 / (1 << o)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let o = 0; o < octaves; o++) {
        const period = base * (1 << o)
        const amp = 1 / (1 << o)
        sum += noise((x / w) * period * stretchX, (y / h) * period * stretchY, period) * amp
      }
      out[y * w + x] = sum / norm
    }
  }
  return out
}

/** Height field to tangent-space normal map, by central differences.
 * `strength` sits in the 0.3-2.5 range for micro-relief; anything higher
 * starts to read as embossed plastic rather than as surface. */
function normalFromHeight(
  height: Float32Array,
  w: number,
  h: number,
  strength: number,
): THREE.CanvasTexture | undefined {
  const made = makeCanvas(w, h)
  if (!made) return undefined
  const { canvas, ctx } = made
  const img = ctx.createImageData(w, h)
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      // Normalise (-dx, -dy, 1) into the 0..1 encoding a normal map uses.
      const len = Math.hypot(dx, dy, 1)
      const i = (y * w + x) * 4
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return finish(canvas, THREE.NoColorSpace)
}

/** Float field to a greyscale texture, used for roughness. Linear colour
 * space: a roughness map is data, not a picture. */
function grayFromField(
  field: Float32Array,
  w: number,
  h: number,
  lo: number,
  hi: number,
): THREE.CanvasTexture | undefined {
  const made = makeCanvas(w, h)
  if (!made) return undefined
  const { canvas, ctx } = made
  const img = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const t = Math.min(1, Math.max(0, field[i] * 0.5 + 0.5))
    const v = Math.min(255, Math.max(0, (lo + (hi - lo) * t) * 255))
    const p = i * 4
    img.data[p] = v
    img.data[p + 1] = v
    img.data[p + 2] = v
    img.data[p + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return finish(canvas, THREE.NoColorSpace)
}

function finish(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.colorSpace = colorSpace
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

export interface MapSet {
  map?: THREE.Texture
  roughnessMap?: THREE.Texture
  normalMap?: THREE.Texture
}

/** Applies a physical tile size to a set of maps by cloning them, so the same
 * generated canvas can serve a 37 m corridor floor and a 3.6 m room floor at
 * the same real-world grain. Clones share the underlying image — no extra
 * upload, one extra texture object. */
export function tiled(set: MapSet, repeatX: number, repeatY: number): MapSet {
  const out: MapSet = {}
  for (const key of ['map', 'roughnessMap', 'normalMap'] as const) {
    const src = set[key]
    if (!src) continue
    const c = src.clone()
    c.wrapS = THREE.RepeatWrapping
    c.wrapT = THREE.RepeatWrapping
    c.repeat.set(repeatX, repeatY)
    c.needsUpdate = true
    out[key] = c
  }
  return out
}

function memo<T>(fn: () => T): () => T {
  let cached: T | undefined
  let done = false
  return () => {
    if (!done) {
      done = true
      try {
        cached = fn()
      } catch {
        cached = undefined
      }
    }
    return cached as T
  }
}

// ---------------------------------------------------------------------
// Stone floor - large-format polished porcelain
// ---------------------------------------------------------------------

/**
 * Two-by-two 1.2 m slabs. Three things make this read as stone rather than a
 * grey plane: each slab carries a slightly different base tone (real batches
 * vary, and an installer deliberately mixes them), soft directional veining
 * drifts across the slab without respecting its edges, and the grout line is
 * a *recess* in the normal map as well as a dark line in the albedo, so it
 * catches a shadow at grazing angles the way a real joint does.
 */
const floorMaps = memo<MapSet>(() => {
  const S = res(512)
  const made = makeCanvas(S, S)
  if (!made) return {}
  const { canvas, ctx } = made

  // Slab tones: four subtly different cuts of the same stone.
  const slabTone = [0.0, 0.013, -0.011, 0.006]
  const baseL = 0.3
  const half = S / 2
  for (let sy = 0; sy < 2; sy++) {
    for (let sx = 0; sx < 2; sx++) {
      const l = baseL + slabTone[sy * 2 + sx]
      ctx.fillStyle = `rgb(${Math.round(l * 255 * 1.07)},${Math.round(l * 255)},${Math.round(l * 255 * 0.9)})`
      ctx.fillRect(sx * half, sy * half, half, half)
    }
  }

  // Veining: long, low-contrast strokes that read as mineral, not as a hotel
  // lobby feature wall. Ridged noise concentrates variation into thin veins.
  const veinField = fbmField(S, S, { seed: 7, base: 3, octaves: 5, stretchX: 2.4 })
  const microField = fbmField(S, S, { seed: 23, base: 48, octaves: 2 })
  const img = ctx.getImageData(0, 0, S, S)
  for (let i = 0; i < S * S; i++) {
    const ridge = 1 - Math.abs(veinField[i])
    const vein = Math.pow(Math.max(0, ridge - 0.62) / 0.38, 2.2) * 24
    const micro = microField[i] * 2
    const p = i * 4
    img.data[p] = Math.min(255, img.data[p] + vein * 1.02 + micro)
    img.data[p + 1] = Math.min(255, img.data[p + 1] + vein * 0.98 + micro)
    img.data[p + 2] = Math.min(255, img.data[p + 2] + vein * 0.9 + micro)
  }
  ctx.putImageData(img, 0, 0)

  // Grout joints between the slabs. 2 px at 512 over 2.4 m is ~3 mm, which is
  // what a rectified large-format tile actually gets.
  ctx.strokeStyle = 'rgba(0,0,0,0.42)'
  ctx.lineWidth = Math.max(1, 1.6 / scaleDiv)
  ctx.beginPath()
  ctx.moveTo(half, 0)
  ctx.lineTo(half, S)
  ctx.moveTo(0, half)
  ctx.lineTo(S, half)
  ctx.stroke()

  const map = finish(canvas, THREE.SRGBColorSpace)

  // Roughness: polished stone is not uniformly polished. Broad, slow variation
  // plus a rougher band along every joint (grout is matte) is what makes the
  // floor's reflection break up instead of behaving like a mirror.
  const roughField = fbmField(S, S, { seed: 31, base: 5, octaves: 3 })
  const rough = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      const dj = Math.min(Math.abs(x - half), Math.abs(y - half), x, y, S - 1 - x, S - 1 - y)
      rough[i] = roughField[i] * 0.6 + (dj < 3 / scaleDiv ? 0.5 : 0)
    }
  }
  const roughnessMap = grayFromField(rough, S, S, 0.14, 0.44)

  // Normal: the joint recess, plus a barely-there stone tooth.
  const tooth = fbmField(S, S, { seed: 55, base: 190, octaves: 3 })
  const normalMap = normalFromHeight(tooth, S, S, 0.12)

  return { map, roughnessMap, normalMap }
})

// ---------------------------------------------------------------------
// Wall - fine plaster over panel joints
// ---------------------------------------------------------------------

/**
 * Immaculate, not perfect. The wall gets a fine plaster tooth in the normal
 * map, a very slight tonal drift in the albedo (the trowel and the light both
 * leave one), and a shadow-gap joint every 1.2 m. Nothing here is dirt: the
 * clinic stays spotless, it just stops being mathematically flat.
 */
const wallMaps = memo<MapSet>(() => {
  const S = res(512)
  const made = makeCanvas(S, S)
  if (!made) return {}
  const { canvas, ctx } = made

  const tone = fbmField(S, S, { seed: 11, base: 3, octaves: 4 })
  const tooth = fbmField(S, S, { seed: 19, base: 150, octaves: 4 })
  const img = ctx.createImageData(S, S)
  for (let i = 0; i < S * S; i++) {
    const l = 190 + tone[i] * 4 + tooth[i] * 2
    const p = i * 4
    img.data[p] = Math.min(255, l * 1.01)
    img.data[p + 1] = l
    img.data[p + 2] = l * 0.975
    img.data[p + 3] = 255
  }
  ctx.putImageData(img, 0, 0)

  // Panel shadow gaps at the tile midline - 1.2 m panels across a 2.4 m tile.
  ctx.strokeStyle = 'rgba(0,0,0,0.14)'
  ctx.lineWidth = Math.max(1, 1.5 / scaleDiv)
  ctx.beginPath()
  ctx.moveTo(S / 2, 0)
  ctx.lineTo(S / 2, S)
  ctx.stroke()

  const map = finish(canvas, THREE.SRGBColorSpace)

  const roughField = fbmField(S, S, { seed: 43, base: 14, octaves: 3 })
  const roughnessMap = grayFromField(roughField, S, S, 0.7, 0.8)

  const height = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      const dj = Math.abs(x - S / 2)
      const jw = 2 / scaleDiv
      height[i] = tooth[i] * 0.22 + (dj < jw ? -(jw - dj) / jw : 0)
    }
  }
  const normalMap = normalFromHeight(height, S, S, 0.45)
  return { map, roughnessMap, normalMap }
})

// ---------------------------------------------------------------------
// Manufactured surfaces
// ---------------------------------------------------------------------

/** Injection-moulded ABS: the faint orange peel every moulded housing has,
 * plus roughness drift so a white shell does not return one flat highlight. */
const plasticMaps = memo<MapSet>(() => {
  const S = res(256)
  const peel = fbmField(S, S, { seed: 61, base: 26, octaves: 3 })
  return {
    roughnessMap: grayFromField(peel, S, S, 0.8, 1.0),
    normalMap: normalFromHeight(peel, S, S, 0.5),
  }
})

/** Brushed stainless: unidirectional graining. The stretch is the whole point
 * - isotropic noise on steel reads as sandblasted, never as brushed. */
const brushedMaps = memo<MapSet>(() => {
  const S = res(256)
  const grain = fbmField(S, S, { seed: 71, base: 4, octaves: 4, stretchX: 30 })
  return {
    roughnessMap: grayFromField(grain, S, S, 0.74, 1.12),
    normalMap: normalFromHeight(grain, S, S, 0.6),
  }
})

/** Microscopic scratch field for polished and painted surfaces. Not readable
 * as scratches at any distance the camera actually gets to - it exists so a
 * highlight shimmers slightly instead of sitting perfectly still, which is the
 * difference between polished metal and a shiny 3D primitive. */
const microMaps = memo<MapSet>(() => {
  const S = res(256)
  const a = fbmField(S, S, { seed: 83, base: 6, octaves: 3, stretchX: 22 })
  const b = fbmField(S, S, { seed: 97, base: 6, octaves: 3, stretchY: 22 })
  const mix = new Float32Array(S * S)
  for (let i = 0; i < S * S; i++) mix[i] = a[i] * 0.6 + b[i] * 0.4
  return {
    roughnessMap: grayFromField(mix, S, S, 0.88, 1.08),
    normalMap: normalFromHeight(mix, S, S, 0.28),
  }
})

/** Medical vinyl upholstery: the pebbled grain that says "soft" before a
 * viewer has consciously identified the material. */
const vinylMaps = memo<MapSet>(() => {
  const S = res(256)
  const grain = fbmField(S, S, { seed: 103, base: 34, octaves: 3 })
  const cell = new Float32Array(S * S)
  for (let i = 0; i < S * S; i++) cell[i] = 1 - Math.abs(grain[i]) * 1.6
  return {
    roughnessMap: grayFromField(cell, S, S, 0.9, 1.06),
    normalMap: normalFromHeight(cell, S, S, 1.3),
  }
})

/** Oak veneer for the reception joinery - directional grain with real growth
 * rings, not stretched noise. */
const woodMaps = memo<MapSet>(() => {
  const S = res(512)
  const made = makeCanvas(S, S)
  if (!made) return {}
  const { canvas, ctx } = made
  const warp = fbmField(S, S, { seed: 127, base: 3, octaves: 4, stretchX: 1.4 })
  const fine = fbmField(S, S, { seed: 131, base: 10, octaves: 4, stretchX: 26 })
  const img = ctx.createImageData(S, S)
  const height = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      // Growth rings: a periodic function of the *warped* cross-grain axis, so
      // the rings wander the way sawn timber does.
      //
      // Both the frequency and the contrast matter here, and the first version
      // had them the wrong way round: nine wide rings swinging 40% in value
      // across a 600 mm tile produced regular light-and-dark banding, which is
      // what a stripe generator looks like rather than what timber looks like.
      // Real quarter-sawn oak veneer of the grade a reception counter is faced
      // in has *fine, closely spaced, low-contrast* figure — you read it as a
      // direction and a warmth long before you read individual rings. Nearly
      // doubling the ring count while more than halving the amplitude, and
      // narrowing the light lobe with a higher exponent, moves it from stripes
      // to figure.
      const ring = Math.sin((y / S) * Math.PI * 2 * 15 + warp[i] * 4.2)
      const g = Math.pow(Math.max(0, ring), 2.0)
      const l = 0.55 + g * 0.085 + fine[i] * 0.055
      const p = i * 4
      // Slightly desaturated from the earlier orange-brown: a clinic's joinery
      // is specified pale and calm, not honey-toned.
      img.data[p] = Math.min(255, l * 146)
      img.data[p + 1] = Math.min(255, l * 117)
      img.data[p + 2] = Math.min(255, l * 93)
      img.data[p + 3] = 255
      height[i] = g * 0.5 + fine[i] * 0.5
    }
  }
  ctx.putImageData(img, 0, 0)
  return {
    map: finish(canvas, THREE.SRGBColorSpace),
    roughnessMap: grayFromField(height, S, S, 0.8, 1.05),
    normalMap: normalFromHeight(height, S, S, 0.8),
  }
})

/** Engineered stone for worktops and the finale wall - finer grained and more
 * uniform than the floor, as quartz composite genuinely is. */
const stoneMaps = memo<MapSet>(() => {
  const S = res(256)
  const made = makeCanvas(S, S)
  if (!made) return {}
  const { canvas, ctx } = made
  const speck = fbmField(S, S, { seed: 149, base: 30, octaves: 3 })
  const drift = fbmField(S, S, { seed: 151, base: 4, octaves: 3 })
  const img = ctx.createImageData(S, S)
  for (let i = 0; i < S * S; i++) {
    const l = 150 + drift[i] * 11 + speck[i] * 15
    const p = i * 4
    img.data[p] = Math.min(255, l * 1.03)
    img.data[p + 1] = l
    img.data[p + 2] = l * 0.94
    img.data[p + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return {
    map: finish(canvas, THREE.SRGBColorSpace),
    roughnessMap: grayFromField(speck, S, S, 0.84, 1.0),
    normalMap: normalFromHeight(speck, S, S, 0.12),
  }
})

/**
 * Room signage: the department name etched into a dark plate.
 *
 * Rendered as an *opaque* plate — dark ground, light lettering — rather than
 * light lettering on transparency. Canvas-generated alpha is not reliable
 * once it has been through a texture upload on every target (see the note in
 * `grounding.tsx`), and a wayfinding sign that renders as a blank rectangle
 * on some machines is worse than one that is simply drawn in full.
 */
const signCache = new Map<string, THREE.Texture | undefined>()
export function getSignTexture(label: string): THREE.Texture | undefined {
  if (signCache.has(label)) return signCache.get(label)
  let result: THREE.Texture | undefined
  try {
    const W = 320
    const H = 128
    const made = makeCanvas(W, H)
    if (made) {
      const { canvas, ctx } = made
      ctx.fillStyle = '#16161a'
      ctx.fillRect(0, 0, W, H)
      // A hairline frame, the way an engraved plate has a machined edge.
      ctx.strokeStyle = 'rgba(190,186,178,0.28)'
      ctx.lineWidth = 2
      ctx.strokeRect(5, 5, W - 10, H - 10)
      ctx.fillStyle = '#ddd6cb'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '600 40px "Segoe UI", Tahoma, system-ui, sans-serif'
      ctx.fillText(label, W / 2, H / 2 + 2, W - 40)
      const t = new THREE.CanvasTexture(canvas)
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      t.needsUpdate = true
      result = t
    }
  } catch {
    result = undefined
  }
  signCache.set(label, result)
  return result
}

export const getFloorMaps = floorMaps
export const getWallMaps = wallMaps
export const getPlasticMaps = plasticMaps
export const getBrushedMaps = brushedMaps
export const getMicroMaps = microMaps
export const getVinylMaps = vinylMaps
export const getWoodMaps = woodMaps
export const getStoneMaps = stoneMaps
