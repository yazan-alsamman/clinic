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
 * Anything expensive (clearcoat, sheen, transmission) collapses on low-power
 * devices, where the extra passes cost more than they visibly buy.
 */

export interface ClinicMaterials {
  /** Injection-molded ABS shell — the off-white housing of most medical devices. */
  shell: Record<string, unknown>
  /** The darker molded plastic used for bases, bezels and control housings. */
  shellDark: Record<string, unknown>
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
  /** Enameled ceramic — cuspidor bowls, basins. */
  ceramic: Record<string, unknown>
}

export function makeClinicMaterials(lowPower: boolean): ClinicMaterials {
  const coat = lowPower ? 0 : 1
  return {
    shell: {
      color: '#e6e4df',
      roughness: 0.38,
      metalness: 0,
      clearcoat: 0.35 * coat,
      clearcoatRoughness: 0.35,
    },
    shellDark: {
      color: '#2f3238',
      roughness: 0.46,
      metalness: 0,
      clearcoat: 0.25 * coat,
      clearcoatRoughness: 0.4,
    },
    paintedSteel: {
      color: '#9aa0a8',
      roughness: 0.44,
      metalness: 1,
    },
    brushedSteel: {
      color: '#b4b9c0',
      roughness: 0.33,
      metalness: 1,
    },
    chrome: {
      color: '#eaeef3',
      roughness: 0.1,
      metalness: 1,
    },
    upholstery: {
      color: '#4c5563',
      roughness: 0.66,
      metalness: 0,
      sheen: 0.45 * coat,
      sheenRoughness: 0.6,
      sheenColor: '#8d97a6',
    },
    upholsteryLight: {
      color: '#cabfae',
      roughness: 0.64,
      metalness: 0,
      sheen: 0.4 * coat,
      sheenRoughness: 0.6,
      sheenColor: '#e6dccb',
    },
    rubber: {
      color: '#16171a',
      roughness: 0.93,
      metalness: 0,
    },
    screenGlass: {
      color: '#080a0d',
      roughness: 0.07,
      metalness: 0,
      clearcoat: coat,
      clearcoatRoughness: 0.05,
    },
    // Deliberately *not* `transmission`. Physical transmission renders the
    // whole scene again into a transmission target for every mesh that uses
    // it, so a handful of acrylic panels and flasks costs a dozen extra full
    // scene passes per frame — enough to lock the renderer outright. Thin
    // glazing this clean is visually indistinguishable from alpha blending
    // plus a clearcoat, at a fraction of the cost.
    acrylic: {
      color: '#eef4f7',
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: lowPower ? 0.2 : 0.14,
      clearcoat: 0.25 * coat,
      clearcoatRoughness: 0.1,
    },
    ceramic: {
      color: '#f4f1eb',
      roughness: 0.16,
      metalness: 0,
      clearcoat: 0.6 * coat,
      clearcoatRoughness: 0.12,
    },
  }
}
