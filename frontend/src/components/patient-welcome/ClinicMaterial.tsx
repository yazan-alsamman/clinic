/**
 * Picks the cheapest shader class a material's own properties can be drawn
 * with, instead of putting the whole clinic on the expensive one.
 *
 * The scene was authored almost entirely with `<meshPhysicalMaterial>`, which
 * is a reasonable default to reach for — until you count what it costs. A
 * census of the built scene found 975 materials, and of those **396 were on
 * the physical shader without a single physical-only feature switched on**: no
 * clearcoat, no sheen, no transmission, no iridescence, no anisotropy. Brushed
 * steel, painted steel, chrome, rubber, soft-touch, engineered stone and the
 * dark recesses — most of the equipment, in other words — were all paying for
 * branches they never used.
 *
 * That matters because three keys a shader program on the material's feature
 * set. `MeshPhysicalMaterial` adds the `PHYSICAL` define, which pulls in the
 * clearcoat, sheen, transmission, iridescence and anisotropy code paths; the
 * resulting program is both a separate variant *and* a substantially larger
 * one to compile. On a cold load the driver links those variants one at a
 * time — three only asks about a program's link status when it first draws
 * with it, and that question blocks the main thread — so every needless
 * physical variant is paid for in frozen tab.
 *
 * The distinction is genuinely free. A `MeshPhysicalMaterial` with clearcoat 0
 * and sheen 0, at three's default `ior` of 1.5, computes the same F0 of 0.04
 * that `MeshStandardMaterial` uses as a constant. The two render identically.
 * So the rule below is not an approximation of the old look — it is the same
 * image, drawn by a smaller shader.
 *
 * Call sites keep their existing shape: `<ClinicMaterial {...mats.brushedSteel} />`
 * takes the same spread the raw element did, including any per-site override,
 * and the override is merged before the decision so a site that adds clearcoat
 * still gets the physical shader.
 */
export interface ClinicMaterialProps {
  [prop: string]: unknown
}

/**
 * True only when a physical-only feature is actually *on*.
 *
 * Presence is not enough: `clinicMaterials` multiplies every clearcoat by a
 * `coat` factor that is 0 on low-power devices, so on a phone these properties
 * are all still present and all still zero. Testing the value rather than the
 * key is what lets those devices drop to the standard shader as well, which is
 * exactly where the saving is worth the most.
 */
function needsPhysicalShader(p: ClinicMaterialProps): boolean {
  const positive = (v: unknown) => typeof v === 'number' && v > 0
  return (
    positive(p.clearcoat) ||
    positive(p.sheen) ||
    positive(p.transmission) ||
    positive(p.iridescence) ||
    positive(p.anisotropy) ||
    // `specularColor`/`specularIntensity` and a non-default `ior` also only
    // exist on the physical shader. Nothing in the clinic sets them today, but
    // a future material that does must not be silently downgraded.
    p.specularColor !== undefined ||
    p.specularIntensity !== undefined ||
    p.ior !== undefined
  )
}

export function ClinicMaterial(props: ClinicMaterialProps) {
  return needsPhysicalShader(props) ? (
    <meshPhysicalMaterial {...props} />
  ) : (
    <meshStandardMaterial {...props} />
  )
}
