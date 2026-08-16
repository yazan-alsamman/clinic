/** @typedef {{ name: string, kind?: string }} LaserOptionMeta */

const FULL_BODY_SESSION_AREA_LABELS = [
  'وجه',
  'رقبة',
  'نقرى',
  'يدين',
  'صدر',
  'بطن',
  'ظهر',
  'إبط',
  'رجلين',
  'بكيني',
  'ديريير',
]

const PACKAGE_AREA_ALIASES = new Map([
  ['باط', 'إبطين'],
  ['ابط', 'إبطين'],
  ['إبط', 'إبطين'],
  ['ابطين', 'إبطين'],
  ['إبطين', 'إبطين'],
  ['حواف بكيني', 'بكيني'],
  ['بكيني', 'بكيني'],
  ['ساقين', 'ساقين'],
  ['رجلين', 'ساقين'],
  ['ساعدين', 'ساعدين'],
  ['يدين', 'ساعدين'],
])

function normalizeLaserBookingText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function isFullBodyLaserBookingText(text) {
  const n = normalizeLaserBookingText(text)
  return n === 'جسم كامل' || n === 'full body' || n === 'fullbody'
}

/** تفكيك اسم عرض إلى مناطق فرعية (مثل «إبطين و بكيني») */
export function splitLaserOfferAreaLabels(offerName) {
  if (isFullBodyLaserBookingText(offerName)) {
    return [...FULL_BODY_SESSION_AREA_LABELS]
  }
  const raw = String(offerName || '').trim()
  if (!raw) return []
  return raw
    .replace(/\s+و\s+/g, '|')
    .split(/\s*(?:\||\+|،|,|\/|\\)\s*/g)
    .map((x) => x.trim())
    .filter(Boolean)
}

export function normalizePackageAreaLabel(text) {
  const n = normalizeLaserBookingText(text)
  if (!n) return ''
  return PACKAGE_AREA_ALIASES.get(n) || n
}

/**
 * هل المنطقة/العرض من مناطق الباكج؟ بالمعرّف أو باسم المنطقة (مع مرادفات العروض).
 * يُستخدم حتى لا تُصنَّف منطقة باكج — خصوصاً المتبقية — كـ «خارج الباكج».
 */
export function areaBelongsToLaserPackage(optionId, label, packageIds, optionMetaById) {
  const oid = String(optionId || '').trim()
  const ids = (Array.isArray(packageIds) ? packageIds : []).map((x) => String(x || '').trim()).filter(Boolean)
  if (oid && ids.includes(oid)) return true
  const slots = expandPackageAreaSlots(ids, optionMetaById || new Map())
  const slotNorms = new Set(slots.map((s) => s.normalized).filter(Boolean))
  if (!slotNorms.size) return false
  const labels = []
  if (label) labels.push(String(label))
  const meta = oid && optionMetaById ? optionMetaById.get(oid) : null
  if (meta?.name) labels.push(String(meta.name))
  if (meta && String(meta.kind || '') === 'offer') {
    labels.push(...splitLaserOfferAreaLabels(meta.name))
  }
  return labels.some((t) => slotNorms.has(normalizePackageAreaLabel(t)))
}

function packageExpectedAreaCount(pkg) {
  const ids = Array.isArray(pkg?.procedureOptionIds) ? pkg.procedureOptionIds : []
  return Math.max(1, Math.trunc(Number(pkg?.areaCount) || 0), ids.length)
}

/**
 * @param {string[]} packageIds
 * @param {Map<string, LaserOptionMeta>} optionMetaById
 */
function expandPackageAreaSlots(packageIds, optionMetaById) {
  /** @type {{ optionId: string, label: string, normalized: string }[]} */
  const slots = []
  for (const rawId of packageIds) {
    const optionId = String(rawId || '').trim()
    if (!optionId) continue
    const meta = optionMetaById.get(optionId)
    const name = String(meta?.name || optionId).trim()
    const kind = String(meta?.kind || 'area').trim()
    if (kind === 'offer') {
      const parts = splitLaserOfferAreaLabels(name)
      const labels = parts.length > 0 ? parts : [name]
      for (const label of labels) {
        slots.push({
          optionId,
          label,
          normalized: normalizePackageAreaLabel(label),
        })
      }
      continue
    }
    slots.push({
      optionId,
      label: name,
      normalized: normalizePackageAreaLabel(name),
    })
  }
  return slots
}

/**
 * @param {Map<string, LaserOptionMeta>} optionMetaById
 */
function resolveDoneLineItemLabel(lineItem, optionMetaById) {
  const fromLabel = String(lineItem?.areaLabel || '').trim()
  if (fromLabel) return fromLabel
  const oid = String(lineItem?.procedureOptionId || '').trim()
  if (!oid) return ''
  return String(optionMetaById.get(oid)?.name || '').trim()
}

function consumeFirstMatchingSlot(slots, predicate) {
  const idx = slots.findIndex(predicate)
  if (idx < 0) return false
  slots.splice(idx, 1)
  return true
}

/**
 * @param {{ optionId: string, label: string, normalized: string }[]} slots
 * @param {Map<string, LaserOptionMeta>} optionMetaById
 */
function consumeDoneLineItemAgainstSlots(slots, lineItem, optionMetaById) {
  const oid = String(lineItem?.procedureOptionId || '').trim()
  const label = resolveDoneLineItemLabel(lineItem, optionMetaById)
  const normalized = normalizePackageAreaLabel(label)

  if (oid && consumeFirstMatchingSlot(slots, (slot) => slot.optionId === oid)) {
    return true
  }

  const doneMeta = oid ? optionMetaById.get(oid) : null
  if (doneMeta && String(doneMeta.kind || '') === 'offer') {
    const parts = splitLaserOfferAreaLabels(doneMeta.name)
    for (const part of parts) {
      const partNorm = normalizePackageAreaLabel(part)
      if (partNorm && consumeFirstMatchingSlot(slots, (slot) => slot.normalized === partNorm)) {
        return true
      }
    }
  }

  if (normalized && consumeFirstMatchingSlot(slots, (slot) => slot.normalized === normalized)) {
    return true
  }

  return false
}

/**
 * @param {object} sessionRow
 * @param {object} pkg
 * @param {Map<string, LaserOptionMeta>} optionMetaById
 */
export function buildPackageAreaBreakdown(sessionRow, pkg, optionMetaById) {
  const packageIds = (Array.isArray(pkg?.procedureOptionIds) ? pkg.procedureOptionIds : [])
    .map(String)
    .filter(Boolean)
  if (!packageIds.length) return null

  const doneItems = (Array.isArray(sessionRow?.lineItems) ? sessionRow.lineItems : []).filter((r) => !r.isAddon)
  const slots = expandPackageAreaSlots(packageIds, optionMetaById)
  const doneAreas = []

  for (const li of doneItems) {
    const label = resolveDoneLineItemLabel(li, optionMetaById)
    if (label) doneAreas.push(label)
    consumeDoneLineItemAgainstSlots(slots, li, optionMetaById)
  }

  const remainingAreas = slots.map((slot) => slot.label).filter(Boolean)
  const remainingProcedureOptionIds = [...new Set(slots.map((slot) => slot.optionId).filter(Boolean))]
  const expected = packageExpectedAreaCount(pkg)
  const expandedSlotCount = expandPackageAreaSlots(packageIds, optionMetaById).length
  const matchedPackageAreaCount = Math.max(0, expandedSlotCount - slots.length)
  const hasUnusedPackageAreas = remainingAreas.length > 0

  return {
    doneAreas,
    remainingAreas,
    remainingProcedureOptionIds,
    matchedPackageAreaCount,
    hasUnusedPackageAreas,
    isPartial: hasUnusedPackageAreas && matchedPackageAreaCount > 0,
    expectedAreaCount: Math.max(expected, expandedSlotCount),
  }
}
