import { AccountingParameterValue } from '../models/AccountingParameterValue.js'
import { AccountingParameterDefinition } from '../models/AccountingParameterDefinition.js'

/**
 * @typedef {{ department?: string, userId?: string }} ParamScope
 */

function isActiveAt(row, at) {
  const t = at.getTime()
  if (row.validFrom && new Date(row.validFrom).getTime() > t) return false
  if (row.validTo != null && new Date(row.validTo).getTime() <= t) return false
  return true
}

function scopeScore(row, scope) {
  if (row.scopeType === 'user' && scope.userId && row.scopeId === String(scope.userId)) return 3
  if (row.scopeType === 'department' && scope.department && row.scopeId === scope.department) return 2
  if (row.scopeType === 'global' && (!row.scopeId || row.scopeId === '')) return 1
  return 0
}

/**
 * @param {string} paramKey
 * @param {ParamScope} scope
 * @param {Date} [at]
 */
export async function resolveParameterRow(paramKey, scope, at = new Date()) {
  const rows = await AccountingParameterValue.find({ paramKey }).lean()
  const candidates = rows.filter((r) => isActiveAt(r, at)).map((r) => ({ r, s: scopeScore(r, scope) }))
  const filtered = candidates.filter((x) => x.s > 0)
  if (!filtered.length) return null
  filtered.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s
    return new Date(b.r.validFrom).getTime() - new Date(a.r.validFrom).getTime()
  })
  return filtered[0].r
}

/**
 * @param {string} paramKey
 * @param {ParamScope} scope
 * @param {Date} [at]
 */
export async function resolveNumber(paramKey, scope, at = new Date()) {
  const row = await resolveParameterRow(paramKey, scope, at)
  if (!row || row.valueNumber == null || !Number.isFinite(row.valueNumber)) return null
  return row.valueNumber
}

/**
 * @param {string} paramKey
 * @param {ParamScope} scope
 * @param {Date} [at]
 */
export async function resolveString(paramKey, scope, at = new Date()) {
  const row = await resolveParameterRow(paramKey, scope, at)
  if (!row || row.valueString == null || String(row.valueString).trim() === '') return null
  return String(row.valueString).trim()
}

/**
 * @param {string[]} keys
 * @param {ParamScope} scope
 */
export async function snapshotParamsForKeys(keys, scope) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const k of keys) {
    const def = await AccountingParameterDefinition.findOne({ key: k, active: true }).lean()
    const row = await resolveParameterRow(k, scope, new Date())
    if (!def) {
      if (row?.valueNumber != null && Number.isFinite(row.valueNumber)) out[k] = row.valueNumber
      else if (row?.valueString != null && String(row.valueString).trim() !== '') out[k] = row.valueString
      else out[k] = null
      continue
    }
    if (def.dataType === 'string') {
      out[k] = row?.valueString ?? def.defaultString ?? ''
    } else if (def.dataType === 'boolean') {
      out[k] = row?.valueBoolean ?? false
    } else {
      out[k] = row?.valueNumber ?? def.defaultNumber ?? null
    }
  }
  return out
}

/** Keys stored on posted documents + resolution for admin UI */
export const TRACKED_PARAM_KEYS = [
  'calc.profile.laser',
  'calc.profile.dermatology',
  'calc.profile.dental_general',
  'calc.profile.dental_ortho',
  'doctor_share_percent',
  'discount_percent_cap',
]

/**
 * لقطة معاملات للتدقيق؛ حقيبة `param` للتعبيرات تُبنى عند الحاجة (مثلاً سقف حسم).
 * @param {ParamScope} scope
 */
export async function buildParamBagForCalculation(scope) {
  const snap = await snapshotParamsForKeys(TRACKED_PARAM_KEYS, scope)
  const capRaw = snap.discount_percent_cap
  const cap = typeof capRaw === 'number' && Number.isFinite(capRaw) ? capRaw : 100
  const param = {
    discount_percent_cap: Math.min(100, Math.max(0, cap)),
  }
  return { param, snapshot: snap }
}
