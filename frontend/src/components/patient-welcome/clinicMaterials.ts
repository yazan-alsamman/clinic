import {
  TILE,
  tiled,
  getPlasticMaps,
  getBrushedMaps,
  getMicroMaps,
  getVinylMaps,
  getWoodMaps,
  getStoneMaps,
} from './proceduralMaps'

/**
 * The clinic's physical material library.
 *
 * Every value here is chosen to be *physically valid* rather than merely
 * pleasant: in a PBR renderer `metalness` is a classifier, not a slider —
 * a surface is either a conductor (1) or a dielectric (0), and the in-between
 * values the earlier passes used are why brushed steel, molded plastic and
 * ceramic all read as the same waxy substance. Real equipment reads as real
 * largely because a viewer can tell painted steel from ABS from vinyl at a
 * glance, so the split below is deliberate and load-bearing.
 *
 * What this pass adds on top of that is *variation*. A correct constant
 * roughness still produces a highlight that behaves identically across an
 * entire surface, and a uniform highlight is the single loudest remaining
 * "this is CG" signal. Each material now carries a roughness map and a
 * micro-normal at the real physical scale of the material it represents
 * (see `TILE`), so light breaks up across a shell, a rail or a cushion the
 * way it does on a manufactured object. None of it is dirt or damage: the
 * clinic stays immaculate, it just stops being mathematically perfect.
 *
 * Anything expensive (clearcoat, sheen) collapses on low-power devices, where
 * the extra passes cost more than they visibly buy — as do the maps
 * themselves, since micro-relief is the first thing that stops resolving on a
 * small screen at reduced pixel ratio.
 */

export interface ClinicMaterials {
  /** Injection-molded ABS shell — the off-white housing of most medical devices. */
  shell: Record<string, unknown>
  /** A second, cooler and very slightly darker polymer grade. Real equipment is
   * assembled from parts moulded in different batches and finishes; using one
   * white for the whole machine is the main reason large devices read as a
   * single carved mass rather than an assembly. */
  shellAlt: Record<string, unknown>
  /** Satin-finish polymer for large curved cowlings — flatter than `shell`, so
   * a big surface returns a broad soft gradient instead of a hot highlight. */
  shellSatin: Record<string, unknown>
  /** Graphite body polymer — the darker lower half of a large machine.
   *
   * The one thing that separates a two-metre device from a white mass at six
   * metres is a change of *value*, not of finish. Seams, reveals and roughness
   * variation all work inside a value; none of them survives being read across
   * a room. Real equipment of this size is built this way for practical
   * reasons — the lower body is what gets kicked, wheeled into and wiped down,
   * so it is moulded in a darker grade — which is why a white hood over a
   * graphite base reads immediately as a manufactured machine. */
  bodyGraphite: Record<string, unknown>
  /** The shade inside a panel gap or a recess. Nearly black, fully matte:
   * a real gap shows the unlit inside of the housing. */
  recess: Record<string, unknown>
  /** The darker molded plastic used for bases, bezels and control housings. */
  shellDark: Record<string, unknown>
  /** Soft-touch elastomer — grips, handle over-mouldings, bumpers. */
  softTouch: Record<string, unknown>
  /** Powder-coated steel — device frames, arms, brackets. A real metal. */
  paintedSteel: Record<string, unknown>
  /** Brushed stainless — trolley rails, trays, kick plates. A real metal. */
  brushedSteel: Record<string, unknown>
  /** Polished chrome — the small bright trim only; overusing this is the tell. */
  chrome: Record<string, unknown>
  /** Medical-grade vinyl upholstery, with the fabric sheen real seating has. */
  upholstery: Record<string, unknown>
  /** Lighter upholstery for the aesthetic/skincare rooms. */
  upholsteryLight: Record<string, unknown>
  /** Rubber — casters, seals, grommets, cable jackets. */
  rubber: Record<string, unknown>
  /** The dark glass of a switched-off display, behind its bezel. */
  screenGlass: Record<string, unknown>
  /** Cast acrylic — solarium panels, equipment covers. */
  acrylic: Record<string, unknown>
  /** Architectural glazing — door screens, partitions. */
  glazing: Record<string, unknown>
  /** Enameled ceramic — cuspidor bowls, basins. */
  ceramic: Record<string, unknown>
  /** Oak veneer joinery — the reception desk front and counter. */
  wood: Record<string, unknown>
  /** Engineered stone — worktops, the reception counter top, feature panels. */
  stone: Record<string, unknown>
}

/** Cheap positional variation so two objects sharing a material never return
 * the exact same highlight. Offsetting the shared map clones by a per-material
 * amount costs nothing and breaks the "cloned prop" look. */
function offset(maps: ReturnType<typeof tiled>, u: number, v: number) {
  for (const t of Object.values(maps)) t?.offset.set(u, v)
  return maps
}

interface MapBundle {
  plastic: ReturnType<typeof tiled>
  plasticFine: ReturnType<typeof tiled>
  brushed: ReturnType<typeof tiled>
  micro: ReturnType<typeof tiled>
  microFine: ReturnType<typeof tiled>
  vinyl: ReturnType<typeof tiled>
  wood: ReturnType<typeof tiled>
  stone: ReturnType<typeof tiled>
}

/** Texture clones are per-`tiled()`-call objects, so they are built once here
 * rather than on every `makeClinicMaterials` call — the environment and each
 * of the five rooms all ask for the library, and none of them should be
 * allocating another eight texture objects to get it. */
let bundle: MapBundle | null = null
function maps(): MapBundle {
  if (bundle) return bundle
  const perM = (tile: number) => 1 / tile
  bundle = {
    plastic: tiled(getPlasticMaps(), perM(TILE.plastic), perM(TILE.plastic)),
    plasticFine: offset(tiled(getPlasticMaps(), perM(TILE.plastic) * 1.7, perM(TILE.plastic) * 1.7), 0.37, 0.61),
    brushed: tiled(getBrushedMaps(), perM(TILE.brushed), perM(TILE.brushed)),
    micro: tiled(getMicroMaps(), perM(TILE.micro), perM(TILE.micro)),
    microFine: offset(tiled(getMicroMaps(), perM(TILE.micro) * 2.3, perM(TILE.micro) * 2.3), 0.13, 0.44),
    vinyl: tiled(getVinylMaps(), perM(TILE.vinyl), perM(TILE.vinyl)),
    wood: tiled(getWoodMaps(), perM(TILE.wood), perM(TILE.wood)),
    stone: tiled(getStoneMaps(), perM(TILE.stone), perM(TILE.stone)),
  }
  return bundle
}

/** Roughness maps multiply the scalar `roughness`, so the scalar becomes the
 * *ceiling* of the range rather than the value. Materials below are written
 * with that in mind: the generated maps sit around 0.75–1.1, so the effective
 * roughness lands just under the stated number with real variation around it. */
function withMaps(
  base: Record<string, unknown>,
  set: ReturnType<typeof tiled>,
  normalScale: number,
  enabled: boolean,
): Record<string, unknown> {
  if (!enabled) return base
  const out = { ...base }
  if (set.roughnessMap) out.roughnessMap = set.roughnessMap
  if (set.map) out.map = set.map
  if (set.normalMap) {
    out.normalMap = set.normalMap
    out.normalScale = [normalScale, normalScale]
  }
  return out
}

const cache = new Map<boolean, ClinicMaterials>()

export function makeClinicMaterials(lowPower: boolean): ClinicMaterials {
  const hit = cache.get(lowPower)
  if (hit) return hit
  const built = build(lowPower)
  cache.set(lowPower, built)
  return built
}

function build(lowPower: boolean): ClinicMaterials {
  const coat = lowPower ? 0 : 1
  // Micro-relief is the first thing to go on a low-power device: it costs a
  // texture fetch per pixel per map and stops resolving below ~1.5x DPR.
  const detail = !lowPower
  const m = detail ? maps() : ({} as MapBundle)

  const result: ClinicMaterials = {
    shell: withMaps(
      {
        color: '#e7e5e0',
        roughness: 0.42,
        metalness: 0,
        clearcoat: 0.3 * coat,
        clearcoatRoughness: 0.38,
        envMapIntensity: 0.85,
      },
      detail ? m.plastic : {},
      0.22,
      detail,
    ),
    // Cooler and a shade darker than `shell`, and rougher: the difference is
    // small enough to read as two mouldings of the same product family and
    // large enough to stop a two-metre machine from being one flat field.
    shellAlt: withMaps(
      {
        color: '#dcdcd9',
        roughness: 0.52,
        metalness: 0,
        clearcoat: 0.18 * coat,
        clearcoatRoughness: 0.45,
        envMapIntensity: 0.75,
      },
      detail ? m.plasticFine : {},
      0.26,
      detail,
    ),
    shellSatin: withMaps(
      {
        color: '#eceae4',
        roughness: 0.58,
        metalness: 0,
        clearcoat: 0.12 * coat,
        clearcoatRoughness: 0.55,
        envMapIntensity: 0.65,
      },
      detail ? m.plastic : {},
      0.18,
      detail,
    ),
    bodyGraphite: withMaps(
      {
        color: '#6f7378',
        roughness: 0.44,
        metalness: 0,
        clearcoat: 0.25 * coat,
        clearcoatRoughness: 0.4,
        envMapIntensity: 0.7,
      },
      detail ? m.plastic : {},
      0.2,
      detail,
    ),
    recess: {
      color: '#17181b',
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.15,
    },
    shellDark: withMaps(
      {
        color: '#303339',
        roughness: 0.5,
        metalness: 0,
        clearcoat: 0.22 * coat,
        clearcoatRoughness: 0.42,
        envMapIntensity: 0.8,
      },
      detail ? m.plasticFine : {},
      0.26,
      detail,
    ),
    softTouch: withMaps(
      {
        color: '#26282d',
        roughness: 0.85,
        metalness: 0,
        envMapIntensity: 0.5,
      },
      detail ? m.plastic : {},
      0.4,
      detail,
    ),
    paintedSteel: withMaps(
      {
        color: '#9aa0a8',
        roughness: 0.48,
        metalness: 1,
        envMapIntensity: 1.0,
      },
      detail ? m.micro : {},
      0.16,
      detail,
    ),
    brushedSteel: withMaps(
      {
        color: '#b6bbc2',
        roughness: 0.4,
        metalness: 1,
        envMapIntensity: 1.15,
      },
      detail ? m.brushed : {},
      0.3,
      detail,
    ),
    chrome: withMaps(
      {
        color: '#eaeef3',
        roughness: 0.13,
        metalness: 1,
        envMapIntensity: 1.3,
      },
      detail ? m.microFine : {},
      0.07,
      detail,
    ),
    upholstery: withMaps(
      {
        color: '#333a45',
        roughness: 0.78,
        metalness: 0,
        sheen: 0.22 * coat,
        sheenRoughness: 0.75,
        sheenColor: '#5d6673',
        envMapIntensity: 0.32,
      },
      detail ? m.vinyl : {},
      0.85,
      detail,
    ),
    upholsteryLight: withMaps(
      {
        color: '#b6a894',
        roughness: 0.76,
        metalness: 0,
        sheen: 0.2 * coat,
        sheenRoughness: 0.75,
        sheenColor: '#cbbfae',
        envMapIntensity: 0.32,
      },
      detail ? m.vinyl : {},
      0.85,
      detail,
    ),
    rubber: withMaps(
      {
        color: '#17181b',
        roughness: 0.95,
        metalness: 0,
        envMapIntensity: 0.35,
      },
      detail ? m.plastic : {},
      0.55,
      detail,
    ),
    screenGlass: {
      color: '#080a0d',
      roughness: 0.08,
      metalness: 0,
      clearcoat: coat,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.1,
    },
    // Deliberately *not* `transmission`. Physical transmission renders the
    // whole scene again into a transmission target for every mesh that uses
    // it, so a handful of acrylic panels and flasks costs a dozen extra full
    // scene passes per frame — enough to lock the renderer outright. Thin
    // glazing this clean is visually indistinguishable from alpha blending
    // plus a clearcoat, at a fraction of the cost.
    acrylic: {
      color: '#eef4f7',
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: lowPower ? 0.2 : 0.15,
      clearcoat: 0.3 * coat,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.4,
    },
    glazing: {
      color: '#c4d2da',
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: lowPower ? 0.2 : 0.15,
      clearcoat: coat,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.5,
    },
    ceramic: withMaps(
      {
        color: '#f4f1eb',
        roughness: 0.2,
        metalness: 0,
        clearcoat: 0.6 * coat,
        clearcoatRoughness: 0.12,
        envMapIntensity: 1.0,
      },
      detail ? m.microFine : {},
      0.08,
      detail,
    ),
    wood: withMaps(
      {
        // White base: the wood map carries the timber colour itself, and a
        // tinted `color` would multiply it a second time into near-black.
        color: '#ffffff',
        roughness: 0.55,
        metalness: 0,
        clearcoat: 0.35 * coat,
        clearcoatRoughness: 0.28,
        envMapIntensity: 0.8,
      },
      detail ? m.wood : {},
      0.45,
      detail,
    ),
    stone: withMaps(
      {
        // Tint only — the stone map supplies the grain, this pulls it to the
        // warm taupe the rest of the palette is built around.
        color: '#a9a29a',
        roughness: 0.36,
        metalness: 0,
        envMapIntensity: 0.9,
      },
      detail ? m.stone : {},
      0.25,
      detail,
    ),
  }
  return result
}
