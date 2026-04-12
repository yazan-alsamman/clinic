import { CalculationProfile } from '../models/CalculationProfile.js'
import { evaluateExpression } from '../utils/safeExpression.js'
import { round2 } from '../utils/money.js'

/**
 * @param {string} profileCode
 * @param {{ input: Record<string, number>, param?: Record<string, number> }} args
 */
export async function runCalculationProfile(profileCode, args) {
  const code = String(profileCode || '')
    .trim()
    .toUpperCase()
  const profile = await CalculationProfile.findOne({ code, active: true }).lean()
  if (!profile) {
    throw new Error(`ملف حساب غير معروف أو غير نشط: ${code}`)
  }
  const input = { ...args.input }
  for (const k of Object.keys(input)) {
    const n = Number(input[k])
    input[k] = Number.isFinite(n) ? n : 0
  }
  const param = { ...(args.param || {}) }
  for (const k of Object.keys(param)) {
    const n = Number(param[k])
    param[k] = Number.isFinite(n) ? n : 0
  }
  /** @type {Record<string, number>} */
  const step = {}
  const sorted = [...(profile.steps || [])].sort((a, b) => a.order - b.order)
  for (const st of sorted) {
    const ctx = { input, param, step }
    const v = evaluateExpression(st.expression, ctx)
    step[st.key] = round2(v)
  }
  return {
    profileCode: profile.code,
    profileName: profile.name,
    accountingStandardTags: profile.accountingStandardTags || [],
    stepResults: step,
    inputSnapshot: input,
  }
}
